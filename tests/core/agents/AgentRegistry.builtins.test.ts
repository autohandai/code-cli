/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentRegistry } from '../../../src/core/agents/AgentRegistry.js';

describe('AgentRegistry built-in agents', () => {
  const tempRoots: string[] = [];

  beforeEach(() => {
    // Reset singleton for clean test state
    (AgentRegistry as any).instance = undefined;
  });

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  async function createTempAgentDirs(): Promise<{ root: string; userDir: string; externalDir: string }> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-agent-registry-'));
    tempRoots.push(root);
    const userDir = path.join(root, 'user-agents');
    const externalDir = path.join(root, 'external-agents');
    await fs.mkdir(userDir, { recursive: true });
    await fs.mkdir(externalDir, { recursive: true });
    return { root, userDir, externalDir };
  }

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
    expect(researcher!.tools).toContain('find');
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

  it('loads external JSON and Markdown agents from configured paths', async () => {
    const { userDir, externalDir } = await createTempAgentDirs();
    await fs.writeFile(path.join(externalDir, 'react-expert.md'), [
      '# React Expert',
      '',
      'Specialized in React performance and hooks.'
    ].join('\n'));
    await fs.writeFile(path.join(externalDir, 'code-reviewer.json'), JSON.stringify({
      description: 'Expert code reviewer',
      systemPrompt: 'Review code with care.',
      tools: ['read_file', 'find'],
      model: 'review-model'
    }));

    const registry = AgentRegistry.getInstance();
    (registry as any).agentsDir = userDir;
    registry.configureExternalAgents({ enabled: true, paths: [externalDir] });
    await registry.loadAgents();

    const markdownAgent = registry.getAgent('react-expert');
    expect(markdownAgent).toMatchObject({
      name: 'react-expert',
      description: 'React Expert',
      source: 'external',
      tools: ['*']
    });
    expect(markdownAgent!.systemPrompt).toContain('Specialized in React');

    const jsonAgent = registry.getAgent('code-reviewer');
    expect(jsonAgent).toMatchObject({
      description: 'Expert code reviewer',
      source: 'external',
      tools: ['read_file', 'find'],
      model: 'review-model'
    });
  });

  it('keeps user agents ahead of external agents with the same name', async () => {
    const { userDir, externalDir } = await createTempAgentDirs();
    await fs.writeFile(path.join(userDir, 'reviewer.md'), '# User Reviewer\n\nUser-owned reviewer.');
    await fs.writeFile(path.join(externalDir, 'reviewer.md'), '# External Reviewer\n\nExternal reviewer.');

    const registry = AgentRegistry.getInstance();
    (registry as any).agentsDir = userDir;
    registry.configureExternalAgents({ enabled: true, paths: [externalDir] });
    await registry.loadAgents();

    const reviewer = registry.getAgent('reviewer');
    expect(reviewer).toMatchObject({
      description: 'User Reviewer',
      source: 'user',
      tools: ['*']
    });
    expect(reviewer!.systemPrompt).toContain('User-owned reviewer');
  });
});
