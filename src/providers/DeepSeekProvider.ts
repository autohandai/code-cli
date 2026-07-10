/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { LLMGatewayClient } from "./LLMGatewayClient.js";
import type { LLMProvider, LLMProviderCapabilities } from "./LLMProvider.js";
import type {
  DeepSeekSettings,
  LLMGatewaySettings,
  LLMRequest,
  LLMResponse,
  NetworkSettings,
} from "../types.js";
import { getProviderModelIds } from "./modelCatalog.js";

export const DEEPSEEK_DEFAULT_BASE_URL = "https://api.deepseek.com";
export const DEEPSEEK_MODELS = getProviderModelIds("deepseek");

export class DeepSeekProvider implements LLMProvider {
  private client: LLMGatewayClient;
  private model: string;

  constructor(config: DeepSeekSettings, networkSettings?: NetworkSettings) {
    const effectiveConfig: LLMGatewaySettings = {
      ...config,
      baseUrl: config.baseUrl ?? DEEPSEEK_DEFAULT_BASE_URL,
    };
    this.client = new LLMGatewayClient(effectiveConfig, networkSettings, {
      serviceName: "DeepSeek",
      credentialName: "DeepSeek API key",
      accountName: "DeepSeek account",
    });
    this.model = config.model;
  }

  getName(): string {
    return "deepseek";
  }

  getCapabilities(): LLMProviderCapabilities {
    return { nativeToolCalling: true };
  }

  setModel(model: string): void {
    this.model = model;
    this.client.setDefaultModel(model);
  }

  async listModels(): Promise<string[]> {
    return getProviderModelIds("deepseek");
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    return this.client.complete(request);
  }
}
