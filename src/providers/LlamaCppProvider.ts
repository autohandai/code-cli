/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LLMProvider, LLMProviderCapabilities } from './LLMProvider.js';
import type { LLMRequest, LLMResponse, LLMToolCall, ProviderSettings, FunctionDefinition } from '../types.js';
import { normalizeLLMUsage } from './usage.js';
import { normalizeProviderFinishReason } from './finishReason.js';
import { ApiError, classifyApiError } from './errors.js';
import { discardResponseBody } from '../utils/responseBody.js';
import { resolveRuntimeContextWindow } from './runtimeContextWindow.js';
import {
    getProviderModelIds,
    getProviderRuntimeDefaultModel,
    mergeModelIds,
} from './modelCatalog.js';

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
    private contextGeneration = 0;
    private runtimeContext?: { model: string; value: number | undefined; expiresAt: number };
    private runtimeContextRequest?: { generation: number; promise: Promise<number | undefined> };

    private static readonly DEFAULT_MODEL = getProviderRuntimeDefaultModel('llamacpp', 'local');

    constructor(config: ProviderSettings) {
        const port = config.port || 8080;
        this.baseUrl = config.baseUrl || `http://localhost:${port}`;
        this.model = config.model || LlamaCppProvider.DEFAULT_MODEL;
    }

    getName(): string {
        return 'llamacpp';
    }

    getCapabilities(): LLMProviderCapabilities {
        return { nativeToolCalling: true };
    }

    setModel(model: string): void {
        if (this.model !== model) {
            this.contextGeneration += 1;
            this.runtimeContext = undefined;
            this.runtimeContextRequest = undefined;
        }
        this.model = model;
    }

    async getContextWindow(signal?: AbortSignal): Promise<number | undefined> {
        if (signal?.aborted) return undefined;
        const cached = this.runtimeContext;
        if (cached?.model === this.model && cached.expiresAt > Date.now()) return cached.value;
        let pending = this.runtimeContextRequest;
        if (!pending || pending.generation !== this.contextGeneration) {
            const generation = this.contextGeneration;
            const model = this.model;
            const previous = cached?.model === model ? cached.value : undefined;
            const request = {
                generation,
                promise: this.discoverContextWindow(model).then((value) => {
                    const effective = value ?? previous;
                    if (this.contextGeneration === generation) {
                        this.runtimeContext = { model, value: effective, expiresAt: Date.now() + 30000 };
                    }
                    return effective;
                }),
            };
            this.runtimeContextRequest = request;
            request.promise = request.promise.finally(() => {
                if (this.runtimeContextRequest === request) this.runtimeContextRequest = undefined;
            });
            pending = request;
        }
        const ready = pending.promise;
        return signal
            ? resolveRuntimeContextWindow(async () => ready, signal)
            : ready;
    }

    private async discoverContextWindow(model: string): Promise<number | undefined> {
        let response: Response | undefined;
        try {
            response = await fetch(
                `${this.baseUrl.replace(/\/+$/, '')}/props?model=${encodeURIComponent(model)}&autoload=false`,
                { signal: AbortSignal.timeout(2000) },
            );
            if (!response.ok) {
                discardResponseBody(response);
                return undefined;
            }
            const payload: unknown = await response.json();
            if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
            const settings = (payload as Record<string, unknown>).default_generation_settings;
            if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return undefined;
            const contextWindow = (settings as Record<string, unknown>).n_ctx;
            return typeof contextWindow === 'number' && Number.isSafeInteger(contextWindow) && contextWindow > 0
                ? contextWindow
                : undefined;
        } catch {
            if (response) discardResponseBody(response);
            return undefined;
        }
    }

    async listModels(): Promise<string[]> {
        let response: Response | undefined;
        try {
            response = await fetch(`${this.baseUrl}/v1/models`, { signal: AbortSignal.timeout(2000) });
            if (!response.ok) {
                discardResponseBody(response);
                return mergeModelIds(this.model ? [this.model] : [], getProviderModelIds('llamacpp'));
            }
            const data = await response.json() as { data?: { id: string }[] };
            return mergeModelIds(
                data.data?.map((m: { id: string }) => m.id) ?? [],
                mergeModelIds(this.model ? [this.model] : [], getProviderModelIds('llamacpp')),
            );
        } catch {
            if (response) discardResponseBody(response);
            return mergeModelIds(this.model ? [this.model] : [], getProviderModelIds('llamacpp'));
        }
    }

    async isAvailable(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
            discardResponseBody(response);
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

        const data = await response.json() as LlamaCppChatResponse;
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

        // Through the shared normalizer rather than by hand, so a cached-prompt
        // detail is carried when the server reports one, and an impossible
        // breakdown is discarded instead of passed on.
        const usage = normalizeLLMUsage(data.usage, 'openai-chat');

        const finishReason = toolCalls?.length
            ? 'tool_calls'
            : normalizeProviderFinishReason(choice?.finish_reason);

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
            discardResponseBody(response);
        }

        const baseError = classifyApiError(response.status, errorBody, response.headers);
        const lowerBody = errorBody.toLowerCase();
        if (body.tools && response.status === 400 && baseError.code === 'invalid_request' && (
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

        return new ApiError(
            `llama.cpp API error: ${response.status} ${response.statusText}\n${baseError.message}`,
            baseError.code,
            baseError.httpStatus,
            baseError.retryable,
            baseError.retryAfterMs,
            errorBody,
        );
    }
}
