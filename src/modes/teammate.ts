/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { MessageRouter } from '../core/teams/MessageRouter.js';
import type { TeammateIncoming, TeamTask } from '../core/teams/types.js';

export interface TeammateOptions {
  teamName: string;
  name: string;
  agentName: string;
  leadSessionId: string;
  model?: string;
  workspacePath?: string;
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
  const router = new MessageRouter();

  // Helper to send a message to the lead process via stdout
  const sendToLead = (method: string, params: Record<string, unknown> = {}) => {
    router.send(process.stdout, { method, params });
  };

  // Signal ready to the lead
  sendToLead('team.ready', { name: opts.name });

  // Track current task
  let currentTask: TeamTask | null = null;

  // Listen for incoming messages from lead via stdin
  router.onMessage(process.stdin, async (msg) => {
    const { method, params } = msg as { method: string; params: Record<string, unknown> };

    switch (method) {
      case 'team.assignTask': {
        const task = params.task as TeamTask;
        currentTask = task;

        // Signal in-progress
        sendToLead('team.taskUpdate', {
          taskId: task.id,
          status: 'in_progress',
        });

        // Execute the task (placeholder - real implementation would use LLM)
        try {
          sendToLead('team.log', {
            level: 'info',
            text: `Working on: ${task.subject}`,
          });

          // TODO: Phase 13 will wire this to the actual LLM loop
          // For now, mark as completed
          sendToLead('team.taskUpdate', {
            taskId: task.id,
            status: 'completed',
            result: `Completed: ${task.subject}`,
          });
        } catch (err) {
          sendToLead('team.log', {
            level: 'error',
            text: `Error on task ${task.id}: ${(err as Error).message}`,
          });
        }

        currentTask = null;
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
        // Receive updated task list - could be used for context
        sendToLead('team.log', {
          level: 'debug',
          text: 'Received context update',
        });
        break;
      }

      case 'team.shutdown': {
        sendToLead('team.shutdownAck', {});
        process.exit(0);
        break;
      }
    }
  });

  // Keep the process alive waiting for messages
  await new Promise<void>((resolve) => {
    process.stdin.on('end', () => {
      resolve();
    });
  });
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
