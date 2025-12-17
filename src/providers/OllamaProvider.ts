/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LLMProvider } from './LLMProvider.js';
import type { LLMRequest, LLMResponse, LLMToolCall, LLMUsage, ProviderSettings, FunctionDefinition } from '../types.js';

interface OllamaModel {
    name: string;
    modified_at?: string;
    size?: number;
}

interface OllamaTagsResponse {
    models: OllamaModel[];
}

interface OllamaToolCall {
    function: {
        name: string;
        arguments: Record<string, unknown>;
    };
}

interface OllamaChatResponse {
    message: {
        role: string;
        content: string;
        tool_calls?: OllamaToolCall[];
    };
    created_at: string;
    done: boolean;
    prompt_eval_count?: number;
    eval_count?: number;
}

export class OllamaProvider implements LLMProvider {
    private baseUrl: string;
    private model: string;
    private disableTools: boolean = false;

    constructor(config: ProviderSettings) {
        this.baseUrl = config.baseUrl || 'http://localhost:11434';
        this.model = config.model || 'llama3.2:latest';
    }

    getName(): string {
        return 'ollama';
    }

    setModel(model: string): void {
        this.model = model;
    }

    async listModels(): Promise<string[]> {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`);

            if (!response.ok) {
                return [];
            }

            const data: OllamaTagsResponse = await response.json();
            return data.models.map(m => m.name);
        } catch (error) {
            // Ollama not running or network error
            return [];
        }
    }

    async isAvailable(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`);
            return response.ok;
        } catch {
            return false;
        }
    }

    async complete(request: LLMRequest): Promise<LLMResponse> {
        const messages = request.messages.map((msg: { role: string; content: string; name?: string; tool_call_id?: string; tool_calls?: unknown[] }) => {
            const mapped: Record<string, unknown> = {
                role: msg.role,
                content: msg.content ?? ''
            };
            if (msg.name) {
                mapped.name = msg.name;
            }
            if (msg.role === 'tool' && msg.tool_call_id) {
                mapped.tool_call_id = msg.tool_call_id;
            }
            if (msg.role === 'assistant' && msg.tool_calls) {
                mapped.tool_calls = msg.tool_calls;
            }
            return mapped;
        });

        const body: Record<string, unknown> = {
            model: request.model || this.model,
            messages,
            stream: request.stream || false
        };

        if (request.temperature !== undefined) {
            body.options = { temperature: request.temperature };
        }

        // Add function calling support if tools are provided and not disabled
        // Ollama 0.1.44+ supports function calling with the 'tools' parameter
        if (!this.disableTools && request.tools && request.tools.length > 0) {
            body.tools = request.tools.map((tool: FunctionDefinition) => ({
                type: 'function',
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters ?? { type: 'object', properties: {} }
                }
            }));
        }

        const response = await fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body),
            signal: request.signal
        });

        if (!response.ok) {
            let errorDetail = '';
            try {
                const errorBody = await response.text();
                errorDetail = errorBody ? `: ${errorBody}` : '';

                // Check if model doesn't support tools - retry without them
                if (errorBody.includes('does not support tools') && body.tools) {
                    console.warn(`Model ${body.model} does not support tools. Retrying without tool support.`);
                    this.disableTools = true;
                    delete body.tools;
                    return this.complete(request);
                }
            } catch {
                // Ignore error reading body
            }
            throw new Error(`Ollama API error: ${response.status} ${response.statusText}${errorDetail}`);
        }

        if (request.stream) {
            return this.handleStreamingResponse(response);
        }

        const data: OllamaChatResponse = await response.json();

        // Parse tool calls if present (Ollama returns arguments as object, not string)
        let toolCalls: LLMToolCall[] | undefined;
        if (data.message.tool_calls && Array.isArray(data.message.tool_calls)) {
            toolCalls = data.message.tool_calls.map((tc: OllamaToolCall, index: number) => ({
                id: `ollama-tool-${Date.now()}-${index}`,
                type: 'function' as const,
                function: {
                    name: tc.function.name,
                    // Ollama returns arguments as object, convert to JSON string for consistency
                    arguments: JSON.stringify(tc.function.arguments)
                }
            }));
        }

        // Parse token usage if present (Ollama uses different field names)
        let usage: LLMUsage | undefined;
        if (data.prompt_eval_count !== undefined || data.eval_count !== undefined) {
            usage = {
                promptTokens: data.prompt_eval_count ?? 0,
                completionTokens: data.eval_count ?? 0,
                totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0)
            };
        }

        return {
            id: `ollama-${Date.now()}`,
            created: Math.floor(new Date(data.created_at).getTime() / 1000),
            content: data.message.content,
            toolCalls,
            finishReason: toolCalls?.length ? 'tool_calls' : 'stop',
            usage,
            raw: data
        };
    }

    private async handleStreamingResponse(response: Response): Promise<LLMResponse> {
        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error('No response body');
        }

        const decoder = new TextDecoder();
        let fullContent = '';
        let lastData: OllamaChatResponse | null = null;

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n').filter(line => line.trim());

                for (const line of lines) {
                    try {
                        const data: OllamaChatResponse = JSON.parse(line);
                        fullContent += data.message.content;
                        lastData = data;
                    } catch {
                        // Skip invalid JSON lines
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }

        return {
            id: `ollama-${Date.now()}`,
            created: lastData ? Math.floor(new Date(lastData.created_at).getTime() / 1000) : Date.now(),
            content: fullContent,
            raw: lastData
        };
    }
}
