/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { ProviderFactory } from '../../src/providers/ProviderFactory.js';
import type { AutohandConfig } from '../../src/types.js';

describe('ProviderFactory', () => {
  describe('create', () => {
    it('should create LLMGatewayProvider when llmgateway is configured', () => {
      const config: AutohandConfig = {
        provider: 'llmgateway',
        llmgateway: {
          apiKey: 'test-key',
          model: 'gpt-4o'
        }
      };

      const provider = ProviderFactory.create(config);
      expect(provider.getName()).toBe('llmgateway');
    });

    it('should return UnconfiguredProvider when llmgateway config is missing', () => {
      const config: AutohandConfig = {
        provider: 'llmgateway'
      };

      const provider = ProviderFactory.create(config);
      expect(provider.getName()).toBe('unconfigured');
    });

    it('should create OpenRouterProvider by default', () => {
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

  describe('getProviderNames', () => {
    it('should include llmgateway in the list', () => {
      const providers = ProviderFactory.getProviderNames();
      expect(providers).toContain('llmgateway');
    });

    it('should include openrouter in the list', () => {
      const providers = ProviderFactory.getProviderNames();
      expect(providers).toContain('openrouter');
    });
  });

  describe('isValidProvider', () => {
    it('should return true for llmgateway', () => {
      expect(ProviderFactory.isValidProvider('llmgateway')).toBe(true);
    });

    it('should return true for openrouter', () => {
      expect(ProviderFactory.isValidProvider('openrouter')).toBe(true);
    });

    it('should return false for invalid provider', () => {
      expect(ProviderFactory.isValidProvider('invalid-provider')).toBe(false);
    });
  });
});
