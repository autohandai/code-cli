/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NVIDIAClient } from '../../src/providers/NVIDIAClient.js';
import type { NvidiaAISettings, NetworkSettings } from '../../src/types.js';

describe('NVIDIAClient', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should use NVIDIA default base URL when not provided', () => {
      const settings: NvidiaAISettings = {
        apiKey: 'nvapi-test-key',
        model: 'deepseek-ai/deepseek-v4-pro'
      };
      const client = new NVIDIAClient(settings);
      expect(client).toBeDefined();
    });

    it('should use custom base URL when provided', () => {
      const settings: NvidiaAISettings = {
        apiKey: 'nvapi-test-key',
        model: 'deepseek-ai/deepseek-v4-pro',
        baseUrl: 'https://custom.nvidia.com/v1'
      };
      const client = new NVIDIAClient(settings);
      expect(client).toBeDefined();
    });

    it('should apply network settings with limits', () => {
      const settings: NvidiaAISettings = {
        apiKey: 'nvapi-test-key',
        model: 'deepseek-ai/deepseek-v4-pro'
      };
      const networkSettings: NetworkSettings = {
        maxRetries: 10, // Should be capped at 5
        retryDelay: 2000,
        timeout: 60000
      };
      const client = new NVIDIAClient(settings, networkSettings);
      expect(client).toBeDefined();
    });
  });

  describe('setDefaultModel', () => {
    it('should update the default model', () => {
      const settings: NvidiaAISettings = {
        apiKey: 'nvapi-test-key',
        model: 'deepseek-ai/deepseek-v4-pro'
      };
      const client = new NVIDIAClient(settings);
      client.setDefaultModel('z-ai/glm-5.1');
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

      const settings: NvidiaAISettings = {
        apiKey: 'nvapi-test-key',
        model: 'deepseek-ai/deepseek-v4-pro'
      };
      const client = new NVIDIAClient(settings);

      const response = await client.complete({
        messages: [{ role: 'user', content: 'Hello' }]
      });

      expect(response.content).toBe('Hello, I am an AI assistant.');
      expect(response.finishReason).toBe('stop');
      expect(response.usage?.promptTokens).toBe(10);
      expect(response.usage?.completionTokens).toBe(20);
      expect(response.usage?.totalTokens).toBe(30);
    });

    it('should include chat_template_kwargs in extra_body', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: 'test',
          created: Date.now(),
          choices: [{ message: { content: 'Test response' }, finish_reason: 'stop' }]
        })
      });
      global.fetch = fetchMock;

      const settings: NvidiaAISettings = {
        apiKey: 'nvapi-test-key',
        model: 'deepseek-ai/deepseek-v4-pro'
      };
      const client = new NVIDIAClient(settings);

      await client.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        chatTemplateKwargs: {
          thinking: true,
          reasoning_effort: 'high'
        }
      });

      const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(callBody.extra_body).toBeDefined();
      expect(callBody.extra_body.chat_template_kwargs).toEqual({
        thinking: true,
        reasoning_effort: 'high'
      });
    });

    it('should support Z.ai GLM chat_template_kwargs', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: 'test',
          created: Date.now(),
          choices: [{ message: { content: 'Test response' }, finish_reason: 'stop' }]
        })
      });
      global.fetch = fetchMock;

      const settings: NvidiaAISettings = {
        apiKey: 'nvapi-test-key',
        model: 'z-ai/glm-5.1'
      };
      const client = new NVIDIAClient(settings);

      await client.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        chatTemplateKwargs: {
          enable_thinking: true,
          clear_thinking: false
        }
      });

      const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(callBody.extra_body.chat_template_kwargs).toEqual({
        enable_thinking: true,
        clear_thinking: false
      });
    });

    it('should handle streaming responses with reasoning content', async () => {
      const encoder = new TextEncoder();
      const streamData = [
        'data: {"id":"stream-test","created":1234567890,"choices":[{"delta":{"reasoning":"Let me think"},"finish_reason":null}]}\n\n',
        'data: {"id":"stream-test","created":1234567890,"choices":[{"delta":{"reasoning_content":" about this"},"finish_reason":null}]}\n\n',
        'data: {"id":"stream-test","created":1234567890,"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
        'data: {"id":"stream-test","created":1234567890,"choices":[{"delta":{"content":"!"},"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n'
      ];

      const mockStream = new ReadableStream({
        start(controller) {
          streamData.forEach(chunk => controller.enqueue(encoder.encode(chunk)));
          controller.close();
        }
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        body: mockStream
      });

      const settings: NvidiaAISettings = {
        apiKey: 'nvapi-test-key',
        model: 'deepseek-ai/deepseek-v4-pro'
      };
      const client = new NVIDIAClient(settings);

      const response = await client.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true
      });

      expect(response.content).toBe('<thinking>Let me think about this</thinking>\n\nHello!');
      expect(response.finishReason).toBe('stop');
    });

    it('should handle streaming without reasoning content', async () => {
      const encoder = new TextEncoder();
      const streamData = [
        'data: {"id":"stream-test","created":1234567890,"choices":[{"delta":{"content":"Just content"},"finish_reason":null}]}\n\n',
        'data: {"id":"stream-test","created":1234567890,"choices":[{"delta":{"content":" here"},"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n'
      ];

      const mockStream = new ReadableStream({
        start(controller) {
          streamData.forEach(chunk => controller.enqueue(encoder.encode(chunk)));
          controller.close();
        }
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        body: mockStream
      });

      const settings: NvidiaAISettings = {
        apiKey: 'nvapi-test-key',
        model: 'z-ai/glm-5.1'
      };
      const client = new NVIDIAClient(settings);

      const response = await client.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true
      });

      expect(response.content).toBe('Just content here');
      expect(response.finishReason).toBe('stop');
    });

    it('should include Authorization header with nvapi key', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: 'test-id',
          created: Date.now(),
          choices: [{ message: { content: 'Test' }, finish_reason: 'stop' }]
        })
      });
      global.fetch = fetchMock;

      const settings: NvidiaAISettings = {
        apiKey: 'nvapi-secret-key',
        model: 'deepseek-ai/deepseek-v4-pro'
      };
      const client = new NVIDIAClient(settings);

      await client.complete({
        messages: [{ role: 'user', content: 'Hello' }]
      });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer nvapi-secret-key',
            'Content-Type': 'application/json',
            'x-source': 'Autohand Code CLI'
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

      const settings: NvidiaAISettings = {
        apiKey: 'invalid-key',
        model: 'deepseek-ai/deepseek-v4-pro'
      };
      const client = new NVIDIAClient(settings, { maxRetries: 0 });

      await expect(client.complete({
        messages: [{ role: 'user', content: 'Hello' }]
      })).rejects.toThrow(/Authentication failed/);
    });

    it('should throw error for payload too large', async () => {
      const settings: NvidiaAISettings = {
        apiKey: 'nvapi-test-key',
        model: 'deepseek-ai/deepseek-v4-pro'
      };
      const client = new NVIDIAClient(settings);

      const largeContent = 'x'.repeat(6 * 1024 * 1024);

      await expect(client.complete({
        messages: [{ role: 'user', content: largeContent }]
      })).rejects.toThrow(/Request payload too large/);
    });
  });
});
