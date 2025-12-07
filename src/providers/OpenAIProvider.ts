/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LLMProvider } from './LLMProvider.js';
import type { LLMRequest, LLMResponse, ProviderSettings } from '../types.js';

interface OpenAIMessage {
    role: string;
    content: string;
}

interface OpenAIChatResponse {
    id: string;
    created: number;
    choices: Array<{
        message: OpenAIMessage;
        finish_reason: string;
    }>;
}

export class OpenAIProvider implements LLMProvider {
    private baseUrl: string;
    private apiKey: string;
    private model: string;

    constructor(config: ProviderSettings) {
        this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
        this.apiKey = config.apiKey || '';
        this.model = config.model || 'gpt-4o';
    }

    getName(): string {
        return 'openai';
    }

    setModel(model: string): void {
        this.model = model;
    }

    async listModels(): Promise<string[]> {
        // Commonly used OpenAI models
        return [
            'gpt-4o',
            'gpt-4o-mini',
            'gpt-4-turbo',
            'gpt-4',
            'gpt-3.5-turbo'
        ];
    }

    async isAvailable(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/models`, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`
                }
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    async complete(request: LLMRequest): Promise<LLMResponse> {
        const body = {
            model: request.model || this.model,
            messages: request.messages.map((msg: { role: string; content: string }) => ({
                role: msg.role === 'system' ? 'system' : msg.role === 'user' ? 'user' : 'assistant',
                content: msg.content
            })),
            temperature: request.temperature || 0.7,
            max_tokens: request.maxTokens
        };

        const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`OpenAI API error: ${response.status} ${error}`);
        }

        const data: OpenAIChatResponse = await response.json();

        return {
            id: data.id,
            created: data.created,
            content: data.choices[0].message.content,
            raw: data
        };
    }
}
