/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LLMProvider } from './LLMProvider.js';
import type { LLMRequest, LLMResponse } from '../types.js';
import { OllamaProvider } from './OllamaProvider.js';
import { OpenAIProvider } from './OpenAIProvider.js';
import { LlamaCppProvider } from './LlamaCppProvider.js';
import { OpenRouterProvider } from './OpenRouterProvider.js';
import type { AutohandConfig, ProviderName } from '../types.js';

/**
 * Custom error class for unconfigured provider
 */
export class ProviderNotConfiguredError extends Error {
    constructor(public readonly providerName: string) {
        super(`PROVIDER_NOT_CONFIGURED:${providerName}`);
        this.name = 'ProviderNotConfiguredError';
    }
}

/**
 * Placeholder provider returned when no provider is configured.
 * Throws ProviderNotConfiguredError when used, allowing the agent to handle it gracefully.
 */
class UnconfiguredProvider implements LLMProvider {
    constructor(private readonly providerName: string) {}

    getName(): string {
        return 'unconfigured';
    }

    async complete(_request: LLMRequest): Promise<LLMResponse> {
        throw new ProviderNotConfiguredError(this.providerName);
    }

    async listModels(): Promise<string[]> {
        return [];
    }

    async isAvailable(): Promise<boolean> {
        return false;
    }

    setModel(_model: string): void {
        // No-op for unconfigured provider
    }
}

export class ProviderFactory {
    /**
     * Create an LLM provider based on configuration.
     * Returns an UnconfiguredProvider if the selected provider is not configured,
     * allowing the agent to handle it gracefully instead of crashing.
     */
    static create(config: AutohandConfig): LLMProvider {
        const providerName = config.provider || 'openrouter';

        switch (providerName) {
            case 'ollama':
                if (!config.ollama) {
                    return new UnconfiguredProvider('ollama');
                }
                return new OllamaProvider(config.ollama);

            case 'openai':
                if (!config.openai) {
                    return new UnconfiguredProvider('openai');
                }
                return new OpenAIProvider(config.openai);

            case 'llamacpp':
                if (!config.llamacpp) {
                    return new UnconfiguredProvider('llamacpp');
                }
                return new LlamaCppProvider(config.llamacpp);

            case 'openrouter':
            default:
                if (!config.openrouter) {
                    return new UnconfiguredProvider('openrouter');
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
