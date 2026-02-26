/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for web_search tool availability gating.
 * The web_search tool should only be offered to the LLM when a reliable
 * search provider is configured (Brave or Parallel with API keys, or Google).
 * DuckDuckGo alone is unreliable (CAPTCHA/timeouts) and should NOT count
 * as "configured".
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { configureSearch, getSearchConfig, isSearchConfigured } from '../src/actions/web.js';

describe('isSearchConfigured', () => {
  beforeEach(() => {
    // Reset to duckduckgo (unreliable) to test gating
    configureSearch({ provider: 'duckduckgo', braveApiKey: undefined, parallelApiKey: undefined });
  });

  it('returns true with default google provider', () => {
    configureSearch({ provider: 'google' });
    expect(isSearchConfigured()).toBe(true);
  });

  it('returns false when only duckduckgo is configured (unreliable)', () => {
    expect(isSearchConfigured()).toBe(false);
  });

  it('returns true when brave provider is configured with API key', () => {
    configureSearch({ provider: 'brave', braveApiKey: 'sk-brave-test' });
    expect(isSearchConfigured()).toBe(true);
  });

  it('returns true when parallel provider is configured with API key', () => {
    configureSearch({ provider: 'parallel', parallelApiKey: 'sk-parallel-test' });
    expect(isSearchConfigured()).toBe(true);
  });

  it('returns false when brave provider is set but no API key', () => {
    configureSearch({ provider: 'brave', braveApiKey: undefined });
    expect(isSearchConfigured()).toBe(false);
  });

  it('returns false when parallel provider is set but no API key', () => {
    configureSearch({ provider: 'parallel', parallelApiKey: undefined });
    expect(isSearchConfigured()).toBe(false);
  });

  it('returns true when google provider is configured (no key required)', () => {
    configureSearch({ provider: 'google' as any });
    expect(isSearchConfigured()).toBe(true);
  });
});
