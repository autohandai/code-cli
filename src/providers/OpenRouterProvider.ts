/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { OpenRouterClient } from '../openrouter.js';
import type { LLMProvider } from './LLMProvider.js';
import type { LLMRequest, LLMResponse, OpenRouterSettings } from '../types.js';

export class OpenRouterProvider implements LLMProvider {
    private client: OpenRouterClient;
    private model: string;

    constructor(config: OpenRouterSettings) {
        this.client = new OpenRouterClient(config);
        this.model = config.model;
    }

    getName(): string {
        return 'openrouter';
    }

    setModel(model: string): void {
        this.model = model;
        this.client.setDefaultModel(model);
    }

    async listModels(): Promise<string[]> {
        // Popular models on OpenRouter
        // In a real implementation, you'd fetch from OpenRouter's models API
        return [
            'anthropic/claude-3.5-sonnet',
            'anthropic/claude-3-opus',
            'google/gemini-pro-1.5',
            'openai/gpt-4o',
            'x-ai/grok-2-latest',
            'meta-llama/llama-3.1-70b-instruct'
        ];
    }

    async isAvailable(): Promise<boolean> {
        // For OpenRouter, we can't easily check without making a request
        // Return true if we have an API key
        return true;
    }

    async complete(request: LLMRequest): Promise<LLMResponse> {
        return this.client.complete(request);
    }
}
