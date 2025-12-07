/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LLMProvider } from './LLMProvider.js';
import { OllamaProvider } from './OllamaProvider.js';
import { OpenAIProvider } from './OpenAIProvider.js';
import { LlamaCppProvider } from './LlamaCppProvider.js';
import { OpenRouterProvider } from './OpenRouterProvider.js';
import type { AutohandConfig, ProviderName } from '../types.js';

export class ProviderFactory {
    /**
     * Create an LLM provider based on configuration
     */
    static create(config: AutohandConfig): LLMProvider {
        const providerName = config.provider || 'openrouter';

        switch (providerName) {
            case 'ollama':
                if (!config.ollama) {
                    throw new Error('Ollama configuration is missing');
                }
                return new OllamaProvider(config.ollama);

            case 'openai':
                if (!config.openai) {
                    throw new Error('OpenAI configuration is missing');
                }
                return new OpenAIProvider(config.openai);

            case 'llamacpp':
                if (!config.llamacpp) {
                    throw new Error('llama.cpp configuration is missing');
                }
                return new LlamaCppProvider(config.llamacpp);

            case 'openrouter':
            default:
                if (!config.openrouter) {
                    throw new Error('OpenRouter configuration is missing');
                }
                return new OpenRouterProvider(config.openrouter);
        }
    }

    /**
     * Get all available provider names
     */
    static getProviderNames(): ProviderName[] {
        return ['openrouter', 'ollama', 'openai', 'llamacpp'];
    }

    /**
     * Check if a provider name is valid
     */
    static isValidProvider(name: string): name is ProviderName {
        return this.getProviderNames().includes(name as ProviderName);
    }
}
