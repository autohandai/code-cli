/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { metadata } from '../../src/commands/search.js';
import { configureSearch, getSearchConfig } from '../../src/actions/web.js';

describe('/search command', () => {
  beforeEach(() => {
    // Reset to default configuration
    configureSearch({ provider: 'duckduckgo', braveApiKey: undefined, parallelApiKey: undefined });
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('metadata', () => {
    it('has correct command name', () => {
      expect(metadata.command).toBe('/search');
    });

    it('has description mentioning supported providers', () => {
      expect(metadata.description).toContain('brave');
      expect(metadata.description).toContain('duckduckgo');
      expect(metadata.description).toContain('parallel');
    });

    it('is marked as implemented', () => {
      expect(metadata.implemented).toBe(true);
    });
  });

  describe('search configuration integration', () => {
    it('default provider is duckduckgo', () => {
      const config = getSearchConfig();
      expect(config.provider).toBe('duckduckgo');
    });

    it('can configure brave provider with API key', () => {
      configureSearch({
        provider: 'brave',
        braveApiKey: 'test-brave-api-key',
      });
      const config = getSearchConfig();
      expect(config.provider).toBe('brave');
      expect(config.braveApiKey).toBe('test-brave-api-key');
    });

    it('can configure parallel provider with API key', () => {
      configureSearch({
        provider: 'parallel',
        parallelApiKey: 'test-parallel-api-key',
      });
      const config = getSearchConfig();
      expect(config.provider).toBe('parallel');
      expect(config.parallelApiKey).toBe('test-parallel-api-key');
    });

    it('preserves API keys when switching providers', () => {
      configureSearch({
        provider: 'brave',
        braveApiKey: 'brave-key',
      });

      configureSearch({
        provider: 'duckduckgo',
      });

      const config = getSearchConfig();
      expect(config.provider).toBe('duckduckgo');
      expect(config.braveApiKey).toBe('brave-key');
    });
  });
});
