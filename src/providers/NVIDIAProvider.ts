/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { NVIDIAClient } from "./NVIDIAClient.js";
import type { LLMProvider, LLMProviderCapabilities } from "./LLMProvider.js";
import type {
  LLMRequest,
  LLMResponse,
  NvidiaAISettings,
  NetworkSettings,
  NvidiaChatTemplateKwargs,
} from "../types.js";

export const NVIDIA_DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";

/**
 * NVIDIA AI Cloud models sorted by name in descending order.
 * Source: https://build.nvidia.com/models
 */
export const NVIDIA_MODELS = [
  "minimaxai/minimax-m3",
  "deepseek-ai/deepseek-v4-pro",
  "z-ai/glm-5.1",
  "z-ai/glm-4.7",
  "qwen/qwen3.5-122b-a10b",
  "stepfun-ai/step-3.7-flash",
  "nvidia/usdcode",
  "moonshotai/kimi-k2.5",
  "minimaxai/minimax-m2.7",
  "microsoft/phi-4-mini-instruct",
  "mistralai/mistral-small-4-119b-2603",
  "mistralai/mixtral-8x7b-instruct-v0.1",
  "mistralai/mixtral-8x22b-instruct-v0.1",
  "mistralai/mamba-codestral-7b-v0.1",
  "nvidia/mistral-nemo-minitron-8b-base",
  "google/gemma-4-31b-it",
  "bigcode/starcoder2-7b",
] as const;

export const NVIDIA_DEFAULT_MODEL = "z-ai/glm-5.1";

export class NVIDIAProvider implements LLMProvider {
  private client: NVIDIAClient;
  private model: string;
  private chatTemplateKwargs?: NvidiaChatTemplateKwargs;
  private stream: boolean;

  constructor(config: NvidiaAISettings, networkSettings?: NetworkSettings) {
    this.client = new NVIDIAClient(config, networkSettings);
    this.model = config.model;
    this.chatTemplateKwargs = config.chatTemplateKwargs;
    this.stream = config.stream ?? false;
  }

  getName(): string {
    return "nvidia";
  }

  getCapabilities(): LLMProviderCapabilities {
    return { nativeToolCalling: true };
  }

  setModel(model: string): void {
    this.model = model;
    this.client.setDefaultModel(model);
  }

  async listModels(): Promise<string[]> {
    return [...NVIDIA_MODELS];
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    // Merge provider-level settings with request-level settings
    const enhancedRequest: LLMRequest = {
      ...request,
      // Use request stream if set, otherwise fall back to provider default
      stream: request.stream ?? this.stream,
      // Merge chatTemplateKwargs: request-level takes precedence
      chatTemplateKwargs: request.chatTemplateKwargs ?? this.chatTemplateKwargs,
    };
    return this.client.complete(enhancedRequest);
  }
}
