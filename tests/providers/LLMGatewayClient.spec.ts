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
            'Content-Type': 'application/json',
            'x-source': 'Autohand Code CLI'
          })
        })
      );
    });

    it('preserves orphaned tool observations as API-valid system context', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: 'test-id',
          choices: [{
            message: { role: 'assistant', content: 'ok' },
            finish_reason: 'stop'
          }]
        })
      });
      global.fetch = fetchMock;

      const client = new LLMGatewayClient({
        apiKey: 'test-key',
        model: 'deepseek-v4-flash'
      });

      await client.complete({
        messages: [
          { role: 'user', content: 'Continue' },
          {
            role: 'tool',
            content: 'orphan result',
            name: 'read_file',
            tool_call_id: 'missing_call'
          }
        ]
      });

      const payload = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
        messages: Array<{ role: string; tool_call_id?: string }>;
      };
      expect(payload.messages).toEqual([
        { role: 'user', content: 'Continue' },
        {
          role: 'system',
          content: '[Recovered Tool Result: read_file]\norphan result',
        },
      ]);
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

    it('does not classify low-information 400 responses as context overflow', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: true })
      });

      const settings: LLMGatewaySettings = {
        apiKey: 'test-key',
        model: 'gpt-4o'
      };
      const client = new LLMGatewayClient(settings, { maxRetries: 0 });

      await expect(client.complete({
        messages: [{ role: 'user', content: 'Hello' }]
      })).rejects.toThrow(/request was malformed/i);
      await expect(client.complete({
        messages: [{ role: 'user', content: 'Hello' }]
      })).rejects.not.toThrow(/context is too long|true/i);
    });

    it('should support provider-specific authentication wording for LLM Gateway-compatible APIs', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: { message: 'token expired or incorrect' } })
      });

      const settings: LLMGatewaySettings = {
        apiKey: 'invalid-key',
        model: 'glm-4.5'
      };
      const client = new LLMGatewayClient(settings, { maxRetries: 0 }, {
        serviceName: 'Z.ai',
        credentialName: 'Z.ai API key',
        accountName: 'Z.ai account',
      });

      try {
        await client.complete({
          messages: [{ role: 'user', content: 'Hello' }]
        });
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('Z.ai API key');
        expect((error as Error).message).not.toContain('LLM Gateway');
      }
    });

    it('should throw ApiError on 429 rate limit', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers(),
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
      })).rejects.toMatchObject({ code: 'rate_limited' });
    });

    it('recommends a paid plan when Autohand AI quota is exhausted', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-14T00:00:00.000Z'));
      const originalTimeZone = process.env.TZ;
      process.env.TZ = 'Pacific/Auckland';
      const resetAt = Math.floor(Date.now() / 1000) + 2 * 60 * 60 + 30 * 60;
      // Rendered in the configured zone, so a UTC fallback would be 12 hours off.
      const expectedResetTime = new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Pacific/Auckland',
      }).format(new Date(resetAt * 1000));
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers(),
        json: () => Promise.resolve({
          error: {
            type: 'rate_limited',
            message: "You've used all your requests in this 5-hour window.",
            scope: 'window_5h',
            resetAt,
            upgradeUrl: 'https://console.autohand.ai/upgrade/?from=cli&tier=pro',
          },
        }),
      });

      const client = new LLMGatewayClient(
        { apiKey: 'test-key', model: 'fantail' },
        { maxRetries: 3, retryDelay: 0 },
        {
          serviceName: 'Autohand AI',
          credentialName: 'Autohand AI API key',
          accountName: 'Autohand AI account',
        },
      );

      try {
        await expect(client.complete({
          messages: [{ role: 'user', content: 'Hello' }],
        })).rejects.toMatchObject({
          code: 'rate_limited',
          retryable: false,
          message: [
            'Autohand AI 5-hour request quota reached.',
            "You've used all your requests in this 5-hour window.",
            `Resets ${expectedResetTime} (Pacific/Auckland) \u00b7 in 2h 30m.`,
            'Upgrade your Autohand Code plan for more usage: https://console.autohand.ai/upgrade/?from=cli&tier=pro',
          ].join('\n'),
        });
        expect(global.fetch).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
        if (originalTimeZone === undefined) {
          delete process.env.TZ;
        } else {
          process.env.TZ = originalTimeZone;
        }
      }
    });

    it('falls back to the runtime time zone when TZ is not a usable zone', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-14T00:00:00.000Z'));
      const originalTimeZone = process.env.TZ;
      process.env.TZ = 'Definitely/NotAZone';
      const resetAt = Math.floor(Date.now() / 1000) + 45 * 60;
      const fallbackFormatter = new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
      const expectedZone = fallbackFormatter.resolvedOptions().timeZone;
      const expectedResetTime = fallbackFormatter.format(new Date(resetAt * 1000));
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers(),
        json: () => Promise.resolve({
          error: {
            type: 'rate_limited',
            message: "You've used all your requests in this 5-hour window.",
            scope: 'window_5h',
            resetAt,
          },
        }),
      });

      const client = new LLMGatewayClient(
        { apiKey: 'test-key', model: 'fantail' },
        { maxRetries: 3, retryDelay: 0 },
        {
          serviceName: 'Autohand AI',
          credentialName: 'Autohand AI API key',
          accountName: 'Autohand AI account',
        },
      );

      try {
        const failure = await client
          .complete({ messages: [{ role: 'user', content: 'Hello' }] })
          .then(() => undefined, (error: unknown) => error as Error);

        expect(failure).toBeInstanceOf(Error);
        const message = failure?.message ?? '';
        expect(message).toContain(`Resets ${expectedResetTime} (${expectedZone ?? 'local time'})`);
        expect(message).toContain('\u00b7 in 45m.');
        expect(message).not.toContain('Definitely/NotAZone');
        expect(message).not.toContain('undefined');
      } finally {
        vi.useRealTimers();
        if (originalTimeZone === undefined) {
          delete process.env.TZ;
        } else {
          process.env.TZ = originalTimeZone;
        }
      }
    });

    it('reports a weekly quota reset safely when the timestamp is unavailable', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers(),
        json: () => Promise.resolve({
          error: {
            type: 'rate_limited',
            message: "You've used all your requests for this week.",
            scope: 'window_week',
            resetAt: 'not-a-timestamp',
            upgradeUrl: 'https://console.autohand.ai/upgrade/?from=cli&tier=max',
          },
        }),
      });
      global.fetch = fetchMock;
      const client = new LLMGatewayClient(
        { apiKey: 'test-key', model: 'fantail' },
        { maxRetries: 3, retryDelay: 0 },
        {
          serviceName: 'Autohand AI',
          credentialName: 'Autohand AI API key',
          accountName: 'Autohand AI account',
        },
      );

      await expect(client.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      })).rejects.toMatchObject({
        code: 'rate_limited',
        retryable: false,
        message: expect.stringMatching(
          /weekly request quota reached\.[\s\S]*Reset time is temporarily unavailable\. Run \/usage to refresh your quota\./,
        ),
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('identifies a 24-hour quota as terminal without calling it a generic rate limit', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers({ 'Retry-After': '3600' }),
        json: () => Promise.resolve({
          error: {
            type: 'rate_limited',
            message: "You've used all your requests in this 24-hour window.",
            scope: 'window_24h',
            resetAt: Math.floor(Date.now() / 1000) + 3600,
          },
        }),
      });
      const client = new LLMGatewayClient(
        { apiKey: 'test-key', model: 'fantail' },
        { maxRetries: 3, retryDelay: 0 },
        {
          serviceName: 'Autohand AI',
          credentialName: 'Autohand AI API key',
          accountName: 'Autohand AI account',
        },
      );

      await expect(client.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      })).rejects.toMatchObject({
        code: 'rate_limited',
        message: expect.stringContaining('Autohand AI 24-hour request quota reached.'),
        retryable: false,
      });
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('identifies uncached input-token throughput as terminal and never retries it as RPM', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers({ 'Retry-After': '1' }),
        json: () => Promise.resolve({
          error: {
            type: 'rate_limited',
            message: 'Your uncached input-token throughput is exhausted for this minute.',
            scope: 'input_tpm',
            upgradeUrl: 'https://console.autohand.ai/upgrade/?from=cli&tier=max',
          },
        }),
      });
      global.fetch = fetchMock;
      const client = new LLMGatewayClient(
        { apiKey: 'test-key', model: 'fantail' },
        { maxRetries: 3, retryDelay: 0 },
        {
          serviceName: 'Autohand AI',
          credentialName: 'Autohand AI API key',
          accountName: 'Autohand AI account',
        },
      );

      await expect(client.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      })).rejects.toMatchObject({
        code: 'rate_limited',
        retryable: false,
        scope: 'input_tpm',
        message: expect.stringMatching(
          /uncached input-token throughput reached[\s\S]*Upgrade your Autohand Code plan/,
        ),
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('retries a transient Autohand AI RPM throttle after the server delay', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-14T00:00:00.000Z'));
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: new Headers({ 'Retry-After': '2' }),
          json: () => Promise.resolve({
            error: {
              type: 'rate_limited',
              message: 'Too many requests. Slow down and try again shortly.',
              scope: 'rpm',
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: 'retry-success',
            created: Date.now(),
            choices: [{
              message: { role: 'assistant', content: 'Recovered after throttling.' },
              finish_reason: 'stop',
            }],
          }),
        });
      global.fetch = fetchMock;
      const client = new LLMGatewayClient(
        { apiKey: 'test-key', model: 'fantail' },
        { maxRetries: 1, retryDelay: 10 },
        {
          serviceName: 'Autohand AI',
          credentialName: 'Autohand AI API key',
          accountName: 'Autohand AI account',
        },
      );

      try {
        const completion = client.complete({
          messages: [{ role: 'user', content: 'Hello' }],
        });
        await vi.advanceTimersByTimeAsync(1_999);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        await expect(completion).resolves.toMatchObject({
          content: 'Recovered after throttling.',
        });
        expect(fetchMock).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not retry an Autohand AI rate limit with an unknown scope', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers({ 'Retry-After': '1' }),
        json: () => Promise.resolve({
          error: {
            type: 'rate_limited',
            message: 'Unknown rate-limit policy.',
            scope: 'unexpected_scope',
          },
        }),
      });
      global.fetch = fetchMock;
      const client = new LLMGatewayClient(
        { apiKey: 'test-key', model: 'fantail' },
        { maxRetries: 3, retryDelay: 0 },
        {
          serviceName: 'Autohand AI',
          credentialName: 'Autohand AI API key',
          accountName: 'Autohand AI account',
        },
      );

      await expect(client.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      })).rejects.toMatchObject({ code: 'rate_limited' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('cancels while waiting to retry an Autohand AI RPM throttle', async () => {
      vi.useFakeTimers();
      const controller = new AbortController();
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers({ 'Retry-After': '60' }),
        json: () => Promise.resolve({
          error: {
            type: 'rate_limited',
            message: 'Too many requests. Slow down and try again shortly.',
            scope: 'rpm',
          },
        }),
      });
      const client = new LLMGatewayClient(
        { apiKey: 'test-key', model: 'fantail' },
        { maxRetries: 1, retryDelay: 10 },
        {
          serviceName: 'Autohand AI',
          credentialName: 'Autohand AI API key',
          accountName: 'Autohand AI account',
        },
      );
      let settled = false;
      const outcome = client.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        signal: controller.signal,
      }).then(
        () => ({ error: null }),
        (error: unknown) => ({ error }),
      ).finally(() => {
        settled = true;
      });

      try {
        await vi.advanceTimersByTimeAsync(0);
        controller.abort();
        await vi.advanceTimersByTimeAsync(0);
        expect(settled).toBe(true);
        await expect(outcome).resolves.toMatchObject({
          error: expect.objectContaining({ code: 'cancelled' }),
        });
        expect(global.fetch).toHaveBeenCalledTimes(1);
      } finally {
        await vi.runAllTimersAsync();
        await outcome;
        vi.useRealTimers();
      }
    });

    it('classifies provider token-per-minute request-size failures as non-retryable context overflow', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers(),
        json: () => Promise.resolve({
          error: {
            message: 'Request too large for model `llama-3.1-8b-instant` on tokens per minute (TPM): Limit 6000, Requested 36114, please reduce your message size and try again.'
          }
        })
      });

      const settings: LLMGatewaySettings = {
        apiKey: 'test-key',
        model: 'llama-3.1-8b-instant'
      };
      const client = new LLMGatewayClient(settings, { maxRetries: 3, retryDelay: 1 });

      await expect(client.complete({
        messages: [{ role: 'user', content: 'Hello' }]
      })).rejects.toMatchObject({ code: 'context_overflow', retryable: false });
      expect(global.fetch).toHaveBeenCalledTimes(1);
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

    it('should include chat_template_kwargs in extra_body for NVIDIA reasoning models', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: 'test',
          created: Date.now(),
          choices: [{ message: { content: 'Test response' }, finish_reason: 'stop' }]
        })
      });
      global.fetch = fetchMock;

      const settings: LLMGatewaySettings = {
        apiKey: 'test-key',
        model: 'deepseek-ai/deepseek-v4-pro'
      };
      const client = new LLMGatewayClient(settings);

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

    it('should include configured reasoning_effort for OpenAI-compatible providers', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: 'test',
          created: Date.now(),
          choices: [{ message: { content: 'Test response' }, finish_reason: 'stop' }]
        })
      });
      global.fetch = fetchMock;

      const settings: LLMGatewaySettings = {
        apiKey: 'test-key',
        model: 'acme-code-1',
        baseUrl: 'https://api.acme.example/v1',
        reasoningEffort: 'high'
      };
      const client = new LLMGatewayClient(settings);

      await client.complete({
        messages: [{ role: 'user', content: 'Hello' }]
      });

      const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(callBody.reasoning_effort).toBe('high');
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

      const settings: LLMGatewaySettings = {
        apiKey: 'test-key',
        model: 'z-ai/glm-5.1'
      };
      const client = new LLMGatewayClient(settings);

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
      // Create a mock stream with SSE data containing reasoning
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

      const settings: LLMGatewaySettings = {
        apiKey: 'test-key',
        model: 'deepseek-ai/deepseek-v4-pro'
      };
      const client = new LLMGatewayClient(settings);

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

      const settings: LLMGatewaySettings = {
        apiKey: 'test-key',
        model: 'gpt-4o'
      };
      const client = new LLMGatewayClient(settings);

      const response = await client.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true
      });

      expect(response.content).toBe('Just content here');
      expect(response.finishReason).toBe('stop');
    });
  });
});
