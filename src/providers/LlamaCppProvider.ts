/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LLMProvider } from './LLMProvider.js';
import type { LLMRequest, LLMResponse, LLMToolCall, LLMUsage, ProviderSettings, FunctionDefinition } from '../types.js';
import { ApiError, classifyApiError } from './errors.js';

interface LlamaCppToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

interface LlamaCppChatResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: Array<{
        index: number;
        message: {
            role: string;
            content: string | null;
            tool_calls?: LlamaCppToolCall[];
        };
        finish_reason: string;
    }>;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

export class LlamaCppProvider implements LLMProvider {
    private baseUrl: string;
    private model: string;

    private static readonly DEFAULT_MODEL = 'local';

    constructor(config: ProviderSettings) {
        const port = config.port || 8080;
        this.baseUrl = config.baseUrl || `http://localhost:${port}`;
        this.model = config.model || LlamaCppProvider.DEFAULT_MODEL;
    }

    getName(): string {
        return 'llamacpp';
    }

    setModel(model: string): void {
        this.model = model;
    }

    async listModels(): Promise<string[]> {
        try {
            const response = await fetch(`${this.baseUrl}/v1/models`);
            if (!response.ok) {
                return this.model ? [this.model] : [];
            }
            const data = await response.json();
            return data.data?.map((m: { id: string }) => m.id) ?? [this.model];
        } catch {
            return this.model ? [this.model] : [];
        }
    }

    async isAvailable(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/health`);
            return response.ok;
        } catch {
            return false;
        }
    }

    async complete(request: LLMRequest): Promise<LLMResponse> {
        const body: Record<string, unknown> = {
            model: request.model || this.model || LlamaCppProvider.DEFAULT_MODEL,
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

        const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            signal: request.signal
        });

        if (!response.ok) {
            throw await this.buildApiError(response, body);
        }

        const data: LlamaCppChatResponse = await response.json();
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
            id: data.id || `llamacpp-${Date.now()}`,
            created: data.created || Math.floor(Date.now() / 1000),
            content: choice?.message.content ?? '',
            toolCalls,
            finishReason,
            usage,
            raw: data
        };
    }

    private async buildApiError(response: Response, body: Record<string, unknown>): Promise<ApiError> {
        let errorBody = '';
        try {
            errorBody = await response.text();
        } catch {
            // Ignore error reading body
        }

        const lowerBody = errorBody.toLowerCase();
        if (body.tools && response.status === 400 && (
            lowerBody.includes('tool') ||
            lowerBody.includes('function') ||
            lowerBody.includes('schema')
        )) {
            return new ApiError(
                `llama.cpp rejected tool-enabled requests. If you want tool support, start llama-server with function-calling settings such as ` +
                `'--jinja -fa' and, if needed, '--chat-template chatml' or '--chat-template-file /path/to/tool_use.jinja'.\n${errorBody}`,
                'invalid_request',
                response.status,
                false,
                undefined,
                errorBody,
            );
        }

        const baseError = classifyApiError(response.status, errorBody, response.headers);
        return new ApiError(
            `llama.cpp API error: ${response.status} ${response.statusText}${errorBody ? `\n${errorBody}` : ''}`,
            baseError.code,
            baseError.httpStatus,
            baseError.retryable,
            baseError.retryAfterMs,
            errorBody,
        );
    }
}
