/** @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { ConversationManager } from '../core/conversationManager.js';
import { compactSessionContext, type SessionCompactionResult } from '../core/context/sessionCompaction.js';
import type { SessionManager } from '../session/SessionManager.js';
import type { MemoryManager } from '../memory/MemoryManager.js';
import type { LLMProvider } from '../providers/LLMProvider.js';
import type { HookManager } from '../core/HookManager.js';
import type { AutohandAISettings } from '../types.js';

export interface ClearCommandContext {
  resetConversation: (summary?: string) => void | Promise<void>;
  startNewSession?: () => Promise<unknown>;
  compactionSettings?: AutohandAISettings;
  signal?: AbortSignal;
  sessionManager: SessionManager;
  memoryManager: MemoryManager;
  llm: LLMProvider;
  workspaceRoot: string;
  model: string;
  hookManager?: HookManager;
  /** Optional callback to clear the screen (Ink-aware) instead of raw ANSI */
  clearScreen?: () => void;
}

export async function clearConversation(ctx: ClearCommandContext): Promise<string | null> {
  ctx.signal?.throwIfAborted();
  let compacted: SessionCompactionResult;
  try {
    compacted = await compactSessionContext({
      history: ConversationManager.getInstance().history(),
      settings: ctx.compactionSettings,
      signal: ctx.signal,
    });
  } catch (error) {
    if (ctx.signal?.aborted) return 'Context compaction cancelled. Conversation unchanged.';
    throw error;
  }
  const { summary, source } = compacted;
  ctx.signal?.throwIfAborted();
  if (ctx.hookManager) {
    await ctx.hookManager.executeHooks('pre-clear', {
      sessionId: ctx.sessionManager.getCurrentSession()?.metadata.sessionId ?? '',
    });
  }
  ctx.signal?.throwIfAborted();
  await ctx.sessionManager.getCurrentSession()?.append({
    role: 'system', content: summary, timestamp: new Date().toISOString(),
    _meta: { contextCompaction: true },
  });
  await ctx.resetConversation(summary);
  ctx.clearScreen?.();
  return `Context compacted. Request, learnings, changes and final answer retained (${source === 'weka' ? 'Weka' : 'local fallback'}).`;
}

/**
 * Standalone hosts may supply only the basic session primitives.
 */
export async function resetConversationSession(ctx: ClearCommandContext, closeReason: string): Promise<string | null> {
  if (ctx.startNewSession) {
    await ctx.startNewSession();
    ctx.clearScreen?.();
    return 'New session started.';
  }
  if (ctx.hookManager) {
    await ctx.hookManager.executeHooks('pre-clear', {
      sessionId: ctx.sessionManager.getCurrentSession()?.metadata.sessionId ?? '',
    });
  }

  const currentSession = ctx.sessionManager.getCurrentSession();
  if (currentSession) {
    await ctx.sessionManager.closeSession(closeReason);
  }

  await ctx.resetConversation();

  await ctx.sessionManager.createSession(ctx.workspaceRoot, ctx.model);

  ctx.clearScreen?.();
  return 'New session started.';
}

export const metadata = {
  command: '/clear',
  description: 'compact current context while retaining a session handoff',
  implemented: true,
};
