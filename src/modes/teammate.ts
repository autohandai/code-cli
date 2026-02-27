/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { MessageRouter } from '../core/teams/MessageRouter.js';
import type { TeamTask } from '../core/teams/types.js';

export interface TeammateOptions {
  teamName: string;
  name: string;
  agentName: string;
  leadSessionId: string;
  model?: string;
  workspacePath?: string;
}

/**
 * Execute a task using SubAgent. Loads config, creates provider and action executor,
 * then runs the agent's LLM loop against the task description.
 */
export async function executeTask(
  opts: TeammateOptions,
  task: TeamTask
): Promise<string> {
  const { loadConfig } = await import('../config.js');
  const { ProviderFactory } = await import('../providers/ProviderFactory.js');
  const { AgentRegistry } = await import('../core/agents/AgentRegistry.js');
  const { SubAgent } = await import('../core/agents/SubAgent.js');
  const { ActionExecutor } = await import('../core/actionExecutor.js');
  const { FileActionManager } = await import('../actions/filesystem.js');

  // Load config and create provider
  const config = await loadConfig();
  const provider = ProviderFactory.create(config);
  if (opts.model) provider.setModel(opts.model);

  // Load agent definition
  const registry = AgentRegistry.getInstance();
  await registry.loadAgents();
  const agentDef = registry.getAgent(opts.agentName);
  if (!agentDef) {
    return `Error: Agent "${opts.agentName}" not found in registry.`;
  }

  // Create action executor with minimal deps for headless teammate mode
  const workspacePath = opts.workspacePath || process.cwd();
  const files = new FileActionManager(workspacePath);
  const executor = new ActionExecutor({
    runtime: {
      config,
      workspaceRoot: workspacePath,
      options: { dryRun: false },
    },
    files,
    resolveWorkspacePath: (rel: string) => path.resolve(workspacePath, rel),
    confirmDangerousAction: async () => true, // auto-approve in teammate mode
  });

  // Run SubAgent
  const agent = new SubAgent(agentDef, provider, executor, {
    clientContext: 'cli',
    depth: 0,
    maxDepth: 2,
  });

  return agent.run(task.description);
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
): Promise<void> {
  const router = new MessageRouter();

  const sendToLead = (method: string, params: Record<string, unknown> = {}) => {
    router.send(stdout, { method, params });
  };

  sendToLead('team.ready', { name: opts.name });

  return new Promise<void>((resolve) => {
    // setInterval holds a ref on the event loop, preventing Node.js from
    // exiting the process while we wait for messages from the lead.
    const keepAlive = setInterval(() => {}, 30_000);

    const shutdown = () => {
      clearInterval(keepAlive);
      resolve();
    };

    router.onMessage(stdin, async (msg) => {
      const { method, params } = msg as { method: string; params: Record<string, unknown> };

      switch (method) {
        case 'team.assignTask': {
          const task = params.task as TeamTask;

          sendToLead('team.taskUpdate', { taskId: task.id, status: 'in_progress' });

          try {
            sendToLead('team.log', { level: 'info', text: `Working on: ${task.subject}` });
            const result = await executeTask(opts, task);
            sendToLead('team.taskUpdate', {
              taskId: task.id,
              status: 'completed',
              result,
            });
          } catch (err) {
            sendToLead('team.log', {
              level: 'error',
              text: `Error on task ${task.id}: ${(err as Error).message}`,
            });
          }

          sendToLead('team.idle', { lastTask: task.id });
          break;
        }

        case 'team.message': {
          const { from, content } = params as { from: string; content: string };
          sendToLead('team.log', {
            level: 'info',
            text: `Message from ${from}: ${content}`,
          });
          break;
        }

        case 'team.updateContext': {
          sendToLead('team.log', {
            level: 'debug',
            text: 'Received context update',
          });
          break;
        }

        case 'team.shutdown': {
          sendToLead('team.shutdownAck', {});
          shutdown();
          break;
        }
      }
    });

    // When stdin closes (lead process died / pipe broken), exit gracefully.
    // We listen via the 'close' event on the readline interface's underlying
    // stream. For the router.onMessage path, readline fires 'close' when
    // its input stream ends, which reliably means the pipe is gone.
    stdin.on('close', shutdown);
  });
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
  return runTeammateModeWithStreams(opts, process.stdin, process.stdout);
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
    model: getArg('--model'),
    workspacePath: getArg('--path'),
  };
}
