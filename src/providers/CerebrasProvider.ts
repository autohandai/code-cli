/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { CerebrasClient } from './CerebrasClient.js';
import type { LLMProvider } from './LLMProvider.js';
import type { LLMRequest, LLMResponse, CerebrasSettings, NetworkSettings } from '../types.js';

export const CEREBRAS_DEFAULT_BASE_URL = 'https://api.cerebras.ai/v1';
export const CEREBRAS_MODELS = [
  'zai-glm-4.7',
  'qwen-3-235b-a22b-instruct-2507',
] as const;

export class CerebrasProvider implements LLMProvider {
  private client: CerebrasClient;
  private model: string;

  constructor(config: CerebrasSettings, networkSettings?: NetworkSettings) {
    const effectiveConfig = {
      ...config,
      baseUrl: config.baseUrl ?? CEREBRAS_DEFAULT_BASE_URL,
    };
    this.client = new CerebrasClient(effectiveConfig, networkSettings);
    this.model = config.model;
  }

  getName(): string {
    return 'cerebras';
  }

  setModel(model: string): void {
    this.model = model;
    this.client.setDefaultModel(model);
  }

  async listModels(): Promise<string[]> {
    return [...CEREBRAS_MODELS];
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    return this.client.complete(request);
  }
}
