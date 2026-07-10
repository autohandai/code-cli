/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { LLMGatewayClient } from './LLMGatewayClient.js';
import type { LLMProvider, LLMProviderCapabilities } from './LLMProvider.js';
import type { LLMRequest, LLMResponse, ZaiSettings, NetworkSettings } from '../types.js';
import { getProviderModelIds } from './modelCatalog.js';

export const ZAI_DEFAULT_BASE_URL = 'https://api.z.ai/api/paas/v4';
export const ZAI_MODELS = getProviderModelIds('zai');

export class ZaiProvider implements LLMProvider {
  private client: LLMGatewayClient;
  private model: string;

  constructor(config: ZaiSettings, networkSettings?: NetworkSettings) {
    const effectiveConfig = {
      ...config,
      baseUrl: config.baseUrl ?? ZAI_DEFAULT_BASE_URL,
    };
    this.client = new LLMGatewayClient(effectiveConfig, networkSettings, {
      serviceName: 'Z.ai',
      credentialName: 'Z.ai API key',
      accountName: 'Z.ai account',
    });
    this.model = config.model;
  }

  getName(): string {
    return 'zai';
  }

  getCapabilities(): LLMProviderCapabilities {
    return { nativeToolCalling: true };
  }

  setModel(model: string): void {
    this.model = model;
    this.client.setDefaultModel(model);
  }

  async listModels(): Promise<string[]> {
    return getProviderModelIds('zai');
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    return this.client.complete(request);
  }
}
