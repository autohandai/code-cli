import { describe, expect, it, vi } from 'vitest';
import { newConversation, type NewCommandContext } from '../../src/commands/new.js';
import type { SessionManager } from '../../src/session/SessionManager.js';
import type { MemoryManager } from '../../src/memory/MemoryManager.js';
import type { LLMProvider } from '../../src/providers/LLMProvider.js';

describe('/new session', () => {
  it('uses the full session lifecycle without waiting for inference', async () => {
    const complete = vi.fn(() => new Promise(() => {}));
    const startNewSession = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      resetConversation: vi.fn(), startNewSession,
      sessionManager: {} as SessionManager, memoryManager: {} as MemoryManager,
      llm: { complete } as unknown as LLMProvider,
      workspaceRoot: '/project', model: 'moa', clearScreen: vi.fn(),
    } satisfies NewCommandContext;
    const result = await newConversation(ctx);
    expect(startNewSession).toHaveBeenCalledOnce();
    expect(complete).not.toHaveBeenCalled();
    expect(ctx.resetConversation).not.toHaveBeenCalled();
    expect(ctx.clearScreen).toHaveBeenCalledOnce();
    expect(result).toContain('New session started');
  });
  it('does not clear the screen when starting the session fails', async () => {
    const ctx = {
      startNewSession: vi.fn().mockRejectedValue(new Error('storage unavailable')),
      resetConversation: vi.fn(), sessionManager: {} as SessionManager,
      memoryManager: {} as MemoryManager, llm: {} as LLMProvider,
      workspaceRoot: '/project', model: 'moa', clearScreen: vi.fn(),
    } satisfies NewCommandContext;
    await expect(newConversation(ctx)).rejects.toThrow('storage unavailable');
    expect(ctx.clearScreen).not.toHaveBeenCalled();
  });
});
