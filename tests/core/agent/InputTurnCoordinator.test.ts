/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  injectAgentContinuationMessage,
  isAgentRetryableSessionError,
} from '../../../src/core/agent/InputTurnCoordinator.js';
import { ConversationManager } from '../../../src/core/conversationManager.js';
import { classifyApiError } from '../../../src/providers/errors.js';

describe('isAgentRetryableSessionError', () => {
  // Rate limits are terminal for the SESSION retry loop. ApiError.retryable means
  // "retryable eventually at transport level", which is not the same as "retry this
  // turn right now" — burning the retry budget on a quota that resets tomorrow just
  // spams the user with recovery attempts that cannot succeed.
  it('does not session-retry a 429 rate limit', () => {
    const error = classifyApiError(429, 'Rate limit exceeded: free-models-per-day.');

    expect(error.code).toBe('rate_limited');
    expect(isAgentRetryableSessionError(error)).toBe(false);
  });

  it('does not session-retry a daily quota exhaustion reported without an HTTP status', () => {
    const error = classifyApiError(
      0,
      'Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day'
    );

    expect(error.code).toBe('rate_limited');
    expect(isAgentRetryableSessionError(error)).toBe(false);
  });

  it('does not session-retry a rate limit surfaced as a plain Error', () => {
    expect(isAgentRetryableSessionError(new Error('Rate limit exceeded, too many requests'))).toBe(false);
  });

  it.each([
    ['server_error', 503, 'The upstream service is unavailable'],
    ['timeout', 504, 'Gateway timeout'],
  ])('still session-retries %s so transient outages recover', (code, status, body) => {
    const error = classifyApiError(status, body);

    expect(error.code).toBe(code);
    expect(isAgentRetryableSessionError(error)).toBe(true);
  });

  it('still session-retries network failures', () => {
    expect(isAgentRetryableSessionError(new Error('fetch failed'))).toBe(true);
  });

  it('does not session-retry non-recoverable auth failures', () => {
    const error = classifyApiError(401, 'Unauthorized');

    expect(isAgentRetryableSessionError(error)).toBe(false);
  });
});

describe('rate-limit hook event registration', () => {
  // A hook event is only usable if every registry knows about it. Half-wiring one
  // yields an event users can configure but never receive, so assert the full set.
  it('is registered across the CLI hook registries', async () => {
    const { HOOK_EVENTS } = await import('../../../src/commands/hooks.js');
    const { RPC_NOTIFICATIONS } = await import('../../../src/modes/rpc/types.js');

    expect(HOOK_EVENTS).toContain('rate-limit');
    expect(RPC_NOTIFICATIONS.HOOK_RATE_LIMIT).toBe('autohand.hook.rateLimit');
  });
});

describe('agent input host contracts', () => {
  it('keeps input and prompt hosts explicit instead of using broad any index signatures', () => {
    const inputSource = readFileSync('src/core/agent/InputTurnCoordinator.ts', 'utf-8');
    const promptSource = readFileSync('src/core/agent/PromptInstructionReader.ts', 'utf-8');

    expect(inputSource).not.toContain('[key: string]: any');
    expect(promptSource).not.toContain('[key: string]: any');
  });

  it('queues active-turn input through the PersistentInput public contract', () => {
    const inputSource = readFileSync('src/core/agent/InputTurnCoordinator.ts', 'utf-8');

    expect(inputSource).not.toContain('(host.persistentInput as any).queue');
    expect(inputSource).toContain('host.persistentInput.enqueue(text)');
  });
});

describe('injectAgentContinuationMessage', () => {
  it('skips recovery notes when the conversation has not been initialized yet', () => {
    const conversation = new ConversationManager();
    const addSystemNote = vi.spyOn(conversation, 'addSystemNote');

    expect(() => {
      injectAgentContinuationMessage(
        { conversation },
        new Error('provider failed during startup'),
        0
      );
    }).not.toThrow();
    expect(addSystemNote).not.toHaveBeenCalled();
  });

  it('adds recovery notes after the conversation is initialized', () => {
    const conversation = new ConversationManager();
    conversation.reset('system prompt');

    injectAgentContinuationMessage(
      { conversation },
      new Error('provider failed mid-turn'),
      0
    );

    expect(conversation.history()).toContainEqual({
      role: 'system',
      content: expect.stringContaining('[System Recovery]'),
    });
  });
});
