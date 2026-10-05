/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { AXO_PERSONA, AxoResponder, normalizeAxoReply } from '../../src/core/agent/AxoResponder.js';
import type { LLMProvider } from '../../src/providers/LLMProvider.js';

function provider(complete: LLMProvider['complete'], name = 'openrouter'): LLMProvider {
  return {
    getName: () => name,
    complete,
    listModels: async () => [],
    isAvailable: async () => true,
    setModel: () => {},
  } as LLMProvider;
}

describe('AxoResponder', () => {
  it('asks once with the tiny persona and a small budget', async () => {
    const complete = vi.fn<LLMProvider['complete']>(async () => ({ content: '  "Tests are just bugs you invited over!"  ' }) as never);
    const responder = new AxoResponder({ getProvider: () => provider(complete), enabled: true });
    await expect(responder.ask('  why write tests?  ')).resolves.toBe('Tests are just bugs you invited over!');
    expect(complete).toHaveBeenCalledTimes(1);
    const request = complete.mock.calls[0]![0];
    expect(request.messages).toEqual([
      { role: 'system', content: AXO_PERSONA },
      { role: 'user', content: 'why write tests?' },
    ]);
    expect(request.maxTokens).toBeLessThanOrEqual(80);
    expect(request.signal).toBeInstanceOf(AbortSignal);
  });

  it('stays quiet when disabled, unconfigured, or failing', async () => {
    const complete = vi.fn<LLMProvider['complete']>(async () => ({ content: 'hi' }) as never);
    await expect(new AxoResponder({ getProvider: () => provider(complete), enabled: false }).ask('hi')).resolves.toBeNull();
    await expect(new AxoResponder({ getProvider: () => provider(complete, 'unconfigured'), enabled: true }).ask('hi')).resolves.toBeNull();
    await expect(new AxoResponder({ getProvider: () => null, enabled: true }).ask('hi')).resolves.toBeNull();
    expect(complete).not.toHaveBeenCalled();
    const failing = provider(async () => {
      throw new Error('signed out');
    });
    await expect(new AxoResponder({ getProvider: () => failing, enabled: true }).ask('hi')).resolves.toBeNull();
  });

  it('gives up after its timeout, and when the caller aborts', async () => {
    const hang = provider(
      (request) =>
        new Promise((_, reject) => request.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
    );
    await expect(new AxoResponder({ getProvider: () => hang, enabled: true, timeoutMs: 20 }).ask('hi')).resolves.toBeNull();
    const controller = new AbortController();
    const pending = new AxoResponder({ getProvider: () => hang, enabled: true }).ask('hi', controller.signal);
    controller.abort();
    await expect(pending).resolves.toBeNull();
  });
});

describe('normalizeAxoReply', () => {
  it('flattens, unquotes, and bounds a reply', () => {
    expect(normalizeAxoReply('“Hello\n  there!”')).toBe('Hello there!');
    expect(normalizeAxoReply('```js\nx\n``` ok')).toBe('ok');
    expect(normalizeAxoReply('   ')).toBeNull();
    expect(normalizeAxoReply(undefined)).toBeNull();
    expect(normalizeAxoReply('x'.repeat(500))?.length).toBe(200);
  });
});
