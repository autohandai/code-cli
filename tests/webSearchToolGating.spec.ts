/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests that only web_search is excluded from the LLM tool list
 * when no reliable search provider is configured. Direct URL and repository
 * tools do not depend on a search provider and must remain available.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { configureSearch, isSearchConfigured } from '../src/actions/web.js';
import type { FunctionDefinition } from '../src/types.js';

/**
 * Simulates the tool gating logic that should exist in agent.ts.
 * web_search should be excluded when no search provider is configured.
 */
function filterUnconfiguredWebTools(tools: FunctionDefinition[]): FunctionDefinition[] {
  if (isSearchConfigured()) {
    return tools;
  }
  return tools.filter(t => t.name !== 'web_search');
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
    expect(names).toContain('fetch_url');
    expect(names).toContain('web_repo');
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
    expect(filtered.map((tool) => tool.name)).toEqual([
      'read_file',
      'fetch_url',
      'web_repo',
      'write_file',
    ]);
  });
});
