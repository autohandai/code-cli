/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { formatActiveAgents, handler } from '../../src/commands/agents.js';
import type { ActiveAgentRecord } from '../../src/session/ActiveAgentRegistry.js';
import type { LoadedConfig } from '../../src/types.js';
import { AgentRegistry } from '../../src/core/agents/AgentRegistry.js';

describe('/agents command', () => {
  it('lists plain-text definitions from the active session configuration', async () => {
    const registry = AgentRegistry.getInstance();
    const previousPaths = registry.getExternalPaths();
    const config: LoadedConfig = {
      configPath: '/selected-repository/config.json',
      externalAgents: { enabled: true, paths: ['/selected-repository/agents'] },
    };
    try {
      const output = await handler(['definitions'], { config });
      expect(registry.getExternalPaths()).toEqual(['/selected-repository/agents']);
      expect(output).toContain('Sub-Agent Definitions');
      expect(output).not.toContain('🤖');
    } finally {
      registry.setExternalPaths(previousPaths);
    }
  });

  it.each([['help'], ['--help']])('documents session inspection and global heartbeat scopes for %s', async (arg) => {
    const output = await handler([arg]);
    expect(output).toContain('/agents view');
    expect(output).toContain('/agents --once');
    expect(output).toContain('/team view');
    expect(output).toContain('/squad view');
    expect(output).toContain('c cancel');
    expect(output).toContain('m message');
    expect(output).toContain('queued');
  });
  it('opens the session run inspector without entering the global heartbeat view', async () => {
    const onToggleAgentRunsView = vi.fn();
    expect(await handler(['view'], { onToggleAgentRunsView })).toContain('Session agent inspector');
    expect(onToggleAgentRunsView).toHaveBeenCalledWith(true);
  });
  it('formats the empty active agents state with the definitions hint', () => {
    const output = formatActiveAgents([]);

    expect(output).toContain('No active Autohand agents found.');
    expect(output).toContain('autohand agents definitions');
    expect(output).toContain('/agents definitions');
  });

  it('formats active agent rows', () => {
    const output = formatActiveAgents([
      createRecord({
        status: 'working',
        projectName: 'cli-3',
        sessionId: 'abcdef123456',
        model: 'openai/gpt-4o-mini',
        contextPercent: 42,
        sessionTokensUsed: 1500,
        pid: 9876,
      }),
    ], new Date('2026-01-01T00:00:05.000Z'));

    expect(output).toContain('Active Autohand Agents');
    expect(output).toContain('working');
    expect(output).toContain('cli-3');
    expect(output).toContain('abcdef12');
    expect(output).toContain('42%');
    expect(output).toContain('1.5k');
    expect(output).toContain('9876');
  });

  it('shows sanitized phase, instruction, command, and recent paths', () => {
    const output = formatActiveAgents([
      createRecord({
        activity: {
          phase: 'running_command',
          instruction: '\u001b[2JRefactor auth\u202E',
          command: 'bun test',
          pathsWritten: ['src/auth.ts', 'tests/auth.test.ts'],
        },
      }),
    ]);

    expect(output).toContain('running command');
    expect(output).toContain('Refactor auth');
    expect(output).toContain('bun test');
    expect(output).toContain('src/auth.ts');
    expect(output).not.toContain('\u001b[2J');
    expect(output).not.toContain('\u202E');
  });

  it('prints a static snapshot when --once is passed', async () => {
    const registry = {
      listActive: async () => [createRecord({ sessionId: 'static123456' })],
    };

    const output = await handler(['--once'], { registry: registry as any });

    expect(output).toContain('static12');
  });

  it('saves an Autohand AI default provider and model for future teammates', async () => {
    const config: LoadedConfig = {
      configPath: '/tmp/autohand.json',
      provider: 'autohandai',
      autohandai: { plan: 'cloud', model: 'fantail' },
    };
    const persistConfig = vi.fn().mockResolvedValue(undefined);

    const output = await handler(['provider'], {
      config,
      chooseTeamProvider: vi.fn().mockResolvedValue('autohandai'),
      chooseTeamModel: vi.fn().mockResolvedValue('fantail'),
      confirmTeamModelSelection: vi.fn().mockResolvedValue(true),
      persistConfig,
    });

    expect(config.teams).toEqual({
      defaultProvider: 'autohandai',
      defaultModel: 'fantail',
    });
    expect(persistConfig).toHaveBeenCalledWith(config);
    expect(output).toContain('Autohand AI · fantail');
  });

  it('saves a named sub-agent exception without replacing the team default', async () => {
    const config: LoadedConfig = {
      configPath: '/tmp/autohand.json',
      provider: 'autohandai',
      autohandai: { plan: 'cloud', model: 'fantail' },
      teams: { defaultProvider: 'autohandai', defaultModel: 'fantail' },
    };

    await handler(['provider', 'reviewer'], {
      config,
      chooseTeamProvider: vi.fn().mockResolvedValue('anthropic'),
      chooseTeamModel: vi.fn().mockResolvedValue('claude-sonnet-5'),
      confirmTeamModelSelection: vi.fn().mockResolvedValue(true),
      persistConfig: vi.fn().mockResolvedValue(undefined),
    });

    expect(config.teams).toEqual({
      defaultProvider: 'autohandai',
      defaultModel: 'fantail',
      agentModelOverrides: {
        reviewer: { provider: 'anthropic', model: 'claude-sonnet-5' },
      },
    });
  });
});

function createRecord(overrides: Partial<ActiveAgentRecord> = {}): ActiveAgentRecord {
  return {
    version: 1,
    pid: 123,
    sessionId: 'session-id',
    workspaceRoot: '/repo',
    projectName: 'repo',
    provider: 'openrouter',
    model: 'openai/gpt-4o-mini',
    mode: 'interactive',
    status: 'idle',
    startedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    messageCount: 2,
    contextPercent: 87,
    tokensUsed: 1234,
    tokensUsageStatus: 'actual',
    sessionTokensUsed: 1234,
    ...overrides,
  };
}
