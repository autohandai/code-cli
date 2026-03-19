/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAIProvider, OPENAI_MODELS } from '../../src/providers/OpenAIProvider.js';

describe('OpenAIProvider – reasoning effort & model list', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('listModels', () => {
    it('should return the GPT-5.4 model family', async () => {
      const provider = new OpenAIProvider({
        baseUrl: 'http://localhost:9999',
        apiKey: 'test-key',
        model: 'gpt-5.4',
      });

      const models = await provider.listModels();
      expect(models).toEqual([...OPENAI_MODELS]);
    });

    it('OPENAI_MODELS constant contains expected models', () => {
      expect(OPENAI_MODELS).toContain('gpt-5.4');
      expect(OPENAI_MODELS).toContain('gpt-5.4-pro');
      expect(OPENAI_MODELS).toContain('gpt-5.3-codex');
      expect(OPENAI_MODELS).toContain('gpt-5.1-codex-max');
    });
  });

  describe('default model', () => {
    it('should default to gpt-5.4 when no model is specified', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({
          id: 'resp-1',
          created: 1234567890,
          choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );

      const provider = new OpenAIProvider({
        baseUrl: 'http://localhost:9999',
        apiKey: 'test-key',
        model: '',
      });

      await provider.complete({ messages: [{ role: 'user', content: 'hi' }] });

      const sentBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(sentBody.model).toBe('gpt-5.4');
    });
  });

  describe('reasoning_effort', () => {
    function makeOkResponse() {
      return new Response(JSON.stringify({
        id: 'resp-1',
        created: 1234567890,
        choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    it('should include reasoning_effort when set in provider config', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(makeOkResponse());

      const provider = new OpenAIProvider({
        baseUrl: 'http://localhost:9999',
        apiKey: 'test-key',
        model: 'gpt-5.4',
        reasoningEffort: 'high',
      });

      await provider.complete({ messages: [{ role: 'user', content: 'hi' }] });

      const sentBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(sentBody.reasoning_effort).toBe('high');
    });

    it('should not include reasoning_effort when not set', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(makeOkResponse());

      const provider = new OpenAIProvider({
        baseUrl: 'http://localhost:9999',
        apiKey: 'test-key',
        model: 'gpt-5.4',
      });

      await provider.complete({ messages: [{ role: 'user', content: 'hi' }] });

      const sentBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(sentBody.reasoning_effort).toBeUndefined();
    });

    it.each(['none', 'low', 'medium', 'high', 'xhigh'] as const)(
      'should pass reasoning_effort=%s to API',
      async (level) => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(makeOkResponse());

        const provider = new OpenAIProvider({
          baseUrl: 'http://localhost:9999',
          apiKey: 'test-key',
          model: 'gpt-5.4-pro',
          reasoningEffort: level,
        });

        await provider.complete({ messages: [{ role: 'user', content: 'test' }] });

        const sentBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
        expect(sentBody.reasoning_effort).toBe(level);
      },
    );

    it('should not include reasoning_effort when set to undefined', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(makeOkResponse());

      const provider = new OpenAIProvider({
        baseUrl: 'http://localhost:9999',
        apiKey: 'test-key',
        model: 'gpt-5.4',
        reasoningEffort: undefined,
      });

      await provider.complete({ messages: [{ role: 'user', content: 'hi' }] });

      const sentBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(sentBody.reasoning_effort).toBeUndefined();
    });

    it('should not send invalid reasoning_effort values to API', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(makeOkResponse());

      const provider = new OpenAIProvider({
        baseUrl: 'http://localhost:9999',
        apiKey: 'test-key',
        model: 'gpt-5.4',
        reasoningEffort: 'garbage_value' as any,
      });

      await provider.complete({ messages: [{ role: 'user', content: 'hi' }] });

      const sentBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(sentBody.reasoning_effort).toBeUndefined();
    });
  });
});
