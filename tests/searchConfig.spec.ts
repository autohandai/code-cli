/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  configureSearch,
  configureSearchFromSettings,
  getSearchConfig,
  webSearch,
} from '../src/actions/web.js';

describe('Search Configuration', () => {
  beforeEach(() => {
    // Reset to default configuration
    configureSearch({ provider: 'browser-profile', braveApiKey: undefined, parallelApiKey: undefined, exaApiKey: undefined });
  });

  describe('configureSearch', () => {
    it('sets provider to brave', () => {
      configureSearch({ provider: 'brave' });
      const config = getSearchConfig();
      expect(config.provider).toBe('brave');
    });

    it('sets provider to browser-profile', () => {
      configureSearch({ provider: 'browser-profile' });
      const config = getSearchConfig();
      expect(config.provider).toBe('browser-profile');
    });

    it('sets provider to exa', () => {
      configureSearch({ provider: 'exa' });
      const config = getSearchConfig();
      expect(config.provider).toBe('exa');
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

    it('stores exa API key', () => {
      configureSearch({ provider: 'exa', exaApiKey: 'test-exa-key' });
      const config = getSearchConfig();
      expect(config.exaApiKey).toBe('test-exa-key');
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
    it('returns configured provider after explicit set', () => {
      const config = getSearchConfig();
      expect(config.provider).toBe('browser-profile'); // set by beforeEach (new default)
    });

    it('returns a copy of config (not reference)', () => {
      const config1 = getSearchConfig();
      const config2 = getSearchConfig();
      expect(config1).not.toBe(config2);
      expect(config1).toEqual(config2);
    });
  });

  describe('configureSearchFromSettings', () => {
    it('uses browser-profile when no provider is configured', () => {
      configureSearch({ provider: 'google' });

      configureSearchFromSettings();

      expect(getSearchConfig().provider).toBe('browser-profile');
    });

    it('preserves explicit provider settings for protocol modes', () => {
      configureSearchFromSettings({
        provider: 'exa',
        exaApiKey: 'exa-config-key',
      });

      expect(getSearchConfig()).toMatchObject({
        provider: 'exa',
        exaApiKey: 'exa-config-key',
      });
    });
  });

  describe('webSearch provider selection', () => {
    it('uses the connected browser tool bridge before headless browser-profile search', async () => {
      configureSearch({ provider: 'browser-profile' });

      const calls: Array<{ toolName: string; input: Record<string, unknown> }> = [];
      const results = await webSearch('autohand code', {
        browserToolInvoker: async (toolName, input) => {
          calls.push({ toolName, input });
          if (toolName === 'browser_execute_js') {
            return JSON.stringify([{
              title: 'Autohand Code',
              url: 'https://autohand.ai/code/',
              snippet: 'Terminal-native AI coding agent',
            }]);
          }
          return 'ok';
        },
      });

      expect(results).toEqual([{
        title: 'Autohand Code',
        url: 'https://autohand.ai/code/',
        snippet: 'Terminal-native AI coding agent',
      }]);
      expect(calls.map((call) => call.toolName)).toEqual([
        'browser_navigate',
        'browser_wait_for_element',
        'browser_execute_js',
      ]);
      expect(calls[0].input.url).toContain('https://www.google.com/search?');
      expect(calls[0].input.url).toContain('autohand%20code');
    });

    it('throws error for exa without API key', async () => {
      configureSearch({ provider: 'exa', exaApiKey: undefined });

      await expect(webSearch('test query')).rejects.toThrow('Exa.ai Search requires an API key');
    });

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
