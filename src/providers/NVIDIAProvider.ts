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
import {
  getProviderDefaultModel,
  getProviderModelIds,
} from "./modelCatalog.js";

export const NVIDIA_DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";

/** NVIDIA AI Cloud models from the JSON model catalog. */
export const NVIDIA_MODELS = getProviderModelIds("nvidia");

export const NVIDIA_DEFAULT_MODEL = getProviderDefaultModel("nvidia", "z-ai/glm-5.1");

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
    return getProviderModelIds("nvidia");
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
