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
import { DEFAULT_TOOL_DEFINITIONS } from '../../../src/core/toolManager.js';

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

  async function loadIsolatedRegistry(): Promise<AgentRegistry> {
    const { userDir } = await createTempAgentDirs();
    const registry = AgentRegistry.getInstance();
    (registry as any).agentsDir = userDir;
    await registry.loadAgents();
    return registry;
  }

  it('should load built-in agents', async () => {
    const registry = await loadIsolatedRegistry();
    const builtins = registry.getAgentsBySource('builtin');
    expect(builtins.length).toBeGreaterThanOrEqual(12);
  });

  it('should include the original six and six specialist built-ins', async () => {
    const registry = await loadIsolatedRegistry();
    const builtins = registry.getAgentsBySource('builtin');
    const names = builtins.map((a) => a.name);
    expect(names).toContain('researcher');
    expect(names).toContain('code-cleaner');
    expect(names).toContain('todo-resolver');
    expect(names).toContain('docs-writer');
    expect(names).toContain('tester');
    expect(names).toContain('reviewer');
    expect(names).toContain('autohand-review');
    expect(names).toContain('product-interviewer');
    expect(names).toContain('planner');
    expect(names).toContain('debugger');
    expect(names).toContain('security-auditor');
    expect(names).toContain('release-readiness');
  });

  it('loads Autohand Review as a read-only, evidence-led specialist', async () => {
    const registry = await loadIsolatedRegistry();

    const review = registry.getAgent('autohand-review');

    expect(review).toMatchObject({
      name: 'autohand-review',
      source: 'builtin',
    });
    expect(review?.tools).toEqual(expect.arrayContaining([
      'read_file',
      'find_grep',
      'fff_find',
      'list_tree',
      'git_status',
      'git_diff',
      'git_diff_range',
      'git_log',
    ]));
    expect(review?.tools).not.toEqual(expect.arrayContaining([
      'write_file',
      'run_command',
      'shell',
    ]));
    expect(review?.systemPrompt).toContain('Executive view');
    expect(review?.systemPrompt).toContain('Technical findings');
    expect(review?.systemPrompt).toContain('Forensic appendix');
    expect(review?.systemPrompt).toContain('Evidence boundary');
  });

  it('should parse frontmatter for description and tools', async () => {
    const registry = AgentRegistry.getInstance();
    await registry.loadAgents();
    const researcher = registry.getAgent('researcher');
    expect(researcher).toBeDefined();
    expect(researcher!.description).toContain('searching and understanding');
    expect(researcher!.tools).toContain('read_file');
    expect(researcher!.tools).toContain('find_grep');
    expect(researcher!.tools).toContain('fff_find');
    expect(researcher!.source).toBe('builtin');
  });

  it('ships an offline delivery lifecycle with evidence-based specialist handoffs', async () => {
    const registry = await loadIsolatedRegistry();
    for (const name of ['requirements-translator', 'software-architect', 'implementer']) {
      expect(registry.getAgent(name)?.source).toBe('builtin');
    }
    for (const definition of registry.getAgentsBySource('builtin')) {
      expect(definition.systemPrompt).toContain('## Evidence and handoff');
      expect(definition.systemPrompt).toContain('Never invent a test result');
      expect(definition.systemPrompt).toContain('owned scope');
      expect(definition.model).toBeUndefined();
    }
    expect(registry.getAgent('software-architect')?.systemPrompt).toContain('plain language');
    expect(registry.getAgent('software-architect')?.systemPrompt).toContain('CTO');
    expect(registry.getAgent('tester')?.systemPrompt).toContain('Playwright');
    expect(registry.getAgent('tester')?.systemPrompt).toContain('WebP');
    expect(registry.getAgent('tester')?.tools).toContain('capture_test_evidence');
  });

  it('gives review and cleanup specialists distinct bounded verification contracts', async () => {
    const registry = await loadIsolatedRegistry();
    expect(registry.getAgent('reviewer')?.systemPrompt).toContain('confidence');
    expect(registry.getAgent('reviewer')?.systemPrompt).toContain('Do not post');
    expect(registry.getAgent('reviewer')?.tools).not.toContain('apply_patch');
    expect(registry.getAgent('security-auditor')?.tools).not.toContain('run_command');
    expect(registry.getAgent('code-cleaner')?.systemPrompt).toContain('behavior-preserving');
    expect(registry.getAgent('code-cleaner')?.tools).toContain('run_command');
    expect(registry.getAgent('product-interviewer')?.systemPrompt).toContain('complete: false');
    expect(registry.getAgent('product-interviewer')?.systemPrompt).toContain('complete: true');
  });

  it('declares only real executable runtime tools in bundled allowlists', async () => {
    const registry = await loadIsolatedRegistry();
    const supportedNames = new Set<string>(DEFAULT_TOOL_DEFINITIONS.map((definition) => definition.name));
    const unsupported = registry.getAgentsBySource('builtin').flatMap((agent) => (
      agent.tools.filter((name) => !supportedNames.has(name)).map((name) => `${agent.name}: ${name}`)
    ));
    expect(unsupported).toEqual([]);
  });

  it('keeps discovery, diagnosis, documentation, and backlog work grounded in delivery evidence', async () => {
    const registry = await loadIsolatedRegistry();
    expect(registry.getAgent('researcher')?.systemPrompt).toContain('entrypoint');
    expect(registry.getAgent('debugger')?.systemPrompt).toContain('discriminating');
    expect(registry.getAgent('docs-writer')?.systemPrompt).toContain('executable examples');
    expect(registry.getAgent('todo-resolver')?.systemPrompt).toContain('not authorization');
    expect(registry.getAgent('product-interviewer')?.systemPrompt).toContain('non-goals');
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
      tools: ['read_file', 'find_grep'],
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
      tools: ['read_file', 'find_grep'],
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
