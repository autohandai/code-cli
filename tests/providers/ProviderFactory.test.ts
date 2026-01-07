/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AutohandConfig } from '../../src/types';

// Create a mock function for isMLXSupported
const mockIsMLXSupported = vi.fn();

// Mock the platform utility before importing ProviderFactory
vi.mock('../../src/utils/platform', () => ({
    isMLXSupported: mockIsMLXSupported
}));

// Import after mocking
import { ProviderFactory } from '../../src/providers/ProviderFactory';

describe('ProviderFactory', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('getProviderNames()', () => {
        it('should include mlx on Apple Silicon', () => {
            mockIsMLXSupported.mockReturnValue(true);

            const providers = ProviderFactory.getProviderNames();

            expect(providers).toContain('mlx');
            expect(providers).toEqual(['openrouter', 'ollama', 'openai', 'llamacpp', 'mlx']);
        });

        it('should exclude mlx on non-Apple Silicon', () => {
            mockIsMLXSupported.mockReturnValue(false);

            const providers = ProviderFactory.getProviderNames();

            expect(providers).not.toContain('mlx');
            expect(providers).toEqual(['openrouter', 'ollama', 'openai', 'llamacpp']);
        });

        it('should always include openrouter, ollama, openai, llamacpp', () => {
            mockIsMLXSupported.mockReturnValue(false);

            const providers = ProviderFactory.getProviderNames();

            expect(providers).toContain('openrouter');
            expect(providers).toContain('ollama');
            expect(providers).toContain('openai');
            expect(providers).toContain('llamacpp');
        });
    });

    describe('create()', () => {
        it('should create MLXProvider when mlx is configured', () => {
            mockIsMLXSupported.mockReturnValue(true);
            const config: AutohandConfig = {
                provider: 'mlx',
                mlx: {
                    model: 'test-model',
                    baseUrl: 'http://localhost:8080'
                }
            };

            const provider = ProviderFactory.create(config);

            expect(provider.getName()).toBe('mlx');
        });

        it('should return UnconfiguredProvider when mlx config is missing', () => {
            mockIsMLXSupported.mockReturnValue(true);
            const config: AutohandConfig = {
                provider: 'mlx'
            };

            const provider = ProviderFactory.create(config);

            expect(provider.getName()).toBe('unconfigured');
        });

        it('should create OllamaProvider when ollama is configured', () => {
            const config: AutohandConfig = {
                provider: 'ollama',
                ollama: {
                    model: 'llama3.2:latest',
                    baseUrl: 'http://localhost:11434'
                }
            };

            const provider = ProviderFactory.create(config);

            expect(provider.getName()).toBe('ollama');
        });

        it('should create OpenAIProvider when openai is configured', () => {
            const config: AutohandConfig = {
                provider: 'openai',
                openai: {
                    apiKey: 'test-key',
                    model: 'gpt-4'
                }
            };

            const provider = ProviderFactory.create(config);

            expect(provider.getName()).toBe('openai');
        });

        it('should create LlamaCppProvider when llamacpp is configured', () => {
            const config: AutohandConfig = {
                provider: 'llamacpp',
                llamacpp: {
                    model: 'test-model',
                    baseUrl: 'http://localhost:8080'
                }
            };

            const provider = ProviderFactory.create(config);

            expect(provider.getName()).toBe('llamacpp');
        });

        it('should default to openrouter when no provider specified', () => {
            const config: AutohandConfig = {
                openrouter: {
                    apiKey: 'test-key',
                    model: 'anthropic/claude-3.5-sonnet'
                }
            };

            const provider = ProviderFactory.create(config);

            expect(provider.getName()).toBe('openrouter');
        });
    });

    describe('isValidProvider()', () => {
        it('should return true for mlx regardless of platform', () => {
            // Even on non-Apple Silicon, mlx is a valid provider name
            mockIsMLXSupported.mockReturnValue(false);

            expect(ProviderFactory.isValidProvider('mlx')).toBe(true);
        });

        it('should return true for openrouter', () => {
            expect(ProviderFactory.isValidProvider('openrouter')).toBe(true);
        });

        it('should return true for ollama', () => {
            expect(ProviderFactory.isValidProvider('ollama')).toBe(true);
        });

        it('should return true for openai', () => {
            expect(ProviderFactory.isValidProvider('openai')).toBe(true);
        });

        it('should return true for llamacpp', () => {
            expect(ProviderFactory.isValidProvider('llamacpp')).toBe(true);
        });

        it('should return false for invalid provider', () => {
            expect(ProviderFactory.isValidProvider('invalid')).toBe(false);
            expect(ProviderFactory.isValidProvider('gpt4')).toBe(false);
            expect(ProviderFactory.isValidProvider('')).toBe(false);
        });
    });
});
