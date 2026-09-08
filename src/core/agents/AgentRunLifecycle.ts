/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { HookContext, HookExecutionResult } from '../HookManager.js';
import type { HookEvent } from '../../types.js';
import { isAgentRunActive, type AgentRunLifecycleEvent } from './AgentRunStore.js';

interface AgentRunLifecycleOptions {
  executeHooks: (event: HookEvent, context: Omit<HookContext, 'event' | 'workspace'>) => Promise<HookExecutionResult[]>;
  sendMessage: (id: string, content: string) => Promise<unknown>;
  requestCancel: (id: string) => Promise<unknown>;
}

interface PendingEvent {
  event: AgentRunLifecycleEvent;
  resolved: Array<() => void>;
}

const HOOK_EVENTS = {
  start: 'subagent-start',
  progress: 'subagent-progress',
  message: 'subagent-message',
  'cancel-requested': 'subagent-cancel-requested',
  stop: 'subagent-stop',
} satisfies Record<AgentRunLifecycleEvent['type'], HookEvent>;

function hookContext({ run, message }: AgentRunLifecycleEvent): Omit<HookContext, 'event' | 'workspace'> {
  return {
    subagentId: run.id,
    subagentName: run.name,
    subagentType: run.agentType ?? run.source,
    subagentParentId: run.parentId,
    subagentSource: run.source,
    subagentStatus: run.status,
    subagentWorkspace: run.workspaceRoot,
    subagentTask: run.task,
    subagentActivity: run.activity,
    subagentMessage: message,
    subagentSuccess: run.status === 'completed',
    subagentError: run.error,
    subagentDuration: Math.max(0, (run.finishedAt ?? run.updatedAt) - run.startedAt),
    provider: run.provider,
    model: run.model,
    tokensUsed: run.usage?.totalTokens,
  };
}

export function createAgentRunLifecycleHandler(options: AgentRunLifecycleOptions): (event: AgentRunLifecycleEvent) => Promise<void> {
  const queues = new Map<string, PendingEvent[]>();

  const execute = async (event: AgentRunLifecycleEvent): Promise<void> => {
    const results = await options.executeHooks(HOOK_EVENTS[event.type], hookContext(event));
    if ((event.type !== 'start' && event.type !== 'progress')
      || !isAgentRunActive(event.run) || event.run.cancelRequested) return;
    const responses = results.filter(result => result.success && !result.hook.async).map(result => result.response);
    if (responses.some(response => response?.continue === false)) {
      await options.requestCancel(event.run.id);
      return;
    }
    for (const response of responses) {
      if (typeof response?.additionalContext !== 'string') continue;
      const content = response.additionalContext.trim().slice(0, 8_000);
      if (content) await options.sendMessage(event.run.id, content);
    }
  };

  const drain = async (id: string, queue: PendingEvent[]): Promise<void> => {
    while (queue.length > 0) {
      const pending = queue[0];
      try {
        await execute(pending.event);
      } catch {
        // Hook failures must not stop the worker or prevent its later lifecycle events.
      } finally {
        queue.shift();
        for (const resolve of pending.resolved) resolve();
      }
    }
    queues.delete(id);
  };

  return (event) => {
    if (event.run.source === 'squad') return Promise.resolve();
    return new Promise<void>((resolve) => {
      const queue = queues.get(event.run.id);
      if (queue) {
        const previous = queue.at(-1);
        // Coalesce only waiting progress; control events retain their exact order.
        if (queue.length > 1 && event.type === 'progress' && previous?.event.type === 'progress') {
          previous.event = event;
          previous.resolved.push(resolve);
        } else {
          queue.push({ event, resolved: [resolve] });
        }
      } else {
        const pending = [{ event, resolved: [resolve] }];
        queues.set(event.run.id, pending);
        void drain(event.run.id, pending);
      }
    });
  };
}
