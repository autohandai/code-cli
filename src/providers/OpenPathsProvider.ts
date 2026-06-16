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
  OpenPathsSettings,
  NetworkSettings,
} from "../types.js";

const OPENPATHS_BASE_URL = "https://openpaths.io/v1";
const OPENPATHS_MODELS_URL = "https://openpaths.io/v1/models";

/**
 * OpenPaths is an OpenAI-compatible model gateway (https://openpaths.io).
 * It reuses the generic OpenAI-compatible client used by OpenRouter, pointed
 * at the OpenPaths base URL.
 */
export class OpenPathsProvider implements LLMProvider {
  private client: OpenRouterClient;
  private model: string;

  constructor(config: OpenPathsSettings, networkSettings?: NetworkSettings) {
    this.client = new OpenRouterClient(
      { ...config, baseUrl: config.baseUrl ?? OPENPATHS_BASE_URL },
      networkSettings,
    );
    this.model = config.model;
  }

  getName(): string {
    return "openpaths";
  }

  setModel(model: string): void {
    this.model = model;
    this.client.setDefaultModel(model);
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(OPENPATHS_MODELS_URL, {
        headers: {
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        const data = (await response.json()) as { data?: Array<{ id?: string }> };
        const ids = (Array.isArray(data?.data) ? data.data : [])
          .map((model) => model.id)
          .filter((id): id is string => Boolean(id));

        if (ids.length > 0) {
          return ids;
        }
      }
    } catch {
      // Fall through to the static fallback list below.
    }

    return [
      "openpaths/auto",
      "openpaths/auto-code",
      "openpaths/auto-fast",
      "openpaths/auto-reasoning",
    ];
  }

  async isAvailable(): Promise<boolean> {
    // For OpenPaths, we can't easily check without making a request
    // Return true if we have an API key
    return true;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    return this.client.complete(request);
  }
}
