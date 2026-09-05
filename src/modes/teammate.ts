/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import type { Readable, Writable } from 'node:stream';
import type { PreToolHookContext, ToolDefinition } from '../core/toolManager.js';
import type { AgentRuntime, ProviderName } from '../types.js';
import { MessageRouter } from '../core/teams/MessageRouter.js';
import { TeamTaskSchema, type TeamTask } from '../core/teams/types.js';
import { TeammateThreadBudget } from '../core/teams/TeammateThreadBudget.js';
import { TeammateAuthorizationBroker, type TeammateAuthorizationResult } from '../core/teams/TeammateAuthorization.js';
import { BackgroundProcessRegistry } from '../core/agent/BackgroundProcessRegistry.js';
import type { SubAgentOptions } from '../core/agents/SubAgent.js';
import { checkWorkspaceSafety } from '../startup/workspaceSafety.js';
import { validateWorkspacePath } from '../startup/checks.js';

export interface TeammateOptions {
  teamName: string;
  name: string;
  agentName: string;
  leadSessionId: string;
  provider?: ProviderName;
  model?: string;
  workspacePath?: string;
  configPath?: string;
}

export interface TeammateTaskRuntime extends Pick<SubAgentOptions,
  'threadBudget' | 'getPendingInstructions' | 'onProgress' | 'onSubagentStart' | 'onSubagentProgress' | 'onSubagentStop'> {
  signal?: AbortSignal;
  authorizeTool?: (context: PreToolHookContext) => Promise<TeammateAuthorizationResult>;
  backgroundProcessRegistry?: BackgroundProcessRegistry;
}

export async function withTeammateTaskEnvironment<T>(
  opts: TeammateOptions,
  task: TeamTask,
  action: () => Promise<T>,
): Promise<T> {
  const scopedEnvironment: Record<string, string | undefined> = {
    AUTOHAND_TEAM_NAME: opts.teamName,
    AUTOHAND_TEAMMATE_NAME: opts.name,
    AUTOHAND_TEAMMATE_AGENT: opts.agentName,
    AUTOHAND_TEAM_LEAD_SESSION_ID: opts.leadSessionId,
    AUTOHAND_TEAM_TASK_ID: task.id,
    AUTOHAND_TEAM_TASK_SUBJECT: task.subject,
    AUTOHAND_TEAM_TASK_OWNER: task.owner,
  };
  const previousEnvironment = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(scopedEnvironment)) {
    previousEnvironment.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    return await action();
  } finally {
    for (const [key, value] of previousEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/**
 * Execute a task using SubAgent. Loads config, creates provider and action executor,
 * then runs the agent's LLM loop against the task description.
 */
export async function executeTask(
  opts: TeammateOptions,
  task: TeamTask,
  taskRuntime: TeammateTaskRuntime = {},
): Promise<string> {
  const backgroundProcessRegistry = taskRuntime.backgroundProcessRegistry ?? new BackgroundProcessRegistry();
  try {
    return await withTeammateTaskEnvironment(opts, task, () => executeTaskWithEnvironment(opts, task, {
      ...taskRuntime,
      backgroundProcessRegistry,
    }));
  } finally {
    if (!taskRuntime.backgroundProcessRegistry) await backgroundProcessRegistry.shutdown(250);
  }
}

async function executeTaskWithEnvironment(
  opts: TeammateOptions,
  task: TeamTask,
  taskRuntime: TeammateTaskRuntime,
): Promise<string> {
  const { loadConfig, getProviderConfig } = await import('../config.js');
  const { ProviderFactory } = await import('../providers/ProviderFactory.js');
  const { AgentRegistry } = await import('../core/agents/AgentRegistry.js');
  const { SubAgent } = await import('../core/agents/SubAgent.js');
  const { ActionExecutor } = await import('../core/actionExecutor.js');
  const { FileActionManager } = await import('../actions/filesystem.js');
  const { createToolsRegistry } = await import('../core/toolsRegistry.js');
  const { PermissionManager } = await import('../permissions/PermissionManager.js');
  const { syncDynamicRuntimeExtensions } = await import('../core/agent/dynamicRuntimeExtensions.js');
  const { resolveTeamModelAssignment } = await import('../core/teams/TeamModelPolicy.js');

  // Load config and create provider
  const workspacePath = opts.workspacePath || process.cwd();
  const loadedConfig = await loadConfig(opts.configPath, workspacePath);
  const config = opts.provider ? { ...loadedConfig, provider: opts.provider } : loadedConfig;
  const provider = ProviderFactory.create(config);
  if (opts.model) provider.setModel(opts.model);

  const runtime: AgentRuntime = {
    config,
    workspaceRoot: workspacePath,
    options: { clientContext: 'cli' },
  };
  const toolsRegistry = createToolsRegistry(workspacePath);
  let runtimeToolDefinitions: ToolDefinition[] = [];
  await syncDynamicRuntimeExtensions({
    toolsRegistry,
    toolManager: {
      replaceRuntimeMetaTools: (definitions) => {
        runtimeToolDefinitions = [...definitions];
      },
    },
  }, runtime);

  // Resolve the agent only after standalone and extension registries are loaded.
  const registry = AgentRegistry.getInstance();
  registry.configureExternalAgents(config.externalAgents);
  await registry.loadAgents();
  const agentDef = registry.getAgent(opts.agentName);
  if (!agentDef) {
    throw new Error(`Agent "${opts.agentName}" not found in registry.`);
  }

  // Create action executor with minimal deps for headless teammate mode
  const files = new FileActionManager(workspacePath);
  const permissionManager = new PermissionManager({
    settings: config.permissions,
    workspaceRoot: workspacePath,
  });
  await permissionManager.initLocalSettings();
  const executor = new ActionExecutor({
    runtime,
    files,
    resolveWorkspacePath: (rel: string) => path.resolve(workspacePath, rel),
    confirmDangerousAction: async () => false,
    toolsRegistry,
    permissionManager,
    getRegisteredTools: () => runtimeToolDefinitions,
    getCurrentSessionId: () => opts.leadSessionId,
    backgroundProcessRegistry: taskRuntime.backgroundProcessRegistry,
  });

  // Run SubAgent
  const authorizationContext: string[] = [];
  const agent = new SubAgent(agentDef, provider, executor, {
    ...taskRuntime,
    getPendingInstructions: () => [...authorizationContext.splice(0), ...(taskRuntime.getPendingInstructions?.() ?? [])],
    workspaceRoot: workspacePath,
    model: opts.model,
    resolveSubagentAssignment: (definition) => {
      const selectedProvider = config.provider ?? 'openrouter';
      return resolveTeamModelAssignment({
        config,
        active: {
          provider: selectedProvider,
          model: opts.model ?? getProviderConfig(config, selectedProvider)?.model ?? 'unconfigured',
        },
        agentName: definition.name,
        agentModel: definition.model,
      });
    },
    createSubagentProvider: (assignment) => {
      const nestedProvider = ProviderFactory.create({ ...config, provider: assignment.provider });
      nestedProvider.setModel(assignment.model);
      return nestedProvider;
    },
    parentId: task.runId ?? task.id,
    clientContext: 'cli',
    depth: 1,
    maxDepth: taskRuntime.threadBudget ? 3 : 1,
    featureConfig: config,
    getToolDefinitions: () => runtimeToolDefinitions,
    authorization: {
      permissionManager,
      resolvePermissionContext: (action) => executor.getPermissionContext(action),
      runPreToolHooks: async (context) => {
        if (!taskRuntime.authorizeTool) throw new Error('Lead tool authorization is unavailable in this teammate runtime.');
        const result = await taskRuntime.authorizeTool(context);
        context.signal?.throwIfAborted();
        if (!result.allowed) throw new Error(result.error);
        authorizationContext.push(...(result.additionalContext ?? []).map(content => `[Lead authorization context]\n${content}`));
        return [{
          hook: { event: 'pre-tool', command: 'lead-authorization' }, success: true, duration: 0,
          response: { decision: 'allow', updatedInput: result.args },
        }];
      },
    },
    confirmApproval: async () => false,
  });

  return agent.run(task.description, { signal: taskRuntime.signal });
}

/**
 * Core teammate loop with injectable streams for testability.
 *
 * Uses a setInterval keep-alive instead of awaiting process.stdin 'end',
 * which is unreliable when readline has consumed the stream (readline's
 * internal stream management can cause premature 'end' events on piped stdin,
 * making the teammate exit before receiving any tasks).
 *
 * The teammate exits when:
 * 1. It receives a 'team.shutdown' message from the lead
 * 2. The stdin stream closes (lead process died)
 */
export async function runTeammateModeWithStreams(
  opts: TeammateOptions,
  stdin: Readable,
  stdout: Writable,
  dependencies: { execute?: typeof executeTask; signal?: AbortSignal } = {},
): Promise<void> {
  const router = new MessageRouter();
  const sendToLead = (method: string, params: Record<string, unknown> = {}) => {
    if (stdout.destroyed || !stdout.writable) return;
    router.send(stdout, { method, params });
  };
  const budget = new TeammateThreadBudget(sendToLead);
  const authorizationBroker = new TeammateAuthorizationBroker(sendToLead);
  const backgroundRegistries = new Set<BackgroundProcessRegistry>();
  const stopBackgroundProcesses = () => Promise.all(
    [...backgroundRegistries].map((registry) => registry.shutdown(250)),
  );
  const pendingInstructions: string[] = [];
  const nestedCancels = new Map<string, () => void>();
  let pendingContext: string | undefined;
  let active: { taskId: string; runId?: string; controller: AbortController; promise: Promise<void> } | undefined;
  let closing = false;
  let resolveShutdown!: () => void;
  const stopped = new Promise<void>((resolve) => { resolveShutdown = resolve; });
  const keepAlive = setInterval(() => {}, 30_000);

  const shutdown = () => {
    if (closing) return;
    closing = true;
    active?.controller.abort(new Error('Teammate shutting down'));
    budget.disconnect();
    authorizationBroker.disconnect();
    resolveShutdown();
  };

  const execute = async (task: TeamTask, controller: AbortController) => {
    const execution = { taskId: task.id, runId: task.runId };
    const backgroundProcessRegistry = new BackgroundProcessRegistry();
    backgroundRegistries.add(backgroundProcessRegistry);
    const stopTaskProcesses = () => { void backgroundProcessRegistry.shutdown(250); };
    controller.signal.addEventListener('abort', stopTaskProcesses, { once: true });
    if (controller.signal.aborted) stopTaskProcesses();
    sendToLead('team.taskUpdate', { ...execution, status: 'in_progress' });
    try {
      const result = await (dependencies.execute ?? executeTask)(opts, task, {
        signal: controller.signal,
        threadBudget: budget,
        authorizeTool: (context) => authorizationBroker.authorize(context, execution),
        backgroundProcessRegistry,
        getPendingInstructions: () => {
          const instructions = pendingInstructions.splice(0);
          if (pendingContext) instructions.push(pendingContext);
          pendingContext = undefined;
          return instructions;
        },
        onProgress: (progress) => { sendToLead('team.progress', { ...execution, ...progress }); },
        onSubagentStart: async (context) => {
          if (context.cancel) nestedCancels.set(context.subagentId, context.cancel);
          sendToLead('team.subagentStart', { ...execution, ...context, cancel: undefined });
        },
        onSubagentProgress: async (context) => { sendToLead('team.subagentProgress', { ...execution, ...context }); },
        onSubagentStop: async (context) => {
          nestedCancels.delete(context.subagentId);
          sendToLead('team.subagentStop', { ...execution, ...context, cancel: undefined });
        },
      });
      controller.signal.throwIfAborted();
      sendToLead('team.taskUpdate', { ...execution, status: 'completed', result });
    } catch (error) {
      await backgroundProcessRegistry.shutdown(250);
      sendToLead('team.taskUpdate', {
        ...execution,
        status: controller.signal.aborted ? 'cancelled' : 'failed',
        error: (error instanceof Error ? error.message : String(error)).slice(0, 4_000),
      });
    } finally {
      controller.signal.removeEventListener('abort', stopTaskProcesses);
      if (backgroundProcessRegistry.list().length === 0) backgroundRegistries.delete(backgroundProcessRegistry);
      nestedCancels.clear();
      active = undefined;
      if (!closing) sendToLead('team.idle', { lastTask: task.id, runId: task.runId });
    }
  };

  const unsubscribe = router.onMessage(stdin, ({ method, params }) => {
    if (method === 'team.authorizationResult') {
      authorizationBroker.handleResult(params);
      return;
    }
    if (method === 'team.threadResult') {
      budget.handleResult(params);
      return;
    }
    if (closing) return;
    switch (method) {
      case 'team.assignTask': {
        const parsed = TeamTaskSchema.safeParse(params.task);
        if (!parsed.success) {
          sendToLead('team.log', { level: 'error', text: 'Invalid teammate task payload' });
          break;
        }
        if (active) {
          if (active.taskId === parsed.data.id && active.runId === parsed.data.runId) break;
          sendToLead('team.taskUpdate', { taskId: parsed.data.id, runId: parsed.data.runId, status: 'failed', error: 'Teammate is already running a task' });
          break;
        }
        const controller = new AbortController();
        const promise = Promise.resolve().then(() => execute(parsed.data, controller));
        active = { taskId: parsed.data.id, runId: parsed.data.runId, controller, promise };
        break;
      }
      case 'team.cancelTask':
        if (active && active.taskId === params.taskId && active.runId === params.runId) active.controller.abort(new Error(
          typeof params.reason === 'string' ? params.reason.slice(0, 4_000) : 'Task cancelled by the lead',
        ));
        break;
      case 'team.cancelRun':
        if (typeof params.runId === 'string') nestedCancels.get(params.runId)?.();
        break;
      case 'team.message':
        if (typeof params.from === 'string' && typeof params.content === 'string') {
          pendingInstructions.push(`Message from ${params.from.slice(0, 200)}:\n${params.content.slice(0, 8_000)}`);
          if (pendingInstructions.length > 32) pendingInstructions.shift();
        }
        break;
      case 'team.updateContext': {
        const parsed = TeamTaskSchema.array().safeParse(params.tasks);
        if (parsed.success) pendingContext = `Current team tasks:\n${JSON.stringify(parsed.data.slice(0, 100).map((task) => ({
          id: task.id, subject: task.subject.slice(0, 500), status: task.status, owner: task.owner, blockedBy: task.blockedBy,
        })))}`;
        break;
      }
      case 'team.shutdown':
        shutdown();
        break;
    }
  }, shutdown);

  stdin.on('end', shutdown);
  stdin.on('close', shutdown);
  stdout.on('error', shutdown);
  dependencies.signal?.addEventListener('abort', shutdown, { once: true });
  try {
    sendToLead('team.ready', { name: opts.name });
    if (dependencies.signal?.aborted) shutdown();
    await stopped;
    await Promise.all([active?.promise, stopBackgroundProcesses()]);
  } finally {
    await stopBackgroundProcesses();
    clearInterval(keepAlive);
    unsubscribe();
    budget.dispose();
    authorizationBroker.disconnect();
    stdin.off('end', shutdown);
    stdin.off('close', shutdown);
    stdout.off('error', shutdown);
    dependencies.signal?.removeEventListener('abort', shutdown);
  }
  sendToLead('team.shutdownAck');
}

/**
 * Run autohand in teammate mode. This is a headless mode where the process
 * receives tasks from the lead process via JSON-RPC over stdin and reports
 * results back via stdout.
 *
 * Lifecycle:
 * 1. Parse teammate options from CLI args
 * 2. Send `team.ready` to lead
 * 3. Listen for incoming messages (assignTask, message, shutdown, updateContext)
 * 4. For each task: set status working, execute, send taskUpdate + idle
 * 5. On shutdown: send shutdownAck and exit
 */
export async function runTeammateMode(opts: TeammateOptions): Promise<void> {
  const workspacePath = opts.workspacePath || process.cwd();
  const workspacePathValidation = await validateWorkspacePath(workspacePath);
  if (!workspacePathValidation.valid) {
    process.stderr.write(`[Teammate] Error: ${workspacePathValidation.error}\n`);
    process.exit(1);
  }
  const safetyCheck = checkWorkspaceSafety(workspacePath);
  if (!safetyCheck.safe) {
    process.stderr.write(`[Teammate] Error: Unsafe workspace — ${safetyCheck.reason}\n`);
    process.exit(1);
  }
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error('Teammate process interrupted'));
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  try {
    await runTeammateModeWithStreams(opts, process.stdin, process.stdout, { signal: controller.signal });
  } finally {
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
  }
}

/**
 * Parse teammate CLI options from process.argv.
 * Returns null if not all required options are present.
 */
export function parseTeammateOptions(argv: string[]): TeammateOptions | null {
  const getArg = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx >= 0 && idx + 1 < argv.length ? argv[idx + 1] : undefined;
  };

  const teamName = getArg('--team');
  const name = getArg('--name');
  const agentName = getArg('--agent');
  const leadSessionId = getArg('--lead-session');

  if (!teamName || !name || !agentName || !leadSessionId) {
    return null;
  }

  return {
    teamName,
    name,
    agentName,
    leadSessionId,
    provider: getArg('--provider') as ProviderName | undefined,
    model: getArg('--model'),
    workspacePath: getArg('--path'),
    configPath: getArg('--config'),
  };
}
