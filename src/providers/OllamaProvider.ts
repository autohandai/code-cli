/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LLMProvider } from './LLMProvider.js';
import type { LLMRequest, LLMResponse, ProviderSettings } from '../types.js';

interface OllamaModel {
    name: string;
    modified_at?: string;
    size?: number;
}

interface OllamaTagsResponse {
    models: OllamaModel[];
}

interface OllamaChatResponse {
    message: {
        role: string;
        content: string;
    };
    created_at: string;
    done: boolean;
}

export class OllamaProvider implements LLMProvider {
    private baseUrl: string;
    private model: string;

    constructor(config: ProviderSettings) {
        this.baseUrl = config.baseUrl || 'http://localhost:11434';
        this.model = config.model || 'llama3.2:latest';
    }

    getName(): string {
        return 'ollama';
    }

    setModel(model: string): void {
        this.model = model;
    }

    async listModels(): Promise<string[]> {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`);

            if (!response.ok) {
                return [];
            }

            const data: OllamaTagsResponse = await response.json();
            return data.models.map(m => m.name);
        } catch (error) {
            // Ollama not running or network error
            return [];
        }
    }

    async isAvailable(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`);
            return response.ok;
        } catch {
            return false;
        }
    }

    async complete(request: LLMRequest): Promise<LLMResponse> {
        const body = {
            model: request.model || this.model,
            messages: request.messages.map((msg: { role: string; content: string }) => ({
                role: msg.role,
                content: msg.content
            })),
            stream: request.stream || false,
            options: {
                temperature: request.temperature
            }
        };

        const response = await fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
        }

        if (request.stream) {
            return this.handleStreamingResponse(response);
        }

        const data: OllamaChatResponse = await response.json();

        return {
            id: `ollama-${Date.now()}`,
            created: Math.floor(new Date(data.created_at).getTime() / 1000),
            content: data.message.content,
            raw: data
        };
    }

    private async handleStreamingResponse(response: Response): Promise<LLMResponse> {
        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error('No response body');
        }

        const decoder = new TextDecoder();
        let fullContent = '';
        let lastData: OllamaChatResponse | null = null;

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n').filter(line => line.trim());

                for (const line of lines) {
                    try {
                        const data: OllamaChatResponse = JSON.parse(line);
                        fullContent += data.message.content;
                        lastData = data;
                    } catch {
                        // Skip invalid JSON lines
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }

        return {
            id: `ollama-${Date.now()}`,
            created: lastData ? Math.floor(new Date(lastData.created_at).getTime() / 1000) : Date.now(),
            content: fullContent,
            raw: lastData
        };
    }
}
