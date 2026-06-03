/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  AgentRegistry,
  looksLikeInlineAgents,
  parseInlineAgents,
} from '../../../src/core/agents/AgentRegistry.js';

describe('looksLikeInlineAgents', () => {
  it('treats values starting with { as inline JSON', () => {
    expect(looksLikeInlineAgents('{"reviewer":{}}')).toBe(true);
    expect(looksLikeInlineAgents('   {"reviewer":{}}  ')).toBe(true);
  });

  it('treats filesystem paths as not inline JSON', () => {
    expect(looksLikeInlineAgents('./agents')).toBe(false);
    expect(looksLikeInlineAgents('/home/user/.agents')).toBe(false);
    expect(looksLikeInlineAgents('~/agents')).toBe(false);
  });
});

describe('parseInlineAgents', () => {
  it('parses Claude Code style agent JSON (prompt -> systemPrompt)', () => {
    const agents = parseInlineAgents(
      JSON.stringify({
        reviewer: { description: 'Reviews code', prompt: 'You are a code reviewer' },
      })
    );

    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      name: 'reviewer',
      description: 'Reviews code',
      systemPrompt: 'You are a code reviewer',
      tools: ['*'],
    });
  });

  it('accepts an already-parsed object', () => {
    const agents = parseInlineAgents({
      tester: { description: 'Writes tests', prompt: 'Write comprehensive tests' },
    });
    expect(agents[0].name).toBe('tester');
  });

  it('supports optional model and array tools', () => {
    const agents = parseInlineAgents(
      JSON.stringify({
        builder: {
          description: 'Builds features',
          prompt: 'Build it',
          tools: ['read_file', 'write_file'],
          model: 'anthropic/claude-3.5-sonnet',
        },
      })
    );
    expect(agents[0]).toMatchObject({
      tools: ['read_file', 'write_file'],
      model: 'anthropic/claude-3.5-sonnet',
    });
  });

  it('normalizes comma-separated string tools', () => {
    const agents = parseInlineAgents({
      builder: {
        description: 'Builds features',
        prompt: 'Build it',
        tools: 'read_file, write_file ,fff_grep',
      },
    });
    expect(agents[0].tools).toEqual(['read_file', 'write_file', 'fff_grep']);
  });

  it('parses multiple agents', () => {
    const agents = parseInlineAgents({
      reviewer: { description: 'r', prompt: 'rp' },
      tester: { description: 't', prompt: 'tp' },
    });
    expect(agents.map((a) => a.name).sort()).toEqual(['reviewer', 'tester']);
  });

  it('throws a clear error on malformed JSON', () => {
    expect(() => parseInlineAgents('{broken json')).toThrow(/invalid json/i);
  });

  it('throws when a required field is missing', () => {
    expect(() =>
      parseInlineAgents(JSON.stringify({ reviewer: { description: 'only desc' } }))
    ).toThrow(/prompt/i);
  });

  it('throws when no agents are defined', () => {
    expect(() => parseInlineAgents('{}')).toThrow();
  });

  it('throws when the top-level value is not an object map', () => {
    expect(() => parseInlineAgents('[]')).toThrow();
  });
});

describe('AgentRegistry session agents', () => {
  const tempRoots: string[] = [];

  beforeEach(() => {
    (AgentRegistry as unknown as { instance?: AgentRegistry }).instance = undefined;
  });

  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
    );
  });

  it('registers session agents with source "session"', () => {
    const registry = AgentRegistry.getInstance();
    registry.setSessionAgents(
      parseInlineAgents({ reviewer: { description: 'Reviews code', prompt: 'Review' } })
    );

    const reviewer = registry.getAgent('reviewer');
    expect(reviewer).toMatchObject({
      name: 'reviewer',
      source: 'session',
      description: 'Reviews code',
      systemPrompt: 'Review',
    });
    expect(registry.getAgentsBySource('session')).toHaveLength(1);
  });

  it('keeps session agents after loadAgents() reloads file-based agents', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-session-agents-'));
    tempRoots.push(root);
    const userDir = path.join(root, 'user-agents');
    await fs.mkdir(userDir, { recursive: true });

    const registry = AgentRegistry.getInstance();
    (registry as unknown as { agentsDir: string }).agentsDir = userDir;
    registry.setSessionAgents(
      parseInlineAgents({ ephemeral: { description: 'temp', prompt: 'temp prompt' } })
    );

    await registry.loadAgents();

    expect(registry.getAgent('ephemeral')).toMatchObject({ source: 'session' });
    expect(registry.getAllAgents().some((a) => a.name === 'ephemeral')).toBe(true);
  });

  it('session agents take precedence over file-based agents with the same name', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-session-agents-'));
    tempRoots.push(root);
    const userDir = path.join(root, 'user-agents');
    await fs.mkdir(userDir, { recursive: true });
    await fs.writeFile(path.join(userDir, 'reviewer.md'), '# File Reviewer\n\nFrom disk.');

    const registry = AgentRegistry.getInstance();
    (registry as unknown as { agentsDir: string }).agentsDir = userDir;
    registry.setSessionAgents(
      parseInlineAgents({ reviewer: { description: 'Session Reviewer', prompt: 'override' } })
    );
    await registry.loadAgents();

    const reviewer = registry.getAgent('reviewer');
    expect(reviewer).toMatchObject({ source: 'session', description: 'Session Reviewer' });
    // getAllAgents must not list the same name twice
    const reviewers = registry.getAllAgents().filter((a) => a.name === 'reviewer');
    expect(reviewers).toHaveLength(1);
    expect(reviewers[0].source).toBe('session');
  });

  it('clearSessionAgents removes injected agents', () => {
    const registry = AgentRegistry.getInstance();
    registry.setSessionAgents(
      parseInlineAgents({ reviewer: { description: 'd', prompt: 'p' } })
    );
    expect(registry.getAgent('reviewer')).toBeDefined();
    registry.clearSessionAgents();
    expect(registry.getAgent('reviewer')).toBeUndefined();
    expect(registry.getAgentsBySource('session')).toHaveLength(0);
  });

  it('setSessionAgents replaces any previously injected agents', () => {
    const registry = AgentRegistry.getInstance();
    registry.setSessionAgents(parseInlineAgents({ a: { description: 'a', prompt: 'a' } }));
    registry.setSessionAgents(parseInlineAgents({ b: { description: 'b', prompt: 'b' } }));
    expect(registry.getAgent('a')).toBeUndefined();
    expect(registry.getAgent('b')).toBeDefined();
  });
});
