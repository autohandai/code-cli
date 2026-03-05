/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { AzureClient } from '../../src/providers/AzureClient';
import type { LLMRequest } from '../../src/types';

describe('AzureClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('URL building', () => {
    it('should build endpoint URL from resourceName and deploymentName', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'test-id', created: 123,
          choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
        })
      } as Response);

      const client = new AzureClient({
        model: 'gpt-4o', resourceName: 'my-resource', deploymentName: 'my-deploy',
        apiVersion: '2024-10-21', apiKey: 'test-key', authMethod: 'api-key'
      });

      await client.complete({ messages: [{ role: 'user', content: 'hi' }] });

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://my-resource.openai.azure.com/openai/deployments/my-deploy/chat/completions?api-version=2024-10-21',
        expect.anything()
      );
    });

    it('should use baseUrl when provided', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'test-id', created: 123,
          choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }]
        })
      } as Response);

      const client = new AzureClient({
        model: 'gpt-4o', baseUrl: 'https://my-proxy.example.com/openai/deployments/gpt-4o',
        apiVersion: '2024-10-21', apiKey: 'test-key', authMethod: 'api-key'
      });

      await client.complete({ messages: [{ role: 'user', content: 'hi' }] });

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://my-proxy.example.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-10-21',
        expect.anything()
      );
    });

    it('should default apiVersion to 2024-10-21', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'id', created: 1,
          choices: [{ message: { content: '' }, finish_reason: 'stop' }]
        })
      } as Response);

      const client = new AzureClient({
        model: 'gpt-4o', resourceName: 'res', deploymentName: 'dep',
        apiKey: 'key', authMethod: 'api-key'
      });

      await client.complete({ messages: [{ role: 'user', content: 'test' }] });
      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('api-version=2024-10-21');
    });
  });

  describe('auth headers', () => {
    it('should use api-key header for api-key auth', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'id', created: 1,
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }]
        })
      } as Response);

      const client = new AzureClient({
        model: 'gpt-4o', resourceName: 'res', deploymentName: 'dep',
        apiKey: 'my-api-key', authMethod: 'api-key'
      });

      await client.complete({ messages: [{ role: 'user', content: 'hi' }] });

      const init = fetchSpy.mock.calls[0][1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers['api-key']).toBe('my-api-key');
      expect(headers['Authorization']).toBeUndefined();
    });
  });

  describe('response parsing', () => {
    it('should parse standard response into LLMResponse', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'resp-123', created: 1700000000,
          choices: [{ message: { role: 'assistant', content: 'Hello from Azure!' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
        })
      } as Response);

      const client = new AzureClient({
        model: 'gpt-4o', resourceName: 'res', deploymentName: 'dep',
        apiKey: 'key', authMethod: 'api-key'
      });

      const response = await client.complete({ messages: [{ role: 'user', content: 'hi' }] });

      expect(response.id).toBe('resp-123');
      expect(response.content).toBe('Hello from Azure!');
      expect(response.finishReason).toBe('stop');
      expect(response.usage?.promptTokens).toBe(10);
      expect(response.usage?.completionTokens).toBe(5);
      expect(response.usage?.totalTokens).toBe(15);
    });

    it('should parse tool calls from response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'resp-456', created: 1700000000,
          choices: [{
            message: {
              role: 'assistant', content: null,
              tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"foo.ts"}' } }]
            },
            finish_reason: 'tool_calls'
          }]
        })
      } as Response);

      const client = new AzureClient({
        model: 'gpt-4o', resourceName: 'res', deploymentName: 'dep',
        apiKey: 'key', authMethod: 'api-key'
      });

      const response = await client.complete({ messages: [{ role: 'user', content: 'read foo.ts' }] });

      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls![0].function.name).toBe('read_file');
      expect(response.finishReason).toBe('tool_calls');
    });
  });

  describe('error handling', () => {
    it('should throw friendly error for 401', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false, status: 401,
        json: async () => ({ error: { message: 'Invalid key' } })
      } as unknown as Response);

      const client = new AzureClient({
        model: 'gpt-4o', resourceName: 'res', deploymentName: 'dep',
        apiKey: 'bad-key', authMethod: 'api-key'
      });

      await expect(client.complete({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow('Authentication failed');
    });

    it('should throw friendly error for 404', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false, status: 404,
        json: async () => ({ error: { message: 'Deployment not found' } })
      } as unknown as Response);

      const client = new AzureClient({
        model: 'gpt-4o', resourceName: 'res', deploymentName: 'missing',
        apiKey: 'key', authMethod: 'api-key'
      });

      await expect(client.complete({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow('not found');
    });

    it('should not retry non-retryable errors', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false, status: 401,
        json: async () => ({ error: { message: 'Auth failed' } })
      } as unknown as Response);

      const client = new AzureClient({
        model: 'gpt-4o', resourceName: 'res', deploymentName: 'dep',
        apiKey: 'bad', authMethod: 'api-key'
      });

      await expect(client.complete({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('message sanitization', () => {
    it('should strip internal fields from messages', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'id', created: 1,
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }]
        })
      } as Response);

      const client = new AzureClient({
        model: 'gpt-4o', resourceName: 'res', deploymentName: 'dep',
        apiKey: 'key', authMethod: 'api-key'
      });

      await client.complete({
        messages: [{ role: 'user', content: 'hi', priority: 1, metadata: { internal: true } } as any]
      });

      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      const msg = body.messages[0];
      expect(msg.role).toBe('user');
      expect(msg.content).toBe('hi');
      expect(msg.priority).toBeUndefined();
      expect(msg.metadata).toBeUndefined();
    });
  });
});
