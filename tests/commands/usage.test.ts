/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import type { SlashCommandContext } from '../../src/core/slashCommandTypes.js';
import type { LoadedConfig } from '../../src/types.js';
import type { SessionMetadata } from '../../src/session/types.js';

const PROJECT_ROOT = '/Users/test/project';

function makeSession(overrides: Partial<SessionMetadata> = {}): SessionMetadata {
  return {
    sessionId: 'session-1',
    createdAt: '2026-06-01T10:00:00.000Z',
    lastActiveAt: '2026-06-01T11:30:00.000Z',
    closedAt: '2026-06-01T11:30:00.000Z',
    projectPath: PROJECT_ROOT,
    projectName: 'project',
    model: 'gpt-5.5',
    messageCount: 4,
    status: 'completed',
    client: 'terminal',
    usage: {
      totalTokens: 120_000,
      promptTokens: 80_000,
      completionTokens: 40_000,
      turnCount: 2,
      tokenUsageStatus: 'actual',
      updatedAt: '2026-06-01T11:30:00.000Z',
    },
    ...overrides,
  };
}

function makeContext(overrides: Partial<SlashCommandContext> = {}): SlashCommandContext {
  const config: LoadedConfig = {
    configPath: '/tmp/autohand-config.json',
    provider: 'openai',
    openai: {
      apiKey: 'test-key',
      model: 'gpt-5.5',
      reasoningEffort: 'high',
      contextWindow: 258_000,
    },
    permissions: {
      mode: 'interactive',
    },
    auth: {
      token: 'test-token',
      user: {
        id: 'user-1',
        email: 'user@example.com',
        name: 'Test User',
      },
    },
    features: {
      usageV2: true,
      cliUsageV2: true,
    },
  };
  const listSessions = vi.fn(async () => [
    makeSession({
      sessionId: 'session-1',
      createdAt: '2026-06-08T10:00:00.000Z',
      lastActiveAt: '2026-06-08T12:00:00.000Z',
      closedAt: '2026-06-08T12:00:00.000Z',
      usage: {
        totalTokens: 120_000,
        promptTokens: 80_000,
        completionTokens: 40_000,
        turnCount: 2,
        tokenUsageStatus: 'actual',
        updatedAt: '2026-06-08T12:00:00.000Z',
      },
    }),
    makeSession({
      sessionId: 'session-2',
      createdAt: '2026-06-09T10:00:00.000Z',
      lastActiveAt: '2026-06-09T11:00:00.000Z',
      closedAt: '2026-06-09T11:00:00.000Z',
      usage: {
        totalTokens: 80_000,
        promptTokens: 60_000,
        completionTokens: 20_000,
        turnCount: 1,
        tokenUsageStatus: 'actual',
        updatedAt: '2026-06-09T11:00:00.000Z',
      },
    }),
  ]);

  return {
    promptModelSelection: vi.fn(),
    createAgentsFile: vi.fn(),
    resetConversation: vi.fn(),
    sessionManager: {
      getCurrentSession: () => ({ metadata: { sessionId: 'session-1' } }),
      listSessions,
    } as unknown as SlashCommandContext['sessionManager'],
    memoryManager: {} as SlashCommandContext['memoryManager'],
    permissionManager: {} as SlashCommandContext['permissionManager'],
    llm: {
      isAvailable: vi.fn(async () => true),
    } as unknown as SlashCommandContext['llm'],
    workspaceRoot: '/Users/test/project',
    provider: 'openai',
    model: 'gpt-5.5',
    config,
    getContextPercentLeft: () => 90,
    getContextWindow: () => 258_000,
    getTotalTokensUsed: () => 37_500,
    getTokenUsageStatus: () => 'actual',
    isFeatureEnabled: (key, localDefault) => key === 'cli_usage_v2' || key === 'usage_v2' || Boolean(localDefault),
    ...overrides,
  };
}

describe('/usage command', () => {
  it('renders the default daily token activity view from project sessions', async () => {
    const { usage } = await import('../../src/commands/usage.js');
    const ctx = makeContext();

    const output = await usage(ctx);

    expect(output).toContain('/usage daily');
    expect(output).toContain('Token activity');
    expect(output).toContain('last 12 months');
    expect(output).toContain('Lifetime');
    expect(output).toContain('200K');
    expect(output).toContain('Peak');
    expect(output).toContain('120K');
    expect(output).toContain('Streak');
    expect(output).toContain('Longest task');
    expect(output).toContain('Su');
    expect(output).toContain('Mo');
    expect(output).toContain('Less');
    expect(output).toContain('More');
    expect(output).toContain('daily · weekly · monthly');
    expect(output).not.toContain('Provider limits:');
    expect(ctx.sessionManager.listSessions).toHaveBeenCalledWith({ project: PROJECT_ROOT });
  });

  it('renders weekly when /usage weekly is requested', async () => {
    const { usage } = await import('../../src/commands/usage.js');

    const output = await usage(makeContext(), ['weekly']);

    expect(output).toContain('/usage weekly');
    expect(output).toContain('last 52 weeks');
    expect(output).toContain('daily · weekly · monthly');
  });

  it('renders monthly when /usage monthly is requested', async () => {
    const { usage } = await import('../../src/commands/usage.js');

    const output = await usage(makeContext(), ['monthly']);

    expect(output).toContain('/usage monthly');
    expect(output).toContain('last 12 months');
    expect(output).toContain('Mo');
    expect(output).toContain('daily · weekly · monthly');
  });

  it('renders the v2 usage dashboard when usage_v2 is enabled', async () => {
    const { usage } = await import('../../src/commands/usage.js');

    const output = await usage(makeContext({
      config: {
        configPath: '/tmp/autohand-config.json',
        provider: 'openai',
        openai: {
          apiKey: 'test-key',
          model: 'gpt-5.5',
          reasoningEffort: 'high',
          contextWindow: 258_000,
        },
        permissions: {
          mode: 'interactive',
        },
        auth: {
          token: 'test-token',
          user: {
            id: 'user-1',
            email: 'user@example.com',
            name: 'Test User',
          },
        },
        features: {
          usageV2: true,
          cliUsageV2: false,
        },
      },
      isFeatureEnabled: (key) => key === 'usage_v2',
    }));

    expect(output).toContain('Model:');
    expect(output).toContain('gpt-5.5 (reasoning high)');
    expect(output).toContain('Provider:');
    expect(output).toContain('openai');
    expect(output).toContain('Directory:');
    expect(output).toContain('/Users/test/project');
    expect(output).toContain('Permissions:');
    expect(output).toContain('Workspace (on-request)');
    expect(output).toContain('Account:');
    expect(output).toContain('Test User (user@example.com)');
    expect(output).toContain('Context window:');
    expect(output).toContain('90% left');
    expect(output).toContain('37.5K used / 258K');
    expect(output).toContain('Provider limits:');
    expect(output).toContain('not reported by provider');
  });

  it('uses the current config provider and model after a provider switch', async () => {
    const { usage } = await import('../../src/commands/usage.js');
    const output = await usage(makeContext({
      provider: 'openrouter',
      model: 'minimax/minimax-m2.5:free',
      config: {
        configPath: '/tmp/autohand-config.json',
        provider: 'openai',
        openai: {
          apiKey: 'test-key',
          model: 'gpt-5.5',
          reasoningEffort: 'high',
          contextWindow: 1_050_000,
        },
        features: {
          usageV2: true,
          cliUsageV2: false,
        },
      },
      getContextWindow: undefined,
      getTotalTokensUsed: () => 32_300,
      getContextPercentLeft: () => 97,
      isFeatureEnabled: (key) => key === 'usage_v2',
    }));

    expect(output).toContain('Model:');
    expect(output).toContain('gpt-5.5 (reasoning high)');
    expect(output).not.toContain('minimax/minimax-m2.5:free');
    expect(output).toContain('Provider:');
    expect(output).toContain('openai');
    expect(output).not.toContain('openrouter');
    expect(output).toContain('32.3K used / 1.1M');
  });

  it('stays hidden when both usage dashboards are disabled', async () => {
    const { usage } = await import('../../src/commands/usage.js');

    const output = await usage(makeContext({
      config: {
        configPath: '/tmp/autohand-config.json',
        provider: 'openai',
        features: {
          usageV2: false,
          cliUsageV2: false,
        },
      },
      isFeatureEnabled: () => false,
    }));

    expect(output).toBe('The /usage activity dashboard is behind cli_usage_v2. Run /experiments enable cli_usage_v2, then /usage again. No restart required.');
  });
});
