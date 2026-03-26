/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

var mockShowModal = vi.fn();
var mockShowInput = vi.fn();
var mockShowPassword = vi.fn();
var mockShowConfirm = vi.fn();
var mockPathExists = vi.fn();
var mockReadJson = vi.fn();
var mockReadFile = vi.fn();
var mockWriteFile = vi.fn();
var mockCheckWorkspaceSafety = vi.fn();
var mockPrintDangerousWorkspaceWarning = vi.fn();
var mockChangeLanguage = vi.fn();
var mockDetectLocale = vi.fn();
var mockFetch = vi.fn();
var mockAuthenticateOpenAIChatGPT = vi.fn();

// Mock Modal components
vi.mock('../../src/ui/ink/components/Modal.js', () => ({
  showModal: mockShowModal,
  showInput: mockShowInput,
  showPassword: mockShowPassword,
  showConfirm: mockShowConfirm
}));

// Mock fs-extra default export
vi.mock('fs-extra', () => ({
  default: {
    pathExists: mockPathExists,
    readJson: mockReadJson,
    readFile: mockReadFile,
    writeFile: mockWriteFile,
  },
}));

// Mock workspace safety
vi.mock('../../src/startup/workspaceSafety.js', () => ({
  checkWorkspaceSafety: mockCheckWorkspaceSafety,
  printDangerousWorkspaceWarning: mockPrintDangerousWorkspaceWarning
}));

// Mock i18n — must also mock localeDetector since index.ts re-exports from it
vi.mock('../../src/i18n/localeDetector.js', () => ({
  detectLocale: mockDetectLocale,
  normalizeLocale: vi.fn((l: string) => l),
  isValidLocale: vi.fn(() => true),
  SUPPORTED_LOCALES: ['en', 'fr', 'de', 'es', 'ja'],
  LANGUAGE_DISPLAY_NAMES: {
    en: 'English',
    fr: 'Français (French)',
    de: 'Deutsch (German)',
    es: 'Español (Spanish)',
    ja: '日本語 (Japanese)'
  }
}));

vi.mock('../../src/i18n/index.js', () => ({
  t: (key: string, opts?: Record<string, string | number>) => {
    if (opts) {
      let result = key;
      for (const [k, v] of Object.entries(opts)) {
        result = result.replace(`{{${k}}}`, String(v));
      }
      return result;
    }
    return key;
  },
  changeLanguage: mockChangeLanguage,
  detectLocale: mockDetectLocale,
  SUPPORTED_LOCALES: ['en', 'fr', 'de', 'es', 'ja'],
  LANGUAGE_DISPLAY_NAMES: {
    en: 'English',
    fr: 'Français (French)',
    de: 'Deutsch (German)',
    es: 'Español (Spanish)',
    ja: '日本語 (Japanese)'
  }
}));

// Mock auth client (registration step)
vi.mock('../../src/auth/index.js', () => ({
  getAuthClient: () => ({
    initiateDeviceAuth: vi.fn().mockResolvedValue({ success: false, error: 'not configured' }),
    pollDeviceAuth: vi.fn().mockResolvedValue({ success: false, status: 'pending' }),
  }),
}));

vi.mock('../../src/providers/openaiAuth.js', () => ({
  authenticateOpenAIChatGPT: mockAuthenticateOpenAIChatGPT,
  isChatGPTAuthExpired: vi.fn(() => false),
}));

// Mock 'open' package
vi.mock('open', () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));

// Mock chalk
vi.mock('chalk', () => ({
  default: {
    gray: (s: string) => s,
    cyan: Object.assign((s: string) => s, { bold: (s: string) => s }),
    white: Object.assign((s: string) => s, { bold: (s: string) => s }),
    green: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
  }
}));

// Mock console to suppress output during tests
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'clear').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

// Mock process.stdin for "Press Enter to continue"
vi.spyOn(process.stdin, 'once').mockImplementation((event: any, callback: any) => {
  if (event === 'data') {
    setImmediate(callback);
  }
  return process.stdin;
});

// Import after mocking — use dynamic import to ensure mocks are applied
// even when other test files have already loaded the real modules.
const { SetupWizard } = await import('../../src/onboarding/setupWizard');

/**
 * Set up mock sequence for OpenAI cloud provider flow with reasoning effort.
 *
 * Flow order:
 *  1. Language modal
 *  2. Provider modal (openai)
 *  3. API key (password)
 *  4. API validation (fetch)
 *  5. Model (input)
 *  6. Reasoning effort modal (NEW - only for OpenAI)
 *  7. Permissions modal + remember confirm
 *  8. Telemetry confirm
 *  9. AutoReport confirm
 * 10. Preferences confirm
 * 11. Advanced gate confirm
 * 12. Agents confirm
 * 13. Registration confirm
 * 14. Review confirm
 */
function setupOpenAIWithReasoningEffort(opts: {
  model: string;
  reasoningEffort: string;
}) {
  // showModal calls: language, provider, auth mode, reasoning effort, permissions
  mockShowModal
    .mockResolvedValueOnce({ value: 'en' })                     // language
    .mockResolvedValueOnce({ value: 'openai' })                  // provider
    .mockResolvedValueOnce({ value: 'api-key' })                 // auth mode
    .mockResolvedValueOnce({ value: opts.reasoningEffort })      // reasoning effort
    .mockResolvedValueOnce({ value: 'interactive' });            // permissions

  // showPassword: API key
  mockShowPassword.mockResolvedValueOnce('sk-test-openai-key-long');

  // showInput: model
  mockShowInput.mockResolvedValueOnce(opts.model);

  // showConfirm calls: remember, telemetry, autoReport, prefs, advanced, agents, registration, review
  mockShowConfirm
    .mockResolvedValueOnce(true)   // remember session
    .mockResolvedValueOnce(true)   // telemetry
    .mockResolvedValueOnce(true)   // autoReport
    .mockResolvedValueOnce(false)  // preferences (skip)
    .mockResolvedValueOnce(false)  // advanced (skip)
    .mockResolvedValueOnce(false)  // agents (skip)
    .mockResolvedValueOnce(false)  // registration (skip)
    .mockResolvedValueOnce(true);  // review confirm
}

/**
 * Set up mock sequence for non-OpenAI cloud provider (no reasoning effort step).
 */
function setupNonOpenAICloud(provider: string, model: string) {
  // showModal calls: language, provider, permissions (NO reasoning effort)
  mockShowModal
    .mockResolvedValueOnce({ value: 'en' })           // language
    .mockResolvedValueOnce({ value: provider })         // provider
    .mockResolvedValueOnce({ value: 'interactive' });   // permissions

  // showPassword: API key
  mockShowPassword.mockResolvedValueOnce('sk-test-key-long-enough');

  // showInput: model
  mockShowInput.mockResolvedValueOnce(model);

  // showConfirm calls: remember, telemetry, autoReport, prefs, advanced, agents, registration, review
  mockShowConfirm
    .mockResolvedValueOnce(true)   // remember session
    .mockResolvedValueOnce(true)   // telemetry
    .mockResolvedValueOnce(true)   // autoReport
    .mockResolvedValueOnce(false)  // preferences (skip)
    .mockResolvedValueOnce(false)  // advanced (skip)
    .mockResolvedValueOnce(false)  // agents (skip)
    .mockResolvedValueOnce(false)  // registration (skip)
    .mockResolvedValueOnce(true);  // review confirm
}

describe('SetupWizard — Reasoning Effort', () => {
  const testWorkspace = '/test/workspace';

  beforeEach(() => {
    vi.clearAllMocks();
    mockShowModal.mockReset();
    mockShowInput.mockReset();
    mockShowPassword.mockReset();
    mockShowConfirm.mockReset();
    mockPathExists.mockResolvedValue(false);
    mockWriteFile.mockResolvedValue(undefined);
    mockCheckWorkspaceSafety.mockReturnValue({ safe: true });
    mockDetectLocale.mockReturnValue({ locale: 'en', source: 'fallback' });
    mockChangeLanguage.mockResolvedValue(undefined);
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    (globalThis as Record<string, unknown>).fetch = mockFetch;
  });

  it('should prompt for reasoning effort when provider is OpenAI', async () => {
    setupOpenAIWithReasoningEffort({
      model: 'gpt-5.4',
      reasoningEffort: 'high',
    });

    const wizard = new SetupWizard(testWorkspace);
    const result = await wizard.run({ skipWelcome: true });

    expect(result.success).toBe(true);
    expect(mockShowModal).toHaveBeenCalledTimes(5);
  });

  it('should include reasoningEffort in final config for OpenAI', async () => {
    setupOpenAIWithReasoningEffort({
      model: 'gpt-5.4-pro',
      reasoningEffort: 'medium',
    });

    const wizard = new SetupWizard(testWorkspace);
    const result = await wizard.run({ skipWelcome: true });

    expect(result.success).toBe(true);
    expect(result.config?.openai).toBeDefined();
    expect((result.config?.openai as any)?.reasoningEffort).toBe('medium');
  });

  it('should NOT prompt reasoning effort for non-OpenAI providers', async () => {
    setupNonOpenAICloud('openrouter', 'anthropic/claude-3.5-sonnet');

    const wizard = new SetupWizard(testWorkspace);
    const result = await wizard.run({ skipWelcome: true });

    expect(result.success).toBe(true);
    // Only 3 showModal calls (language, provider, permissions) - NO reasoning effort
    expect(mockShowModal).toHaveBeenCalledTimes(3);
  });

  it.each(['none', 'low', 'medium', 'high', 'xhigh'])(
    'should accept reasoning effort level: %s',
    async (level) => {
      setupOpenAIWithReasoningEffort({
        model: 'gpt-5.4',
        reasoningEffort: level,
      });

      const wizard = new SetupWizard(testWorkspace);
      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(true);
      expect((result.config?.openai as any)?.reasoningEffort).toBe(level);
    },
  );

  it('should show reasoning effort in review summary', async () => {
    setupOpenAIWithReasoningEffort({
      model: 'gpt-5.4',
      reasoningEffort: 'high',
    });

    const wizard = new SetupWizard(testWorkspace);
    const result = await wizard.run({ skipWelcome: true });

    expect(result.success).toBe(true);
    // The t() mock returns the key with interpolation, so the review log should contain the i18n key
    const logCalls = (console.log as any).mock.calls.map((c: any[]) => c[0]).filter(Boolean);
    const hasReasoningLog = logCalls.some((msg: string) =>
      typeof msg === 'string' && msg.includes('reasoningEffort')
    );
    expect(hasReasoningLog).toBe(true);
  });

  it('should default to gpt-5.4 for OpenAI default model', async () => {
    setupOpenAIWithReasoningEffort({
      model: 'gpt-5.4',
      reasoningEffort: 'medium',
    });

    const wizard = new SetupWizard(testWorkspace);
    const result = await wizard.run({ skipWelcome: true });

    expect(result.success).toBe(true);
    expect((result.config?.openai as any)?.model).toBe('gpt-5.4');
  });

  it('should allow openai chatgpt auth mode during onboarding', async () => {
    mockAuthenticateOpenAIChatGPT.mockResolvedValue({
      accessToken: 'chatgpt-access-token',
      refreshToken: 'chatgpt-refresh-token',
      accountId: 'chatgpt-account-123',
    });

    mockShowModal
      .mockResolvedValueOnce({ value: 'en' })
      .mockResolvedValueOnce({ value: 'openai' })
      .mockResolvedValueOnce({ value: 'chatgpt' })
      .mockResolvedValueOnce({ value: 'high' })
      .mockResolvedValueOnce({ value: 'interactive' });

    mockShowInput.mockResolvedValueOnce('gpt-5.4');

    mockShowConfirm
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const wizard = new SetupWizard(testWorkspace);
    const result = await wizard.run({ skipWelcome: true });

    expect(result.success).toBe(true);
    expect(mockAuthenticateOpenAIChatGPT).toHaveBeenCalledOnce();
    expect(result.config.openai?.authMode).toBe('chatgpt');
    expect(result.config.openai?.chatgptAuth?.accountId).toBe('chatgpt-account-123');
  });

  it('prints a visible sign-in status before requesting chatgpt auth', async () => {
    mockAuthenticateOpenAIChatGPT.mockResolvedValue({
      accessToken: 'chatgpt-access-token',
      refreshToken: 'chatgpt-refresh-token',
      accountId: 'chatgpt-account-123',
    });

    mockShowModal
      .mockResolvedValueOnce({ value: 'en' })
      .mockResolvedValueOnce({ value: 'openai' })
      .mockResolvedValueOnce({ value: 'chatgpt' })
      .mockResolvedValueOnce({ value: 'high' })
      .mockResolvedValueOnce({ value: 'interactive' });

    mockShowInput.mockResolvedValueOnce('gpt-5.4');

    mockShowConfirm
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const wizard = new SetupWizard(testWorkspace);
    await wizard.run({ skipWelcome: true });

    const logCalls = (console.log as any).mock.calls.map((c: any[]) => c[0]).filter(Boolean);
    expect(logCalls.some((msg: string) =>
      typeof msg === 'string' && msg.includes('providers.openaiAuth.starting')
    )).toBe(true);
  });

  it('should print the auth error message when chatgpt sign-in fails', async () => {
    mockAuthenticateOpenAIChatGPT.mockRejectedValueOnce(new Error('device auth forbidden'));

    mockShowModal
      .mockResolvedValueOnce({ value: 'en' })
      .mockResolvedValueOnce({ value: 'openai' })
      .mockResolvedValueOnce({ value: 'chatgpt' });

    const wizard = new SetupWizard(testWorkspace);

    await expect(wizard.run({ skipWelcome: true })).rejects.toThrow('device auth forbidden');

    const logCalls = (console.log as any).mock.calls.map((c: any[]) => c[0]).filter(Boolean);
    expect(logCalls.some((msg: string) =>
      typeof msg === 'string' && msg.includes('providers.openaiAuth.failed')
    )).toBe(true);
  });
});
