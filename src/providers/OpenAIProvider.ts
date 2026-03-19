/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LLMProvider } from './LLMProvider.js';
import type { LLMRequest, LLMResponse, LLMToolCall, LLMUsage, ProviderSettings, FunctionDefinition, ReasoningEffort } from '../types.js';
import { ApiError, classifyApiError } from './errors.js';

interface OpenAIToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

interface OpenAIMessage {
    role: string;
    content: string | null;
    tool_calls?: OpenAIToolCall[];
}

interface OpenAIChatResponse {
    id: string;
    created: number;
    choices: Array<{
        message: OpenAIMessage;
        finish_reason: string;
    }>;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

/** Canonical list of supported OpenAI models — single source of truth. */
export const OPENAI_MODELS = [
    'gpt-5.4',
    'gpt-5.4-pro',
    'gpt-5.4-mini',
    'gpt-5.4-nano',
    'gpt-5.3-codex',
    'gpt-5.1-codex-max',
] as const;

/** Valid reasoning effort levels for runtime validation. */
const VALID_REASONING_EFFORTS = new Set<string>(['none', 'low', 'medium', 'high', 'xhigh']);

export class OpenAIProvider implements LLMProvider {
    private baseUrl: string;
    private apiKey: string;
    private model: string;
    private reasoningEffort?: ReasoningEffort;

    constructor(config: ProviderSettings) {
        this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
        this.apiKey = config.apiKey || '';
        this.model = config.model || 'gpt-5.4';
        this.reasoningEffort = config.reasoningEffort;
    }

    getName(): string {
        return 'openai';
    }

    setModel(model: string): void {
        this.model = model;
    }

    async listModels(): Promise<string[]> {
        return [...OPENAI_MODELS];
    }

    async isAvailable(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/models`, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`
                }
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    async complete(request: LLMRequest): Promise<LLMResponse> {
        const body: Record<string, unknown> = {
            model: request.model || this.model,
            messages: request.messages.map((msg: { role: string; content: string; name?: string; tool_call_id?: string; tool_calls?: LLMToolCall[] }) => {
                const mapped: Record<string, unknown> = {
                    role: msg.role === 'system' ? 'system' : msg.role === 'user' ? 'user' : msg.role === 'tool' ? 'tool' : 'assistant',
                    content: msg.content
                };
                // Include tool_calls on assistant messages so the API can match
                // subsequent role:"tool" results to the calls that triggered them
                if (msg.role === 'assistant' && msg.tool_calls?.length) {
                    mapped.tool_calls = msg.tool_calls;
                }
                // Add tool call ID for tool response messages
                if (msg.role === 'tool' && msg.tool_call_id) {
                    mapped.tool_call_id = msg.tool_call_id;
                }
                if (msg.name) {
                    mapped.name = msg.name;
                }
                return mapped;
            }),
            temperature: request.temperature || 0.7,
            max_tokens: request.maxTokens
        };

        // Add reasoning effort when configured (with runtime validation)
        if (this.reasoningEffort && VALID_REASONING_EFFORTS.has(this.reasoningEffort)) {
            body.reasoning_effort = this.reasoningEffort;
        }

        // Add function calling support if tools are provided
        if (request.tools && request.tools.length > 0) {
            body.tools = request.tools.map((tool: FunctionDefinition) => ({
                type: 'function',
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters ?? { type: 'object', properties: {} }
                }
            }));

            // Set tool_choice based on request
            if (request.toolChoice) {
                body.tool_choice = request.toolChoice;
            }
        }

        let response: Response;

        try {
            response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify(body),
                signal: request.signal
            });
        } catch (error) {
            const err = error as Error;

            // User cancelled
            if (err.name === 'AbortError' && request.signal?.aborted) {
                throw new ApiError('Request cancelled.', 'cancelled', 0, false);
            }

            // Timeout
            if (err.name === 'AbortError') {
                throw new ApiError(
                    'Request timed out. The AI service may be experiencing high load.',
                    'timeout', 0, true,
                );
            }

            // Network error
            throw new ApiError(
                `Unable to connect to ${this.baseUrl}. Please check the URL and your internet connection.`,
                'network_error', 0, true,
            );
        }

        if (!response.ok) {
            throw await this.buildApiError(response);
        }

        const data: OpenAIChatResponse = await response.json();
        const message = data.choices[0].message;
        const finishReason = data.choices[0].finish_reason;

        // Parse tool calls if present
        let toolCalls: LLMToolCall[] | undefined;
        if (message.tool_calls && Array.isArray(message.tool_calls)) {
            toolCalls = message.tool_calls.map((tc: OpenAIToolCall) => ({
                id: tc.id,
                type: 'function' as const,
                function: {
                    name: tc.function.name,
                    arguments: tc.function.arguments
                }
            }));
        }

        // Parse token usage if present
        let usage: LLMUsage | undefined;
        if (data.usage) {
            usage = {
                promptTokens: data.usage.prompt_tokens,
                completionTokens: data.usage.completion_tokens,
                totalTokens: data.usage.total_tokens
            };
        }

        return {
            id: data.id,
            created: data.created,
            content: message.content ?? '',
            toolCalls,
            finishReason: finishReason as LLMResponse['finishReason'],
            usage,
            raw: data
        };
    }

    private async buildApiError(response: Response): Promise<ApiError> {
        let errorDetail = '';
        try {
            const body = (await response.json()) as Record<string, unknown>;
            const errObj = body?.error as Record<string, unknown> | undefined;
            errorDetail = (errObj?.message ?? body?.detail ?? body?.error ?? '') as string;
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
}
