/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AzureClient } from './AzureClient.js';
import type { LLMProvider } from './LLMProvider.js';
import type { LLMRequest, LLMResponse, AzureSettings, NetworkSettings } from '../types.js';

export class AzureProvider implements LLMProvider {
  private client: AzureClient;
  private model: string;

  constructor(config: AzureSettings, networkSettings?: NetworkSettings) {
    this.client = new AzureClient(
      {
        model: config.model,
        resourceName: config.resourceName,
        deploymentName: config.deploymentName,
        baseUrl: config.baseUrl,
        apiVersion: config.apiVersion,
        apiKey: config.apiKey,
        authMethod: config.authMethod ?? 'api-key',
        tenantId: config.tenantId,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
      },
      networkSettings,
    );
    this.model = config.model;
  }

  getName(): string {
    return 'azure';
  }

  setModel(model: string): void {
    this.model = model;
    this.client.setDefaultModel(model);
  }

  async listModels(): Promise<string[]> {
    return ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'];
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    return this.client.complete(request);
  }
}
