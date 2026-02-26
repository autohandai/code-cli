/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AgentRegistry } from '../../../src/core/agents/AgentRegistry.js';

describe('AgentRegistry built-in agents', () => {
  beforeEach(() => {
    // Reset singleton for clean test state
    (AgentRegistry as any).instance = undefined;
  });

  it('should load built-in agents', async () => {
    const registry = AgentRegistry.getInstance();
    await registry.loadAgents();
    const builtins = registry.getAgentsBySource('builtin');
    expect(builtins.length).toBeGreaterThanOrEqual(6);
  });

  it('should include all 6 expected built-in agent names', async () => {
    const registry = AgentRegistry.getInstance();
    await registry.loadAgents();
    const builtins = registry.getAgentsBySource('builtin');
    const names = builtins.map((a) => a.name);
    expect(names).toContain('researcher');
    expect(names).toContain('code-cleaner');
    expect(names).toContain('todo-resolver');
    expect(names).toContain('docs-writer');
    expect(names).toContain('tester');
    expect(names).toContain('reviewer');
  });

  it('should parse frontmatter for description and tools', async () => {
    const registry = AgentRegistry.getInstance();
    await registry.loadAgents();
    const researcher = registry.getAgent('researcher');
    expect(researcher).toBeDefined();
    expect(researcher!.description).toContain('searching and understanding');
    expect(researcher!.tools).toContain('read_file');
    expect(researcher!.tools).toContain('search');
    expect(researcher!.source).toBe('builtin');
  });

  it('should not overwrite user agents with built-ins', async () => {
    const registry = AgentRegistry.getInstance();
    // Simulate a user agent with the same name already loaded
    const agents = (registry as any).agents as Map<string, any>;
    agents.set('researcher', {
      name: 'researcher',
      path: '/fake/user/researcher.md',
      source: 'user',
      description: 'User version',
      systemPrompt: 'custom',
      tools: [],
    });
    await registry.loadBuiltinAgents();
    const researcher = registry.getAgent('researcher');
    expect(researcher!.source).toBe('user');
    expect(researcher!.description).toBe('User version');
  });
});
