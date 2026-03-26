/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

var mockShowModal = vi.fn();
var mockShowInput = vi.fn();
var mockShowPassword = vi.fn();
var mockSaveConfig = vi.fn();
var mockEnsureOpenAIChatGPTAuth = vi.fn();
var mockAuthenticateOpenAIChatGPT = vi.fn();

vi.mock('../../../src/ui/ink/components/Modal.js', () => ({
  showModal: mockShowModal,
  showInput: mockShowInput,
  showPassword: mockShowPassword,
}));

vi.mock('../../../src/config.js', () => ({
  saveConfig: mockSaveConfig,
  getProviderConfig: (config: Record<string, unknown>, provider?: string) => {
    const chosen = provider ?? (config.provider as string | undefined);
    return chosen ? (config[chosen] as Record<string, unknown> | null) ?? null : null;
  },
}));

vi.mock('../../../src/providers/openaiAuth.js', () => ({
  ensureOpenAIChatGPTAuth: mockEnsureOpenAIChatGPTAuth,
  authenticateOpenAIChatGPT: mockAuthenticateOpenAIChatGPT,
  isChatGPTAuthExpired: vi.fn(() => false),
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

// Dynamic import ensures mocks are applied even when the module cache
// has been populated by other test files in the same Bun process.
const { ProviderConfigManager } = await import('../../../src/core/agent/ProviderConfigManager.js');

describe('ProviderConfigManager openai auth mode', () => {
  let runtime: any;
  let manager: ProviderConfigManager;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    runtime = {
      config: {
        configPath: '/tmp/config.json',
        provider: 'openrouter',
        openrouter: { apiKey: 'test', model: 'anthropic/claude-sonnet-4' },
      },
      options: {},
    };

    manager = new ProviderConfigManager(
      runtime,
      () => ({ setModel: vi.fn(), getName: () => 'openrouter' } as any),
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

  it('configures openai with chatgpt auth mode', async () => {
    mockAuthenticateOpenAIChatGPT.mockResolvedValue({
      accessToken: 'chatgpt-access-token',
      refreshToken: 'chatgpt-refresh-token',
      accountId: 'chatgpt-account-123',
    });

    mockShowModal
      .mockResolvedValueOnce({ value: 'chatgpt' })
      .mockResolvedValueOnce({ value: 'gpt-5.4' })
      .mockResolvedValueOnce({ value: 'high' });

    await (manager as any).configureOpenAI();

    expect(runtime.config.openai.authMode).toBe('chatgpt');
    expect(runtime.config.openai.chatgptAuth.accountId).toBe('chatgpt-account-123');
    expect(mockAuthenticateOpenAIChatGPT).toHaveBeenCalledOnce();
    expect(mockSaveConfig).toHaveBeenCalledOnce();
  });

  it('prints a visible sign-in status before starting chatgpt auth', async () => {
    mockAuthenticateOpenAIChatGPT.mockResolvedValue({
      accessToken: 'chatgpt-access-token',
      refreshToken: 'chatgpt-refresh-token',
      accountId: 'chatgpt-account-123',
    });

    mockShowModal
      .mockResolvedValueOnce({ value: 'chatgpt' })
      .mockResolvedValueOnce({ value: 'gpt-5.4' })
      .mockResolvedValueOnce({ value: 'high' });

    await (manager as any).configureOpenAI();

    const logCalls = consoleLogSpy.mock.calls.map((c: any[]) => c[0]).filter(Boolean);
    expect(logCalls.some((msg: string) =>
      typeof msg === 'string' && msg.includes('providers.openaiAuth.starting')
    )).toBe(true);
  });

  it('considers openai chatgpt auth mode configured', () => {
    runtime.config.openai = {
      authMode: 'chatgpt',
      model: 'gpt-5.4',
      chatgptAuth: {
        accessToken: 'chatgpt-access-token',
        accountId: 'chatgpt-account-123',
      },
    };

    expect(manager.isProviderConfigured('openai')).toBe(true);
  });
});
