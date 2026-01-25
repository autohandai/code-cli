/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { LLMGatewayClient } from './LLMGatewayClient.js';
import type { LLMProvider } from './LLMProvider.js';
import type { LLMRequest, LLMResponse, LLMGatewaySettings, NetworkSettings } from '../types.js';

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

    setModel(model: string): void {
        this.model = model;
        this.client.setDefaultModel(model);
    }

    async listModels(): Promise<string[]> {
        // Popular models available on LLM Gateway
        // In a real implementation, you'd fetch from LLM Gateway's models API
        return [
            'gpt-4o',
            'gpt-4o-mini',
            'gpt-4-turbo',
            'claude-3-5-sonnet-20241022',
            'claude-3-5-haiku-20241022',
            'gemini-1.5-pro',
            'gemini-1.5-flash'
        ];
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
