/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import {
  loadAgentInstructionFiles,
  updateAgentContextUsage,
  type AgentContextRuntimeHost,
} from '../../../src/core/agent/AgentContextRuntime.js';

describe('loadAgentInstructionFiles agent profile instructions', () => {
  let tempDir: string;
  let previousAutohandHome: string | undefined;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-profile-instructions-'));
    previousAutohandHome = process.env.AUTOHAND_HOME;
  });

  afterEach(async () => {
    if (previousAutohandHome === undefined) {
      delete process.env.AUTOHAND_HOME;
    } else {
      process.env.AUTOHAND_HOME = previousAutohandHome;
    }
    await fs.remove(tempDir);
  });

  function hostFor(workspaceRoot: string): AgentContextRuntimeHost {
    return {
      activeProvider: 'openai',
      runtime: {
        options: {},
        workspaceRoot,
        config: {},
      },
      getParallelismLimit: () => 3,
    } as unknown as AgentContextRuntimeHost;
  }

  it('loads workspace AGENTS.md and AUTOHAND_HOME AGENTS.md as separate instruction sections', async () => {
    const workspaceRoot = path.join(tempDir, 'workspace');
    const agentHome = path.join(tempDir, 'agent-home');
    await fs.ensureDir(workspaceRoot);
    await fs.ensureDir(agentHome);
    await fs.writeFile(path.join(workspaceRoot, 'AGENTS.md'), '# Project\n\nUse project rules.');
    await fs.writeFile(path.join(agentHome, 'AGENTS.md'), '# Profile Map\n\nRead profile/PERSONA.md when style matters.');
    process.env.AUTOHAND_HOME = agentHome;

    const instructions = await loadAgentInstructionFiles(hostFor(workspaceRoot));

    expect(instructions).toHaveLength(2);
    expect(instructions[0]).toContain('## Project Instructions (AGENTS.md)');
    expect(instructions[0]).toContain('Use project rules.');
    expect(instructions[1]).toContain('## Agent Profile Instructions ($AUTOHAND_HOME/AGENTS.md)');
    expect(instructions[1]).toContain('profile/PERSONA.md');
  });

  it('does not load default user AGENTS.md unless AUTOHAND_HOME is explicit', async () => {
    const workspaceRoot = path.join(tempDir, 'workspace');
    await fs.ensureDir(workspaceRoot);
    await fs.writeFile(path.join(workspaceRoot, 'AGENTS.md'), '# Project\n\nUse project rules.');
    delete process.env.AUTOHAND_HOME;

    const instructions = await loadAgentInstructionFiles(hostFor(workspaceRoot));

    expect(instructions).toHaveLength(1);
    expect(instructions[0]).toContain('## Project Instructions (AGENTS.md)');
    expect(instructions[0]).not.toContain('Agent Profile Instructions');
  });

  it('bare mode skips implicit AGENTS.md and provider instruction discovery', async () => {
    const workspaceRoot = path.join(tempDir, 'workspace');
    const agentHome = path.join(tempDir, 'agent-home');
    await fs.ensureDir(workspaceRoot);
    await fs.ensureDir(agentHome);
    await fs.writeFile(path.join(workspaceRoot, 'AGENTS.md'), '# Project\n\nUse project rules.');
    await fs.writeFile(path.join(workspaceRoot, 'CLAUDE.md'), '# Claude\n\nUse provider rules.');
    await fs.writeFile(path.join(agentHome, 'AGENTS.md'), '# Profile\n\nUse profile rules.');
    process.env.AUTOHAND_HOME = agentHome;

    const host = hostFor(workspaceRoot);
    host.runtime.options.bare = true;

    await expect(loadAgentInstructionFiles(host)).resolves.toEqual([]);
  });
});

describe('updateAgentContextUsage composer display', () => {
  function makeUsageHost(): AgentContextRuntimeHost {
    return {
      activeProvider: 'ollama',
      contextPercentLeft: 100,
      contextWindow: 100,
      currentTurnHadUnavailableUsage: false,
      runtime: {
        options: { model: 'gemma4:12b-mlx' },
        workspaceRoot: '/tmp/workspace',
        config: { provider: 'ollama' },
      },
      conversation: {
        addSystemNote: vi.fn(),
        history: vi.fn(() => []),
        reset: vi.fn(),
      },
      ignoreFilter: { isIgnored: vi.fn(() => false) },
      inkRenderer: {
        getQueueCount: vi.fn(() => 0),
        setContextPercent: vi.fn(),
      },
      memoryManager: { getContextMemories: vi.fn(async () => '') },
      mentionResolver: {
        clear: vi.fn(),
        flush: vi.fn(() => null),
      },
      persistentInput: { getQueueLength: vi.fn(() => 0) },
      projectManager: { getKnowledge: vi.fn(async () => null) },
      skillsRegistry: { getActiveSkills: vi.fn(() => []) },
      buildSystemPrompt: vi.fn(async () => ''),
      emitStatus: vi.fn(),
      generateSessionBootstrap: vi.fn(async () => ''),
      getParallelismLimit: vi.fn(() => 3),
      recordExploration: vi.fn(),
      updateContextUsage: vi.fn(),
    } as unknown as AgentContextRuntimeHost;
  }

  it('keeps message-only context estimates out of the idle Ink composer', () => {
    const host = makeUsageHost();

    updateAgentContextUsage(host, [
      { role: 'system', content: 'x'.repeat(400) },
    ]);

    expect(host.contextPercentLeft).toBeLessThan(100);
    expect(host.inkRenderer?.setContextPercent).not.toHaveBeenCalled();
    expect(host.emitStatus).toHaveBeenCalled();
  });

  it('updates the Ink composer for prepared request estimates with tools', () => {
    const host = makeUsageHost();

    updateAgentContextUsage(
      host,
      [{ role: 'user', content: 'hello' }],
      [{
        name: 'read_file',
        description: 'Read a file',
        parameters: { type: 'object', properties: {} },
      }] as never
    );

    expect(host.inkRenderer?.setContextPercent).toHaveBeenCalledWith(host.contextPercentLeft);
  });
});
