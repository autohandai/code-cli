/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { LLMGatewayClient } from './LLMGatewayClient.js';
import type { LLMProvider, LLMProviderCapabilities } from './LLMProvider.js';
import type { LLMRequest, LLMResponse, NetworkSettings, SakanaSettings } from '../types.js';

export const SAKANA_DEFAULT_BASE_URL = 'https://api.sakana.ai/v1';
export const SAKANA_MODELS = [
  'fugu',
  'fugu-ultra',
] as const;

export class SakanaProvider implements LLMProvider {
  private client: LLMGatewayClient;
  private model: string;

  constructor(config: SakanaSettings, networkSettings?: NetworkSettings) {
    const effectiveConfig = {
      ...config,
      baseUrl: config.baseUrl ?? SAKANA_DEFAULT_BASE_URL,
    };
    this.client = new LLMGatewayClient(effectiveConfig, networkSettings, {
      serviceName: 'Sakana.AI',
      credentialName: 'Sakana API key',
      accountName: 'Sakana account',
    });
    this.model = config.model;
  }

  getName(): string {
    return 'sakana';
  }

  getCapabilities(): LLMProviderCapabilities {
    return { nativeToolCalling: true };
  }

  setModel(model: string): void {
    this.model = model;
    this.client.setDefaultModel(model);
  }

  async listModels(): Promise<string[]> {
    return [...SAKANA_MODELS];
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    return this.client.complete(request);
  }
}
