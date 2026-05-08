/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LLMProvider } from './LLMProvider.js';
import type { ContentPart, LLMRequest, LLMResponse, LLMToolCall, FunctionDefinition, ReasoningEffort, OpenAISettings, OpenAIChatGPTAuth } from '../types.js';
import { ApiError, classifyApiError, type ApiErrorCode } from './errors.js';
import { isChatGPTAuthExpired, refreshChatGPTAuth } from './openaiAuth.js';
import { normalizeLLMUsage } from './usage.js';

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

type OpenAIProviderMessage = {
    role: string;
    content: string | ContentPart[];
    name?: string;
    tool_call_id?: string;
    tool_calls?: LLMToolCall[];
};

type OpenAIChatContentPart =
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } };

type OpenAIResponsesInputContentPart =
    | { type: 'input_text'; text: string }
    | { type: 'output_text'; text: string }
    | { type: 'input_image'; image_url: string };

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
    'gpt-5.5',
    'gpt-5.5-pro',
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

const OPENAI_API_KEY_FRIENDLY_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
    auth_failed:
        'Authentication failed. Please verify your OpenAI API key in ~/.autohand/config.json.',
    payment_required:
        'Payment required. Please check your OpenAI account balance or billing settings.',
    access_denied:
        'Access denied. Your OpenAI API key may not have permission for this model.',
    server_error:
        'The OpenAI service encountered an error. Please try again later.',
    network_error:
        'Unable to connect to OpenAI. Please check your internet connection and OpenAI API configuration.',
    timeout:
        'The request timed out. The OpenAI service may be experiencing high load.',
};

const OPENAI_CHATGPT_FRIENDLY_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
    auth_failed:
        'ChatGPT authentication failed. Please sign in again.',
    access_denied:
        'Access denied. Your ChatGPT account may not have access to this model or Codex backend.',
    server_error:
        'The ChatGPT Codex service encountered an error. Please try again later.',
    network_error:
        'Unable to connect to ChatGPT Codex. Please check your internet connection.',
    timeout:
        'The request timed out. The ChatGPT Codex service may be experiencing high load.',
};

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
            messages: request.messages.map((msg: OpenAIProviderMessage) => {
                const mapped: Record<string, unknown> = {
                    role: msg.role === 'system' ? 'system' : msg.role === 'user' ? 'user' : msg.role === 'tool' ? 'tool' : 'assistant',
                    content: this.toChatCompletionContent(msg.content),
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
            // Newer OpenAI models (gpt-5.x, o-series) require max_completion_tokens
            // instead of max_tokens. Use the correct parameter based on model.
            ...(this.usesMaxCompletionTokens(request.model || this.model)
                ? { max_completion_tokens: request.maxTokens }
                : { max_tokens: request.maxTokens })
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
                    'The request timed out. The OpenAI service may be experiencing high load.',
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

        const data = await response.json() as OpenAIChatResponse;
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

        const usage = normalizeLLMUsage(data.usage);

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
                    'The request timed out. The ChatGPT Codex service may be experiencing high load.',
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
        const usage = normalizeLLMUsage(data.usage);

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

        return this.withOpenAIMessage(classifyApiError(response.status, errorDetail, response.headers));
    }

    private withOpenAIMessage(error: ApiError): ApiError {
        const messages = this.authMode === 'chatgpt'
            ? OPENAI_CHATGPT_FRIENDLY_MESSAGES
            : OPENAI_API_KEY_FRIENDLY_MESSAGES;
        const friendlyMessage = messages[error.code];
        if (!friendlyMessage) {
            return error;
        }

        return new ApiError(
            error.rawDetail ? `${friendlyMessage}\n${error.rawDetail}` : friendlyMessage,
            error.code,
            error.httpStatus,
            error.retryable,
            error.retryAfterMs,
            error.rawDetail,
        );
    }

    /**
     * Parse an SSE stream from the ChatGPT Codex backend and extract the
     * `response.completed` event payload as the full response object.
     */
    private async parseCodexStream(response: Response): Promise<OpenAIResponsesResponse> {
        const text = await response.text();
        let currentEvent = '';
        let completedData: OpenAIResponsesResponse | null = null;
        let streamedOutputText = '';

        for (const line of text.split('\n')) {
            if (line.startsWith('event: ')) {
                currentEvent = line.slice(7).trim();
                continue;
            }
            if (!line.startsWith('data: ')) {
                continue;
            }

            const dataLine = line.slice(6);
            if (currentEvent === 'response.output_text.delta') {
                const eventData = JSON.parse(dataLine) as Record<string, unknown>;
                if (typeof eventData.delta === 'string') {
                    streamedOutputText += eventData.delta;
                }
                continue;
            }

            if (currentEvent === 'response.output_text.done') {
                const eventData = JSON.parse(dataLine) as Record<string, unknown>;
                if (typeof eventData.text === 'string' && eventData.text.trim()) {
                    streamedOutputText = eventData.text;
                }
                continue;
            }

            if (currentEvent === 'response.completed') {
                completedData = JSON.parse(dataLine) as OpenAIResponsesResponse;
                break;
            }
        }

        if (!completedData) {
            throw new ApiError(
                'No response.completed event found in stream. The API response may be malformed.',
                'invalid_request', 0, false,
            );
        }

        if (!this.extractResponsesContent(completedData) && streamedOutputText.trim()) {
            completedData.output_text = streamedOutputText;
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
            Authorization: `Bearer ${this.apiKey}`,
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

    private isContentPartsArray(content: string | ContentPart[]): content is ContentPart[] {
        return Array.isArray(content);
    }

    private toChatCompletionContent(content: string | ContentPart[]): string | OpenAIChatContentPart[] {
        if (!this.isContentPartsArray(content)) {
            return content;
        }

        return content
            .map((part): OpenAIChatContentPart | null => {
                if (part.type === 'text') {
                    return { type: 'text', text: part.text };
                }
                if (part.type === 'image_url') {
                    return {
                        type: 'image_url',
                        image_url: part.image_url,
                    };
                }
                return null;
            })
            .filter((part): part is OpenAIChatContentPart => part !== null);
    }

    private toResponsesMessageContent(role: string, content: string | ContentPart[]): OpenAIResponsesInputContentPart[] {
        const textType = role === 'assistant' ? 'output_text' : 'input_text';

        if (!this.isContentPartsArray(content)) {
            return [{ type: textType, text: content }];
        }

        const parts: OpenAIResponsesInputContentPart[] = [];
        for (const part of content) {
            if (part.type === 'text') {
                parts.push({ type: textType, text: part.text });
                continue;
            }

            if (part.type === 'image_url' && role !== 'assistant') {
                parts.push({
                    type: 'input_image',
                    image_url: part.image_url.url,
                });
            }
        }

        return parts;
    }

    private toResponsesInputItems(msg: OpenAIProviderMessage): Array<Record<string, unknown>> {
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
            const content = this.toResponsesMessageContent(msg.role, msg.content);
            items.push({
                type: 'message',
                role: msg.role === 'tool' ? 'user' : msg.role,
                content,
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

    /**
     * Determine if a model requires `max_completion_tokens` instead of `max_tokens`.
     * OpenAI's newer models (gpt-5.x, o-series) reject `max_tokens` with a 400 error.
     */
    private usesMaxCompletionTokens(model: string): boolean {
        const lower = model.toLowerCase();
        return (
            lower.startsWith('gpt-5') ||
            lower.startsWith('o1') ||
            lower.startsWith('o3') ||
            lower.startsWith('o4')
        );
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
