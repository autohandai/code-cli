/** @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { t } from '../i18n/index.js';
import { ConversationManager } from '../core/conversationManager.js';
import { extractAndSaveSessionMemories } from '../memory/extractSessionMemories.js';
import type { SessionManager } from '../session/SessionManager.js';
import type { MemoryManager } from '../memory/MemoryManager.js';
import type { LLMProvider } from '../providers/LLMProvider.js';
import type { HookManager } from '../core/HookManager.js';

export interface ClearCommandContext {
  resetConversation: () => void | Promise<void>;
  sessionManager: SessionManager;
  memoryManager: MemoryManager;
  llm: LLMProvider;
  workspaceRoot: string;
  model: string;
  hookManager?: HookManager;
}

/**
 * Clear conversation command - extracts memories, then resets to a fresh session.
 */
export async function clearConversation(ctx: ClearCommandContext): Promise<string | null> {
  // 1. Emit pre-clear hook before memory extraction
  if (ctx.hookManager) {
    await ctx.hookManager.executeHooks('pre-clear', {
      sessionId: ctx.sessionManager.getCurrentSession()?.metadata.sessionId ?? '',
    });
  }

  // 2. Capture conversation history before we reset anything
  const conversationHistory = ConversationManager.getInstance().history();

  // 3. Extract and save memories from the conversation
  const saved = await extractAndSaveSessionMemories({
    llm: ctx.llm,
    memoryManager: ctx.memoryManager,
    conversationHistory,
    workspaceRoot: ctx.workspaceRoot,
  });

  // 4. Close the current session if one exists
  const currentSession = ctx.sessionManager.getCurrentSession();
  if (currentSession) {
    await ctx.sessionManager.closeSession('Session ended - conversation cleared');
  }

  // 5. Reset the conversation context
  await ctx.resetConversation();

  // 6. Create a new session
  await ctx.sessionManager.createSession(ctx.workspaceRoot, ctx.model);

  // 7. Print summary
  console.log();
  if (saved.length > 0) {
    console.log(
      chalk.cyan(
        `Conversation cleared. ${saved.length} ${saved.length === 1 ? 'memory' : 'memories'} saved. Starting fresh.`,
      ),
    );
  } else {
    console.log(chalk.cyan(t('commands.new.cleared')));
  }
  console.log();

  return null;
}

export const metadata = {
  command: '/clear',
  description: 'clear conversation with automatic memory extraction',
  implemented: true,
};
