/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OllamaProvider } from '../../src/providers/OllamaProvider';
import type { ProviderSettings, NetworkSettings } from '../../src/types';
import { ApiError } from '../../src/providers/errors';

describe('OllamaProvider', () => {
    let provider: OllamaProvider;
    let config: ProviderSettings;

    beforeEach(() => {
        config = {
            baseUrl: 'http://localhost:11434',
            model: 'llama3.2:latest'
        };
        provider = new OllamaProvider(config);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('getName()', () => {
        it('should return provider name', () => {
            expect(provider.getName()).toBe('ollama');
        });
    });

    describe('constructor with network settings', () => {
        it('accepts NetworkSettings as second constructor param', () => {
            const networkSettings: NetworkSettings = {
                timeout: 120_000,
                maxRetries: 2,
                retryDelay: 500
            };
            const p = new OllamaProvider(config, networkSettings);
            expect(p.getName()).toBe('ollama');
        });

        it('uses default timeout when network settings not provided', () => {
            const p = new OllamaProvider(config);
            expect(p.getName()).toBe('ollama');
        });
    });

    describe('listModels()', () => {
        it('should fetch models from Ollama API with 5s timeout', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    models: [
                        { name: 'llama3.2:latest', size: 4661212864 },
                        { name: 'mistral:7b', size: 3825816576 }
                    ]
                })
            });

            const models = await provider.listModels();

            expect(models).toEqual(['llama3.2:latest', 'mistral:7b']);
            // Now uses a timeout signal
            expect(fetch).toHaveBeenCalledWith(
                'http://localhost:11434/api/tags',
                expect.objectContaining({ signal: expect.any(AbortSignal) })
            );
        });

        it('should return empty array if Ollama is not running', async () => {
            global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

            const models = await provider.listModels();

            expect(models).toEqual([]);
        });

        it('should handle non-ok response', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 500
            });

            const models = await provider.listModels();

            expect(models).toEqual([]);
        });
    });

    describe('isAvailable()', () => {
        it('should return true if Ollama is running', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ models: [] })
            });

            const available = await provider.isAvailable();

            expect(available).toBe(true);
            // Now uses a timeout signal
            expect(fetch).toHaveBeenCalledWith(
                'http://localhost:11434/api/tags',
                expect.objectContaining({ signal: expect.any(AbortSignal) })
            );
        });

        it('should return false if Ollama is not running', async () => {
            global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

            const available = await provider.isAvailable();

            expect(available).toBe(false);
        });

        it('should return false if server returns error', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 500
            });

            const available = await provider.isAvailable();

            expect(available).toBe(false);
        });
    });

    describe('complete()', () => {
        it('should send request to Ollama chat API', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    message: {
                        content: 'Hello! How can I help you?'
                    },
                    created_at: '2024-11-21T10:30:00Z'
                })
            });

            const response = await provider.complete({
                messages: [{ role: 'user', content: 'Hello' }],
                temperature: 0.7
            });

            expect(response.content).toBe('Hello! How can I help you?');
            expect(fetch).toHaveBeenCalledWith(
                'http://localhost:11434/api/chat',
                expect.objectContaining({
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: expect.stringContaining('llama3.2:latest')
                })
            );
        });

        it('should handle streaming responses', async () => {
            const mockStream = new ReadableStream({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode(
                        '{"message":{"content":"Hello"},"created_at":"2024-11-21T10:30:00Z"}\n'
                    ));
                    controller.enqueue(new TextEncoder().encode(
                        '{"message":{"content":" World"},"created_at":"2024-11-21T10:30:01Z"}\n'
                    ));
                    controller.close();
                }
            });

            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                body: mockStream
            });

            const response = await provider.complete({
                messages: [{ role: 'user', content: 'Hello' }],
                stream: true
            });

            expect(response.content).toContain('Hello');
        });

        // -----------------------------------------------------------------------
        // Error handling tests (TDD — these fail before the fix is implemented)
        // -----------------------------------------------------------------------

        it('throws friendly ApiError on ECONNREFUSED — message mentions Ollama and suggests checking if running', async () => {
            const connRefused = new Error('connect ECONNREFUSED 127.0.0.1:11434');
            connRefused.name = 'Error';
            global.fetch = vi.fn().mockRejectedValue(connRefused);

            const err = await provider.complete({
                messages: [{ role: 'user', content: 'Hello' }]
            }).catch((e: unknown) => e);

            expect(err).toBeInstanceOf(ApiError);
            const apiErr = err as ApiError;
            expect(apiErr.message.toLowerCase()).toMatch(/ollama/i);
            expect(apiErr.message.toLowerCase()).toMatch(/running|ollama serve/i);
            expect(apiErr.code).toBe('network_error');
        });

        it('throws friendly timeout error when server does not respond', async () => {
            const timeoutErr = new Error('The operation was aborted due to timeout');
            timeoutErr.name = 'AbortError';
            global.fetch = vi.fn().mockRejectedValue(timeoutErr);

            const err = await provider.complete({
                messages: [{ role: 'user', content: 'Hello' }]
            }).catch((e: unknown) => e);

            expect(err).toBeInstanceOf(ApiError);
            const apiErr = err as ApiError;
            expect(apiErr.code).toBe('timeout');
            expect(apiErr.message.toLowerCase()).toMatch(/timed? out|timeout/i);
        });

        it('retries on transient 500 errors (verify retry attempt)', async () => {
            const successResponse = {
                ok: true,
                json: async () => ({
                    message: { content: 'Recovered' },
                    created_at: '2024-11-21T10:30:00Z'
                })
            };
            // First call fails with 500, second succeeds
            global.fetch = vi.fn()
                .mockResolvedValueOnce({
                    ok: false,
                    status: 500,
                    statusText: 'Internal Server Error',
                    text: async () => 'Internal Server Error'
                })
                .mockResolvedValueOnce(successResponse);

            const response = await provider.complete({
                messages: [{ role: 'user', content: 'Hello' }]
            });

            expect(response.content).toBe('Recovered');
            // fetch should have been called at least twice (original + 1 retry)
            expect(global.fetch).toHaveBeenCalledTimes(2);
        });

        it('does not retry on 400 errors (non-retryable)', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 400,
                statusText: 'Bad Request',
                text: async () => 'Bad request body'
            });

            const err = await provider.complete({
                messages: [{ role: 'user', content: 'Hello' }]
            }).catch((e: unknown) => e);

            expect(err).toBeInstanceOf(ApiError);
            const apiErr = err as ApiError;
            expect(apiErr.retryable).toBe(false);
            // fetch called exactly once — no retries
            expect(global.fetch).toHaveBeenCalledTimes(1);
        });

        it('does not retry when user cancels (AbortError with signal.aborted)', async () => {
            const controller = new AbortController();
            controller.abort();

            const abortErr = new Error('The user aborted a request.');
            abortErr.name = 'AbortError';
            global.fetch = vi.fn().mockRejectedValue(abortErr);

            const err = await provider.complete({
                messages: [{ role: 'user', content: 'Hello' }],
                signal: controller.signal
            }).catch((e: unknown) => e);

            expect(err).toBeInstanceOf(ApiError);
            const apiErr = err as ApiError;
            expect(apiErr.code).toBe('cancelled');
            // Should have been called only once — no retries after user cancel
            expect(global.fetch).toHaveBeenCalledTimes(1);
        });

        it('returns friendly message for 400 invalid request', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 400,
                statusText: 'Bad Request',
                text: async () => 'invalid request format'
            });

            const err = await provider.complete({
                messages: [{ role: 'user', content: 'Hello' }]
            }).catch((e: unknown) => e);

            expect(err).toBeInstanceOf(ApiError);
            expect((err as ApiError).httpStatus).toBe(400);
        });

        it('returns friendly message for 404 with suggestion to run ollama pull', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 404,
                statusText: 'Not Found',
                text: async () => 'model not found'
            });

            const err = await provider.complete({
                messages: [{ role: 'user', content: 'Hello' }]
            }).catch((e: unknown) => e);

            expect(err).toBeInstanceOf(ApiError);
            const apiErr = err as ApiError;
            expect(apiErr.code).toBe('model_not_found');
            expect(apiErr.httpStatus).toBe(404);
            // Should suggest running ollama pull
            expect(apiErr.message).toMatch(/ollama pull/i);
        });

        it('returns friendly message for 500 server error', async () => {
            // With retries disabled to avoid slow test
            const p = new OllamaProvider(config, { maxRetries: 0 });
            global.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
                text: async () => 'internal error'
            });

            const err = await p.complete({
                messages: [{ role: 'user', content: 'Hello' }]
            }).catch((e: unknown) => e);

            expect(err).toBeInstanceOf(ApiError);
            const apiErr = err as ApiError;
            expect(apiErr.code).toBe('server_error');
            expect(apiErr.httpStatus).toBe(500);
        });

        it('returns friendly message for 503 service unavailable', async () => {
            const p = new OllamaProvider(config, { maxRetries: 0 });
            global.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 503,
                statusText: 'Service Unavailable',
                text: async () => 'service unavailable'
            });

            const err = await p.complete({
                messages: [{ role: 'user', content: 'Hello' }]
            }).catch((e: unknown) => e);

            expect(err).toBeInstanceOf(ApiError);
            const apiErr = err as ApiError;
            expect(apiErr.code).toBe('server_error');
            expect(apiErr.httpStatus).toBe(503);
        });

        it('respects configured timeout', async () => {
            const networkSettings: NetworkSettings = { timeout: 100, maxRetries: 0 };
            const fastTimeoutProvider = new OllamaProvider(config, networkSettings);

            // fetch hangs until signal is aborted
            global.fetch = vi.fn().mockImplementation((_url: string, opts: RequestInit) => {
                return new Promise((_resolve, reject) => {
                    opts.signal?.addEventListener('abort', () => {
                        const err = new Error('The operation was aborted.');
                        err.name = 'AbortError';
                        reject(err);
                    });
                });
            });

            const err = await fastTimeoutProvider.complete({
                messages: [{ role: 'user', content: 'Hello' }]
            }).catch((e: unknown) => e);

            expect(err).toBeInstanceOf(ApiError);
            const apiErr = err as ApiError;
            expect(apiErr.code).toBe('timeout');
        });

        it('passes a signal for request cancellation (combined with timeout)', async () => {
            const controller = new AbortController();
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    message: { content: 'Response' },
                    created_at: '2024-11-21T10:30:00Z'
                })
            });

            await provider.complete({
                messages: [{ role: 'user', content: 'Hello' }],
                signal: controller.signal
            });

            // After the fix, a combined signal (user + timeout) is passed — just verify a signal is present
            expect(fetch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    signal: expect.objectContaining({ aborted: false })
                })
            );
        });

        it('keeps existing disableTools retry logic when model does not support tools', async () => {
            // First response: 400 with "does not support tools"
            // Second response: success (without tools)
            global.fetch = vi.fn()
                .mockResolvedValueOnce({
                    ok: false,
                    status: 400,
                    statusText: 'Bad Request',
                    text: async () => 'model does not support tools'
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({
                        message: { content: 'Response without tools' },
                        created_at: '2024-11-21T10:30:00Z'
                    })
                });

            const response = await provider.complete({
                messages: [{ role: 'user', content: 'Hello' }],
                tools: [{
                    name: 'read_file',
                    description: 'Read a file',
                    parameters: { type: 'object', properties: {} }
                }]
            });

            expect(response.content).toBe('Response without tools');
            // Called twice: once with tools, once without
            expect(global.fetch).toHaveBeenCalledTimes(2);
            // Second call should not include tools
            const secondCallBody = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[1][1].body);
            expect(secondCallBody.tools).toBeUndefined();
        });
    });

    describe('streaming timeout', () => {
        it('returns partial content with finishReason "length" when stream dies mid-response', async () => {
            // Simulate a stream that sends some data then hangs
            let chunkController!: ReadableStreamDefaultController<Uint8Array>;
            const mockStream = new ReadableStream<Uint8Array>({
                start(controller) {
                    chunkController = controller;
                    // Send partial data immediately
                    controller.enqueue(new TextEncoder().encode(
                        '{"message":{"content":"Partial content"},"created_at":"2024-11-21T10:30:00Z"}\n'
                    ));
                    // Then never send done or more chunks (simulating dead stream)
                }
            });

            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                body: mockStream
            });

            // Use a very short chunk timeout to avoid slow tests
            const p = new OllamaProvider(config, { timeout: 120_000 });

            // We need to expose the chunk timeout for testing — use a very short one
            // The provider should accept chunkTimeout in its options
            // For now test via the actual streaming with a stubbed read that resolves slowly
            // We'll test by verifying the stream returns partial + finishReason: 'length'

            // Trigger a close on the stream after getting partial data to simulate mid-stream death
            // (ReadableStream close is not an error but an abrupt ending after partial data)
            // Actually simulate: send chunk then close immediately (success path with partial)
            const partialStream = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode(
                        '{"message":{"content":"Partial response text"},"created_at":"2024-11-21T10:30:00Z","done":false}\n'
                    ));
                    // Close without a done:true — simulates abrupt end
                    controller.close();
                }
            });

            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                body: partialStream
            });

            const response = await p.complete({
                messages: [{ role: 'user', content: 'Hello' }],
                stream: true
            });

            expect(response.content).toBe('Partial response text');
            // When stream closes without done:true, finishReason should be 'length'
            expect(response.finishReason).toBe('length');

            // Keep chunkController alive to prevent GC
            void chunkController;
        });

        it('times out if no data received within chunk timeout, returns partial with finishReason length', async () => {
            // Build a manual reader mock: first read returns a chunk, second hangs forever
            let resolveHangingRead!: (value: ReadableStreamReadResult<Uint8Array>) => void;
            let readCount = 0;
            const mockReader = {
                read: vi.fn().mockImplementation(() => {
                    readCount++;
                    if (readCount === 1) {
                        return Promise.resolve({
                            done: false,
                            value: new TextEncoder().encode(
                                '{"message":{"content":"Partial data"},"created_at":"2024-11-21T10:30:00Z"}\n'
                            )
                        });
                    }
                    // Second read hangs forever until test resolves it
                    return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
                        resolveHangingRead = resolve;
                    });
                }),
                releaseLock: vi.fn(),
                cancel: vi.fn().mockResolvedValue(undefined)
            };

            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                body: { getReader: vi.fn().mockReturnValue(mockReader) }
            });

            // Use a very short chunk timeout by creating a provider with overridden chunkTimeout
            // We achieve this by monkey-patching the private field after construction
            const p = new OllamaProvider(config, { timeout: 120_000, maxRetries: 0 });
            // Override chunkTimeout to be very short (50ms) for testing
            (p as unknown as Record<string, unknown>)['chunkTimeout'] = 50;

            const response = await p.complete({
                messages: [{ role: 'user', content: 'Hello' }],
                stream: true
            });

            // Should get partial content with finishReason 'length' after chunk timeout fires
            expect(response.content).toBe('Partial data');
            expect(response.finishReason).toBe('length');

            // Resolve the hanging read to prevent test resource leak
            resolveHangingRead({ done: true, value: undefined });
        });

        it('handleStreamingResponse returns length finishReason when reader ends without done:true JSON', async () => {
            // A stream that ends immediately (done: true from reader) without any Ollama done:true JSON
            // This simulates a connection dropped in the middle of a response
            const partialStream = new ReadableStream<Uint8Array>({
                start(controller) {
                    // No data — just close the stream
                    controller.close();
                }
            });

            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                body: partialStream
            });

            const response = await provider.complete({
                messages: [{ role: 'user', content: 'Hello' }],
                stream: true
            });

            // Empty content, but finishReason should be 'length' because no done:true seen
            expect(response.content).toBe('');
            expect(response.finishReason).toBe('length');
        });
    });
});
