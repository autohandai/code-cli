/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SimpleChatHandler, type SimpleChatAgent } from '../../../src/core/agent/SimpleChatHandler.js';
import type { LLMMessage } from '../../../src/types.js';
import type { LLMProvider } from '../../../src/providers/LLMProvider.js';
import { ReactionParser } from '../../../src/core/agent/ReactionParser.js';

const sessionId = 'session-123';

describe('SimpleChatHandler prompt cache affinity', () => {
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
