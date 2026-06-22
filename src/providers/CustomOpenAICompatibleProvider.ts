/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { LLMGatewayClient } from "./LLMGatewayClient.js";
import type { LLMProvider, LLMProviderCapabilities } from "./LLMProvider.js";
import type {
  CustomProviderId,
  CustomProviderSettings,
  LLMRequest,
  LLMResponse,
  NetworkSettings,
} from "../types.js";
import { toCustomProviderName } from "./customProviders.js";

export class CustomOpenAICompatibleProvider implements LLMProvider {
  private readonly providerName: CustomProviderId;
  private readonly client: LLMGatewayClient;
  private readonly models: string[];
  private readonly apiKeyRequired: boolean;
  private readonly apiKey?: string;
  private model: string;

  constructor(config: CustomProviderSettings, networkSettings?: NetworkSettings) {
    this.providerName = toCustomProviderName(config.id);
    this.model = config.model;
    this.models = config.models?.map((entry) => entry.id) ?? [config.model];
    this.apiKeyRequired = config.apiKeyRequired !== false;
    this.apiKey = config.apiKey;
    this.client = new LLMGatewayClient(
      {
        apiKey: config.apiKey ?? "",
        baseUrl: config.baseUrl,
        model: config.model,
      },
      networkSettings,
      {
        serviceName: config.displayName,
        credentialName: `${config.displayName} API key`,
        accountName: `${config.displayName} account`,
      },
    );
  }

  getName(): string {
    return this.providerName;
  }

  getCapabilities(): LLMProviderCapabilities {
    return { nativeToolCalling: true };
  }

  setModel(model: string): void {
    this.model = model;
    this.client.setDefaultModel(model);
  }

  async listModels(): Promise<string[]> {
    return this.models;
  }

  async isAvailable(): Promise<boolean> {
    return !this.apiKeyRequired || Boolean(this.apiKey);
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    return this.client.complete(request);
  }
}

