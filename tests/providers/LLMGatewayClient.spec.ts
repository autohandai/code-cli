/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LLMGatewayClient } from '../../src/providers/LLMGatewayClient.js';
import type { LLMGatewaySettings, NetworkSettings } from '../../src/types.js';

describe('LLMGatewayClient', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should use default base URL when not provided', () => {
      const settings: LLMGatewaySettings = {
        apiKey: 'test-key',
        model: 'gpt-4o'
      };
      const client = new LLMGatewayClient(settings);
      expect(client).toBeDefined();
    });

    it('should use custom base URL when provided', () => {
      const settings: LLMGatewaySettings = {
        apiKey: 'test-key',
        model: 'gpt-4o',
        baseUrl: 'https://custom.llmgateway.io/v1'
      };
      const client = new LLMGatewayClient(settings);
      expect(client).toBeDefined();
    });

    it('should apply network settings with limits', () => {
      const settings: LLMGatewaySettings = {
        apiKey: 'test-key',
        model: 'gpt-4o'
      };
      const networkSettings: NetworkSettings = {
        maxRetries: 10, // Should be capped at 5
        retryDelay: 2000,
        timeout: 60000
      };
      const client = new LLMGatewayClient(settings, networkSettings);
      expect(client).toBeDefined();
    });
  });

  describe('setDefaultModel', () => {
    it('should update the default model', () => {
      const settings: LLMGatewaySettings = {
        apiKey: 'test-key',
        model: 'gpt-4o'
      };
      const client = new LLMGatewayClient(settings);
      client.setDefaultModel('claude-3-5-sonnet-20241022');
      expect(client).toBeDefined();
    });
  });

  describe('complete', () => {
    it('should make a successful request', async () => {
      const mockResponse = {
        id: 'test-id',
        created: Date.now(),
        choices: [{
          message: {
            role: 'assistant',
            content: 'Hello, I am an AI assistant.'
          },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30
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
      const client = new LLMGatewayClient(settings);

      const response = await client.complete({
        messages: [{ role: 'user', content: 'Hello' }]
      });

      expect(response.content).toBe('Hello, I am an AI assistant.');
      expect(response.finishReason).toBe('stop');
      expect(response.usage?.promptTokens).toBe(10);
      expect(response.usage?.completionTokens).toBe(20);
      expect(response.usage?.totalTokens).toBe(30);
    });

    it('should handle tool calls in response', async () => {
      const mockResponse = {
        id: 'test-id',
        created: Date.now(),
        choices: [{
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call_123',
              type: 'function',
              function: {
                name: 'read_file',
                arguments: '{"path": "/test.txt"}'
              }
            }]
          },
          finish_reason: 'tool_calls'
        }]
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const settings: LLMGatewaySettings = {
        apiKey: 'test-key',
        model: 'gpt-4o'
      };
      const client = new LLMGatewayClient(settings);

      const response = await client.complete({
        messages: [{ role: 'user', content: 'Read the file' }],
        tools: [{
          name: 'read_file',
          description: 'Read a file',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string' }
            }
          }
        }]
      });

      expect(response.toolCalls).toBeDefined();
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls![0].function.name).toBe('read_file');
      expect(response.toolCalls![0].function.arguments).toBe('{"path": "/test.txt"}');
    });

    it('should include Authorization header when API key is provided', async () => {
      const mockResponse = {
        id: 'test-id',
        created: Date.now(),
        choices: [{
          message: { role: 'assistant', content: 'Test' },
          finish_reason: 'stop'
        }]
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });
      global.fetch = fetchMock;

      const settings: LLMGatewaySettings = {
        apiKey: 'my-secret-key',
        model: 'gpt-4o'
      };
      const client = new LLMGatewayClient(settings);

      await client.complete({
        messages: [{ role: 'user', content: 'Hello' }]
      });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer my-secret-key',
            'Content-Type': 'application/json'
          })
        })
      );
    });

    it('should throw friendly error on 401 authentication failure', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: { message: 'Invalid API key' } })
      });

      const settings: LLMGatewaySettings = {
        apiKey: 'invalid-key',
        model: 'gpt-4o'
      };
      const client = new LLMGatewayClient(settings);

      await expect(client.complete({
        messages: [{ role: 'user', content: 'Hello' }]
      })).rejects.toThrow(/Authentication failed/);
    });

    it('should throw friendly error on 429 rate limit', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: () => Promise.resolve({ error: { message: 'Rate limit exceeded' } })
      });

      const settings: LLMGatewaySettings = {
        apiKey: 'test-key',
        model: 'gpt-4o'
      };
      // Disable retries for this test
      const client = new LLMGatewayClient(settings, { maxRetries: 0 });

      await expect(client.complete({
        messages: [{ role: 'user', content: 'Hello' }]
      })).rejects.toThrow(/Rate limit exceeded/);
    });

    it('should throw error for payload too large', async () => {
      const settings: LLMGatewaySettings = {
        apiKey: 'test-key',
        model: 'gpt-4o'
      };
      const client = new LLMGatewayClient(settings);

      // Create a message that exceeds 5MB
      const largeContent = 'x'.repeat(6 * 1024 * 1024);

      await expect(client.complete({
        messages: [{ role: 'user', content: largeContent }]
      })).rejects.toThrow(/Request payload too large/);
    });

    it('should handle request cancellation', async () => {
      const controller = new AbortController();

      global.fetch = vi.fn().mockImplementation(() => {
        return new Promise((_, reject) => {
          controller.signal.addEventListener('abort', () => {
            const error = new Error('Aborted');
            error.name = 'AbortError';
            reject(error);
          });
        });
      });

      const settings: LLMGatewaySettings = {
        apiKey: 'test-key',
        model: 'gpt-4o'
      };
      const client = new LLMGatewayClient(settings);

      const promise = client.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        signal: controller.signal
      });

      controller.abort();

      await expect(promise).rejects.toThrow(/cancelled/i);
    });

    it('should handle network errors with friendly message', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const settings: LLMGatewaySettings = {
        apiKey: 'test-key',
        model: 'gpt-4o'
      };
      const client = new LLMGatewayClient(settings, { maxRetries: 0 });

      await expect(client.complete({
        messages: [{ role: 'user', content: 'Hello' }]
      })).rejects.toThrow(/Unable to connect/);
    });

    it('should use default values for temperature and max_tokens', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: 'test',
          created: Date.now(),
          choices: [{ message: { content: 'Test' }, finish_reason: 'stop' }]
        })
      });
      global.fetch = fetchMock;

      const settings: LLMGatewaySettings = {
        apiKey: 'test-key',
        model: 'gpt-4o'
      };
      const client = new LLMGatewayClient(settings);

      await client.complete({
        messages: [{ role: 'user', content: 'Hello' }]
      });

      const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(callBody.temperature).toBe(0.2);
      expect(callBody.max_tokens).toBe(16000);
    });

    it('should send tool_choice when provided', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: 'test',
          created: Date.now(),
          choices: [{ message: { content: 'Test' }, finish_reason: 'stop' }]
        })
      });
      global.fetch = fetchMock;

      const settings: LLMGatewaySettings = {
        apiKey: 'test-key',
        model: 'gpt-4o'
      };
      const client = new LLMGatewayClient(settings);

      await client.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        tools: [{
          name: 'test_tool',
          description: 'A test tool',
          parameters: { type: 'object', properties: {} }
        }],
        toolChoice: 'auto'
      });

      const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(callBody.tool_choice).toBe('auto');
    });
  });
});
