/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LLMProvider } from './LLMProvider.js';
import type { LLMRequest, LLMResponse, LLMToolCall, LLMUsage, ProviderSettings, NetworkSettings, FunctionDefinition } from '../types.js';
import { isMLXSupported } from '../utils/platform.js';
import { ApiError, classifyApiError } from './errors.js';

interface MLXToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

interface MLXChatResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: Array<{
        index: number;
        message: {
            role: string;
            content: string | null;
            tool_calls?: MLXToolCall[];
        };
        finish_reason: string;
    }>;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

const DEFAULT_TIMEOUT = 60_000;   // 60 s — local inference can be slow
const DEFAULT_MAX_RETRIES = 2;
const MAX_ALLOWED_RETRIES = 5;
const DEFAULT_RETRY_DELAY = 1_000;
const AVAILABILITY_TIMEOUT = 5_000; // 5 s for listModels / isAvailable

/**
 * MLX Provider for Apple Silicon optimized local inference.
 * Uses OpenAI-compatible API format (mlx-lm server).
 * Only available on macOS with Apple Silicon (M1, M2, M3, etc.).
 */
export class MLXProvider implements LLMProvider {
    private readonly baseUrl: string;
    private model: string;
    private readonly maxRetries: number;
    private readonly retryDelay: number;
    private readonly timeout: number;

    constructor(config: ProviderSettings, networkSettings?: NetworkSettings) {
        const port = config.port || 8080;
        this.baseUrl = config.baseUrl || `http://localhost:${port}`;
        this.model = config.model || 'mlx-model';

        const configuredRetries = networkSettings?.maxRetries ?? DEFAULT_MAX_RETRIES;
        this.maxRetries = Math.min(Math.max(0, configuredRetries), MAX_ALLOWED_RETRIES);
        this.retryDelay = networkSettings?.retryDelay ?? DEFAULT_RETRY_DELAY;
        this.timeout = networkSettings?.timeout ?? DEFAULT_TIMEOUT;
    }

    getName(): string {
        return 'mlx';
    }

    setModel(model: string): void {
        this.model = model;
    }

    async listModels(): Promise<string[]> {
        if (!isMLXSupported()) {
            return [];
        }

        try {
            const controller = new AbortController();
            const timerId = setTimeout(() => controller.abort(), AVAILABILITY_TIMEOUT);
            try {
                const response = await fetch(`${this.baseUrl}/v1/models`, {
                    signal: controller.signal,
                });
                if (!response.ok) {
                    return this.model ? [this.model] : [];
                }
                const data = await response.json();
                return data.data?.map((m: { id: string }) => m.id) ?? (this.model ? [this.model] : []);
            } finally {
                clearTimeout(timerId);
            }
        } catch {
            return this.model ? [this.model] : [];
        }
    }

    async isAvailable(): Promise<boolean> {
        if (!isMLXSupported()) {
            return false;
        }

        try {
            const controller = new AbortController();
            const timerId = setTimeout(() => controller.abort(), AVAILABILITY_TIMEOUT);
            try {
                const response = await fetch(`${this.baseUrl}/v1/models`, {
                    signal: controller.signal,
                });
                return response.ok;
            } finally {
                clearTimeout(timerId);
            }
        } catch {
            return false;
        }
    }

    async complete(request: LLMRequest): Promise<LLMResponse> {
        if (!isMLXSupported()) {
            throw new Error('MLX is only supported on macOS with Apple Silicon');
        }

        const body: Record<string, unknown> = {
            model: request.model || this.model,
            messages: request.messages.map((msg) => {
                const mapped: Record<string, unknown> = {
                    role: msg.role,
                    content: msg.content
                };
                if (msg.name) mapped.name = msg.name;
                if (msg.role === 'tool' && msg.tool_call_id) mapped.tool_call_id = msg.tool_call_id;
                if (msg.role === 'assistant' && msg.tool_calls) mapped.tool_calls = msg.tool_calls;
                return mapped;
            }),
            temperature: request.temperature ?? 0.7,
            max_tokens: request.maxTokens ?? 4096,
            stream: false
        };

        if (request.tools && request.tools.length > 0) {
            body.tools = request.tools.map((tool: FunctionDefinition) => ({
                type: 'function',
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters ?? { type: 'object', properties: {} }
                }
            }));
        }

        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                return await this.makeRequest(body, request.signal);
            } catch (error) {
                lastError = error as Error;

                if (this.isNonRetryableError(error as Error)) {
                    throw error;
                }

                if (attempt < this.maxRetries) {
                    const delay = this.retryDelay * Math.pow(2, attempt);
                    await this.sleep(delay);
                }
            }
        }

        throw lastError ?? new ApiError(
            'Failed to communicate with the MLX server. Please try again.',
            'network_error',
            0,
            true,
        );
    }

    private async makeRequest(
        body: Record<string, unknown>,
        userSignal?: AbortSignal,
    ): Promise<LLMResponse> {
        let response: Response;

        try {
            const timeoutController = new AbortController();
            const timerId = setTimeout(() => timeoutController.abort(), this.timeout);

            const combinedSignal = userSignal
                ? this.combineSignals(userSignal, timeoutController.signal)
                : timeoutController.signal;

            try {
                response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(body),
                    signal: combinedSignal,
                });
            } finally {
                clearTimeout(timerId);
            }
        } catch (error) {
            const err = error as Error;

            // User cancelled
            if (err.name === 'AbortError' && userSignal?.aborted) {
                throw new ApiError('Request cancelled.', 'cancelled', 0, false);
            }

            // Timeout (timeout controller fired, not user abort)
            if (err.name === 'AbortError') {
                throw new ApiError(
                    `MLX server request timed out after ${this.timeout / 1000}s. ` +
                    'Local inference can be slow — consider increasing the timeout in your config.',
                    'timeout',
                    0,
                    true,
                );
            }

            // Network error (ECONNREFUSED, ENOTFOUND, etc.)
            throw new ApiError(
                `Cannot connect to MLX server at ${this.baseUrl}. Make sure it is running.`,
                'network_error',
                0,
                true,
            );
        }

        if (!response.ok) {
            throw await this.buildApiError(response);
        }

        const data: MLXChatResponse = await response.json();
        const choice = data.choices[0];

        let toolCalls: LLMToolCall[] | undefined;
        if (choice?.message.tool_calls?.length) {
            toolCalls = choice.message.tool_calls.map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: {
                    name: tc.function.name,
                    arguments: tc.function.arguments
                }
            }));
        }

        let usage: LLMUsage | undefined;
        if (data.usage) {
            usage = {
                promptTokens: data.usage.prompt_tokens,
                completionTokens: data.usage.completion_tokens,
                totalTokens: data.usage.total_tokens
            };
        }

        const finishReason = toolCalls?.length
            ? 'tool_calls'
            : (choice?.finish_reason === 'stop' || choice?.finish_reason === 'length' || choice?.finish_reason === 'content_filter')
                ? choice.finish_reason
                : 'stop';

        return {
            id: data.id || `mlx-${Date.now()}`,
            created: data.created || Math.floor(Date.now() / 1000),
            content: choice?.message.content ?? '',
            toolCalls,
            finishReason,
            usage,
            raw: data
        };
    }

    private async buildApiError(response: Response): Promise<ApiError> {
        let errorDetail = '';
        try {
            const body = (await response.json()) as Record<string, unknown>;
            const maybeError = body?.error;
            if (maybeError && typeof maybeError === 'object') {
                errorDetail = (maybeError as Record<string, unknown>)?.message as string ?? '';
            } else if (typeof maybeError === 'string') {
                errorDetail = maybeError;
            } else if (typeof body?.message === 'string') {
                errorDetail = body.message;
            }
            if (typeof errorDetail === 'object') {
                errorDetail = JSON.stringify(errorDetail);
            }
        } catch {
            try {
                errorDetail = await response.text();
            } catch {
                // Ignore
            }
        }

        return classifyApiError(response.status, errorDetail, response.headers);
    }

    private isNonRetryableError(error: Error): boolean {
        if (error instanceof ApiError) {
            return !error.retryable;
        }
        const classified = classifyApiError(0, error.message);
        return !classified.retryable;
    }

    private combineSignals(signal1: AbortSignal, signal2: AbortSignal): AbortSignal {
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal1.addEventListener('abort', abort);
        signal2.addEventListener('abort', abort);
        if (signal1.aborted || signal2.aborted) {
            controller.abort();
        }
        return controller.signal;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
