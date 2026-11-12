/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SimpleChatHandler, type SimpleChatAgent } from '../../../src/core/agent/SimpleChatHandler.js';
import type { LLMMessage, LLMRequest } from '../../../src/types.js';
import type { LLMProvider } from '../../../src/providers/LLMProvider.js';
import { ReactionParser } from '../../../src/core/agent/ReactionParser.js';
import { AnthropicProvider } from '../../../src/providers/AnthropicProvider.js';

const sessionId = 'session-123';

describe('SimpleChatHandler prompt cache affinity', () => {
  it('previews streamed greetings before completion and clears the transient frame', async () => {
    const { agent } = createAgent();
    const preview = vi.fn();
    agent.inkRenderer = { setStreamingResponse: preview };
    agent.llm.getCapabilities = () => ({ nativeToolCalling: true, streaming: true });
    agent.llm.complete = async (request: LLMRequest) => {
      expect(request.stream).toBe(true);
      request.onDelta?.({ type: 'content', text: 'Hello there' });
      expect(preview).toHaveBeenCalledWith('Hello there');
      return { id: 'greeting', created: 1, content: 'Hello there!', raw: {} };
    };
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await new SimpleChatHandler(agent).handle('hello')).toBe(true);
    expect(preview).toHaveBeenLastCalledWith(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses an opaque active-session prompt-cache key when enabled', async () => {
    const { agent, complete } = createAgent(sessionId);
    (agent as SimpleChatAgent & { isPromptCachingEnabled(): boolean }).isPromptCachingEnabled = () => true;
    const handler = new SimpleChatHandler(agent);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(handler.handle('Hello')).resolves.toBe(true);

    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      promptCache: { key: 'ahpc_DzK47b3oj6VjrqBwQcBE1QfMuE8dOKcQsbV0KLKX-S8' },
    }));
  });

  it('omits prompt-cache metadata while the experimental gate is disabled', async () => {
    const { agent, complete } = createAgent(sessionId);
    (agent as SimpleChatAgent & { isPromptCachingEnabled(): boolean }).isPromptCachingEnabled = () => false;
    const handler = new SimpleChatHandler(agent);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(handler.handle('Hello')).resolves.toBe(true);

    expect(complete).toHaveBeenCalledWith(expect.not.objectContaining({
      promptCache: expect.anything(),
    }));
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ sessionId }));
  });

  it('changes the Go routing header with the active conversation even when prompt caching is disabled', async () => {
    const { agent } = createAgent();
    let activeSession = 'original-session';
    agent.getSessionManager = () => ({ getCurrentSession: () => ({ metadata: { sessionId: activeSession } }) });
    agent.isPromptCachingEnabled = () => false;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({
      id: 'go-response', type: 'message', role: 'assistant', model: 'minimax-m3',
      content: [{ type: 'text', text: 'Hello' }], stop_reason: 'end_turn',
      usage: { input_tokens: 3, output_tokens: 1 },
    }));
    agent.llm = new AnthropicProvider({ apiKey: 'fixture', model: 'minimax-m3', baseUrl: 'https://opencode.ai/inference/go/anthropic' });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const handler = new SimpleChatHandler(agent);
    await expect(handler.handle('Hello')).resolves.toBe(true);
    activeSession = 'new-session';
    await expect(handler.handle('Hello again')).resolves.toBe(true);
    const ids = fetch.mock.calls.map(([, init]) => new Headers(init?.headers).get('x-opencode-session'));
    expect(ids[0]).toMatch(/^autohand_[a-f0-9]{64}$/);
    expect(ids[1]).not.toBe(ids[0]);
    for (const [, init] of fetch.mock.calls) {
      expect(String(init?.body)).not.toMatch(/original-session|new-session|sessionId/);
    }
  });

  it('omits prompt-cache metadata without an active session', async () => {
    const { agent, complete } = createAgent();
    const handler = new SimpleChatHandler(agent);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(handler.handle('Hello')).resolves.toBe(true);

    expect(complete).toHaveBeenCalledWith(expect.not.objectContaining({
      promptCache: expect.anything(),
    }));
  });
});

function createAgent(activeSessionId?: string): {
  agent: SimpleChatAgent;
  complete: ReturnType<typeof vi.fn>;
} {
  const messages: LLMMessage[] = [];
  const complete = vi.fn(async () => ({
    id: 'response-1',
    created: Date.now(),
    content: 'Hi there!',
    raw: {},
  }));

  return {
    agent: {
      isInstructionActive: false,
      conversation: {
        addMessage(message) {
          messages.push(message);
        },
        history() {
          return messages;
        },
      },
      llm: { complete } as unknown as LLMProvider,
      totalTokensUsed: 0,
      currentTurnActualUsage: { kind: 'unavailable', reason: 'not_reported' },
      currentTurnHadUnavailableUsage: false,
      lastAssistantResponseForNotification: '',
      saveUserMessage: vi.fn(async () => {}),
      saveAssistantMessage: vi.fn(async () => {}),
      getReactionParser: () => new ReactionParser(),
      cleanupModelResponse: (content) => content,
      updateContextUsage: vi.fn(),
      getSessionManager: () => ({
        getCurrentSession: () => activeSessionId
          ? { metadata: { sessionId: activeSessionId } }
          : null,
      }),
    },
    complete,
  };
}
