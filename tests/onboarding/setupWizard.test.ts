/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { LoadedConfig } from '../../src/types';

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

// Mock fs-extra default export (source uses `import fse from 'fs-extra'`)
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

// Mock i18n - provide t(), changeLanguage, detectLocale, and constants
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

// Mock auth client (registration step uses device-flow auth)
vi.mock('../../src/auth/index.js', () => ({
  getAuthClient: () => ({
    initiateDeviceAuth: vi.fn().mockResolvedValue({ success: false, error: 'not configured' }),
    pollDeviceAuth: vi.fn().mockResolvedValue({ success: false, status: 'pending' }),
  }),
}));

// Mock 'open' package for browser opening
vi.mock('open', () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));

// Mock chalk (to avoid terminal color issues in tests)
vi.mock('chalk', () => ({
  default: {
    gray: (s: string) => s,
    cyan: { bold: (s: string) => s },
    white: Object.assign((s: string) => s, { bold: (s: string) => s }),
    green: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s
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
 * Helper: set up the standard mock sequence for a cloud provider flow.
 *
 * New full flow (non-quickSetup, skipWelcome):
 *  1. Language modal
 *  2. Workspace safety (mocked to safe)
 *  3. Provider modal
 *  4. API key (password) if cloud
 *  5. API validation (fetch) if cloud
 *  6. Model (input)
 *  7. Connection test (fetch) if local
 *  8. Permissions modal + remember confirm
 *  9. Telemetry confirm
 * 10. AutoReport confirm
 * 11. Preferences confirm
 * 12. Advanced gate confirm
 * 13. Agents confirm
 * 14. Review confirm
 */
function setupCloudProviderMocks(provider: string, apiKey: string, model: string) {
  // showModal calls: language, provider, permissions
  mockShowModal
    .mockResolvedValueOnce({ value: 'en' })           // language
    .mockResolvedValueOnce({ value: provider })         // provider
    .mockResolvedValueOnce({ value: 'interactive' });   // permissions

  // showPassword: API key
  mockShowPassword.mockResolvedValueOnce(apiKey);

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

function setupLocalProviderMocks(provider: string, model: string) {
  // showModal calls: language, provider, permissions
  mockShowModal
    .mockResolvedValueOnce({ value: 'en' })           // language
    .mockResolvedValueOnce({ value: provider })         // provider
    .mockResolvedValueOnce({ value: 'interactive' });   // permissions

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

function setupQuickLocalMocks(provider: string, model: string) {
  // showModal calls: language, provider, permissions
  mockShowModal
    .mockResolvedValueOnce({ value: 'en' })
    .mockResolvedValueOnce({ value: provider })
    .mockResolvedValueOnce({ value: 'interactive' });

  // showInput: model
  mockShowInput.mockResolvedValueOnce(model);

  // showConfirm calls: remember, telemetry, autoReport, agents (no prefs, no advanced, no review in quickSetup)
  mockShowConfirm
    .mockResolvedValueOnce(true)   // remember session
    .mockResolvedValueOnce(true)   // telemetry
    .mockResolvedValueOnce(true)   // autoReport
    .mockResolvedValueOnce(false); // agents (skip)
}

describe('SetupWizard', () => {
  const testWorkspace = '/test/workspace';
  const testConfigPath = '/test/.autohand/config.json';

  beforeEach(() => {
    vi.clearAllMocks();
    mockShowModal.mockReset();
    mockShowInput.mockReset();
    mockShowPassword.mockReset();
    mockShowConfirm.mockReset();
    mockPathExists.mockResolvedValue(false);
    mockWriteFile.mockResolvedValue(undefined);
    // Default: workspace is safe
    mockCheckWorkspaceSafety.mockReturnValue({ safe: true });
    // Default: detect English locale
    mockDetectLocale.mockReturnValue({ locale: 'en', source: 'fallback' });
    mockChangeLanguage.mockResolvedValue(undefined);
    // Default: fetch succeeds (for API validation + connection tests)
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', mockFetch);
  });

  describe('isAlreadyConfigured', () => {
    it('should return false when no config provided', async () => {
      const wizard = new SetupWizard(testWorkspace);
      setupCloudProviderMocks('openrouter', 'sk-test-key-long-enough', 'anthropic/claude-3.5-sonnet');

      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(true);
    });

    it('should skip wizard when config is already complete', async () => {
      const existingConfig: LoadedConfig = {
        configPath: testConfigPath,
        provider: 'openrouter',
        openrouter: {
          apiKey: 'sk-existing-key-long-enough',
          model: 'anthropic/claude-3.5-sonnet'
        }
      };

      const wizard = new SetupWizard(testWorkspace, existingConfig);
      const result = await wizard.run();

      expect(result.success).toBe(true);
      expect(result.skippedSteps).toContain('welcome');
      expect(result.skippedSteps).toContain('provider');
      expect(mockShowModal).not.toHaveBeenCalled();
    });

    it('should run wizard when config exists but provider not configured', async () => {
      const incompleteConfig: LoadedConfig = {
        configPath: testConfigPath,
        provider: 'openrouter'
      };

      const wizard = new SetupWizard(testWorkspace, incompleteConfig);
      setupCloudProviderMocks('openrouter', 'sk-new-key-long-enough', 'anthropic/claude-3.5-sonnet');

      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(true);
      expect(mockShowModal).toHaveBeenCalled();
    });

    it('should run wizard when API key is missing', async () => {
      const configWithoutApiKey: LoadedConfig = {
        configPath: testConfigPath,
        provider: 'openrouter',
        openrouter: {
          model: 'anthropic/claude-3.5-sonnet'
        }
      };

      const wizard = new SetupWizard(testWorkspace, configWithoutApiKey);
      setupCloudProviderMocks('openrouter', 'sk-new-api-key-long', 'anthropic/claude-3.5-sonnet');

      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(true);
      expect(mockShowModal).toHaveBeenCalled();
    });

    it('should run wizard when API key is "replace-me"', async () => {
      const configWithPlaceholder: LoadedConfig = {
        configPath: testConfigPath,
        provider: 'openrouter',
        openrouter: {
          apiKey: 'replace-me',
          model: 'anthropic/claude-3.5-sonnet'
        }
      };

      const wizard = new SetupWizard(testWorkspace, configWithPlaceholder);
      setupCloudProviderMocks('openrouter', 'sk-new-api-key-long', 'anthropic/claude-3.5-sonnet');

      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(true);
      expect(mockShowModal).toHaveBeenCalled();
    });

    it('should run wizard when API key is too short', async () => {
      const configWithShortKey: LoadedConfig = {
        configPath: testConfigPath,
        provider: 'openrouter',
        openrouter: {
          apiKey: 'short',
          model: 'anthropic/claude-3.5-sonnet'
        }
      };

      const wizard = new SetupWizard(testWorkspace, configWithShortKey);

      // Language modal
      mockShowModal.mockResolvedValueOnce({ value: 'en' });
      // Provider modal
      mockShowModal.mockResolvedValueOnce({ value: 'openrouter' });
      // Reject existing short key
      mockShowConfirm.mockResolvedValueOnce(false);
      // New API key
      mockShowPassword.mockResolvedValueOnce('sk-new-valid-api-key');
      // Model
      mockShowInput.mockResolvedValueOnce('anthropic/claude-3.5-sonnet');
      // Permissions modal
      mockShowModal.mockResolvedValueOnce({ value: 'interactive' });
      // Remember, telemetry, autoReport, prefs, advanced, agents, registration, review
      mockShowConfirm
        .mockResolvedValueOnce(true)   // remember
        .mockResolvedValueOnce(true)   // telemetry
        .mockResolvedValueOnce(true)   // autoReport
        .mockResolvedValueOnce(false)  // prefs
        .mockResolvedValueOnce(false)  // advanced
        .mockResolvedValueOnce(false)  // agents
        .mockResolvedValueOnce(false)  // registration (skip)
        .mockResolvedValueOnce(true);  // review

      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(true);
      expect(mockShowModal).toHaveBeenCalled();
    });

    it('should skip wizard for local providers without API key', async () => {
      const localConfig: LoadedConfig = {
        configPath: testConfigPath,
        provider: 'ollama',
        ollama: {
          model: 'llama3.2:latest',
          baseUrl: 'http://localhost:11434'
        }
      };

      const wizard = new SetupWizard(testWorkspace, localConfig);
      const result = await wizard.run();

      expect(result.success).toBe(true);
      expect(result.skippedSteps).toContain('provider');
      expect(mockShowModal).not.toHaveBeenCalled();
    });
  });

  describe('Provider Selection', () => {
    it('should set provider in result config', async () => {
      const wizard = new SetupWizard(testWorkspace);
      setupLocalProviderMocks('ollama', 'llama3.2:latest');

      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(true);
      expect(result.config.provider).toBe('ollama');
    });

    it('should not prompt for API key for local providers', async () => {
      const wizard = new SetupWizard(testWorkspace);
      setupLocalProviderMocks('ollama', 'llama3.2:latest');

      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(true);
      expect(mockShowPassword).not.toHaveBeenCalled();
    });

    it('should prompt for API key for cloud providers', async () => {
      const wizard = new SetupWizard(testWorkspace);
      setupCloudProviderMocks('openrouter', 'sk-test-key-long-enough', 'anthropic/claude-3.5-sonnet');

      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(true);
      expect(mockShowPassword).toHaveBeenCalledTimes(1);
    });
  });

  describe('API Key Handling', () => {
    it('should save API key for OpenRouter', async () => {
      const wizard = new SetupWizard(testWorkspace);
      setupCloudProviderMocks('openrouter', 'sk-or-test-key-long', 'anthropic/claude-3.5-sonnet');

      const result = await wizard.run({ skipWelcome: true });

      expect(result.config.openrouter?.apiKey).toBe('sk-or-test-key-long');
    });

    it('should save API key for OpenAI', async () => {
      const wizard = new SetupWizard(testWorkspace);
      setupCloudProviderMocks('openai', 'sk-openai-test-key', 'gpt-4o');

      const result = await wizard.run({ skipWelcome: true });

      expect(result.config.openai?.apiKey).toBe('sk-openai-test-key');
    });

    it('should offer to use existing API key', async () => {
      const existingConfig: LoadedConfig = {
        configPath: testConfigPath,
        provider: 'openrouter',
        openrouter: {
          apiKey: 'sk-existing-key-long',
          model: '' // Model missing, so wizard should run
        }
      };

      const wizard = new SetupWizard(testWorkspace, existingConfig);

      // Language
      mockShowModal.mockResolvedValueOnce({ value: 'en' });
      // Provider
      mockShowModal.mockResolvedValueOnce({ value: 'openrouter' });
      // Use existing key
      mockShowConfirm.mockResolvedValueOnce(true);
      // Model
      mockShowInput.mockResolvedValueOnce('anthropic/claude-3.5-sonnet');
      // Permissions
      mockShowModal.mockResolvedValueOnce({ value: 'interactive' });
      // Remember, telemetry, autoReport, prefs, advanced, agents, registration, review
      mockShowConfirm
        .mockResolvedValueOnce(true)   // remember
        .mockResolvedValueOnce(true)   // telemetry
        .mockResolvedValueOnce(true)   // autoReport
        .mockResolvedValueOnce(false)  // prefs
        .mockResolvedValueOnce(false)  // advanced
        .mockResolvedValueOnce(false)  // agents
        .mockResolvedValueOnce(false)  // registration (skip)
        .mockResolvedValueOnce(true);  // review

      const result = await wizard.run({ skipWelcome: true, force: true });

      expect(result.config.openrouter?.apiKey).toBe('sk-existing-key-long');
    });
  });

  describe('Model Selection', () => {
    it('should save selected model', async () => {
      const wizard = new SetupWizard(testWorkspace);
      setupCloudProviderMocks('openrouter', 'sk-test-long-key', 'anthropic/claude-sonnet-4-20250514');

      const result = await wizard.run({ skipWelcome: true });

      expect(result.config.openrouter?.model).toBe('anthropic/claude-sonnet-4-20250514');
    });
  });

  describe('Telemetry Preference', () => {
    it('should save telemetry enabled preference', async () => {
      const wizard = new SetupWizard(testWorkspace);
      setupLocalProviderMocks('ollama', 'llama3.2:latest');

      const result = await wizard.run({ skipWelcome: true });

      expect(result.config.telemetry?.enabled).toBe(true);
    });

    it('should save telemetry disabled preference', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockShowModal
        .mockResolvedValueOnce({ value: 'en' })
        .mockResolvedValueOnce({ value: 'ollama' })
        .mockResolvedValueOnce({ value: 'interactive' });
      mockShowInput.mockResolvedValueOnce('llama3.2:latest');
      mockShowConfirm
        .mockResolvedValueOnce(true)   // remember
        .mockResolvedValueOnce(false)  // telemetry disabled
        .mockResolvedValueOnce(true)   // autoReport
        .mockResolvedValueOnce(false)  // prefs
        .mockResolvedValueOnce(false)  // advanced
        .mockResolvedValueOnce(false)  // agents
        .mockResolvedValueOnce(false)  // registration (skip)
        .mockResolvedValueOnce(true);  // review

      const result = await wizard.run({ skipWelcome: true });

      expect(result.config.telemetry?.enabled).toBe(false);
    });
  });

  describe('Preferences', () => {
    it('should skip preferences when user declines', async () => {
      const wizard = new SetupWizard(testWorkspace);
      setupLocalProviderMocks('ollama', 'llama3.2:latest');

      const result = await wizard.run({ skipWelcome: true });

      expect(result.skippedSteps).toContain('preferences');
    });

    it('should save preferences when user configures them', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockShowModal
        .mockResolvedValueOnce({ value: 'en' })
        .mockResolvedValueOnce({ value: 'ollama' })
        .mockResolvedValueOnce({ value: 'interactive' });
      mockShowInput.mockResolvedValueOnce('llama3.2:latest');
      mockShowConfirm
        .mockResolvedValueOnce(true)   // remember
        .mockResolvedValueOnce(true)   // telemetry
        .mockResolvedValueOnce(true)   // autoReport
        .mockResolvedValueOnce(true);  // prefs=yes

      // Theme modal
      mockShowModal.mockResolvedValueOnce({ value: 'dark' });
      mockShowConfirm
        .mockResolvedValueOnce(true)   // autoConfirm
        .mockResolvedValueOnce(false)  // checkForUpdates
        .mockResolvedValueOnce(false)  // advanced
        .mockResolvedValueOnce(false)  // agents
        .mockResolvedValueOnce(false)  // registration (skip)
        .mockResolvedValueOnce(true);  // review

      const result = await wizard.run({ skipWelcome: true });

      expect(result.config.ui?.theme).toBe('dark');
      expect(result.config.ui?.autoConfirm).toBe(true);
      expect(result.config.ui?.checkForUpdates).toBe(false);
    });

    it('should skip preferences in quick setup mode', async () => {
      const wizard = new SetupWizard(testWorkspace);
      setupQuickLocalMocks('ollama', 'llama3.2:latest');

      const result = await wizard.run({ skipWelcome: true, quickSetup: true });

      expect(result.success).toBe(true);
      expect(result.skippedSteps).toContain('preferences');
    });
  });

  describe('AGENTS.md Generation', () => {
    it('should create AGENTS.md when user agrees', async () => {
      mockPathExists.mockImplementation(async (path: string) => {
        if (path === `${testWorkspace}/package.json`) return true;
        return false;
      });
      mockReadJson.mockResolvedValue({
        name: 'test',
        devDependencies: { typescript: '^5.0.0' }
      });

      const wizard = new SetupWizard(testWorkspace);

      mockShowModal
        .mockResolvedValueOnce({ value: 'en' })
        .mockResolvedValueOnce({ value: 'ollama' })
        .mockResolvedValueOnce({ value: 'interactive' });
      mockShowInput.mockResolvedValueOnce('llama3.2:latest');
      mockShowConfirm
        .mockResolvedValueOnce(true)   // remember
        .mockResolvedValueOnce(true)   // telemetry
        .mockResolvedValueOnce(true)   // autoReport
        .mockResolvedValueOnce(false)  // prefs
        .mockResolvedValueOnce(false)  // advanced
        .mockResolvedValueOnce(true)   // agents - CREATE
        .mockResolvedValueOnce(false)  // registration (skip)
        .mockResolvedValueOnce(true);  // review

      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(true);
      expect(result.agentsFileCreated).toBe(true);
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it('should skip AGENTS.md when user declines', async () => {
      const wizard = new SetupWizard(testWorkspace);
      setupLocalProviderMocks('ollama', 'llama3.2:latest');

      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(true);
      expect(result.agentsFileCreated).toBeFalsy();
      expect(result.skippedSteps).toContain('agentsFile');
    });

    it('should ask to overwrite existing AGENTS.md', async () => {
      mockPathExists.mockImplementation(async (path: string) => {
        if (path === `${testWorkspace}/AGENTS.md`) return true;
        if (path === `${testWorkspace}/package.json`) return true;
        return false;
      });
      mockReadJson.mockResolvedValue({ name: 'test' });

      const wizard = new SetupWizard(testWorkspace);

      mockShowModal
        .mockResolvedValueOnce({ value: 'en' })
        .mockResolvedValueOnce({ value: 'ollama' })
        .mockResolvedValueOnce({ value: 'interactive' });
      mockShowInput.mockResolvedValueOnce('llama3.2:latest');
      mockShowConfirm
        .mockResolvedValueOnce(true)   // remember
        .mockResolvedValueOnce(true)   // telemetry
        .mockResolvedValueOnce(true)   // autoReport
        .mockResolvedValueOnce(false)  // prefs
        .mockResolvedValueOnce(false)  // advanced
        .mockResolvedValueOnce(false)  // Don't overwrite AGENTS.md
        .mockResolvedValueOnce(false)  // registration (skip)
        .mockResolvedValueOnce(true);  // review

      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(true);
      expect(result.agentsFileCreated).toBeFalsy();
    });
  });

  describe('Cancellation Handling', () => {
    it('should handle cancellation gracefully', async () => {
      const wizard = new SetupWizard(testWorkspace);

      // First modal (language) succeeds, then provider cancelled
      mockShowModal
        .mockResolvedValueOnce({ value: 'en' })
        .mockRejectedValueOnce({ message: 'cancelled' });

      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(false);
      expect(result.cancelled).toBe(true);
    });

    it('should handle ERR_USE_AFTER_CLOSE', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockShowModal.mockResolvedValueOnce({ value: 'en' });
      const closeError = new Error('readline was closed');
      (closeError as any).code = 'ERR_USE_AFTER_CLOSE';
      mockShowModal.mockRejectedValueOnce(closeError);

      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(false);
      expect(result.cancelled).toBe(true);
    });
  });

  describe('Force Mode', () => {
    it('should run wizard when force is true even if configured', async () => {
      const existingConfig: LoadedConfig = {
        configPath: testConfigPath,
        provider: 'openrouter',
        openrouter: {
          apiKey: 'sk-existing-long-key',
          model: 'anthropic/claude-3.5-sonnet'
        }
      };

      const wizard = new SetupWizard(testWorkspace, existingConfig);
      setupLocalProviderMocks('ollama', 'llama3.2:latest');

      const result = await wizard.run({ skipWelcome: true, force: true });

      expect(result.success).toBe(true);
      expect(result.config.provider).toBe('ollama');
      expect(mockShowModal).toHaveBeenCalled();
    });
  });

  describe('Provider-Specific Base URLs', () => {
    it('should set correct base URL for OpenRouter', async () => {
      const wizard = new SetupWizard(testWorkspace);
      setupCloudProviderMocks('openrouter', 'sk-test-long-key', 'test');

      const result = await wizard.run({ skipWelcome: true });

      expect(result.config.openrouter?.baseUrl).toBe('https://openrouter.ai/api/v1');
    });

    it('should set correct base URL for OpenAI', async () => {
      const wizard = new SetupWizard(testWorkspace);
      setupCloudProviderMocks('openai', 'sk-test-long-key', 'gpt-4o');

      const result = await wizard.run({ skipWelcome: true });

      expect(result.config.openai?.baseUrl).toBe('https://api.openai.com/v1');
    });

    it('should set correct base URL for Ollama', async () => {
      const wizard = new SetupWizard(testWorkspace);
      setupLocalProviderMocks('ollama', 'llama3.2:latest');

      const result = await wizard.run({ skipWelcome: true });

      expect(result.config.ollama?.baseUrl).toBe('http://localhost:11434');
    });
  });

  // ============ NEW FEATURE TESTS ============

  describe('Language Selection', () => {
    it('should set locale in config when language is selected', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockShowModal
        .mockResolvedValueOnce({ value: 'fr' })        // language = French
        .mockResolvedValueOnce({ value: 'ollama' })     // provider
        .mockResolvedValueOnce({ value: 'interactive' }); // permissions
      mockShowInput.mockResolvedValueOnce('llama3.2:latest');
      mockShowConfirm
        .mockResolvedValueOnce(true)   // remember
        .mockResolvedValueOnce(true)   // telemetry
        .mockResolvedValueOnce(true)   // autoReport
        .mockResolvedValueOnce(false)  // prefs
        .mockResolvedValueOnce(false)  // advanced
        .mockResolvedValueOnce(false)  // agents
        .mockResolvedValueOnce(false)  // registration (skip)
        .mockResolvedValueOnce(true);  // review

      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(true);
      expect(result.config.ui?.locale).toBe('fr');
      expect(mockChangeLanguage).toHaveBeenCalledWith('fr');
    });

    it('should not call changeLanguage when detected locale matches selection', async () => {
      mockDetectLocale.mockReturnValue({ locale: 'en', source: 'fallback' });

      const wizard = new SetupWizard(testWorkspace);
      setupLocalProviderMocks('ollama', 'llama3.2:latest');

      await wizard.run({ skipWelcome: true });

      expect(mockChangeLanguage).not.toHaveBeenCalled();
    });

    it('should default to detected locale when modal is cancelled', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockShowModal
        .mockResolvedValueOnce(null)                    // language cancelled
        .mockResolvedValueOnce({ value: 'ollama' })     // provider
        .mockResolvedValueOnce({ value: 'interactive' }); // permissions
      mockShowInput.mockResolvedValueOnce('llama3.2:latest');
      mockShowConfirm
        .mockResolvedValueOnce(true)   // remember
        .mockResolvedValueOnce(true)   // telemetry
        .mockResolvedValueOnce(true)   // autoReport
        .mockResolvedValueOnce(false)  // prefs
        .mockResolvedValueOnce(false)  // advanced
        .mockResolvedValueOnce(false)  // agents
        .mockResolvedValueOnce(false)  // registration (skip)
        .mockResolvedValueOnce(true);  // review

      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(true);
      // Should use detected locale (en) as fallback
      expect(result.config.ui?.locale).toBe('en');
    });
  });

  describe('API Key Validation', () => {
    it('should validate API key via GET /models for cloud providers', async () => {
      const wizard = new SetupWizard(testWorkspace);
      setupCloudProviderMocks('openrouter', 'sk-valid-key-long', 'test-model');

      await wizard.run({ skipWelcome: true });

      // Fetch should have been called for validation
      expect(mockFetch).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/models',
        expect.objectContaining({
          headers: { Authorization: 'Bearer sk-valid-key-long' }
        })
      );
    });

    it('should continue when API key validation fails', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 401 });

      const wizard = new SetupWizard(testWorkspace);
      setupCloudProviderMocks('openrouter', 'sk-bad-key-long-enough', 'test-model');

      const result = await wizard.run({ skipWelcome: true });

      // Should still succeed - validation failure is non-blocking
      expect(result.success).toBe(true);
    });

    it('should continue when API key validation network error', async () => {
      mockFetch.mockRejectedValue(new Error('network error'));

      const wizard = new SetupWizard(testWorkspace);
      setupCloudProviderMocks('openrouter', 'sk-key-long-enough', 'test-model');

      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(true);
    });

    it('should not validate for local providers', async () => {
      const wizard = new SetupWizard(testWorkspace);
      setupLocalProviderMocks('ollama', 'llama3.2:latest');

      await wizard.run({ skipWelcome: true });

      // Fetch should only be called for connection test, not validation
      const validationCalls = mockFetch.mock.calls.filter(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('/models') && call[1]?.headers?.Authorization
      );
      expect(validationCalls.length).toBe(0);
    });
  });

  describe('Connection Test (Local Providers)', () => {
    it('should test Ollama connection', async () => {
      const wizard = new SetupWizard(testWorkspace);
      setupLocalProviderMocks('ollama', 'llama3.2:latest');

      await wizard.run({ skipWelcome: true });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/tags',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it('should test llama.cpp connection', async () => {
      const wizard = new SetupWizard(testWorkspace);
      setupLocalProviderMocks('llamacpp', 'default');

      await wizard.run({ skipWelcome: true });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/health',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it('should test MLX connection', async () => {
      const wizard = new SetupWizard(testWorkspace);
      setupLocalProviderMocks('mlx', 'mlx-community/Llama-3.2-3B-Instruct-4bit');

      await wizard.run({ skipWelcome: true });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/v1/models',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it('should ask to continue when connection fails', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      const wizard = new SetupWizard(testWorkspace);

      mockShowModal
        .mockResolvedValueOnce({ value: 'en' })
        .mockResolvedValueOnce({ value: 'ollama' })
        .mockResolvedValueOnce({ value: 'interactive' });
      mockShowInput.mockResolvedValueOnce('llama3.2:latest');
      // Connection test fails → asks "continue anyway?"
      mockShowConfirm
        .mockResolvedValueOnce(true)   // continue anyway
        .mockResolvedValueOnce(true)   // remember
        .mockResolvedValueOnce(true)   // telemetry
        .mockResolvedValueOnce(true)   // autoReport
        .mockResolvedValueOnce(false)  // prefs
        .mockResolvedValueOnce(false)  // advanced
        .mockResolvedValueOnce(false)  // agents
        .mockResolvedValueOnce(false)  // registration (skip)
        .mockResolvedValueOnce(true);  // review

      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(true);
    });

    it('should cancel when user refuses to continue after failed connection', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      const wizard = new SetupWizard(testWorkspace);

      mockShowModal
        .mockResolvedValueOnce({ value: 'en' })
        .mockResolvedValueOnce({ value: 'ollama' });
      mockShowInput.mockResolvedValueOnce('llama3.2:latest');
      // Connection test fails → asks "continue anyway?" → NO
      mockShowConfirm.mockResolvedValueOnce(false);

      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(false);
      expect(result.cancelled).toBe(true);
    });

    it('should not test connection for cloud providers', async () => {
      const wizard = new SetupWizard(testWorkspace);
      setupCloudProviderMocks('openrouter', 'sk-test-key-long', 'test');

      await wizard.run({ skipWelcome: true });

      // Only the API validation fetch should be called, not a health check
      const healthCalls = mockFetch.mock.calls.filter(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('/api/tags')
      );
      expect(healthCalls.length).toBe(0);
    });
  });

  describe('Permissions Mode', () => {
    it('should save interactive permission mode', async () => {
      const wizard = new SetupWizard(testWorkspace);
      setupLocalProviderMocks('ollama', 'llama3.2:latest');

      const result = await wizard.run({ skipWelcome: true });

      expect(result.config.permissions?.mode).toBe('interactive');
      expect(result.config.permissions?.rememberSession).toBe(true);
    });

    it('should save unrestricted permission mode', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockShowModal
        .mockResolvedValueOnce({ value: 'en' })
        .mockResolvedValueOnce({ value: 'ollama' })
        .mockResolvedValueOnce({ value: 'unrestricted' }); // unrestricted
      mockShowInput.mockResolvedValueOnce('llama3.2:latest');
      mockShowConfirm
        .mockResolvedValueOnce(false)  // remember = false
        .mockResolvedValueOnce(true)   // telemetry
        .mockResolvedValueOnce(true)   // autoReport
        .mockResolvedValueOnce(false)  // prefs
        .mockResolvedValueOnce(false)  // advanced
        .mockResolvedValueOnce(false)  // agents
        .mockResolvedValueOnce(false)  // registration (skip)
        .mockResolvedValueOnce(true);  // review

      const result = await wizard.run({ skipWelcome: true });

      expect(result.config.permissions?.mode).toBe('unrestricted');
      expect(result.config.permissions?.rememberSession).toBe(false);
    });

    it('should save restricted permission mode', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockShowModal
        .mockResolvedValueOnce({ value: 'en' })
        .mockResolvedValueOnce({ value: 'ollama' })
        .mockResolvedValueOnce({ value: 'restricted' });
      mockShowInput.mockResolvedValueOnce('llama3.2:latest');
      mockShowConfirm
        .mockResolvedValueOnce(true)   // remember
        .mockResolvedValueOnce(true)   // telemetry
        .mockResolvedValueOnce(true)   // autoReport
        .mockResolvedValueOnce(false)  // prefs
        .mockResolvedValueOnce(false)  // advanced
        .mockResolvedValueOnce(false)  // agents
        .mockResolvedValueOnce(false)  // registration (skip)
        .mockResolvedValueOnce(true);  // review

      const result = await wizard.run({ skipWelcome: true });

      expect(result.config.permissions?.mode).toBe('restricted');
    });
  });

  describe('Workspace Safety', () => {
    it('should proceed when workspace is safe', async () => {
      mockCheckWorkspaceSafety.mockReturnValue({ safe: true });

      const wizard = new SetupWizard(testWorkspace);
      setupLocalProviderMocks('ollama', 'llama3.2:latest');

      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(true);
      expect(mockCheckWorkspaceSafety).toHaveBeenCalledWith(testWorkspace);
    });

    it('should warn and ask to continue when workspace is unsafe', async () => {
      mockCheckWorkspaceSafety.mockReturnValue({
        safe: false,
        reason: 'This is your home directory.'
      });

      const wizard = new SetupWizard(testWorkspace);

      // Language
      mockShowModal.mockResolvedValueOnce({ value: 'en' });
      // Workspace unsafe → continue anyway? → YES
      mockShowConfirm.mockResolvedValueOnce(true);
      // Provider
      mockShowModal.mockResolvedValueOnce({ value: 'ollama' });
      // Permissions
      mockShowModal.mockResolvedValueOnce({ value: 'interactive' });
      mockShowInput.mockResolvedValueOnce('llama3.2:latest');
      mockShowConfirm
        .mockResolvedValueOnce(true)   // remember
        .mockResolvedValueOnce(true)   // telemetry
        .mockResolvedValueOnce(true)   // autoReport
        .mockResolvedValueOnce(false)  // prefs
        .mockResolvedValueOnce(false)  // advanced
        .mockResolvedValueOnce(false)  // agents
        .mockResolvedValueOnce(false)  // registration (skip)
        .mockResolvedValueOnce(true);  // review

      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(true);
      expect(mockPrintDangerousWorkspaceWarning).toHaveBeenCalled();
    });

    it('should cancel when user refuses unsafe workspace', async () => {
      mockCheckWorkspaceSafety.mockReturnValue({
        safe: false,
        reason: 'This is the filesystem root.'
      });

      const wizard = new SetupWizard(testWorkspace);

      // Language
      mockShowModal.mockResolvedValueOnce({ value: 'en' });
      // Workspace unsafe → continue anyway? → NO
      mockShowConfirm.mockResolvedValueOnce(false);

      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(false);
      expect(result.cancelled).toBe(true);
    });
  });

  describe('Advanced Settings', () => {
    it('should skip all advanced settings when user declines gate', async () => {
      const wizard = new SetupWizard(testWorkspace);
      setupLocalProviderMocks('ollama', 'llama3.2:latest');

      const result = await wizard.run({ skipWelcome: true });

      expect(result.skippedSteps).toContain('advanced');
      expect(result.skippedSteps).toContain('notifications');
      expect(result.skippedSteps).toContain('network');
      expect(result.skippedSteps).toContain('search');
      expect(result.skippedSteps).toContain('mcp');
      expect(result.skippedSteps).toContain('agentBehavior');
      expect(result.skippedSteps).toContain('communitySkills');
    });

    it('should configure advanced settings when user accepts gate', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockShowModal
        .mockResolvedValueOnce({ value: 'en' })
        .mockResolvedValueOnce({ value: 'ollama' })
        .mockResolvedValueOnce({ value: 'interactive' });
      mockShowInput.mockResolvedValueOnce('llama3.2:latest');
      mockShowConfirm
        .mockResolvedValueOnce(true)   // remember
        .mockResolvedValueOnce(true)   // telemetry
        .mockResolvedValueOnce(true)   // autoReport
        .mockResolvedValueOnce(false)  // prefs
        .mockResolvedValueOnce(true);  // advanced=YES

      // Notifications: enabled, sound
      mockShowConfirm
        .mockResolvedValueOnce(true)   // notifications enabled
        .mockResolvedValueOnce(true);  // sound

      // Network: need custom? → no
      mockShowConfirm.mockResolvedValueOnce(false);

      // Search: provider modal
      mockShowModal.mockResolvedValueOnce({ value: 'google' });

      // MCP: enable
      mockShowConfirm.mockResolvedValueOnce(true);

      // Agent: maxIterations input, debug
      mockShowInput.mockResolvedValueOnce('100');
      mockShowConfirm.mockResolvedValueOnce(false); // debug

      // Community skills: enable
      mockShowConfirm.mockResolvedValueOnce(true);

      // Agents.md
      mockShowConfirm.mockResolvedValueOnce(false); // skip agents

      // Registration
      mockShowConfirm.mockResolvedValueOnce(false); // registration (skip)

      // Review
      mockShowConfirm.mockResolvedValueOnce(true);

      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(true);
      expect(result.config.ui?.notifications).toEqual({ enabled: true, sound: true });
      expect(result.config.search?.provider).toBe('google');
      expect(result.config.mcp?.enabled).toBe(true);
      expect(result.config.agent?.maxIterations).toBe(100);
      expect(result.config.agent?.debug).toBe(false);
      expect(result.config.communitySkills?.enabled).toBe(true);
    });

    it('should skip advanced settings in quickSetup mode', async () => {
      const wizard = new SetupWizard(testWorkspace);
      setupQuickLocalMocks('ollama', 'llama3.2:latest');

      const result = await wizard.run({ skipWelcome: true, quickSetup: true });

      expect(result.success).toBe(true);
      expect(result.skippedSteps).toContain('advanced');
    });

    it('should configure custom network settings', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockShowModal
        .mockResolvedValueOnce({ value: 'en' })
        .mockResolvedValueOnce({ value: 'ollama' })
        .mockResolvedValueOnce({ value: 'interactive' });
      mockShowInput.mockResolvedValueOnce('llama3.2:latest');
      mockShowConfirm
        .mockResolvedValueOnce(true)   // remember
        .mockResolvedValueOnce(true)   // telemetry
        .mockResolvedValueOnce(true)   // autoReport
        .mockResolvedValueOnce(false)  // prefs
        .mockResolvedValueOnce(true);  // advanced=YES

      // Notifications
      mockShowConfirm.mockResolvedValueOnce(false); // disabled
      // Network: yes
      mockShowConfirm.mockResolvedValueOnce(true);
      mockShowInput
        .mockResolvedValueOnce('5')      // maxRetries
        .mockResolvedValueOnce('60000');  // timeout

      // Search
      mockShowModal.mockResolvedValueOnce({ value: 'duckduckgo' });
      // MCP
      mockShowConfirm.mockResolvedValueOnce(false);
      // Agent
      mockShowInput.mockResolvedValueOnce('50');
      mockShowConfirm.mockResolvedValueOnce(true); // debug
      // Community
      mockShowConfirm.mockResolvedValueOnce(false);
      // Agents.md
      mockShowConfirm.mockResolvedValueOnce(false);
      // Registration
      mockShowConfirm.mockResolvedValueOnce(false); // registration (skip)
      // Review
      mockShowConfirm.mockResolvedValueOnce(true);

      const result = await wizard.run({ skipWelcome: true });

      expect(result.config.network?.maxRetries).toBe(5);
      expect(result.config.network?.timeout).toBe(60000);
      expect(result.config.search?.provider).toBe('duckduckgo');
      expect(result.config.agent?.maxIterations).toBe(50);
      expect(result.config.agent?.debug).toBe(true);
    });

    it('should prompt for Brave API key when brave search selected', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockShowModal
        .mockResolvedValueOnce({ value: 'en' })
        .mockResolvedValueOnce({ value: 'ollama' })
        .mockResolvedValueOnce({ value: 'interactive' });
      mockShowInput.mockResolvedValueOnce('llama3.2:latest');
      mockShowConfirm
        .mockResolvedValueOnce(true)   // remember
        .mockResolvedValueOnce(true)   // telemetry
        .mockResolvedValueOnce(true)   // autoReport
        .mockResolvedValueOnce(false)  // prefs
        .mockResolvedValueOnce(true);  // advanced=YES

      // Notifications
      mockShowConfirm.mockResolvedValueOnce(false);
      // Network
      mockShowConfirm.mockResolvedValueOnce(false);
      // Search: brave → API key prompt
      mockShowModal.mockResolvedValueOnce({ value: 'brave' });
      mockShowPassword.mockResolvedValueOnce('brave-api-key-123');
      // MCP
      mockShowConfirm.mockResolvedValueOnce(false);
      // Agent
      mockShowInput.mockResolvedValueOnce('100');
      mockShowConfirm.mockResolvedValueOnce(false);
      // Community
      mockShowConfirm.mockResolvedValueOnce(false);
      // Agents
      mockShowConfirm.mockResolvedValueOnce(false);
      // Registration
      mockShowConfirm.mockResolvedValueOnce(false); // registration (skip)
      // Review
      mockShowConfirm.mockResolvedValueOnce(true);

      const result = await wizard.run({ skipWelcome: true });

      expect(result.config.search?.provider).toBe('brave');
      expect(result.config.search?.braveApiKey).toBe('brave-api-key-123');
    });
  });

  describe('Review Summary', () => {
    it('should complete when user confirms review', async () => {
      const wizard = new SetupWizard(testWorkspace);
      setupLocalProviderMocks('ollama', 'llama3.2:latest');

      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(true);
    });

    it('should skip review in quickSetup mode', async () => {
      const wizard = new SetupWizard(testWorkspace);
      setupQuickLocalMocks('ollama', 'llama3.2:latest');

      const result = await wizard.run({ skipWelcome: true, quickSetup: true });

      expect(result.success).toBe(true);
    });
  });

  describe('Config Output', () => {
    it('should include all new config fields when fully configured', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockShowModal
        .mockResolvedValueOnce({ value: 'de' })        // language
        .mockResolvedValueOnce({ value: 'ollama' })     // provider
        .mockResolvedValueOnce({ value: 'restricted' }); // permissions
      mockShowInput.mockResolvedValueOnce('llama3.2:latest');
      mockShowConfirm
        .mockResolvedValueOnce(true)   // remember
        .mockResolvedValueOnce(false)  // telemetry
        .mockResolvedValueOnce(false)  // autoReport
        .mockResolvedValueOnce(false)  // prefs
        .mockResolvedValueOnce(true);  // advanced=YES

      // Notifications
      mockShowConfirm
        .mockResolvedValueOnce(true)   // enabled
        .mockResolvedValueOnce(false); // no sound
      // Network
      mockShowConfirm.mockResolvedValueOnce(false); // skip
      // Search
      mockShowModal.mockResolvedValueOnce({ value: 'duckduckgo' });
      // MCP
      mockShowConfirm.mockResolvedValueOnce(true);
      // Agent
      mockShowInput.mockResolvedValueOnce('200');
      mockShowConfirm.mockResolvedValueOnce(true); // debug
      // Community
      mockShowConfirm.mockResolvedValueOnce(true);
      // Agents
      mockShowConfirm.mockResolvedValueOnce(false);
      // Registration
      mockShowConfirm.mockResolvedValueOnce(false); // registration (skip)
      // Review
      mockShowConfirm.mockResolvedValueOnce(true);

      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(true);
      expect(result.config.ui?.locale).toBe('de');
      expect(result.config.permissions?.mode).toBe('restricted');
      expect(result.config.permissions?.rememberSession).toBe(true);
      expect(result.config.ui?.notifications).toEqual({ enabled: true, sound: false });
      expect(result.config.search?.provider).toBe('duckduckgo');
      expect(result.config.mcp?.enabled).toBe(true);
      expect(result.config.agent?.maxIterations).toBe(200);
      expect(result.config.agent?.debug).toBe(true);
      expect(result.config.communitySkills?.enabled).toBe(true);
      expect(result.config.telemetry?.enabled).toBe(false);
      expect(result.config.autoReport?.enabled).toBe(false);
    });

    it('should not include config fields for skipped sections', async () => {
      const wizard = new SetupWizard(testWorkspace);
      setupQuickLocalMocks('ollama', 'llama3.2:latest');

      const result = await wizard.run({ skipWelcome: true, quickSetup: true });

      expect(result.success).toBe(true);
      // Quick setup skips advanced, so these should not be set
      expect(result.config.network).toBeUndefined();
      expect(result.config.search).toBeUndefined();
      expect(result.config.agent).toBeUndefined();
      // But permissions, telemetry, locale should still be set
      expect(result.config.permissions?.mode).toBe('interactive');
      expect(result.config.telemetry?.enabled).toBe(true);
      expect(result.config.ui?.locale).toBe('en');
    });
  });
});
