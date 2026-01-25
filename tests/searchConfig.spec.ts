/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { configureSearch, getSearchConfig, webSearch } from '../src/actions/web.js';

describe('Search Configuration', () => {
  beforeEach(() => {
    // Reset to default configuration
    configureSearch({ provider: 'duckduckgo', braveApiKey: undefined, parallelApiKey: undefined });
  });

  describe('configureSearch', () => {
    it('sets provider to brave', () => {
      configureSearch({ provider: 'brave' });
      const config = getSearchConfig();
      expect(config.provider).toBe('brave');
    });

    it('sets provider to duckduckgo', () => {
      configureSearch({ provider: 'duckduckgo' });
      const config = getSearchConfig();
      expect(config.provider).toBe('duckduckgo');
    });

    it('sets provider to parallel', () => {
      configureSearch({ provider: 'parallel' });
      const config = getSearchConfig();
      expect(config.provider).toBe('parallel');
    });

    it('stores brave API key', () => {
      configureSearch({ provider: 'brave', braveApiKey: 'test-brave-key' });
      const config = getSearchConfig();
      expect(config.braveApiKey).toBe('test-brave-key');
    });

    it('stores parallel API key', () => {
      configureSearch({ provider: 'parallel', parallelApiKey: 'test-parallel-key' });
      const config = getSearchConfig();
      expect(config.parallelApiKey).toBe('test-parallel-key');
    });

    it('preserves existing settings when partially updating', () => {
      configureSearch({ provider: 'brave', braveApiKey: 'test-key' });
      configureSearch({ provider: 'duckduckgo' });
      const config = getSearchConfig();
      expect(config.provider).toBe('duckduckgo');
      expect(config.braveApiKey).toBe('test-key');
    });
  });

  describe('getSearchConfig', () => {
    it('returns default provider as duckduckgo', () => {
      const config = getSearchConfig();
      expect(config.provider).toBe('duckduckgo');
    });

    it('returns a copy of config (not reference)', () => {
      const config1 = getSearchConfig();
      const config2 = getSearchConfig();
      expect(config1).not.toBe(config2);
      expect(config1).toEqual(config2);
    });
  });

  describe('webSearch provider selection', () => {
    it('throws error for brave without API key', async () => {
      configureSearch({ provider: 'brave', braveApiKey: undefined });

      await expect(webSearch('test query')).rejects.toThrow('Brave Search requires an API key');
    });

    it('throws error for parallel without API key', async () => {
      configureSearch({ provider: 'parallel', parallelApiKey: undefined });

      await expect(webSearch('test query')).rejects.toThrow('Parallel.ai Search requires an API key');
    });
  });
});
