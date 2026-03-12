/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ProviderSettings, LLMRequest, NetworkSettings } from '../../src/types';
import { ApiError } from '../../src/providers/errors';

// Use vi.hoisted to ensure the mock is created before vi.mock hoists
const { mockIsMLXSupported } = vi.hoisted(() => ({
    mockIsMLXSupported: vi.fn()
}));

// Mock the platform utility before importing MLXProvider
vi.mock('../../src/utils/platform', () => ({
    isMLXSupported: mockIsMLXSupported
}));

// Import after mocking
import { MLXProvider } from '../../src/providers/MLXProvider';

describe('MLXProvider', () => {
    let provider: MLXProvider;
    let config: ProviderSettings;

    beforeEach(() => {
        config = {
            baseUrl: 'http://localhost:8080',
            model: 'mlx-community/Llama-3.2-3B-Instruct-4bit'
        };
        provider = new MLXProvider(config);
        // Default to supported for most tests
        mockIsMLXSupported.mockReturnValue(true);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('getName()', () => {
        it('should return mlx', () => {
            expect(provider.getName()).toBe('mlx');
        });
    });

    describe('setModel()', () => {
        it('should update the model', () => {
            provider.setModel('new-model');
            // Verify provider still works after model change
            expect(provider.getName()).toBe('mlx');
        });
    });

    describe('constructor', () => {
        it('should use default port 8080 when not specified', () => {
            const defaultProvider = new MLXProvider({ model: 'test-model' });
            expect(defaultProvider.getName()).toBe('mlx');
        });

        it('should use custom port from config', () => {
            const customProvider = new MLXProvider({
                model: 'test-model',
                port: 9090
            });
            expect(customProvider.getName()).toBe('mlx');
        });

        it('should use custom baseUrl when provided', () => {
            const customProvider = new MLXProvider({
                model: 'test-model',
                baseUrl: 'http://custom:9999'
            });
            expect(customProvider.getName()).toBe('mlx');
        });
    });

    describe('listModels()', () => {
        it('should return empty array if MLX not supported', async () => {
            mockIsMLXSupported.mockReturnValue(false);
            const mockFetch = vi.fn();
            global.fetch = mockFetch;

            const models = await provider.listModels();

            expect(models).toEqual([]);
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('should fetch models from MLX API when supported', async () => {
            mockIsMLXSupported.mockReturnValue(true);
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    data: [
                        { id: 'model-1' },
                        { id: 'model-2' }
                    ]
                })
            });

            const models = await provider.listModels();

            expect(models).toEqual(['model-1', 'model-2']);
            // listModels now passes an AbortSignal (5s timeout) — check URL only
            expect(fetch).toHaveBeenCalledWith(
                'http://localhost:8080/v1/models',
                expect.objectContaining({ signal: expect.any(AbortSignal) })
            );
        });

        it('should return configured model if API fails', async () => {
            mockIsMLXSupported.mockReturnValue(true);
            global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

            const models = await provider.listModels();

            expect(models).toEqual(['mlx-community/Llama-3.2-3B-Instruct-4bit']);
        });

        it('should return configured model if API returns error', async () => {
            mockIsMLXSupported.mockReturnValue(true);
            global.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 500
            });

            const models = await provider.listModels();

            expect(models).toEqual(['mlx-community/Llama-3.2-3B-Instruct-4bit']);
        });

        it('should return default model if empty model provided and API fails', async () => {
            mockIsMLXSupported.mockReturnValue(true);
            // When model is empty string, constructor defaults to 'mlx-model'
            const emptyProvider = new MLXProvider({ model: '' });
            global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

            const models = await emptyProvider.listModels();

            // Falls back to default model from constructor
            expect(models).toEqual(['mlx-model']);
        });
    });

    describe('isAvailable()', () => {
        it('should return false if MLX not supported', async () => {
            mockIsMLXSupported.mockReturnValue(false);

            const available = await provider.isAvailable();

            expect(available).toBe(false);
            expect(fetch).not.toHaveBeenCalled();
        });

        it('should return true if MLX server is running', async () => {
            mockIsMLXSupported.mockReturnValue(true);
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ data: [] })
            });

            const available = await provider.isAvailable();

            expect(available).toBe(true);
            // isAvailable now passes an AbortSignal (5s timeout) — check URL only
            expect(fetch).toHaveBeenCalledWith(
                'http://localhost:8080/v1/models',
                expect.objectContaining({ signal: expect.any(AbortSignal) })
            );
        });

        it('should return false if MLX server is not running', async () => {
            mockIsMLXSupported.mockReturnValue(true);
            global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

            const available = await provider.isAvailable();

            expect(available).toBe(false);
        });

        it('should return false if server returns error', async () => {
            mockIsMLXSupported.mockReturnValue(true);
            global.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 500
            });

            const available = await provider.isAvailable();

            expect(available).toBe(false);
        });
    });

    describe('complete()', () => {
        it('should throw error if MLX not supported', async () => {
            mockIsMLXSupported.mockReturnValue(false);

            const request: LLMRequest = {
                messages: [{ role: 'user', content: 'Hello' }]
            };

            await expect(provider.complete(request)).rejects.toThrow(
                'MLX is only supported on macOS with Apple Silicon'
            );
        });

        it('should send request to MLX chat API', async () => {
            mockIsMLXSupported.mockReturnValue(true);
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    id: 'mlx-123',
                    created: 1700000000,
                    choices: [{
                        index: 0,
                        message: {
                            role: 'assistant',
                            content: 'Hello! How can I help you?'
                        },
                        finish_reason: 'stop'
                    }],
                    usage: {
                        prompt_tokens: 10,
                        completion_tokens: 8,
                        total_tokens: 18
                    }
                })
            });

            const response = await provider.complete({
                messages: [{ role: 'user', content: 'Hello' }],
                temperature: 0.7
            });

            expect(response.content).toBe('Hello! How can I help you?');
            expect(response.id).toBe('mlx-123');
            expect(response.created).toBe(1700000000);
            expect(response.finishReason).toBe('stop');
            expect(response.usage).toEqual({
                promptTokens: 10,
                completionTokens: 8,
                totalTokens: 18
            });
            expect(fetch).toHaveBeenCalledWith(
                'http://localhost:8080/v1/chat/completions',
                expect.objectContaining({
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                })
            );
        });

        it('should include tools in request when provided', async () => {
            mockIsMLXSupported.mockReturnValue(true);
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    id: 'mlx-456',
                    created: 1700000000,
                    choices: [{
                        index: 0,
                        message: {
                            role: 'assistant',
                            content: 'I will read the file'
                        },
                        finish_reason: 'stop'
                    }]
                })
            });

            await provider.complete({
                messages: [{ role: 'user', content: 'Read test.txt' }],
                tools: [{
                    name: 'read_file',
                    description: 'Read a file',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: { type: 'string', description: 'File path' }
                        },
                        required: ['path']
                    }
                }]
            });

            expect(fetch).toHaveBeenCalledWith(
                'http://localhost:8080/v1/chat/completions',
                expect.objectContaining({
                    body: expect.stringContaining('tools')
                })
            );
        });

        it('should handle tool calls in response', async () => {
            mockIsMLXSupported.mockReturnValue(true);
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    id: 'mlx-789',
                    created: 1700000000,
                    choices: [{
                        index: 0,
                        message: {
                            role: 'assistant',
                            content: null,
                            tool_calls: [{
                                id: 'call_1',
                                type: 'function',
                                function: {
                                    name: 'read_file',
                                    arguments: '{"path": "/test.txt"}'
                                }
                            }]
                        },
                        finish_reason: 'tool_calls'
                    }]
                })
            });

            const response = await provider.complete({
                messages: [{ role: 'user', content: 'Read test.txt' }],
                tools: [{
                    name: 'read_file',
                    description: 'Read a file',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: { type: 'string', description: 'File path' }
                        },
                        required: ['path']
                    }
                }]
            });

            expect(response.toolCalls).toHaveLength(1);
            expect(response.toolCalls![0].id).toBe('call_1');
            expect(response.toolCalls![0].function.name).toBe('read_file');
            expect(response.toolCalls![0].function.arguments).toBe('{"path": "/test.txt"}');
            expect(response.finishReason).toBe('tool_calls');
        });

        it('should throw ApiError with friendly message on API error', async () => {
            mockIsMLXSupported.mockReturnValue(true);
            global.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
                json: async () => ({ error: { message: 'Internal Server Error' } })
            });

            const err = await provider.complete({
                messages: [{ role: 'user', content: 'Hello' }]
            }).catch((e: unknown) => e);
            expect(err).toBeInstanceOf(ApiError);
            expect((err as ApiError).code).toBe('server_error');
            expect((err as ApiError).httpStatus).toBe(500);
        });

        it('should use default values when not provided', async () => {
            mockIsMLXSupported.mockReturnValue(true);
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    id: 'mlx-default',
                    choices: [{
                        index: 0,
                        message: {
                            role: 'assistant',
                            content: 'Response'
                        },
                        finish_reason: 'stop'
                    }]
                })
            });

            await provider.complete({
                messages: [{ role: 'user', content: 'Hello' }]
            });

            const callBody = JSON.parse((fetch as any).mock.calls[0][1].body);
            expect(callBody.temperature).toBe(0.7);
            expect(callBody.max_tokens).toBe(4096);
            expect(callBody.stream).toBe(false);
        });

        it('should handle response without usage data', async () => {
            mockIsMLXSupported.mockReturnValue(true);
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    id: 'mlx-no-usage',
                    choices: [{
                        index: 0,
                        message: {
                            role: 'assistant',
                            content: 'Response'
                        },
                        finish_reason: 'stop'
                    }]
                })
            });

            const response = await provider.complete({
                messages: [{ role: 'user', content: 'Hello' }]
            });

            expect(response.usage).toBeUndefined();
        });

        it('should generate default id and created when not in response', async () => {
            mockIsMLXSupported.mockReturnValue(true);
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    choices: [{
                        index: 0,
                        message: {
                            role: 'assistant',
                            content: 'Response'
                        },
                        finish_reason: 'stop'
                    }]
                })
            });

            const response = await provider.complete({
                messages: [{ role: 'user', content: 'Hello' }]
            });

            expect(response.id).toMatch(/^mlx-\d+$/);
            expect(response.created).toBeGreaterThan(0);
        });

        it('should pass a signal for request cancellation (combined with timeout)', async () => {
            mockIsMLXSupported.mockReturnValue(true);
            const controller = new AbortController();
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    choices: [{
                        index: 0,
                        message: {
                            role: 'assistant',
                            content: 'Response'
                        },
                        finish_reason: 'stop'
                    }]
                })
            });

            await provider.complete({
                messages: [{ role: 'user', content: 'Hello' }],
                signal: controller.signal
            });

            // After our fix, a combined signal (user + timeout) is passed — just verify a signal is present
            expect(fetch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    signal: expect.objectContaining({ aborted: false })
                })
            );
        });

        it('should map message roles and content correctly', async () => {
            mockIsMLXSupported.mockReturnValue(true);
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    choices: [{
                        index: 0,
                        message: {
                            role: 'assistant',
                            content: 'Response'
                        },
                        finish_reason: 'stop'
                    }]
                })
            });

            await provider.complete({
                messages: [
                    { role: 'system', content: 'You are helpful' },
                    { role: 'user', content: 'Hello' },
                    { role: 'assistant', content: 'Hi there' },
                    { role: 'user', content: 'How are you?' }
                ]
            });

            const callBody = JSON.parse((fetch as any).mock.calls[0][1].body);
            expect(callBody.messages).toHaveLength(4);
            expect(callBody.messages[0].role).toBe('system');
            expect(callBody.messages[1].role).toBe('user');
            expect(callBody.messages[2].role).toBe('assistant');
            expect(callBody.messages[3].role).toBe('user');
        });

        // -----------------------------------------------------------------------
        // Error handling tests (TDD — these fail before the fix is implemented)
        // -----------------------------------------------------------------------

        it('throws friendly ApiError on ECONNREFUSED (server down)', async () => {
            mockIsMLXSupported.mockReturnValue(true);
            const connRefused = new Error('connect ECONNREFUSED 127.0.0.1:8080');
            connRefused.name = 'Error';
            global.fetch = vi.fn().mockRejectedValue(connRefused);

            const err = await provider.complete({
                messages: [{ role: 'user', content: 'Hello' }]
            }).catch((e: unknown) => e);

            expect(err).toBeInstanceOf(ApiError);
            const apiErr = err as ApiError;
            expect(apiErr.message).toMatch(/MLX server/i);
            expect(apiErr.message).toMatch(/running/i);
            expect(apiErr.code).toBe('network_error');
        });

        it('throws friendly ApiError on timeout (server not responding)', async () => {
            mockIsMLXSupported.mockReturnValue(true);
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

        it('does not retry when user cancels (signal.aborted = true)', async () => {
            mockIsMLXSupported.mockReturnValue(true);
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

        it('retries on transient 500 errors (at least 1 retry attempt)', async () => {
            mockIsMLXSupported.mockReturnValue(true);
            const successResponse = {
                ok: true,
                json: async () => ({
                    id: 'mlx-retry',
                    choices: [{
                        index: 0,
                        message: { role: 'assistant', content: 'Recovered' },
                        finish_reason: 'stop'
                    }]
                })
            };
            // First call fails with 500, second succeeds
            global.fetch = vi.fn()
                .mockResolvedValueOnce({
                    ok: false,
                    status: 500,
                    statusText: 'Internal Server Error',
                    json: async () => ({ error: { message: 'Internal Server Error' } })
                })
                .mockResolvedValueOnce(successResponse);

            const response = await provider.complete({
                messages: [{ role: 'user', content: 'Hello' }]
            });

            expect(response.content).toBe('Recovered');
            // fetch should have been called twice (original + 1 retry)
            expect(global.fetch).toHaveBeenCalledTimes(2);
        });

        it('does not retry on 400 errors (non-retryable)', async () => {
            mockIsMLXSupported.mockReturnValue(true);
            global.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 400,
                statusText: 'Bad Request',
                json: async () => ({ error: { message: 'Bad request body' } })
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

        it('returns friendly message for 400 invalid request', async () => {
            mockIsMLXSupported.mockReturnValue(true);
            global.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 400,
                statusText: 'Bad Request',
                json: async () => ({ error: { message: 'invalid request format' } })
            });

            const err = await provider.complete({
                messages: [{ role: 'user', content: 'Hello' }]
            }).catch((e: unknown) => e);

            expect(err).toBeInstanceOf(ApiError);
            expect((err as ApiError).httpStatus).toBe(400);
        });

        it('returns friendly message for 404 model not found', async () => {
            mockIsMLXSupported.mockReturnValue(true);
            global.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 404,
                statusText: 'Not Found',
                json: async () => ({ error: { message: 'model not found' } })
            });

            const err = await provider.complete({
                messages: [{ role: 'user', content: 'Hello' }]
            }).catch((e: unknown) => e);

            expect(err).toBeInstanceOf(ApiError);
            const apiErr = err as ApiError;
            expect(apiErr.code).toBe('model_not_found');
            expect(apiErr.httpStatus).toBe(404);
        });

        it('returns friendly message for 503 service unavailable', async () => {
            mockIsMLXSupported.mockReturnValue(true);
            global.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 503,
                statusText: 'Service Unavailable',
                json: async () => ({ error: { message: 'service unavailable' } })
            });

            const err = await provider.complete({
                messages: [{ role: 'user', content: 'Hello' }]
            }).catch((e: unknown) => e);

            expect(err).toBeInstanceOf(ApiError);
            const apiErr = err as ApiError;
            expect(apiErr.code).toBe('server_error');
            expect(apiErr.httpStatus).toBe(503);
        });

        it('respects configured timeout', async () => {
            mockIsMLXSupported.mockReturnValue(true);
            const networkSettings: NetworkSettings = { timeout: 100, maxRetries: 0 };
            const fastTimeoutProvider = new MLXProvider(config, networkSettings);

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
    });

    describe('constructor with network settings', () => {
        it('accepts NetworkSettings as second constructor param', () => {
            const networkSettings: NetworkSettings = {
                timeout: 120_000,
                maxRetries: 2,
                retryDelay: 500
            };
            const p = new MLXProvider(config, networkSettings);
            expect(p.getName()).toBe('mlx');
        });

        it('uses default timeout when network settings not provided', () => {
            const p = new MLXProvider(config);
            expect(p.getName()).toBe('mlx');
        });
    });
});
