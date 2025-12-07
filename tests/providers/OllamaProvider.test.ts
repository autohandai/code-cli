/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OllamaProvider } from '../../src/providers/OllamaProvider';
import type { ProviderSettings } from '../../src/types';

describe('OllamaProvider', () => {
    let provider: OllamaProvider;
    let config: ProviderSettings;

    beforeEach(() => {
        config = {
            baseUrl: 'http://localhost:11434',
            model: 'llama3.2:latest'
        };
        provider = new OllamaProvider(config);
    });

    describe('listModels', () => {
        it('should fetch models from Ollama API', async () => {
            // Mock fetch
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    models: [
                        { name: 'llama3.2:latest', size: 4661212864 },
                        { name: 'mistral:7b', size: 3825816576 }
                    ]
                })
            });

            const models = await provider.listModels();

            expect(models).toEqual(['llama3.2:latest', 'mistral:7b']);
            expect(fetch).toHaveBeenCalledWith('http://localhost:11434/api/tags');
        });

        it('should return empty array if Ollama is not running', async () => {
            global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

            const models = await provider.listModels();

            expect(models).toEqual([]);
        });

        it('should handle invalid JSON response', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 500
            });

            const models = await provider.listModels();

            expect(models).toEqual([]);
        });
    });

    describe('isAvailable', () => {
        it('should return true if Ollama is running', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ models: [] })
            });

            const available = await provider.isAvailable();

            expect(available).toBe(true);
        });

        it('should return false if Ollama is not running', async () => {
            global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

            const available = await provider.isAvailable();

            expect(available).toBe(false);
        });
    });

    describe('complete', () => {
        it('should send request to Ollama chat API', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    message: {
                        content: 'Hello! How can I help you?'
                    },
                    created_at: '2024-11-21T10:30:00Z'
                })
            });

            const response = await provider.complete({
                messages: [{ role: 'user', content: 'Hello' }],
                temperature: 0.7
            });

            expect(response.content).toBe('Hello! How can I help you?');
            expect(fetch).toHaveBeenCalledWith(
                'http://localhost:11434/api/chat',
                expect.objectContaining({
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: expect.stringContaining('llama3.2:latest')
                })
            );
        });

        it('should handle streaming responses', async () => {
            // Mock streaming response
            const mockStream = new ReadableStream({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode('{"message":{"content":"Hello"}}\n'));
                    controller.enqueue(new TextEncoder().encode('{"message":{"content":" World"}}\n'));
                    controller.close();
                }
            });

            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                body: mockStream
            });

            const response = await provider.complete({
                messages: [{ role: 'user', content: 'Hello' }],
                stream: true
            });

            expect(response.content).toContain('Hello');
        });
    });

    describe('getName', () => {
        it('should return provider name', () => {
            expect(provider.getName()).toBe('ollama');
        });
    });
});
