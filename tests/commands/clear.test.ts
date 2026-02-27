/** @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks – declared before imports so vi.mock hoisting works
// ---------------------------------------------------------------------------

const mockHistory = vi.fn<() => Array<{ role: string; content: string }>>().mockReturnValue([]);

vi.mock('../../src/core/conversationManager.js', () => ({
  ConversationManager: {
    getInstance: () => ({ history: mockHistory }),
  },
}));

const mockExtract = vi
  .fn()
  .mockResolvedValue([]);

vi.mock('../../src/memory/extractSessionMemories.js', () => ({
  extractAndSaveSessionMemories: (...args: unknown[]) => mockExtract(...args),
}));

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------

import { clearConversation, type ClearCommandContext } from '../../src/commands/clear.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createContext(hasSession = true): ClearCommandContext {
  return {
    resetConversation: vi.fn(),
    sessionManager: {
      getCurrentSession: vi.fn().mockReturnValue(
        hasSession ? { metadata: { sessionId: 'sess-1' } } : null,
      ),
      closeSession: vi.fn().mockResolvedValue(undefined),
      createSession: vi.fn().mockResolvedValue({ metadata: { sessionId: 'sess-2' } }),
    } as any,
    memoryManager: {} as any,
    llm: {} as any,
    workspaceRoot: '/tmp/project',
    model: 'anthropic/claude-3.5-sonnet',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('/clear command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHistory.mockReturnValue([
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ]);
  });

  it('calls extractAndSaveSessionMemories before resetting conversation', async () => {
    const ctx = createContext();

    const callOrder: string[] = [];
    mockExtract.mockImplementation(async () => {
      callOrder.push('extract');
      return [{ content: 'User prefers tabs', level: 'user', tags: ['style'] }];
    });
    (ctx.resetConversation as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callOrder.push('reset');
    });

    await clearConversation(ctx);

    // extract must have been called with conversation history
    expect(mockExtract).toHaveBeenCalledTimes(1);
    expect(mockExtract).toHaveBeenCalledWith(
      expect.objectContaining({
        llm: ctx.llm,
        memoryManager: ctx.memoryManager,
        conversationHistory: mockHistory(),
        workspaceRoot: ctx.workspaceRoot,
      }),
    );

    // extract happened before reset
    expect(callOrder).toEqual(['extract', 'reset']);
  });

  it('closes current session and creates a new one', async () => {
    const ctx = createContext(true);
    await clearConversation(ctx);

    expect(ctx.sessionManager.closeSession).toHaveBeenCalledTimes(1);
    expect(ctx.sessionManager.createSession).toHaveBeenCalledWith(
      ctx.workspaceRoot,
      ctx.model,
    );
  });

  it('skips session close when no current session exists', async () => {
    const ctx = createContext(false);
    await clearConversation(ctx);

    expect(ctx.sessionManager.closeSession).not.toHaveBeenCalled();
    // Still creates a new session
    expect(ctx.sessionManager.createSession).toHaveBeenCalledTimes(1);
  });

  it('returns null', async () => {
    const ctx = createContext();
    const result = await clearConversation(ctx);
    expect(result).toBeNull();
  });
});
