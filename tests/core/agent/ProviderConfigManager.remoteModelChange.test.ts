/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionExecutor } from '../../../src/core/actionExecutor.js';
import type { LLMProvider } from '../../../src/providers/LLMProvider.js';
import { TelemetryManager } from '../../../src/telemetry/TelemetryManager.js';
import type { AgentRuntime } from '../../../src/types.js';

var mockSaveConfig = vi.fn();
var mockCreate = vi.fn();

vi.mock('../../../src/config.js', () => ({
  saveConfig: mockSaveConfig,
  getProviderConfig: (config: Record<string, unknown>, provider?: string) => {
    const chosen = provider ?? (config.provider as string | undefined);
    return chosen ? (config[chosen] as Record<string, unknown> | null) ?? null : null;
  },
}));

vi.mock('../../../src/providers/ProviderFactory.js', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../../src/providers/ProviderFactory.js')
  >();
  return {
    ...actual,
    ProviderFactory: {
      create: mockCreate,
      isValidProvider: actual.ProviderFactory.isValidProvider,
      getRuntimeProviderDisplayName: actual.ProviderFactory.getRuntimeProviderDisplayName,
    },
  };
});

vi.mock('../../../src/i18n/index.js', () => ({
  t: (key: string) => key,
}));

vi.mock('chalk', () => ({
  default: {
    green: (s: string) => s,
    red: (s: string) => s,
    gray: (s: string) => s,
    cyan: (s: string) => s,
    yellow: (s: string) => s,
    white: (s: string) => s,
  },
}));

const { ProviderConfigManager } = await import('../../../src/core/agent/ProviderConfigManager.js');

function createMockLlm(): LLMProvider {
  return {
    complete: vi.fn(async () => ({
      id: 'test-response',
      created: 0,
      content: '',
      raw: null,
    })),
    getName: () => 'openrouter',
    isAvailable: vi.fn(async () => true),
    listModels: vi.fn(async () => []),
    setModel: vi.fn(),
  };
}

describe('ProviderConfigManager.applyModelChangeRemote', () => {
  let runtime: AgentRuntime;
  let manager: InstanceType<typeof ProviderConfigManager>;
  let setLlm: ReturnType<typeof vi.fn>;
  let setActiveProvider: ReturnType<typeof vi.fn>;
  let setDelegator: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mockCreate.mockReturnValue(createMockLlm());

    runtime = {
      workspaceRoot: '/repo',
      config: {
        configPath: '/tmp/config.json',
        provider: 'openrouter',
        openrouter: { apiKey: 'key', model: 'tencent/hy3:free' },
      },
      options: { model: 'tencent/hy3:free' },
    };
    setLlm = vi.fn();
    setActiveProvider = vi.fn();
    setDelegator = vi.fn();

    manager = new ProviderConfigManager(
      runtime,
      createMockLlm,
      setLlm,
      () => runtime.config.provider ?? 'openrouter',
      setActiveProvider,
      () => undefined,
      setDelegator,
      new TelemetryManager({ enabled: false }),
      {} as ActionExecutor,
      vi.fn(),
      vi.fn(),
      vi.fn(),
    );
  });

  it('switches provider and model, persists config, and reinitializes the LLM client', async () => {
    const result = await manager.applyModelChangeRemote('openrouter', 'anthropic/claude-sonnet-4.5');

    expect(result).toEqual({
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet-4.5',
      status: 'applied',
    });
    expect(runtime.options.model).toBe('anthropic/claude-sonnet-4.5');
    expect(runtime.config.openrouter.model).toBe('anthropic/claude-sonnet-4.5');
    expect(mockSaveConfig).toHaveBeenCalledWith(runtime.config);
    expect(setLlm).toHaveBeenCalled();
    expect(setDelegator).toHaveBeenCalled();
    expect(setActiveProvider).toHaveBeenCalledWith('openrouter');
  });

  it('rejects an unrecognized provider without touching runtime state', async () => {
    const result = await manager.applyModelChangeRemote('not-a-real-provider', 'anthropic/claude-sonnet-4.5');

    expect(result.status).toBe('failed');
    expect(result.error).toContain('not-a-real-provider');
    expect(runtime.options.model).toBe('tencent/hy3:free');
    expect(mockSaveConfig).not.toHaveBeenCalled();
    expect(setLlm).not.toHaveBeenCalled();
  });

  it('rejects an unconfigured custom provider without touching runtime state', async () => {
    const initialConfig = structuredClone(runtime.config);
    const initialOptions = structuredClone(runtime.options);

    const result = await manager.applyModelChangeRemote('custom:missing', 'missing/model');

    expect(result).toEqual({
      provider: 'custom:missing',
      model: 'missing/model',
      status: 'failed',
      error: 'Unknown provider: custom:missing',
    });
    expect(runtime.config).toEqual(initialConfig);
    expect(runtime.options).toEqual(initialOptions);
    expect(mockSaveConfig).not.toHaveBeenCalled();
    expect(setLlm).not.toHaveBeenCalled();
    expect(setDelegator).not.toHaveBeenCalled();
    expect(setActiveProvider).not.toHaveBeenCalled();
  });

  it('rejects an empty model id', async () => {
    const result = await manager.applyModelChangeRemote('openrouter', '   ');

    expect(result.status).toBe('failed');
    expect(runtime.options.model).toBe('tencent/hy3:free');
    expect(mockSaveConfig).not.toHaveBeenCalled();
  });

  it('reports failed with the underlying error message if applying throws', async () => {
    mockCreate.mockImplementation(() => {
      throw new Error('OpenRouter rejected the request');
    });

    const result = await manager.applyModelChangeRemote('openrouter', 'anthropic/claude-sonnet-4.5');

    expect(result).toEqual({
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet-4.5',
      status: 'failed',
      error: 'OpenRouter rejected the request',
    });
  });
});
