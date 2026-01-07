/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LLMProvider } from './LLMProvider.js';
import type { LLMRequest, LLMResponse, LLMToolCall, LLMUsage, ProviderSettings, FunctionDefinition } from '../types.js';
import { isMLXSupported } from '../utils/platform.js';

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

/**
 * MLX Provider for Apple Silicon optimized local inference.
 * Uses OpenAI-compatible API format (mlx-lm server).
 * Only available on macOS with Apple Silicon (M1, M2, M3, etc.).
 */
export class MLXProvider implements LLMProvider {
    private baseUrl: string;
    private model: string;

    constructor(config: ProviderSettings) {
        const port = config.port || 8080;
        this.baseUrl = config.baseUrl || `http://localhost:${port}`;
        this.model = config.model || 'mlx-model';
    }

    getName(): string {
        return 'mlx';
    }

    setModel(model: string): void {
        this.model = model;
    }

    async listModels(): Promise<string[]> {
        // MLX is only available on Apple Silicon
        if (!isMLXSupported()) {
            return [];
        }

        try {
            const response = await fetch(`${this.baseUrl}/v1/models`);
            if (!response.ok) {
                return this.model ? [this.model] : [];
            }
            const data = await response.json();
            return data.data?.map((m: { id: string }) => m.id) ?? (this.model ? [this.model] : []);
        } catch {
            return this.model ? [this.model] : [];
        }
    }

    async isAvailable(): Promise<boolean> {
        // MLX is only available on Apple Silicon
        if (!isMLXSupported()) {
            return false;
        }

        try {
            const response = await fetch(`${this.baseUrl}/v1/models`);
            return response.ok;
        } catch {
            return false;
        }
    }

    async complete(request: LLMRequest): Promise<LLMResponse> {
        // MLX is only available on Apple Silicon
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

        const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body),
            signal: request.signal
        });

        if (!response.ok) {
            throw new Error(`MLX API error: ${response.status} ${response.statusText}`);
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
}
