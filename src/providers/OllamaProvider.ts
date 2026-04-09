/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LLMProvider } from './LLMProvider.js';
import type {
    LLMRequest,
    LLMResponse,
    LLMMessage,
    LLMToolCall,
    LLMUsage,
    ProviderSettings,
    NetworkSettings,
    FunctionDefinition,
} from '../types.js';
import { ApiError, classifyApiError } from './errors.js';

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

interface OllamaRequestToolCall {
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

// Ollama runs locally and can be slower — use generous defaults
const DEFAULT_TIMEOUT = 120_000;        // 120 s — local inference can be slow
const DEFAULT_CHUNK_TIMEOUT = 30_000;   // 30 s between stream chunks
const DEFAULT_MAX_RETRIES = 2;
const MAX_ALLOWED_RETRIES = 5;
const DEFAULT_RETRY_DELAY = 1_000;
const AVAILABILITY_TIMEOUT = 5_000;    // 5 s for listModels / isAvailable

export class OllamaProvider implements LLMProvider {
    private readonly baseUrl: string;
    private model: string;
    private disableTools: boolean = false;
    private readonly maxRetries: number;
    private readonly retryDelay: number;
    private readonly timeout: number;
    private readonly chunkTimeout: number;

    constructor(config: ProviderSettings, networkSettings?: NetworkSettings) {
        this.baseUrl = config.baseUrl || 'http://localhost:11434';
        this.model = config.model || 'llama3.2:latest';

        const configuredRetries = networkSettings?.maxRetries ?? DEFAULT_MAX_RETRIES;
        this.maxRetries = Math.min(Math.max(0, configuredRetries), MAX_ALLOWED_RETRIES);
        this.retryDelay = networkSettings?.retryDelay ?? DEFAULT_RETRY_DELAY;
        this.timeout = networkSettings?.timeout ?? DEFAULT_TIMEOUT;
        this.chunkTimeout = DEFAULT_CHUNK_TIMEOUT;
    }

    getName(): string {
        return 'ollama';
    }

    setModel(model: string): void {
        this.model = model;
    }

    async listModels(): Promise<string[]> {
        try {
            const controller = new AbortController();
            const timerId = setTimeout(() => controller.abort(), AVAILABILITY_TIMEOUT);
            try {
                const response = await fetch(`${this.baseUrl}/api/tags`, {
                    signal: controller.signal,
                });
                if (!response.ok) {
                    return [];
                }
                const data: OllamaTagsResponse = await response.json();
                return data.models.map(m => m.name);
            } finally {
                clearTimeout(timerId);
            }
        } catch {
            // Ollama not running or network error
            return [];
        }
    }

    async isAvailable(): Promise<boolean> {
        try {
            const controller = new AbortController();
            const timerId = setTimeout(() => controller.abort(), AVAILABILITY_TIMEOUT);
            try {
                const response = await fetch(`${this.baseUrl}/api/tags`, {
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
        const body: Record<string, unknown> = {
            model: request.model || this.model,
            messages: this.buildMessages(request.messages, !this.disableTools),
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

        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                return await this.makeRequest(body, request);
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
            'Failed to communicate with Ollama. Please try again.',
            'network_error',
            0,
            true,
        );
    }

    private async makeRequest(
        body: Record<string, unknown>,
        request: LLMRequest,
    ): Promise<LLMResponse> {
        let response: Response;

        try {
            const timeoutController = new AbortController();
            const timerId = setTimeout(() => timeoutController.abort(), this.timeout);

            const combinedSignal = request.signal
                ? this.combineSignals(request.signal, timeoutController.signal)
                : timeoutController.signal;

            try {
                response = await fetch(`${this.baseUrl}/api/chat`, {
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
            if (err.name === 'AbortError' && request.signal?.aborted) {
                throw new ApiError('Request cancelled.', 'cancelled', 0, false);
            }

            // Timeout (timeout controller fired, not user abort)
            if (err.name === 'AbortError') {
                throw new ApiError(
                    `Ollama request timed out after ${this.timeout / 1000}s. ` +
                    'Local inference can be slow — consider increasing the timeout in your config.',
                    'timeout',
                    0,
                    true,
                );
            }

            // Network error (ECONNREFUSED, ENOTFOUND, etc.)
            throw new ApiError(
                `Cannot connect to Ollama at ${this.baseUrl}. Make sure Ollama is running (try 'ollama serve').`,
                'network_error',
                0,
                true,
            );
        }

        if (!response.ok) {
            const apiError = await this.buildApiError(response, body);
            if (apiError === null) {
                // Retry without tools was triggered — makeRequest called recursively
                return this.makeRequest(body, request);
            }
            throw apiError;
        }

        if (request.stream) {
            return this.handleStreamingResponse(response);
        }

        const data: OllamaChatResponse = await response.json();

        // Parse tool calls if present (Ollama returns arguments as object, not string)
        let toolCalls: LLMToolCall[] | undefined;
        if (data.message.tool_calls && Array.isArray(data.message.tool_calls)) {
            toolCalls = data.message.tool_calls.map((tc: OllamaToolCall, index: number) => {
                let argumentsStr: string;
                try {
                    // Ollama returns arguments as object, convert to JSON string for consistency
                    argumentsStr = JSON.stringify(tc.function.arguments);
                } catch (error) {
                    // If JSON.stringify fails (e.g., circular references), fallback to string representation
                    console.warn('Failed to stringify tool call arguments, using fallback:', error);
                    argumentsStr = String(tc.function.arguments);
                }
                
                return {
                    id: `ollama-tool-${Date.now()}-${index}`,
                    type: 'function' as const,
                    function: {
                        name: tc.function.name,
                        arguments: argumentsStr
                    }
                };
            });
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

    /**
     * Build an ApiError from a non-ok response.
     *
     * Returns `null` as a sentinel when the request was retried internally
     * (e.g., disableTools retry). The caller must re-run makeRequest in
     * that case.
     */
    private async buildApiError(
        response: Response,
        body: Record<string, unknown>,
    ): Promise<ApiError | null> {
        let errorBody = '';
        try {
            errorBody = await response.text();
        } catch {
            // Ignore error reading body
        }

        // Check if model doesn't support tools — retry without them (existing behaviour)
        if (errorBody.includes('does not support tools') && body.tools) {
            console.warn(`Model ${body.model} does not support tools. Retrying without tool support.`);
            this.disableTools = true;
            delete body.tools;
            if (Array.isArray(body.messages)) {
                body.messages = this.sanitizeMessagesForToollessMode(body.messages);
            }
            return null; // sentinel: caller should retry
        }

        // Some Ollama-hosted models fail while parsing tool metadata/history rather than
        // explicitly reporting unsupported tools. Fall back to toolless mode on this class
        // of parser error so the request can still complete.
        if (this.isToolParserError(errorBody) && (body.tools || this.hasToolMetadata(body.messages))) {
            console.warn(`Model ${body.model} rejected tool metadata. Retrying without tool support.`);
            this.disableTools = true;
            delete body.tools;
            if (Array.isArray(body.messages)) {
                body.messages = this.sanitizeMessagesForToollessMode(body.messages);
            }
            return null; // sentinel: caller should retry
        }

        if (response.status === 429 || this.isOllamaCloudRateLimitError(errorBody)) {
            const baseError = classifyApiError(
                response.status === 429 ? response.status : 429,
                errorBody,
                response.headers,
            );

            return new ApiError(
                'Ollama Cloud has paused this session because you hit a usage limit. This is expected on hosted Ollama plans. Wait a bit and try again, switch to another model, or upgrade your Ollama plan if you need higher limits.',
                'rate_limited',
                baseError.httpStatus,
                true,
                baseError.retryAfterMs,
                errorBody,
            );
        }

        // For 400, augment with Ollama-specific context about malformed requests
        if (response.status === 400) {
            const baseError = classifyApiError(response.status, errorBody, response.headers);
            return new ApiError(
                `Ollama rejected the request. This can happen when message content confuses the model's parser. Try simplifying your prompt or using a different model.\n${errorBody}`,
                baseError.code,
                baseError.httpStatus,
                baseError.retryable,
                baseError.retryAfterMs,
                errorBody,
            );
        }

        // For 404, augment the message with an Ollama-specific suggestion
        if (response.status === 404) {
            const baseError = classifyApiError(response.status, errorBody, response.headers);
            return new ApiError(
                `Model not found. Run 'ollama pull ${String(body.model)}' to download it.\n${errorBody}`,
                baseError.code,
                baseError.httpStatus,
                baseError.retryable,
                baseError.retryAfterMs,
                errorBody,
            );
        }

        return classifyApiError(response.status, errorBody, response.headers);
    }

    private buildMessages(messages: LLMMessage[], includeToolMetadata: boolean): Record<string, unknown>[] {
        if (!includeToolMetadata) {
            return this.sanitizeMessagesForToollessMode(messages);
        }

        return messages.map((msg) => {
            const mapped: Record<string, unknown> = {
                role: msg.role,
                content: msg.content ?? '',
            };

            if (msg.name) {
                mapped.name = msg.name;
            }
            if (msg.role === 'tool' && msg.tool_call_id) {
                mapped.tool_call_id = msg.tool_call_id;
            }
            if (msg.role === 'assistant' && msg.tool_calls?.length) {
                mapped.tool_calls = this.normalizeToolCallsForRequest(msg.tool_calls);
            }

            return mapped;
        });
    }

    private normalizeToolCallsForRequest(toolCalls: LLMToolCall[]): OllamaRequestToolCall[] {
        return toolCalls.map((toolCall) => ({
            function: {
                name: toolCall.function.name,
                arguments: this.parseToolArguments(toolCall.function.arguments),
            }
        }));
    }

    private parseToolArguments(rawArguments: string): Record<string, unknown> {
        try {
            const parsed = JSON.parse(rawArguments);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>;
            }
        } catch {
            // Fall through to safe wrapper below.
        }

        return { __raw_arguments: rawArguments };
    }

    private sanitizeMessagesForToollessMode(messages: Array<LLMMessage | Record<string, unknown>>): Record<string, unknown>[] {
        return messages.map((msg) => {
            const role = typeof msg.role === 'string' ? msg.role : 'user';
            const content = typeof msg.content === 'string' ? msg.content : '';
            const name = typeof msg.name === 'string' ? msg.name : undefined;
            const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : undefined;

            if (role === 'tool') {
                return {
                    role: 'user',
                    content: name ? `[Tool result: ${name}]\n${content}` : `[Tool result]\n${content}`,
                };
            }

            if (role === 'assistant' && toolCalls?.length) {
                const toolNames = toolCalls
                    .map((call) => {
                        const fn = call && typeof call === 'object' ? (call as { function?: { name?: unknown } }).function : undefined;
                        return typeof fn?.name === 'string' ? fn.name : undefined;
                    })
                    .filter((value): value is string => Boolean(value));
                const toolSummary = toolNames.length > 0
                    ? `\n[Assistant requested tools: ${toolNames.join(', ')}]`
                    : '';

                return {
                    role: 'assistant',
                    content: `${content}${toolSummary}`.trim(),
                };
            }

            return {
                role,
                content,
                ...(name ? { name } : {}),
            };
        });
    }

    private hasToolMetadata(messages: unknown): boolean {
        if (!Array.isArray(messages)) {
            return false;
        }

        return messages.some((msg) => {
            if (!msg || typeof msg !== 'object') {
                return false;
            }

            const candidate = msg as { role?: unknown; tool_call_id?: unknown; tool_calls?: unknown };
            return candidate.role === 'tool' || candidate.tool_call_id !== undefined || candidate.tool_calls !== undefined;
        });
    }

    private isToolParserError(errorBody: string): boolean {
        const lower = errorBody.toLowerCase();
        return (
            lower.includes("value looks like object, but can't find closing '}' symbol") ||
            lower.includes('value looks like object, but can\'t find closing') ||
            (lower.includes('tool') && lower.includes('parse')) ||
            (lower.includes('function') && lower.includes('arguments') && lower.includes('closing'))
        );
    }

    private isOllamaCloudRateLimitError(errorBody: string): boolean {
        const lower = errorBody.toLowerCase();
        return (
            lower.includes('session usage limit') ||
            lower.includes('rate limit exceeded') ||
            (lower.includes('upgrade for higher limits') && lower.includes('ollama.com/upgrade'))
        );
    }

    private async handleStreamingResponse(response: Response): Promise<LLMResponse> {
        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error('No response body');
        }

        const decoder = new TextDecoder();
        let fullContent = '';
        let lastData: OllamaChatResponse | null = null;
        let streamEndedWithDone = false;

        try {
            while (true) {
                // Apply a per-chunk timeout to detect dead streams
                const chunkResult = await this.readWithTimeout(reader, this.chunkTimeout, fullContent);

                if ('timedOut' in chunkResult) {
                    // Stream timed out mid-response
                    if (fullContent) {
                        // Return partial content with finishReason: 'length'
                        return {
                            id: `ollama-${Date.now()}`,
                            created: lastData
                                ? Math.floor(new Date(lastData.created_at).getTime() / 1000)
                                : Math.floor(Date.now() / 1000),
                            content: fullContent,
                            finishReason: 'length',
                            raw: lastData
                        };
                    }
                    // No content at all — throw a friendly error
                    throw new ApiError(
                        `Ollama stream timed out after ${this.chunkTimeout / 1000}s with no data. ` +
                        'Make sure Ollama is running and the model is loaded.',
                        'timeout',
                        0,
                        true,
                    );
                }

                const { done, value } = chunkResult as ReadableStreamReadResult<Uint8Array>;

                if (done) {
                    // Stream ended at the transport level — stop reading
                    break;
                }

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n').filter(line => line.trim());

                for (const line of lines) {
                    try {
                        const data: OllamaChatResponse = JSON.parse(line);
                        fullContent += data.message.content;
                        lastData = data;
                        // Ollama signals completion via the JSON "done" field
                        if (data.done) {
                            streamEndedWithDone = true;
                        }
                    } catch {
                        // Skip invalid JSON lines
                    }
                }

                if (streamEndedWithDone) {
                    break;
                }
            }
        } finally {
            reader.releaseLock();
        }

        // If stream closed without done:true it means it ended abruptly
        const finishReason = streamEndedWithDone ? 'stop' : 'length';

        return {
            id: `ollama-${Date.now()}`,
            created: lastData
                ? Math.floor(new Date(lastData.created_at).getTime() / 1000)
                : Math.floor(Date.now() / 1000),
            content: fullContent,
            finishReason,
            raw: lastData
        };
    }

    /**
     * Read one chunk from the stream with a timeout.
     * Returns `{ timedOut: true }` if the timeout fires before a chunk arrives.
     */
    private async readWithTimeout(
        reader: ReadableStreamDefaultReader<Uint8Array>,
        timeoutMs: number,
        _partialContent: string,
    ): Promise<{ timedOut: true } | ReadableStreamReadResult<Uint8Array>> {
        let timerId!: ReturnType<typeof setTimeout>;

        const timeoutPromise = new Promise<{ timedOut: true }>((resolve) => {
            timerId = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
        });

        try {
            const result = await Promise.race([
                reader.read(),
                timeoutPromise,
            ]);
            return result;
        } finally {
            clearTimeout(timerId);
        }
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
        signal1.addEventListener('abort', abort, { once: true });
        signal2.addEventListener('abort', abort, { once: true });
        if (signal1.aborted || signal2.aborted) {
            controller.abort();
        }
        return controller.signal;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
