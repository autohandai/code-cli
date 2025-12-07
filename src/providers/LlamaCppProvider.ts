/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LLMProvider } from './LLMProvider.js';
import type { LLMRequest, LLMResponse, ProviderSettings } from '../types.js';

interface LlamaCppCompletionResponse {
    content: string;
    generation_settings: {
        model: string;
    };
    timings: {
        prompt_ms: number;
        predicted_ms: number;
    };
}

export class LlamaCppProvider implements LLMProvider {
    private baseUrl: string;
    private model: string;

    constructor(config: ProviderSettings) {
        const port = config.port || 8080;
        this.baseUrl = config.baseUrl || `http://localhost:${port}`;
        this.model = config.model || 'llama-model';
    }

    getName(): string {
        return 'llamacpp';
    }

    setModel(model: string): void {
        this.model = model;
    }

    async listModels(): Promise<string[]> {
        // llama.cpp serves one model at a time
        // Try to detect the model name from the server
        try {
            const available = await this.isAvailable();
            return available ? [this.model] : [];
        } catch {
            return [];
        }
    }

    async isAvailable(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/health`);
            return response.ok;
        } catch {
            return false;
        }
    }

    async complete(request: LLMRequest): Promise<LLMResponse> {
        // Convert chat messages to a prompt
        const prompt = this.messagesToPrompt(request.messages);

        const body = {
            prompt,
            temperature: request.temperature || 0.7,
            n_predict: request.maxTokens || 2048,
            stop: ['</s>', 'User:', '\nUser:']
        };

        const response = await fetch(`${this.baseUrl}/completion`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            throw new Error(`llama.cpp API error: ${response.status} ${response.statusText}`);
        }

        const data: LlamaCppCompletionResponse = await response.json();

        return {
            id: `llamacpp-${Date.now()}`,
            created: Math.floor(Date.now() / 1000),
            content: data.content.trim(),
            raw: data
        };
    }

    private messagesToPrompt(messages: Array<{ role: string; content: string }>): string {
        let prompt = '';

        for (const msg of messages) {
            if (msg.role === 'system') {
                prompt += `System: ${msg.content}\n\n`;
            } else if (msg.role === 'user') {
                prompt += `User: ${msg.content}\n\n`;
            } else if (msg.role === 'assistant') {
                prompt += `Assistant: ${msg.content}\n\n`;
            }
        }

        prompt += 'Assistant: ';
        return prompt;
    }
}
