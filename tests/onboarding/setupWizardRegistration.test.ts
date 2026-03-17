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
  mockChangeLanguage, mockDetectLocale, mockFetch,
  mockInitiateDeviceAuth, mockPollDeviceAuth, mockSaveConfig
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
  mockFetch: vi.fn(),
  mockInitiateDeviceAuth: vi.fn(),
  mockPollDeviceAuth: vi.fn(),
  mockSaveConfig: vi.fn(),
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

// Mock auth client
vi.mock('../../src/auth/index.js', () => ({
  getAuthClient: () => ({
    initiateDeviceAuth: mockInitiateDeviceAuth,
    pollDeviceAuth: mockPollDeviceAuth,
  }),
}));

// Mock config save
vi.mock('../../src/config.js', async (importOriginal) => {
  const original = await importOriginal() as Record<string, unknown>;
  return {
    ...original,
    saveConfig: mockSaveConfig,
  };
});

// Mock 'open' package for browser opening
vi.mock('open', () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));

// Mock chalk
vi.mock('chalk', () => ({
  default: {
    gray: (s: string) => s,
    cyan: Object.assign((s: string) => s, { bold: (s: string) => s, underline: (s: string) => s }),
    white: Object.assign((s: string) => s, { bold: (s: string) => s }),
    green: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
    bold: Object.assign((s: string) => s, { yellow: (s: string) => s }),
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
 * Set up mock sequence for a full cloud provider flow WITH registration step.
 *
 * Flow order:
 *  1. Language modal
 *  2. Provider modal
 *  3. API key (password)
 *  4. API validation (fetch)
 *  5. Model (input)
 *  6. Permissions modal + remember confirm
 *  7. Telemetry confirm
 *  8. AutoReport confirm
 *  9. Preferences confirm
 * 10. Advanced gate confirm
 * 11. Agents confirm
 * 12. Registration confirm (NEW)
 * 13. Review confirm
 */
function setupCloudWithRegistration(opts: {
  provider: string;
  apiKey: string;
  model: string;
  wantsRegistration: boolean;
  deviceAuthSuccess?: boolean;
}) {
  // showModal calls: language, provider, permissions
  mockShowModal
    .mockResolvedValueOnce({ value: 'en' })               // language
    .mockResolvedValueOnce({ value: opts.provider })        // provider
    .mockResolvedValueOnce({ value: 'interactive' });       // permissions

  // showPassword: API key
  mockShowPassword.mockResolvedValueOnce(opts.apiKey);

  // showInput: model
  mockShowInput.mockResolvedValueOnce(opts.model);

  // showConfirm calls: remember, telemetry, autoReport, prefs, advanced, agents, registration, review
  mockShowConfirm
    .mockResolvedValueOnce(true)                            // remember session
    .mockResolvedValueOnce(true)                            // telemetry
    .mockResolvedValueOnce(true)                            // autoReport
    .mockResolvedValueOnce(false)                           // preferences (skip)
    .mockResolvedValueOnce(false)                           // advanced (skip)
    .mockResolvedValueOnce(false)                           // agents (skip)
    .mockResolvedValueOnce(opts.wantsRegistration)          // registration
    .mockResolvedValueOnce(true);                           // review confirm

  // Mock fetch for API validation
  mockFetch.mockResolvedValue({ ok: true, status: 200 });
}

describe('SetupWizard — Registration Step', () => {
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
    mockSaveConfig.mockResolvedValue(undefined);
    vi.stubGlobal('fetch', mockFetch);
  });

  it('should skip registration when user declines', async () => {
    setupCloudWithRegistration({
      provider: 'openrouter',
      apiKey: 'sk-test-key-long-enough',
      model: 'nvidia/nemotron-3-super-120b-a12b:free',
      wantsRegistration: false,
    });

    const wizard = new SetupWizard(testWorkspace);
    const result = await wizard.run({ skipWelcome: true });

    expect(result.success).toBe(true);
    expect(result.skippedSteps).toContain('registration');
    // Device auth should NOT be called
    expect(mockInitiateDeviceAuth).not.toHaveBeenCalled();
  });

  it('should run device auth flow when user accepts registration', async () => {
    setupCloudWithRegistration({
      provider: 'openrouter',
      apiKey: 'sk-test-key-long-enough',
      model: 'nvidia/nemotron-3-super-120b-a12b:free',
      wantsRegistration: true,
    });

    // Mock successful device auth
    mockInitiateDeviceAuth.mockResolvedValueOnce({
      success: true,
      deviceCode: 'test-device-code',
      userCode: 'ABC-123',
      verificationUri: 'https://autohand.ai/cli-auth',
      verificationUriComplete: 'https://autohand.ai/cli-auth?code=ABC-123&source=cli',
      expiresIn: 300,
      interval: 2,
    });

    // First poll: pending, second poll: authorized
    mockPollDeviceAuth
      .mockResolvedValueOnce({ success: false, status: 'pending' })
      .mockResolvedValueOnce({
        success: true,
        status: 'authorized',
        token: 'test-session-token',
        user: { id: 'user-1', email: 'test@example.com', name: 'Test User' },
      });

    const wizard = new SetupWizard(testWorkspace);
    const result = await wizard.run({ skipWelcome: true });

    expect(result.success).toBe(true);
    expect(result.skippedSteps).not.toContain('registration');
    expect(mockInitiateDeviceAuth).toHaveBeenCalledOnce();
    expect(mockPollDeviceAuth).toHaveBeenCalledWith('test-device-code');
  });

  it('should handle device auth initiation failure gracefully', async () => {
    setupCloudWithRegistration({
      provider: 'openrouter',
      apiKey: 'sk-test-key-long-enough',
      model: 'nvidia/nemotron-3-super-120b-a12b:free',
      wantsRegistration: true,
    });

    // Mock failed device auth initiation
    mockInitiateDeviceAuth.mockResolvedValueOnce({
      success: false,
      error: 'Service unavailable',
    });

    const wizard = new SetupWizard(testWorkspace);
    const result = await wizard.run({ skipWelcome: true });

    // Should still complete the wizard even if registration fails
    expect(result.success).toBe(true);
    expect(mockPollDeviceAuth).not.toHaveBeenCalled();
  });

  it('should handle device auth expiry gracefully', async () => {
    setupCloudWithRegistration({
      provider: 'openrouter',
      apiKey: 'sk-test-key-long-enough',
      model: 'nvidia/nemotron-3-super-120b-a12b:free',
      wantsRegistration: true,
    });

    mockInitiateDeviceAuth.mockResolvedValueOnce({
      success: true,
      deviceCode: 'test-device-code',
      userCode: 'XYZ-789',
      verificationUri: 'https://autohand.ai/cli-auth',
      verificationUriComplete: 'https://autohand.ai/cli-auth?code=XYZ-789&source=cli',
      expiresIn: 300,
      interval: 2,
    });

    // Poll returns expired
    mockPollDeviceAuth.mockResolvedValueOnce({
      success: false,
      status: 'expired',
    });

    const wizard = new SetupWizard(testWorkspace);
    const result = await wizard.run({ skipWelcome: true });

    // Should still complete the wizard
    expect(result.success).toBe(true);
  });

  it('should skip registration in quickSetup mode', async () => {
    // In quickSetup: language, provider, API key, model, permissions, remember, telemetry, autoReport, agents
    // Registration should be skipped entirely
    mockShowModal
      .mockResolvedValueOnce({ value: 'en' })
      .mockResolvedValueOnce({ value: 'openrouter' })
      .mockResolvedValueOnce({ value: 'interactive' });

    mockShowPassword.mockResolvedValueOnce('sk-test-key-long-enough');
    mockShowInput.mockResolvedValueOnce('nvidia/nemotron-3-super-120b-a12b:free');

    // quickSetup: remember, telemetry, autoReport, agents (no prefs, no advanced, no registration, no review)
    mockShowConfirm
      .mockResolvedValueOnce(true)   // remember session
      .mockResolvedValueOnce(true)   // telemetry
      .mockResolvedValueOnce(true)   // autoReport
      .mockResolvedValueOnce(false); // agents (skip)

    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    const wizard = new SetupWizard(testWorkspace);
    const result = await wizard.run({ skipWelcome: true, quickSetup: true });

    expect(result.success).toBe(true);
    expect(result.skippedSteps).toContain('registration');
    expect(mockInitiateDeviceAuth).not.toHaveBeenCalled();
  });

  it('should store auth data in result config when registration succeeds', async () => {
    setupCloudWithRegistration({
      provider: 'openrouter',
      apiKey: 'sk-test-key-long-enough',
      model: 'nvidia/nemotron-3-super-120b-a12b:free',
      wantsRegistration: true,
    });

    mockInitiateDeviceAuth.mockResolvedValueOnce({
      success: true,
      deviceCode: 'dev-code',
      userCode: 'REG-456',
      verificationUri: 'https://autohand.ai/cli-auth',
      verificationUriComplete: 'https://autohand.ai/cli-auth?code=REG-456&source=cli',
      expiresIn: 300,
      interval: 2,
    });

    mockPollDeviceAuth.mockResolvedValueOnce({
      success: true,
      status: 'authorized',
      token: 'auth-token-123',
      user: { id: 'u-1', email: 'dev@autohand.ai', name: 'Dev User' },
    });

    const wizard = new SetupWizard(testWorkspace);
    const result = await wizard.run({ skipWelcome: true });

    expect(result.success).toBe(true);
    expect(result.config.auth).toEqual({
      token: 'auth-token-123',
      user: { id: 'u-1', email: 'dev@autohand.ai', name: 'Dev User' },
    });
  });

  it('should not include auth in config when registration is skipped', async () => {
    setupCloudWithRegistration({
      provider: 'openrouter',
      apiKey: 'sk-test-key-long-enough',
      model: 'nvidia/nemotron-3-super-120b-a12b:free',
      wantsRegistration: false,
    });

    const wizard = new SetupWizard(testWorkspace);
    const result = await wizard.run({ skipWelcome: true });

    expect(result.success).toBe(true);
    expect(result.config.auth).toBeUndefined();
  });
});
