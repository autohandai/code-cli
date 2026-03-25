/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LLMProvider } from './LLMProvider.js';
import type { LLMRequest, LLMResponse, LLMToolCall, LLMUsage, FunctionDefinition, ReasoningEffort, OpenAISettings, OpenAIChatGPTAuth } from '../types.js';
import { ApiError, classifyApiError } from './errors.js';
import { isChatGPTAuthExpired, refreshChatGPTAuth } from './openaiAuth.js';

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

interface OpenAIResponsesUsage {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
}

interface OpenAIResponsesOutputText {
    type: 'output_text';
    text: string;
}

interface OpenAIResponsesFunctionCall {
    type: 'function_call';
    call_id?: string;
    name: string;
    arguments: string;
}

interface OpenAIResponsesMessage {
    type: 'message';
    role: string;
    content?: Array<OpenAIResponsesOutputText | { type: string; [key: string]: unknown }>;
}

interface OpenAIResponsesResponse {
    id: string;
    created_at?: number;
    output?: Array<OpenAIResponsesMessage | OpenAIResponsesFunctionCall | { type: string; [key: string]: unknown }>;
    output_text?: string;
    usage?: OpenAIResponsesUsage;
    incomplete_details?: {
        reason?: string;
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
const OPENAI_API_BASE_URL = 'https://api.openai.com/v1';
const OPENAI_CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const DEFAULT_CODEX_INSTRUCTIONS = 'You are Autohand, a coding assistant. Follow the repository instructions and help the user complete software tasks.';

export class OpenAIProvider implements LLMProvider {
    private baseUrl: string;
    private apiKey: string;
    private model: string;
    private reasoningEffort?: ReasoningEffort;
    private authMode: 'api-key' | 'chatgpt';
    private chatgptAuth?: OpenAIChatGPTAuth;

    constructor(config: OpenAISettings) {
        this.authMode = config.authMode === 'chatgpt' ? 'chatgpt' : 'api-key';
        this.baseUrl = this.resolveBaseUrl(config.baseUrl);
        this.apiKey = config.apiKey || '';
        this.model = config.model || 'gpt-5.4';
        this.reasoningEffort = config.reasoningEffort;
        this.chatgptAuth = config.chatgptAuth;
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
        if (this.authMode === 'chatgpt') {
            return !!this.chatgptAuth?.accessToken && !!this.chatgptAuth?.accountId;
        }
        try {
            const headers = await this.buildAuthHeaders();
            const response = await fetch(`${this.baseUrl}/models`, {
                headers
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    async complete(request: LLMRequest): Promise<LLMResponse> {
        if (this.authMode === 'chatgpt') {
            return this.completeWithResponsesApi(request);
        }

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
        const headers = await this.buildAuthHeaders();

        try {
            response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...headers
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

    private async completeWithResponsesApi(request: LLMRequest): Promise<LLMResponse> {
        const instructions = this.buildCodexInstructions(request.messages);
        // The ChatGPT Codex backend supports a strict subset of the Responses API.
        // Unsupported parameters (max_output_tokens, temperature) are rejected.
        // See: https://github.com/openai/codex — ResponsesApiRequest struct.
        const body: Record<string, unknown> = {
            model: request.model || this.model,
            instructions,
            store: false,
            stream: true,
            tool_choice: 'auto',
            parallel_tool_calls: true,
            input: request.messages.flatMap((msg) => this.toResponsesInputItems(msg)),
        };

        if (this.reasoningEffort && VALID_REASONING_EFFORTS.has(this.reasoningEffort)) {
            body.reasoning = {
                effort: this.reasoningEffort,
            };
            // Enable encrypted reasoning content for multi-turn conversations
            body.include = ['reasoning.encrypted_content'];
        }

        if (request.tools && request.tools.length > 0) {
            body.tools = request.tools.map((tool: FunctionDefinition) => ({
                type: 'function',
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters ?? { type: 'object', properties: {} },
            }));

            if (request.toolChoice === 'required') {
                body.tool_choice = 'required';
            } else if (request.toolChoice === 'none') {
                body.tool_choice = 'none';
            } else if (request.toolChoice && typeof request.toolChoice === 'object') {
                body.tool_choice = {
                    type: 'function',
                    name: request.toolChoice.function.name,
                };
            }
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
                `Unable to connect to ${this.baseUrl}. Please check the URL and your internet connection.`,
                'network_error', 0, true,
            );
        }

        if (!response.ok) {
            throw await this.buildApiError(response);
        }

        const data = await this.parseCodexStream(response);
        const toolCalls = this.extractResponsesToolCalls(data.output);
        const content = this.extractResponsesContent(data);
        const usage = data.usage
            ? {
                promptTokens: data.usage.input_tokens ?? 0,
                completionTokens: data.usage.output_tokens ?? 0,
                totalTokens: data.usage.total_tokens ?? ((data.usage.input_tokens ?? 0) + (data.usage.output_tokens ?? 0)),
            }
            : undefined;

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

    /**
     * Parse an SSE stream from the ChatGPT Codex backend and extract the
     * `response.completed` event payload as the full response object.
     */
    private async parseCodexStream(response: Response): Promise<OpenAIResponsesResponse> {
        const text = await response.text();
        let currentEvent = '';
        let completedData: OpenAIResponsesResponse | null = null;

        for (const line of text.split('\n')) {
            if (line.startsWith('event: ')) {
                currentEvent = line.slice(7).trim();
                continue;
            }
            if (line.startsWith('data: ') && currentEvent === 'response.completed') {
                completedData = JSON.parse(line.slice(6)) as OpenAIResponsesResponse;
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

    private async buildAuthHeaders(): Promise<Record<string, string>> {
        if (this.authMode === 'chatgpt') {
            if (!this.chatgptAuth?.accessToken || !this.chatgptAuth.accountId) {
                throw new ApiError('ChatGPT authentication is missing. Please sign in again.', 'auth_failed', 401, false);
            }

            if (isChatGPTAuthExpired(this.chatgptAuth)) {
                this.chatgptAuth = await refreshChatGPTAuth(this.chatgptAuth);
            }

            return {
                Authorization: `Bearer ${this.chatgptAuth.accessToken}`,
                'chatgpt-account-id': this.chatgptAuth.accountId,
            };
        }

        return {
            Authorization: `Bearer ${this.apiKey}`
        };
    }

    private resolveBaseUrl(configBaseUrl?: string): string {
        if (this.authMode === 'chatgpt') {
            if (!configBaseUrl || configBaseUrl === OPENAI_API_BASE_URL) {
                return OPENAI_CODEX_BASE_URL;
            }
            return configBaseUrl.replace(/\/$/, '');
        }

        return (configBaseUrl || OPENAI_API_BASE_URL).replace(/\/$/, '');
    }

    private toResponsesInputItems(msg: { role: string; content: string; name?: string; tool_call_id?: string; tool_calls?: LLMToolCall[] }): Array<Record<string, unknown>> {
        const items: Array<Record<string, unknown>> = [];

        if (msg.role === 'system') {
            return items;
        }

        if (msg.role === 'tool' && msg.tool_call_id) {
            items.push({
                type: 'function_call_output',
                call_id: msg.tool_call_id,
                output: msg.content,
            });
            return items;
        }

        if (msg.content) {
            items.push({
                type: 'message',
                role: msg.role === 'tool' ? 'user' : msg.role,
                content: [{ type: 'input_text', text: msg.content }],
            });
        }

        if (msg.role === 'assistant' && msg.tool_calls?.length) {
            for (const toolCall of msg.tool_calls) {
                items.push({
                    type: 'function_call',
                    call_id: toolCall.id,
                    name: toolCall.function.name,
                    arguments: toolCall.function.arguments,
                });
            }
        }

        return items;
    }

    private buildCodexInstructions(messages: Array<{ role: string; content: string }>): string {
        const systemMessages = messages
            .filter((msg) => msg.role === 'system' && typeof msg.content === 'string' && msg.content.trim())
            .map((msg) => msg.content.trim());

        if (systemMessages.length === 0) {
            return DEFAULT_CODEX_INSTRUCTIONS;
        }

        return [DEFAULT_CODEX_INSTRUCTIONS, ...systemMessages].join('\n\n');
    }

    private extractResponsesToolCalls(output: OpenAIResponsesResponse['output']): LLMToolCall[] {
        if (!Array.isArray(output)) {
            return [];
        }

        return output
            .filter((entry): entry is OpenAIResponsesFunctionCall => entry?.type === 'function_call')
            .map((toolCall, index) => ({
                id: toolCall.call_id ?? `call_${index + 1}`,
                type: 'function' as const,
                function: {
                    name: toolCall.name,
                    arguments: toolCall.arguments,
                },
            }));
    }

    private extractResponsesContent(data: OpenAIResponsesResponse): string {
        if (typeof data.output_text === 'string' && data.output_text.trim()) {
            return data.output_text;
        }

        if (!Array.isArray(data.output)) {
            return '';
        }

        const parts: string[] = [];
        for (const item of data.output) {
            if (item?.type !== 'message' || !Array.isArray(item.content)) {
                continue;
            }

            for (const contentItem of item.content) {
                if (contentItem?.type === 'output_text' && typeof contentItem.text === 'string') {
                    parts.push(contentItem.text);
                }
            }
        }

        return parts.join('\n').trim();
    }
}
