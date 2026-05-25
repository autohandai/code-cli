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
import { MLXProvider } from './MLXProvider.js';
import { LLMGatewayProvider } from './LLMGatewayProvider.js';
import { AzureProvider } from './AzureProvider.js';
import { ZaiProvider } from './ZaiProvider.js';
import { VertexAIProvider } from './VertexAIProvider.js';
import { XAIProvider } from './XAIProvider.js';
import { CerebrasProvider } from './CerebrasProvider.js';
import { NVIDIAProvider } from './NVIDIAProvider.js';
import { DeepSeekProvider } from './DeepSeekProvider.js';
import { BedrockProvider } from './BedrockProvider.js';
import { isAwsBedrockProviderEnabled } from '../features/featureRegistry.js';
import { isMLXSupported } from '../utils/platform.js';
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

        if (providerName === 'bedrock' && !isAwsBedrockProviderEnabled(config)) {
            return new UnconfiguredProvider('bedrock');
        }

        switch (providerName) {
            case 'ollama':
                if (!config.ollama) {
                    return new UnconfiguredProvider('ollama');
                }
                return new OllamaProvider(config.ollama, config.network);

            case 'openai':
                if (!config.openai) {
                    return new UnconfiguredProvider('openai');
                }
                return new OpenAIProvider(config.openai);

            case 'openaicompatible':
                if (!config.openaicompatible) {
                    return new UnconfiguredProvider('openaicompatible');
                }
                return new OpenAIProvider(config.openaicompatible);

            case 'llamacpp':
                if (!config.llamacpp) {
                    return new UnconfiguredProvider('llamacpp');
                }
                return new LlamaCppProvider(config.llamacpp);

            case 'mlx':
                if (!config.mlx) {
                    return new UnconfiguredProvider('mlx');
                }
                return new MLXProvider(config.mlx, config.network);

            case 'llmgateway':
                if (!config.llmgateway) {
                    return new UnconfiguredProvider('llmgateway');
                }
                return new LLMGatewayProvider(config.llmgateway, config.network);

            case 'azure':
                if (!config.azure) {
                    return new UnconfiguredProvider('azure');
                }
                return new AzureProvider(config.azure, config.network);

            case 'zai':
                if (!config.zai) {
                    return new UnconfiguredProvider('zai');
                }
                return new ZaiProvider(config.zai, config.network);

            case 'vertexai':
                if (!config.vertexai) {
                    return new UnconfiguredProvider('vertexai');
                }
                return new VertexAIProvider(config.vertexai, config.network);

            case 'xai':
                if (!config.xai) {
                    return new UnconfiguredProvider('xai');
                }
                return new XAIProvider(config.xai);

            case 'cerebras':
                if (!config.cerebras) {
                    return new UnconfiguredProvider('cerebras');
                }
                return new CerebrasProvider(config.cerebras, config.network);

            case 'nvidia':
                if (!config.nvidia) {
                    return new UnconfiguredProvider('nvidia');
                }
                return new NVIDIAProvider(config.nvidia, config.network);

            case 'deepseek':
                if (!config.deepseek) {
                    return new UnconfiguredProvider('deepseek');
                }
                return new DeepSeekProvider(config.deepseek, config.network);

            case 'bedrock':
                if (!config.bedrock) {
                    return new UnconfiguredProvider('bedrock');
                }
                return new BedrockProvider(config.bedrock);

            case 'openrouter':
            default:
                if (!config.openrouter) {
                    return new UnconfiguredProvider('openrouter');
                }
                return new OpenRouterProvider(config.openrouter);
        }
    }

    /**
     * Get all available provider names.
     * MLX is only included on Apple Silicon (macOS + arm64).
     */
    static getProviderNames(config?: Pick<AutohandConfig, 'features'> | null): ProviderName[] {
        // Sorted DESC by display name: Z.ai, xAI, Vertex AI, NVIDIA, OpenRouter, OpenAI, OpenAI Compatible, Ollama, MLX, LLM Gateway, llama.cpp, DeepSeek, Cerebras, Bedrock, Azure
        const providers: ProviderName[] = ['zai', 'xai', 'vertexai', 'nvidia', 'openrouter', 'openai', 'openaicompatible', 'ollama', 'llmgateway', 'llamacpp', 'deepseek', 'cerebras', 'azure'];
        if (isAwsBedrockProviderEnabled(config)) {
            providers.splice(providers.indexOf('azure'), 0, 'bedrock');
        }
        if (isMLXSupported()) {
            providers.push('mlx');
        }
        return providers;
    }

    /**
     * Check if a provider name is valid.
     * Note: This checks if the name is a valid provider type, not if it's available on this platform.
     * MLX is always a valid provider name, but may not be available on non-Apple Silicon systems.
     */
    static isValidProvider(name: string, config?: Pick<AutohandConfig, 'features'> | null): name is ProviderName {
        if (name === 'bedrock' && !isAwsBedrockProviderEnabled(config)) {
            return false;
        }

        const allProviders: ProviderName[] = ['openrouter', 'ollama', 'openai', 'openaicompatible', 'llamacpp', 'mlx', 'llmgateway', 'azure', 'zai', 'vertexai', 'xai', 'cerebras', 'nvidia', 'deepseek', 'bedrock'];
        return allProviders.includes(name as ProviderName);
    }
}
