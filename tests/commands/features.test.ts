/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SlashCommandContext } from '../../src/core/slashCommandTypes.js';
import type { LoadedConfig } from '../../src/types.js';
import type { ShowModalOptions } from '../../src/ui/ink/components/Modal.js';

const mockShowModal = vi.fn();
const mockSaveConfig = vi.fn();
const mockLoadRemoteFeatureFlags = vi.fn();

vi.mock('../../src/ui/ink/components/Modal.js', () => ({
  showModal: mockShowModal,
}));

vi.mock('../../src/config.js', () => ({
  saveConfig: mockSaveConfig,
  getProviderConfig: (config: LoadedConfig, provider: keyof LoadedConfig) => config[provider],
}));

vi.mock('../../src/features/RemoteFeatureFlagManager.js', () => ({
  loadRemoteFeatureFlags: mockLoadRemoteFeatureFlags,
}));

function makeConfig(overrides: Partial<LoadedConfig> = {}): LoadedConfig {
  return {
    configPath: '/tmp/autohand-config.json',
    provider: 'openrouter',
    ...overrides,
  };
}

describe('/experiments command', () => {
  beforeEach(() => {
    mockShowModal.mockReset();
    mockSaveConfig.mockReset();
    mockLoadRemoteFeatureFlags.mockReset();
    mockLoadRemoteFeatureFlags.mockResolvedValue(null);
  });

  it('returns a list in non-interactive subcommand mode', async () => {
    const { features } = await import('../../src/commands/features.js');

    const output = await features({ config: makeConfig() }, ['list']);

    expect(output).toContain('mcp');
    expect(output).toContain('prompt_suggestions');
    expect(mockShowModal).not.toHaveBeenCalled();
  });

  it('opens the checkbox list for interactive list mode', async () => {
    const { features } = await import('../../src/commands/features.js');
    const config = makeConfig({
      features: {
        usageV2: false,
      },
      telemetry: {
        enabled: false,
      },
    });

    mockShowModal.mockImplementation(async (options: ShowModalOptions) => {
      options.onToggle?.({ label: 'Usage v2', value: 'usage_v2' }, true);
      options.onToggle?.({ label: 'Telemetry', value: 'telemetry' }, true);
      return { label: 'Telemetry', value: 'telemetry' };
    });

    const output = await features({ config, interactive: true }, ['list']);

    expect(mockShowModal).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringContaining('Experiments'),
      multiSelect: true,
    }));
    expect(config.features?.usageV2).toBe(true);
    expect(config.telemetry?.enabled).toBe(true);
    expect(output).toBe('Enabled 2 features: usage_v2, telemetry.');
    expect(mockSaveConfig).toHaveBeenCalledTimes(2);
  });

  it('enables a feature and persists config', async () => {
    const { features } = await import('../../src/commands/features.js');
    const config = makeConfig({ mcp: { enabled: false } });

    const output = await features({ config }, ['enable', 'mcp']);

    expect(output).toContain('Enabled mcp');
    expect(config.mcp?.enabled).toBe(true);
    expect(mockSaveConfig).toHaveBeenCalledWith(config);
  });

  it('enables usage_v2 on the active config without requiring restart', async () => {
    const { features } = await import('../../src/commands/features.js');
    const { usage } = await import('../../src/commands/usage.js');
    const config = makeConfig({
      provider: 'openai',
      openai: {
        apiKey: 'test-key',
        model: 'gpt-5.5',
        contextWindow: 258_000,
      },
      features: {
        usageV2: false,
      },
    });

    const enableOutput = await features({ config }, ['enable', 'usage_v2']);
    const usageCtx: SlashCommandContext = {
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
      workspaceRoot: '/tmp/workspace',
      provider: 'openai',
      model: 'gpt-5.5',
      config,
      getContextPercentLeft: () => 100,
      getContextWindow: () => 258_000,
      getTotalTokensUsed: () => 0,
      getTokenUsageStatus: () => 'actual',
    };
    const usageOutput = await usage(usageCtx);

    expect(enableOutput).toBe('Enabled usage_v2.');
    expect(config.features?.usageV2).toBe(true);
    expect(mockSaveConfig).toHaveBeenCalledWith(config);
    expect(usageOutput).toContain('Context window:');
    expect(usageOutput).not.toContain('No restart required');
  });

  it('enables usage_v2 locally even when a remote flag with the same id is off', async () => {
    const { features } = await import('../../src/commands/features.js');
    const { usage } = await import('../../src/commands/usage.js');
    const config = makeConfig({
      provider: 'openai',
      openai: {
        apiKey: 'test-key',
        model: 'gpt-5.5',
        contextWindow: 258_000,
      },
      features: {
        usageV2: false,
      },
    });
    mockLoadRemoteFeatureFlags.mockResolvedValue({
      success: true,
      environment: 'production',
      evaluatedAt: '2026-01-01T00:00:00.000Z',
      ttlSeconds: 300,
      flags: [{
        key: 'usage_v2',
        enabled: false,
        reason: 'rollout_miss',
        userOverridable: true,
      }],
    });

    const enableOutput = await features({ config }, ['enable', 'usage_v2']);
    const usageCtx: SlashCommandContext = {
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
      workspaceRoot: '/tmp/workspace',
      provider: 'openai',
      model: 'gpt-5.5',
      config,
      isFeatureEnabled: (_key, localDefault) => localDefault ?? false,
      getContextPercentLeft: () => 100,
      getContextWindow: () => 258_000,
      getTotalTokensUsed: () => 0,
      getTokenUsageStatus: () => 'actual',
    };

    const usageOutput = await usage(usageCtx);

    expect(enableOutput).toBe('Enabled usage_v2.');
    expect(config.features?.usageV2).toBe(true);
    expect(usageOutput).toContain('Context window:');
  });

  it('opens an interactive checkbox list by default', async () => {
    const { features } = await import('../../src/commands/features.js');

    mockShowModal.mockResolvedValue(null);
    const output = await features({ config: makeConfig() }, []);

    expect(output).toBeNull();
    expect(mockShowModal).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringContaining('Experiments'),
      multiSelect: true,
    }));
  });

  it('lets users opt out of a remote-enabled feature', async () => {
    const { features } = await import('../../src/commands/features.js');
    const config = makeConfig();
    mockLoadRemoteFeatureFlags.mockResolvedValue({
      success: true,
      environment: 'production',
      evaluatedAt: '2026-01-01T00:00:00.000Z',
      ttlSeconds: 300,
      flags: [{
        key: 'remote_search',
        enabled: true,
        reason: 'match',
        userOverridable: true,
      }],
    });

    const output = await features({ config }, ['disable', 'remote_search']);

    expect(output).toContain('Disabled remote_search locally');
    expect(config.features?.remoteOverrides?.remote_search).toBe('off');
    expect(mockSaveConfig).toHaveBeenCalledWith(config);
  });

  it('clears a remote opt-out when enabling the flag', async () => {
    const { features } = await import('../../src/commands/features.js');
    const config = makeConfig({
      features: {
        remoteOverrides: { remote_search: 'off' },
      },
    });
    mockLoadRemoteFeatureFlags.mockResolvedValue({
      success: true,
      environment: 'production',
      evaluatedAt: '2026-01-01T00:00:00.000Z',
      ttlSeconds: 300,
      flags: [{
        key: 'remote_search',
        enabled: true,
        reason: 'match',
        userOverridable: true,
      }],
    });

    const output = await features({ config }, ['enable', 'remote_search']);

    expect(output).toContain('Following remote state for remote_search');
    expect(config.features?.remoteOverrides?.remote_search).toBeUndefined();
    expect(mockSaveConfig).toHaveBeenCalledWith(config);
  });

  it('refreshes remote flags on demand', async () => {
    const { features } = await import('../../src/commands/features.js');
    mockLoadRemoteFeatureFlags.mockResolvedValue({
      success: true,
      environment: 'staging',
      evaluatedAt: '2026-01-01T00:00:00.000Z',
      ttlSeconds: 300,
      flags: [{
        key: 'remote_search',
        enabled: true,
        reason: 'match',
        userOverridable: true,
      }],
    });

    const output = await features({ config: makeConfig() }, ['refresh']);

    expect(mockLoadRemoteFeatureFlags).toHaveBeenCalledWith(expect.any(Object), {
      forceRefresh: true,
      allowCachedFallback: false,
    });
    expect(output).toContain('Downloaded 1 remote feature');
    expect(output).toContain('staging');
  });
});
