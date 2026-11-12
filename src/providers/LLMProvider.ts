/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LLMRequest, LLMResponse, ReasoningEffort } from '../types.js';

export interface LLMProviderCapabilities {
    /**
     * Provider supports API-native tool/function calling and should not rely on
     * Autohand's JSON toolCalls prompt protocol as the primary contract.
     */
    nativeToolCalling: boolean;
    /** Supports incremental content callbacks while assembling the final response. */
    streaming?: boolean;
    /** Maximum function definitions accepted per request by the active model. */
    maxTools?: number;
}

/**
 * Base interface for all LLM providers
 */
export interface LLMProvider {
    setReasoningEffort?(effort: ReasoningEffort): void;
    /**
     * Get the provider name
     */
    getName(): string;

    /**
     * Complete a chat request
     */
    complete(request: LLMRequest): Promise<LLMResponse>;

    /**
     * List available models for this provider
     */
    listModels(): Promise<string[]>;

    /**
     * Check if the provider is available/accessible
     */
    isAvailable(): Promise<boolean>;

    /**
     * Set the model to use
     */
    setModel(model: string): void;

    /**
     * Report provider capabilities for prompt shaping and runtime behavior.
     * Providers that do not implement this are treated as legacy/fallback.
     */
    getCapabilities?(): LLMProviderCapabilities;

    /** Effective runtime context limit, when the provider can report it. */
    getContextWindow?(signal?: AbortSignal): Promise<number | undefined>;
}
