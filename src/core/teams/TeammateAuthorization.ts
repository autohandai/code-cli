/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ToolManager, type PreToolHookContext, type ToolDefinition, type ToolManagerOptions } from '../toolManager.js';
import type { AgentRuntime, ToolCallRequest } from '../../types.js';
import { isToolAllowedByYolo, normalizeYoloInput, parseYoloPattern } from '../../permissions/yoloMode.js';

export function createTeammateConfirmation(
  runtime: Pick<AgentRuntime, 'config' | 'options'>,
  confirm: ToolManagerOptions['confirmApproval'],
): ToolManagerOptions['confirmApproval'] {
  return async (message, context) => {
    let automatic = runtime.options.yes === true || runtime.options.unrestricted === true || runtime.config.ui?.autoConfirm === true;
    const yolo = normalizeYoloInput(runtime.options.yolo);
    if (yolo && context?.tool) {
      try { automatic ||= isToolAllowedByYolo(context.tool, parseYoloPattern(yolo)); } catch { /* Malformed input does not grant approval. */ }
    }
    if (!automatic) throw new Error('Teammate tool requires interactive approval. Authorize a specific rule in the lead session, or perform this tool in the lead session.');
    return confirm(message, context);
  };
}

export const TeammateAuthorizationRequestSchema = z.object({
  requestId: z.string().min(1).max(200), taskId: z.string().min(1).max(200), runId: z.string().min(1).max(200),
  call: z.object({ id: z.string().min(1).max(200), tool: z.string().min(1).max(200), args: z.record(z.string(), z.unknown()) }),
});
export type TeammateToolCall = z.infer<typeof TeammateAuthorizationRequestSchema>['call'];

export type TeammateAuthorizationResult =
  | { allowed: true; args: Record<string, unknown>; additionalContext?: string[] }
  | { allowed: false; error: string };

const ResultSchema = z.discriminatedUnion('allowed', [
  z.object({ allowed: z.literal(true), args: z.record(z.string(), z.unknown()), additionalContext: z.array(z.string().max(8_000)).max(16).optional() }),
  z.object({ allowed: z.literal(false), error: z.string().max(4_000) }),
]);

interface PendingAuthorization {
  settle(result: TeammateAuthorizationResult | Error): void;
}

export class TeammateAuthorizationBroker {
  private readonly pending = new Map<string, PendingAuthorization>();
  private disconnected = false;

  constructor(
    private readonly send: (method: string, params: Record<string, unknown>) => void,
    private readonly timeoutMs = 120_000,
  ) {}

  authorize(context: PreToolHookContext, execution: { taskId: string; runId?: string }): Promise<TeammateAuthorizationResult> {
    if (this.disconnected) return Promise.reject(new Error('Team lead disconnected; tool authorization unavailable.'));
    if (!execution.runId) return Promise.reject(new Error('Tool authorization requires an active task attempt.'));
    if (this.pending.size >= 128) return Promise.reject(new Error('Too many pending teammate authorization requests.'));
    context.signal?.throwIfAborted();
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const stop = (message: string) => {
        if (!this.pending.has(requestId)) return;
        settle(new Error(message));
        try { this.send('team.authorizationCancel', { requestId }); } catch { /* The lead also cancels on process exit. */ }
      };
      const cancel = () => stop('Teammate tool authorization cancelled.');
      const timeout = setTimeout(() => stop('Timed out waiting for lead tool authorization.'), this.timeoutMs);
      timeout.unref?.();
      const settle = (result: TeammateAuthorizationResult | Error) => {
        if (!this.pending.delete(requestId)) return;
        clearTimeout(timeout);
        context.signal?.removeEventListener('abort', cancel);
        if (result instanceof Error) reject(result);
        else resolve(result);
      };
      this.pending.set(requestId, { settle });
      context.signal?.addEventListener('abort', cancel, { once: true });
      if (context.signal?.aborted) { cancel(); return; }
      try {
        this.send('team.authorizeTool', {
          ...execution, requestId,
          call: { id: context.toolCallId, tool: context.tool, args: context.args },
        });
      } catch (error) {
        settle(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  handleResult(params: Record<string, unknown>): void {
    if (typeof params.requestId !== 'string') return;
    const pending = this.pending.get(params.requestId);
    if (!pending) return;
    const parsed = ResultSchema.safeParse(params.result);
    pending.settle(parsed.success ? parsed.data : new Error('The lead returned invalid tool authorization.'));
  }

  disconnect(): void {
    this.disconnected = true;
    for (const pending of this.pending.values()) pending.settle(new Error('Team lead disconnected; tool authorization unavailable.'));
  }
}

export async function authorizeTeammateTool(
  call: { id?: string; tool: string; args?: Record<string, unknown> },
  options: Omit<ToolManagerOptions, 'executor' | 'definitions'> & { definitions: ToolDefinition[] },
  signal?: AbortSignal,
): Promise<TeammateAuthorizationResult> {
  const definition = options.definitions.find(item => item.name === call.tool);
  if (!definition) return { allowed: false, error: 'This tool is unavailable in the lead runtime.' };
  let authorizedArgs: Record<string, unknown> | undefined;
  const additionalContext: string[] = [];
  const manager = new ToolManager({
    ...options,
    ...(options.authorization ? { authorization: {
      ...options.authorization,
      onAdditionalContext: (context) => {
        if (additionalContext.length >= 16 || context.length > 8_000) throw new Error('Lead authorization context exceeds the safe transport limit.');
        additionalContext.push(context);
      },
    } } : {}),
    executor: async (action) => {
      authorizedArgs = Object.fromEntries(Object.entries(action).filter(([key]) => key !== 'type'));
      return { success: true };
    },
  });
  const [result] = await manager.execute([{ id: call.id, tool: definition.name, args: call.args as ToolCallRequest['args'] }], undefined, { signal });
  return result?.success && authorizedArgs && !signal?.aborted
    ? { allowed: true, args: authorizedArgs, ...(additionalContext.length ? { additionalContext } : {}) }
    : { allowed: false, error: (result && !result.success ? result.error : undefined) ?? 'The lead did not authorize this tool call.' };
}
