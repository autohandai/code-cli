/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LLMProvider } from './LLMProvider.js';
import type { LLMRequest, LLMResponse, LLMToolCall, LLMUsage, ProviderSettings, FunctionDefinition } from '../types.js';

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

export class OpenAIProvider implements LLMProvider {
    private baseUrl: string;
    private apiKey: string;
    private model: string;

    constructor(config: ProviderSettings) {
        this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
        this.apiKey = config.apiKey || '';
        this.model = config.model || 'gpt-4o';
    }

    getName(): string {
        return 'openai';
    }

    setModel(model: string): void {
        this.model = model;
    }

    async listModels(): Promise<string[]> {
        // Commonly used OpenAI models
        return [
            'gpt-4o',
            'gpt-4o-mini',
            'gpt-4-turbo',
            'gpt-4',
            'gpt-3.5-turbo'
        ];
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
            messages: request.messages.map((msg: { role: string; content: string; name?: string; tool_call_id?: string }) => {
                const mapped: Record<string, unknown> = {
                    role: msg.role === 'system' ? 'system' : msg.role === 'user' ? 'user' : msg.role === 'tool' ? 'tool' : 'assistant',
                    content: msg.content
                };
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

        const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: JSON.stringify(body),
            signal: request.signal
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`OpenAI API error: ${response.status} ${error}`);
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
}
