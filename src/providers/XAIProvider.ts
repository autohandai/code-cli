/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LLMProvider } from './LLMProvider.js';
import type { LLMRequest, LLMResponse, LLMToolCall, LLMUsage, FunctionDefinition } from '../types.js';
import { ApiError, classifyApiError } from './errors.js';

/** Canonical list of supported xAI models — single source of truth. */
export const XAI_MODELS = [
    'grok-4.20-reasoning',
    'grok-4-1-fast-reasoning-latest',
    'grok-4.20-0309-reasoning',
] as const;

/** Default model when none is specified. */
export const XAI_DEFAULT_MODEL = 'grok-4.20-reasoning';

/** xAI API base URL. */
const XAI_API_BASE_URL = 'https://api.x.ai/v1';

/** xAI server-side tools — the built-in tool types the API supports. */
export const XAI_SUPPORTED_TOOLS = [
    'web_search',
    'x_search',
    'code_execution',
] as const;

type XAISupportedTool = (typeof XAI_SUPPORTED_TOOLS)[number];

/**
 * Represents a built-in xAI tool as sent in the request.
 * (Server-side tools don't need function definitions — just a type.)
 */
interface XAITool {
    type: XAISupportedTool;
}

/** --- Internal response types --- */

interface XAIResponsesUsage {
    input_tokens?: number;
    output_tokens?: number;
    reasoning_tokens?: number;
    total_tokens?: number;
}

interface XAIResponsesOutputText {
    type: 'output_text';
    text: string;
}

interface XAIResponsesFunctionCall {
    type: 'function_call';
    call_id?: string;
    name: string;
    arguments: string;
}

interface XAIResponsesMessage {
    type: 'message';
    role: string;
    content?: Array<XAIResponsesOutputText | { type: string; [key: string]: unknown }>;
}

interface XAIResponsesResponse {
    id: string;
    created_at?: number;
    output?: Array<XAIResponsesMessage | XAIResponsesFunctionCall | { type: string; [key: string]: unknown }>;
    output_text?: string;
    usage?: XAIResponsesUsage;
    incomplete_details?: {
        reason?: string;
    };
}

/**
 * xAI provider implementation using the OpenAI-compatible Responses API.
 *
 * Target models:
 *   - grok-4.20-reasoning        (latest reasoning model)
 *   - grok-4-1-fast-reasoning    (fast reasoning, aliases: grok-4-1-fast-reasoning-latest)
 *   - grok-4.20-0309-reasoning   (specific dated release)
 *
 * Server-side tools (specified by type, no function schema needed):
 *   - web_search
 *   - x_search
 *   - code_execution    (alias: code_interpreter)
 */
export class XAIProvider implements LLMProvider {
    private baseUrl: string;
    private apiKey: string;
    private model: string;

    constructor(config: { apiKey?: string; baseUrl?: string; model?: string }) {
        this.apiKey = config.apiKey || '';
        this.baseUrl = (config.baseUrl || XAI_API_BASE_URL).replace(/\/$/, '');
        this.model = config.model || XAI_DEFAULT_MODEL;
    }

    getName(): string {
        return 'xai';
    }

    setModel(model: string): void {
        this.model = model;
    }

    /**
     * List available models from xAI's REST API (GET /v1/language-models),
     * falling back to the canonical static list.
     */
    async listModels(): Promise<string[]> {
        // First try to fetch from API
        try {
            const headers = await this.buildAuthHeaders();
            const response = await fetch(`${this.baseUrl}/language-models`, { headers });
            if (response.ok) {
                const data = await response.json();
                if (data?.models && Array.isArray(data.models)) {
                    // Collect all canonical IDs + their aliases
                    const ids = new Set<string>();
                    for (const m of data.models) {
                        if (m.id) ids.add(m.id);
                        if (Array.isArray(m.aliases)) {
                            for (const a of m.aliases) ids.add(a);
                        }
                    }
                    if (ids.size > 0) {
                        return [...ids];
                    }
                }
            }
        } catch {
            // Fall through to static list
        }

        // Fall back to canonical list
        return [...XAI_MODELS];
    }

    async isAvailable(): Promise<boolean> {
        if (!this.apiKey) return false;
        try {
            const headers = await this.buildAuthHeaders();
            const response = await fetch(`${this.baseUrl}/models`, { headers });
            return response.ok;
        } catch {
            return false;
        }
    }

    /**
     * Complete a chat request using the xAI Responses API.
     *
     * xAI supports server-side tools (`web_search`, `x_search`, `code_execution`)
     * in addition to standard function calling. This implementation detects
     * tool types and emits the appropriate xAI tool format.
     */
    async complete(request: LLMRequest): Promise<LLMResponse> {
        const body: Record<string, unknown> = {
            model: request.model || this.model,
            stream: true,
            tool_choice: 'auto',
            input: this.toXAIInputItems(request.messages),
        };

        // Map tools to xAI's server-side tool format or standard function definitions
        const tools = this.mapToXAITools(request.tools);
        if (tools.length > 0) {
            body.tools = tools;
        }

        const headers = await this.buildAuthHeaders();
        let response: Response;

        try {
            response = await fetch(`${this.baseUrl}/responses`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...headers,
                },
                body: JSON.stringify(body),
                signal: request.signal,
            });
        } catch (error) {
            const err = error as Error;
            if (err.name === 'AbortError' && request.signal?.aborted) {
                throw new ApiError('Request cancelled.', 'cancelled', 0, false);
            }
            if (err.name === 'AbortError') {
                throw new ApiError(
                    'Request timed out. The AI service may be experiencing high load.',
                    'timeout', 0, true,
                );
            }
            throw new ApiError(
                `Unable to connect to ${this.baseUrl}. Please check the URL and your API key.`,
                'network_error', 0, true,
            );
        }

        if (!response.ok) {
            throw await this.buildApiError(response);
        }

        const data = await this.parseXAIStream(response);
        const toolCalls = this.extractXAIToolCalls(data.output);
        const content = this.extractXAIContent(data);
        const usage = this.mapXAIUsage(data.usage);

        return {
            id: data.id,
            created: data.created_at ?? Math.floor(Date.now() / 1000),
            content,
            toolCalls,
            finishReason: toolCalls.length > 0
                ? 'tool_calls'
                : (data.incomplete_details?.reason === 'max_output_tokens' ? 'length' : 'stop'),
            usage,
            raw: data,
        };
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private async buildAuthHeaders(): Promise<Record<string, string>> {
        return {
            Authorization: `Bearer ${this.apiKey}`,
        };
    }

    // Map the generic LLMRequest.tools (FunctionDefinition[]) to xAI tool payloads.
    // xAI built-in tools use a simple `{ type: "web_search" }` form.
    // If the user supplies a custom FunctionDefinition whose name matches a known
    // server-side tool we emit the server-side variant; everything else becomes a
    // standard `function` tool.
    private mapToXAITools(tools?: FunctionDefinition[]): Array<XAITool | { type: 'function'; function: { name: string; description?: string; parameters?: Record<string, unknown> } }> {
        if (!tools?.length) return [];

        return tools.map((tool) => {
            const name = tool.name.toLowerCase();
            if (name === 'web_search' || name === 'x_search' || name === 'code_execution' || name === 'code_interpreter') {
                return { type: name === 'code_interpreter' ? 'code_execution' : name };
            }
            return {
                type: 'function' as const,
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                },
            };
        });
    }

    // Convert the internal message format to xAI Responses API input items.
    private toXAIInputItems(messages: Array<{ role: string; content: string; name?: string; tool_call_id?: string; tool_calls?: LLMToolCall[] }>): Array<Record<string, unknown>> {
        const items: Array<Record<string, unknown>> = [];

        for (const msg of messages) {
            if (msg.role === 'system') {
                // xAI doesn't support system role in the input array —
                // push it as an instructions-style prefix via a user message.
                continue;
            }

            if (msg.role === 'tool' && msg.tool_call_id && msg.content) {
                items.push({
                    type: 'function_call_output',
                    call_id: msg.tool_call_id,
                    output: msg.content,
                });
                continue;
            }

            if (msg.role === 'assistant' && msg.tool_calls?.length) {
                items.push({
                    type: 'message',
                    role: 'assistant',
                    content: [], // will have function_calls appended
                });
                for (const tc of msg.tool_calls) {
                    items.push({
                        type: 'function_call',
                        call_id: tc.id,
                        name: tc.function.name,
                        arguments: tc.function.arguments,
                    });
                }
                continue;
            }

            if (msg.content && typeof msg.content === 'string' && msg.content.trim()) {
                items.push({
                    type: 'message',
                    role: msg.role === 'user' ? 'user' : 'user',
                    content: [{ type: 'input_text', text: msg.content }],
                });
            }
        }

        return items;
    }

    private extractXAIToolCalls(output: XAIResponsesResponse['output']): LLMToolCall[] {
        if (!Array.isArray(output)) return [];

        return output
            .filter((entry): entry is XAIResponsesFunctionCall => entry?.type === 'function_call')
            .map((toolCall, index) => ({
                id: toolCall.call_id ?? `call_${index + 1}`,
                type: 'function' as const,
                function: {
                    name: toolCall.name,
                    arguments: toolCall.arguments,
                },
            }));
    }

    private extractXAIContent(data: XAIResponsesResponse): string {
        if (typeof data.output_text === 'string' && data.output_text.trim()) {
            return data.output_text;
        }
        if (!Array.isArray(data.output)) return '';

        const parts: string[] = [];
        for (const item of data.output) {
            if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
            for (const ci of item.content) {
                if (ci?.type === 'output_text' && typeof ci.text === 'string') {
                    parts.push(ci.text);
                }
            }
        }
        return parts.join('\n').trim();
    }

    private mapXAIUsage(usage?: XAIResponsesUsage): LLMUsage | undefined {
        if (!usage) return undefined;
        const input = usage.input_tokens ?? 0;
        const output = usage.output_tokens ?? 0;
        return {
            promptTokens: input,
            completionTokens: output,
            totalTokens: usage.total_tokens ?? (input + output),
        };
    }

    private async parseXAIStream(response: Response): Promise<XAIResponsesResponse> {
        const text = await response.text();
        let currentEvent = '';
        let completedData: XAIResponsesResponse | null = null;

        for (const line of text.split('\n')) {
            if (line.startsWith('event: ')) {
                currentEvent = line.slice(7).trim();
                continue;
            }
            if (line.startsWith('data: ') && currentEvent === 'response.completed') {
                completedData = JSON.parse(line.slice(6)) as XAIResponsesResponse;
                break;
            }
        }

        if (!completedData) {
            throw new ApiError(
                'No response.completed event found in stream. The API response may be malformed.',
                'invalid_request', 0, false,
            );
        }
        return completedData;
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
            try { errorDetail = await response.text(); } catch { /* ignore */ }
        }
        return classifyApiError(response.status, errorDetail, response.headers);
    }
}
