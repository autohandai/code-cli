/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests that web_search tool is excluded from LLM tool list
 * when no reliable search provider is configured.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { configureSearch, isSearchConfigured } from '../src/actions/web.js';
import type { FunctionDefinition } from '../src/types.js';

/**
 * Simulates the tool gating logic that should exist in agent.ts.
 * web_search (and fetch_url, web_repo) should be excluded when
 * no search provider is properly configured.
 */
const WEB_TOOLS = new Set(['web_search', 'fetch_url', 'web_repo']);

function filterUnconfiguredWebTools(tools: FunctionDefinition[]): FunctionDefinition[] {
  if (isSearchConfigured()) {
    return tools;
  }
  return tools.filter(t => !WEB_TOOLS.has(t.name));
}

describe('web_search tool gating', () => {
  const mockTools: FunctionDefinition[] = [
    { name: 'read_file', description: 'Read a file', parameters: { type: 'object', properties: {} } },
    { name: 'web_search', description: 'Search the web', parameters: { type: 'object', properties: {} } },
    { name: 'fetch_url', description: 'Fetch URL', parameters: { type: 'object', properties: {} } },
    { name: 'web_repo', description: 'Browse repos', parameters: { type: 'object', properties: {} } },
    { name: 'write_file', description: 'Write a file', parameters: { type: 'object', properties: {} } },
  ];

  beforeEach(() => {
    // Set to duckduckgo (unreliable) to test gating behavior
    configureSearch({ provider: 'duckduckgo', braveApiKey: undefined, parallelApiKey: undefined });
  });

  it('excludes web_search when no provider is configured', () => {
    const filtered = filterUnconfiguredWebTools(mockTools);
    const names = filtered.map(t => t.name);
    expect(names).not.toContain('web_search');
    expect(names).not.toContain('fetch_url');
    expect(names).not.toContain('web_repo');
    expect(names).toContain('read_file');
    expect(names).toContain('write_file');
  });

  it('includes web_search when brave is configured with key', () => {
    configureSearch({ provider: 'brave', braveApiKey: 'sk-test' });
    const filtered = filterUnconfiguredWebTools(mockTools);
    const names = filtered.map(t => t.name);
    expect(names).toContain('web_search');
    expect(names).toContain('fetch_url');
    expect(names).toContain('web_repo');
  });

  it('includes web_search when google is configured', () => {
    configureSearch({ provider: 'google' as any });
    const filtered = filterUnconfiguredWebTools(mockTools);
    const names = filtered.map(t => t.name);
    expect(names).toContain('web_search');
  });

  it('preserves all non-web tools regardless of config', () => {
    const filtered = filterUnconfiguredWebTools(mockTools);
    expect(filtered.length).toBe(2); // read_file + write_file
    expect(filtered.every(t => !WEB_TOOLS.has(t.name))).toBe(true);
  });
});
