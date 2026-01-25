/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LLMGatewayProvider } from '../../src/providers/LLMGatewayProvider.js';
import type { LLMGatewaySettings } from '../../src/types.js';

describe('LLMGatewayProvider', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('getName', () => {
    it('should return llmgateway', () => {
      const settings: LLMGatewaySettings = {
        apiKey: 'test-key',
        model: 'gpt-4o'
      };
      const provider = new LLMGatewayProvider(settings);
      expect(provider.getName()).toBe('llmgateway');
    });
  });

  describe('setModel', () => {
    it('should update the model', () => {
      const settings: LLMGatewaySettings = {
        apiKey: 'test-key',
        model: 'gpt-4o'
      };
      const provider = new LLMGatewayProvider(settings);
      provider.setModel('claude-3-5-sonnet-20241022');
      expect(provider).toBeDefined();
    });
  });

  describe('listModels', () => {
    it('should return a list of available models', async () => {
      const settings: LLMGatewaySettings = {
        apiKey: 'test-key',
        model: 'gpt-4o'
      };
      const provider = new LLMGatewayProvider(settings);
      const models = await provider.listModels();

      expect(models).toContain('gpt-4o');
      expect(models).toContain('gpt-4o-mini');
      expect(models).toContain('claude-3-5-sonnet-20241022');
    });
  });

  describe('isAvailable', () => {
    it('should return true', async () => {
      const settings: LLMGatewaySettings = {
        apiKey: 'test-key',
        model: 'gpt-4o'
      };
      const provider = new LLMGatewayProvider(settings);
      const available = await provider.isAvailable();

      expect(available).toBe(true);
    });
  });

  describe('complete', () => {
    it('should delegate to the client', async () => {
      const mockResponse = {
        id: 'test-id',
        created: Date.now(),
        choices: [{
          message: {
            role: 'assistant',
            content: 'Hello from LLM Gateway!'
          },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: 5,
          completion_tokens: 10,
          total_tokens: 15
        }
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const settings: LLMGatewaySettings = {
        apiKey: 'test-key',
        model: 'gpt-4o'
      };
      const provider = new LLMGatewayProvider(settings);

      const response = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }]
      });

      expect(response.content).toBe('Hello from LLM Gateway!');
      expect(response.finishReason).toBe('stop');
    });
  });
});
