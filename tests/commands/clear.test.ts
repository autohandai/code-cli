import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationManager } from '../../src/core/conversationManager.js';
import { clearConversation, type ClearCommandContext } from '../../src/commands/clear.js';
import type { SessionManager } from '../../src/session/SessionManager.js';
import type { MemoryManager } from '../../src/memory/MemoryManager.js';
import type { LLMProvider } from '../../src/providers/LLMProvider.js';

const conversation = ConversationManager.getInstance();
const append = vi.fn().mockResolvedValue(undefined);
const reset = vi.fn((summary?: string) => {
  conversation.reset('Fresh system prompt');
  if (summary) conversation.addSystemNote(summary);
});
function context(): ClearCommandContext {
  return {
    resetConversation: reset,
    sessionManager: {
      getCurrentSession: () => ({ metadata: { sessionId: 'same-session' }, append }),
      closeSession: vi.fn(), createSession: vi.fn(),
    } as unknown as SessionManager,
    memoryManager: {} as MemoryManager,
    llm: { complete: vi.fn(() => new Promise(() => {})) } as unknown as LLMProvider,
    workspaceRoot: '/project', model: 'moa', clearScreen: vi.fn(),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  append.mockResolvedValue(undefined);
  conversation.reset('System');
  conversation.addMessage({ role: 'user', content: 'Fix the retry race in src/retry.ts' });
  conversation.addMessage({ role: 'tool', name: 'write_file', content: 'Updated src/retry.ts: cancellation now wins.' });
  conversation.addMessage({ role: 'assistant', content: 'Learnt that cancellation must settle first. Fixed src/retry.ts and tests pass.' });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('/clear context handoff', () => {
  it('compacts even a single turn while retaining the request, changes, lessons and final answer', async () => {
    const ctx = context();
    const result = await clearConversation(ctx);
    const summary = reset.mock.calls[0]?.[0];
    expect(summary).toContain('Fix the retry race');
    expect(summary).toContain('Updated src/retry.ts');
    expect(summary).toContain('cancellation must settle first');
    expect(summary).toContain('tests pass');
    expect(conversation.history()).toHaveLength(2);
    expect(ctx.sessionManager.closeSession).not.toHaveBeenCalled();
    expect(ctx.sessionManager.createSession).not.toHaveBeenCalled();
    expect(result).toContain('Context compacted');
    expect(ctx.clearScreen).toHaveBeenCalledOnce();
  });
  it('persists a compaction checkpoint before changing the active context', async () => {
    await clearConversation(context());
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      role: 'system', content: expect.stringContaining('[Session Handoff]'),
      _meta: { contextCompaction: true },
    }));
    expect(append.mock.invocationCallOrder[0]).toBeLessThan(reset.mock.invocationCallOrder[0]!);
  });
  it('leaves context intact if the checkpoint cannot be persisted', async () => {
    append.mockRejectedValueOnce(new Error('disk full'));
    await expect(clearConversation(context())).rejects.toThrow('disk full');
    expect(reset).not.toHaveBeenCalled();
    expect(conversation.history()).toHaveLength(4);
  });
  it('does not mutate anything after cancellation', async () => {
    const ctx = context();
    const controller = new AbortController();
    controller.abort();
    Object.assign(ctx, { signal: controller.signal });
    await expect(clearConversation(ctx)).rejects.toThrow();
    expect(append).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });
  it('returns to the composer cleanly when the user cancels an in-flight Weka call', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => { controller.abort(); throw controller.signal.reason; }));
    const ctx = Object.assign(context(), {
      signal: controller.signal,
      compactionSettings: { plan: 'cloud' as const, authMode: 'api-key' as const, apiKey: 'fixture-key' },
    });
    expect(await clearConversation(ctx)).toContain('cancelled');
    expect(append).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });
});
