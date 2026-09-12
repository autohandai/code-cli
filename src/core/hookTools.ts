import type { ToolDefinition } from './toolManager.js';
import { HOOK_EVENTS } from './hookEvents.js';
import { getLifecycleHookInventory } from './hookEvents.js';
import type { AgentAction } from '../types.js';
import type { HookManager } from './HookManager.js';
import type { HookAuthoringService, LifecycleHookLevelContext } from './HookAuthoringService.js';
import type { HookDefinition } from '../types.js';
import {
  LIFECYCLE_HOOK_LEVELS,
  normalizeLifecycleHookLevel,
  reloadLifecycleHooks,
  resolveLifecycleHookLevelPath,
  upsertLifecycleHookAtLevel,
} from './lifecycleHookLevels.js';

export const HOOK_TOOL_NAMES = new Set(['list_hooks', 'create_hook', 'set_lifecycle_hook', 'set_hook_enabled']);

type HookAction = Extract<AgentAction, { type: 'list_hooks' | 'create_hook' | 'set_lifecycle_hook' | 'set_hook_enabled' }>;
type SetLifecycleHookAction = Extract<AgentAction, { type: 'set_lifecycle_hook' }>;

const MAX_COMMAND_LENGTH = 4_000;
const MAX_DESCRIPTION_LENGTH = 240;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 120_000;

export interface HookToolContext {
  manager: HookManager;
  authoring: Pick<HookAuthoringService, 'create'>;
  getActiveProvider: () => string;
  /** Approval for a command hook; the preview names the event, command, level, and file. */
  confirm?: (preview: string) => Promise<boolean>;
  levels?: LifecycleHookLevelContext;
}

export function isHookAction(action: AgentAction): action is HookAction {
  return HOOK_TOOL_NAMES.has(action.type);
}

function requireText(value: unknown, field: string, max: number): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`Hook ${field} is required.`);
  if (text.length > max) throw new Error(`Hook ${field} must be ${max} characters or fewer.`);
  return text;
}

function optionalStringList(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string' && entry.trim())) {
    throw new Error(`Hook filter.${field} must be a list of non-empty strings.`);
  }
  return value.map((entry: string) => entry.trim());
}

function buildLifecycleHook(action: SetLifecycleHookAction): HookDefinition {
  if (!(HOOK_EVENTS as readonly string[]).includes(action.event)) {
    throw new Error(`Unknown lifecycle event "${action.event}". Call list_hooks for the event names.`);
  }
  if (action.timeout !== undefined && (!Number.isInteger(action.timeout) || action.timeout < MIN_TIMEOUT_MS || action.timeout > MAX_TIMEOUT_MS)) {
    throw new Error(`Hook timeout must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS} milliseconds.`);
  }
  const tool = optionalStringList(action.filter?.tool, 'tool');
  const filterPath = optionalStringList(action.filter?.path, 'path');
  const filter = tool || filterPath ? { ...(tool ? { tool } : {}), ...(filterPath ? { path: filterPath } : {}) } : undefined;
  return {
    event: action.event,
    command: requireText(action.command, 'command', MAX_COMMAND_LENGTH),
    description: requireText(action.description, 'description', MAX_DESCRIPTION_LENGTH),
    enabled: action.enabled !== false,
    ...(action.timeout !== undefined ? { timeout: action.timeout } : {}),
    ...(action.async ? { async: true } : {}),
    ...(action.matcher?.trim() ? { matcher: action.matcher.trim() } : {}),
    ...(filter ? { filter } : {}),
  };
}

async function setLifecycleHook(action: SetLifecycleHookAction, context: HookToolContext, signal?: AbortSignal): Promise<string> {
  const { levels, confirm, manager } = context;
  if (!levels || !confirm) throw new Error('Lifecycle hook levels are not available in this session.');
  const level = normalizeLifecycleHookLevel(action.level);
  const hook = buildLifecycleHook(action);
  const target = { level, workspaceRoot: levels.runtime.workspaceRoot, configPath: levels.runtime.config.configPath };
  const filePath = await resolveLifecycleHookLevelPath(target);
  const preview = [
    'Install lifecycle hook',
    `Event: ${hook.event}`,
    `Command: ${hook.command}`,
    `Description: ${hook.description}`,
    `Level: ${level} (${filePath})`,
    ...(hook.filter?.tool ? [`Tools: ${hook.filter.tool.join(', ')}`] : []),
    ...(hook.filter?.path ? [`Paths: ${hook.filter.path.join(', ')}`] : []),
    ...(hook.matcher ? [`Matcher: ${hook.matcher}`] : []),
    `Timeout: ${hook.timeout ?? 5000} ms${hook.async ? ' · async' : ''}${hook.enabled ? '' : ' · saved disabled'}`,
  ].join('\n');
  signal?.throwIfAborted();
  if (!await confirm(preview)) return JSON.stringify({ status: 'cancelled' });
  signal?.throwIfAborted();
  const wasTrusted = levels.runtime.config.workspaceTrust?.trusted ?? true;
  const written = await upsertLifecycleHookAtLevel({ ...target, hook });
  const reloaded = await reloadLifecycleHooks(levels.runtime, manager, { extendTrust: wasTrusted, trustStorePath: levels.trustStorePath });
  return JSON.stringify({
    status: written.replaced ? 'updated' : 'created',
    level,
    path: written.path,
    hook,
    trusted: reloaded.trusted,
    active: manager.isEnabled() && reloaded.trusted && hook.enabled !== false,
  });
}

export async function executeHookTool(action: HookAction, context: HookToolContext, signal?: AbortSignal): Promise<string> {
  if (context.getActiveProvider() !== 'autohandai') throw new Error('Lifecycle hook tools are available only with the Autohand AI provider.');
  const { manager } = context;
  if (action.type === 'set_lifecycle_hook') return setLifecycleHook(action, context, signal);
  if (action.type === 'list_hooks') {
    const hooks = manager.getHooks();
    return JSON.stringify({ enabled: manager.isEnabled(), events: getLifecycleHookInventory(manager),
      configHooks: hooks.map(hook => ({ ...hook, index: hooks.filter(candidate => candidate.event === hook.event).indexOf(hook) })),
    });
  }
  if (action.type === 'create_hook') return JSON.stringify(await context.authoring.create(action, signal));
  if (!Number.isInteger(action.index) || action.index < 0) throw new Error('Hook index must be a non-negative integer.');
  if (!await manager.setHookEnabled(action.event, action.index, action.enabled)) {
    throw new Error('Config hook not found. Call list_hooks for current indexes.');
  }
  return JSON.stringify({ event: action.event, index: action.index, enabled: action.enabled, active: action.enabled && manager.isEnabled() });
}

export const HOOK_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'list_hooks',
    description: 'List Autohand lifecycle events, installed and active counts, config hooks and enabled plugin hooks. Use when the user asks about lifecycle automation.',
  },
  {
    name: 'create_hook',
    description: 'Create a lifecycle hook from a plain-English request ONLY when the user asks for persistent automation. Generates a workspace-scoped Node.js script, reviews it with the user, and saves the hook. Never run the script to test it automatically. Autohand AI only.',
    parameters: { type: 'object', properties: {
      prompt: { type: 'string', description: 'The user-requested trigger and script behavior in plain English.' },
      event: { type: 'string', description: 'Optional lifecycle event; otherwise infer it from the request.', enum: HOOK_EVENTS },
      level: { type: 'string', description: 'Where the hook is saved: project (shared .autohand/config), local (this machine only), or user (every workspace, default).', enum: [...LIFECYCLE_HOOK_LEVELS] },
    }, required: ['prompt'] },
  },
  {
    name: 'set_lifecycle_hook',
    description: 'Install or update a lifecycle hook that runs a shell command when the user asks for automation such as "run lint after every tool call". Prefer this over create_hook whenever a single command does the job. The user reviews the event, command, and level before it is saved; a hook with the same event and description at that level is updated in place. Autohand AI only.',
    parameters: { type: 'object', properties: {
      event: { type: 'string', description: 'Lifecycle event that triggers the command, for example post-tool or session-end.', enum: HOOK_EVENTS },
      command: { type: 'string', description: 'Shell command to run, executed from the workspace root, for example "bun run lint".' },
      description: { type: 'string', description: 'Short label shown in /hooks; reuse it to update the same hook later.' },
      level: { type: 'string', description: 'project (shared .autohand/config, default), local (this machine only), or user (every workspace).', enum: [...LIFECYCLE_HOOK_LEVELS] },
      filter: { type: 'object', description: 'Optional limits on when the hook fires.', properties: {
        tool: { type: 'array', description: 'Only for these tool names, for example ["write_file", "apply_patch"].', items: { type: 'string' } },
        path: { type: 'array', description: 'Only for files matching these globs, for example ["src/**/*.ts"].', items: { type: 'string' } },
      } },
      matcher: { type: 'string', description: 'Optional regular expression matched against the event target, such as a tool name.' },
      timeout: { type: 'number', description: 'Milliseconds before the command is stopped; default 5000.' },
      async: { type: 'boolean', description: 'Run without blocking the agent; default false.' },
      enabled: { type: 'boolean', description: 'Save the hook disabled when false; default true.' },
    }, required: ['event', 'command', 'description'] },
  },
  {
    name: 'set_hook_enabled',
    description: 'Enable or disable one config hook when explicitly requested. Obtain its event and zero-based index from list_hooks. Plugin hooks are managed with /extensions. Autohand AI only.',
    parameters: { type: 'object', properties: {
      event: { type: 'string', description: 'Exact config event returned by list_hooks.', enum: HOOK_EVENTS },
      index: { type: 'number', description: 'Zero-based index within config hooks for this exact event.' },
      enabled: { type: 'boolean', description: 'Whether the hook should be enabled.' },
    }, required: ['event', 'index', 'enabled'] },
    requiresApproval: true,
  },
];
