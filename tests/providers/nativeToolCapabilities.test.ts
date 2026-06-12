/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { LLMProvider } from '../../src/providers/LLMProvider.js';
import { AzureProvider } from '../../src/providers/AzureProvider.js';
import { CerebrasProvider } from '../../src/providers/CerebrasProvider.js';
import { DeepSeekProvider } from '../../src/providers/DeepSeekProvider.js';
import { LlamaCppProvider } from '../../src/providers/LlamaCppProvider.js';
import { LLMGatewayProvider } from '../../src/providers/LLMGatewayProvider.js';
import { MLXProvider } from '../../src/providers/MLXProvider.js';
import { NVIDIAProvider } from '../../src/providers/NVIDIAProvider.js';
import { OllamaProvider } from '../../src/providers/OllamaProvider.js';
import { OpenRouterProvider } from '../../src/providers/OpenRouterProvider.js';
import { VertexAIProvider } from '../../src/providers/VertexAIProvider.js';
import { XAIProvider } from '../../src/providers/XAIProvider.js';
import { ZaiProvider } from '../../src/providers/ZaiProvider.js';

describe('native tool capability declarations', () => {
  it('advertises native tool calling for providers that serialize request tools', () => {
    const providers: Array<{ name: string; provider: LLMProvider }> = [
      {
        name: 'azure',
        provider: new AzureProvider({
          apiKey: 'test-key',
          baseUrl: 'https://example.openai.azure.com',
          model: 'gpt-4o',
        }),
      },
      {
        name: 'cerebras',
        provider: new CerebrasProvider({
          apiKey: 'test-key',
          model: 'qwen-3-235b-a22b-instruct-2507',
        }),
      },
      {
        name: 'deepseek',
        provider: new DeepSeekProvider({
          apiKey: 'test-key',
          model: 'deepseek-chat',
        }),
      },
      {
        name: 'llamacpp',
        provider: new LlamaCppProvider({
          baseUrl: 'http://localhost:8080',
          model: 'local',
        }),
      },
      {
        name: 'llmgateway',
        provider: new LLMGatewayProvider({
          apiKey: 'test-key',
          model: 'gpt-4o',
        }),
      },
      {
        name: 'mlx',
        provider: new MLXProvider({
          baseUrl: 'http://localhost:8080',
          model: 'mlx-model',
        }),
      },
      {
        name: 'nvidia',
        provider: new NVIDIAProvider({
          apiKey: 'nvapi-test',
          model: 'z-ai/glm-5.1',
        }),
      },
      {
        name: 'ollama',
        provider: new OllamaProvider({
          baseUrl: 'http://localhost:11434',
          model: 'llama3.2:latest',
        }),
      },
      {
        name: 'openrouter',
        provider: new OpenRouterProvider({
          apiKey: 'test-key',
          model: 'openai/gpt-4o',
        }),
      },
      {
        name: 'vertexai',
        provider: new VertexAIProvider({
          authToken: 'test-token',
          model: 'gemini-1.5-pro',
          projectId: 'test-project',
        }),
      },
      {
        name: 'xai',
        provider: new XAIProvider({
          apiKey: 'test-key',
          model: 'grok-4.20-reasoning',
        }),
      },
      {
        name: 'zai',
        provider: new ZaiProvider({
          apiKey: 'test-key',
          model: 'glm-4.5',
        }),
      },
    ];

    expect(
      providers.map(({ name, provider }) => ({
        name,
        capabilities: provider.getCapabilities?.(),
      })),
    ).toEqual(
      providers.map(({ name }) => ({
        name,
        capabilities: { nativeToolCalling: true },
      })),
    );
  });
});
