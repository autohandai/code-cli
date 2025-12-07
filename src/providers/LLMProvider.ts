/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LLMRequest, LLMResponse } from '../types.js';

/**
 * Base interface for all LLM providers
 */
export interface LLMProvider {
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
}
