/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { LLMGatewayClient } from './LLMGatewayClient.js';
import type { LLMProvider } from './LLMProvider.js';
import type { LLMRequest, LLMResponse, ZaiSettings, NetworkSettings } from '../types.js';

const ZAI_DEFAULT_BASE_URL = 'https://api.z.ai/api/paas/v4';

export class ZaiProvider implements LLMProvider {
  private client: LLMGatewayClient;
  private model: string;

  constructor(config: ZaiSettings, networkSettings?: NetworkSettings) {
    const effectiveConfig = {
      ...config,
      baseUrl: config.baseUrl ?? ZAI_DEFAULT_BASE_URL,
    };
    this.client = new LLMGatewayClient(effectiveConfig, networkSettings);
    this.model = config.model;
  }

  getName(): string {
    return 'zai';
  }

  setModel(model: string): void {
    this.model = model;
    this.client.setDefaultModel(model);
  }

  async listModels(): Promise<string[]> {
    return [
      'glm-4.5',
      'glm-4.5v',
      'glm-4.5-air',
      'glm-4.5-prior',
      'glm-4.5-flash',
      'glm-4.5-air-2504',
      'cogview-4.5',
    ];
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    return this.client.complete(request);
  }
}
