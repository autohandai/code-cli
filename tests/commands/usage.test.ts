/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import type { SlashCommandContext } from '../../src/core/slashCommandTypes.js';
import type { LoadedConfig } from '../../src/types.js';

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
    },
  };

  return {
    promptModelSelection: vi.fn(),
    createAgentsFile: vi.fn(),
    resetConversation: vi.fn(),
    sessionManager: {
      getCurrentSession: () => ({ metadata: { sessionId: 'session-1' } }),
      listSessions: vi.fn(async () => []),
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
    isFeatureEnabled: (key) => key === 'usage_v2',
    ...overrides,
  };
}

describe('/usage command', () => {
  it('renders the v2 usage dashboard when usage_v2 is enabled', async () => {
    const { usage } = await import('../../src/commands/usage.js');

    const output = await usage(makeContext());

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
        },
      },
      getContextWindow: undefined,
      getTotalTokensUsed: () => 32_300,
      getContextPercentLeft: () => 97,
    }));

    expect(output).toContain('Model:');
    expect(output).toContain('gpt-5.5 (reasoning high)');
    expect(output).not.toContain('minimax/minimax-m2.5:free');
    expect(output).toContain('Provider:');
    expect(output).toContain('openai');
    expect(output).not.toContain('openrouter');
    expect(output).toContain('32.3K used / 1.1M');
  });

  it('stays hidden behind usage_v2', async () => {
    const { usage } = await import('../../src/commands/usage.js');

    const output = await usage(makeContext({
      config: {
        configPath: '/tmp/autohand-config.json',
        provider: 'openai',
        features: {
          usageV2: false,
        },
      },
      isFeatureEnabled: () => false,
    }));

    expect(output).toBe('The /usage dashboard is behind usage_v2. Run /features enable usage_v2, then /usage again. No restart required.');
  });
});
