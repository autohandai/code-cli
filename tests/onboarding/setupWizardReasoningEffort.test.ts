/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Use vi.hoisted() to ensure mock functions are available when vi.mock is hoisted
const {
  mockShowModal, mockShowInput, mockShowPassword, mockShowConfirm,
  mockPathExists, mockReadJson, mockReadFile, mockWriteFile,
  mockCheckWorkspaceSafety, mockPrintDangerousWorkspaceWarning,
  mockChangeLanguage, mockDetectLocale, mockFetch
} = vi.hoisted(() => ({
  mockShowModal: vi.fn(),
  mockShowInput: vi.fn(),
  mockShowPassword: vi.fn(),
  mockShowConfirm: vi.fn(),
  mockPathExists: vi.fn(),
  mockReadJson: vi.fn(),
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn(),
  mockCheckWorkspaceSafety: vi.fn(),
  mockPrintDangerousWorkspaceWarning: vi.fn(),
  mockChangeLanguage: vi.fn(),
  mockDetectLocale: vi.fn(),
  mockFetch: vi.fn()
}));

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

// Mock i18n
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

// Import after mocking
import { SetupWizard } from '../../src/onboarding/setupWizard';

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
  // showModal calls: language, provider, reasoning effort, permissions
  mockShowModal
    .mockResolvedValueOnce({ value: 'en' })                     // language
    .mockResolvedValueOnce({ value: 'openai' })                  // provider
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
    vi.stubGlobal('fetch', mockFetch);
  });

  it('should prompt for reasoning effort when provider is OpenAI', async () => {
    setupOpenAIWithReasoningEffort({
      model: 'gpt-5.4',
      reasoningEffort: 'high',
    });

    const wizard = new SetupWizard(testWorkspace);
    const result = await wizard.run({ skipWelcome: true });

    expect(result.success).toBe(true);
    // Verify reasoning effort modal was shown (3rd showModal call after language and provider)
    expect(mockShowModal).toHaveBeenCalledTimes(4); // language, provider, reasoning, permissions
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
});
