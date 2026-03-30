/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

var mockShowModal = vi.fn();
var mockShowInput = vi.fn();
var mockShowPassword = vi.fn();
var mockShowConfirm = vi.fn();
var mockSaveConfig = vi.fn();
var mockProbeLlamaCppEnvironment = vi.fn();
var mockInstallLlamaCpp = vi.fn();

vi.mock('../../../src/ui/ink/components/Modal.js', () => ({
  showModal: mockShowModal,
  showInput: mockShowInput,
  showPassword: mockShowPassword,
  showConfirm: mockShowConfirm,
}));

vi.mock('../../../src/config.js', () => ({
  saveConfig: mockSaveConfig,
  getProviderConfig: (config: Record<string, unknown>, provider?: string) => {
    const chosen = provider ?? (config.provider as string | undefined);
    return chosen ? (config[chosen] as Record<string, unknown> | null) ?? null : null;
  },
}));

vi.mock('../../../src/providers/llamaCppSetup.js', () => ({
  probeLlamaCppEnvironment: mockProbeLlamaCppEnvironment,
  installLlamaCpp: mockInstallLlamaCpp,
}));

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

describe('ProviderConfigManager llama.cpp flow', () => {
  let runtime: any;
  let manager: InstanceType<typeof ProviderConfigManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    runtime = {
      workspaceRoot: '/repo',
      config: {
        configPath: '/tmp/config.json',
        provider: 'ollama',
        ollama: { model: 'llama3.2:latest', baseUrl: 'http://localhost:11434' },
        llamacpp: { model: 'local', baseUrl: 'http://localhost:8080', port: 8080 },
      },
      options: {
        model: 'llama3.2:latest'
      },
    };

    manager = new ProviderConfigManager(
      runtime,
      () => ({ setModel: vi.fn(), getName: () => 'ollama' } as any),
      vi.fn(),
      () => runtime.config.provider,
      vi.fn(),
      () => undefined,
      vi.fn(),
      { trackModelSwitch: vi.fn().mockResolvedValue(undefined) } as any,
      {} as any,
      vi.fn(),
      vi.fn(),
      vi.fn(),
    );
  });

  it('does not ask for model id when switching to llama.cpp', async () => {
    mockProbeLlamaCppEnvironment.mockResolvedValue({
      installed: true,
      running: true,
      port: 80,
      baseUrl: 'http://127.0.0.1:80'
    });
    mockShowInput.mockResolvedValue('80');

    await manager.changeProviderModel('llamacpp');

    expect(mockShowInput).toHaveBeenCalledWith(expect.objectContaining({
      title: 'providers.wizard.llamacpp.serverPort',
      defaultValue: '80'
    }));
    expect(mockShowInput).not.toHaveBeenCalledWith(expect.objectContaining({
      title: 'providers.config.enterModelIdToUse'
    }));
    expect(runtime.config.provider).toBe('llamacpp');
    expect(runtime.config.llamacpp.baseUrl).toBe('http://localhost:80');
    expect(runtime.options.model).toBe('local');
    expect(mockSaveConfig).toHaveBeenCalled();
  });
});
