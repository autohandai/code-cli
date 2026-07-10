/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { OpenRouterClient } from "./OpenRouterClient.js";
import type { LLMProvider, LLMProviderCapabilities } from "./LLMProvider.js";
import type {
  LLMRequest,
  LLMResponse,
  OpenRouterSettings,
  NetworkSettings,
} from "../types.js";
import { fetchOpenRouterModelCapabilities } from "./modelCapabilities.js";
import { getProviderModelIds, mergeModelIds } from "./modelCatalog.js";

export class OpenRouterProvider implements LLMProvider {
  private client: OpenRouterClient;
  private model: string;

  constructor(config: OpenRouterSettings, networkSettings?: NetworkSettings) {
    this.client = new OpenRouterClient(config, networkSettings);
    this.model = config.model;
  }

  getName(): string {
    return "openrouter";
  }

  getCapabilities(): LLMProviderCapabilities {
    return { nativeToolCalling: true };
  }

  setModel(model: string): void {
    this.model = model;
    this.client.setDefaultModel(model);
  }

  async listModels(): Promise<string[]> {
    try {
      const models = await fetchOpenRouterModelCapabilities();
      const ids = models
        .map((model) => model.id)
        .filter((id): id is string => Boolean(id));

      if (ids.length > 0) {
        return mergeModelIds(ids, getProviderModelIds("openrouter"));
      }
    } catch {
      // Fall through to the catalog fallback list below.
    }

    return getProviderModelIds("openrouter");
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
