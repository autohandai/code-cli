/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { LLMGatewayClient } from './LLMGatewayClient.js';
import type { LLMProvider, LLMProviderCapabilities } from './LLMProvider.js';
import type { LLMRequest, LLMResponse, LLMGatewaySettings, NetworkSettings } from '../types.js';
import { getProviderModelIds } from './modelCatalog.js';

export class LLMGatewayProvider implements LLMProvider {
    private client: LLMGatewayClient;
    private model: string;

    constructor(config: LLMGatewaySettings, networkSettings?: NetworkSettings) {
        this.client = new LLMGatewayClient(config, networkSettings);
        this.model = config.model;
    }

    getName(): string {
        return 'llmgateway';
    }

    getCapabilities(): LLMProviderCapabilities {
        return { nativeToolCalling: true };
    }

    setModel(model: string): void {
        this.model = model;
        this.client.setDefaultModel(model);
    }

    async listModels(): Promise<string[]> {
        return getProviderModelIds('llmgateway');
    }

    async isAvailable(): Promise<boolean> {
        // For LLM Gateway, we can't easily check without making a request
        // Return true if we have an API key
        return true;
    }

    async complete(request: LLMRequest): Promise<LLMResponse> {
        return this.client.complete(request);
    }
}
