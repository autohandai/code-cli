/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { OpenRouterClient } from "./OpenRouterClient.js";
import type { LLMProvider } from "./LLMProvider.js";
import type {
  LLMRequest,
  LLMResponse,
  OpenRouterSettings,
  NetworkSettings,
} from "../types.js";
import { fetchOpenRouterModelCapabilities } from "./modelCapabilities.js";

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
        return ids;
      }
    } catch {
      // Fall through to the static fallback list below.
    }

    return [
      "anthropic/claude-sonnet-4-20250514",
      "anthropic/claude-3-opus",
      "google/gemini-pro-1.5",
      "openai/gpt-4o",
      "x-ai/grok-2-latest",
      "meta-llama/llama-3.1-70b-instruct",
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
