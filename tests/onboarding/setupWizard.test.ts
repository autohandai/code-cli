/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { LoadedConfig } from '../../src/types';

// Use vi.hoisted() to ensure mock functions are available when vi.mock is hoisted
const { mockShowModal, mockShowInput, mockShowPassword, mockShowConfirm, mockPathExists, mockReadJson, mockReadFile, mockWriteFile } = vi.hoisted(() => ({
  mockShowModal: vi.fn(),
  mockShowInput: vi.fn(),
  mockShowPassword: vi.fn(),
  mockShowConfirm: vi.fn(),
  mockPathExists: vi.fn(),
  mockReadJson: vi.fn(),
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn()
}));

// Mock Modal components
vi.mock('../../src/ui/ink/components/Modal.js', () => ({
  showModal: mockShowModal,
  showInput: mockShowInput,
  showPassword: mockShowPassword,
  showConfirm: mockShowConfirm
}));

// Mock fs-extra
vi.mock('fs-extra', () => ({
  pathExists: mockPathExists,
  readJson: mockReadJson,
  readFile: mockReadFile,
  writeFile: mockWriteFile
}));

// Mock chalk (to avoid terminal color issues in tests)
vi.mock('chalk', () => ({
  default: {
    gray: (s: string) => s,
    cyan: { bold: (s: string) => s },
    white: Object.assign((s: string) => s, { bold: (s: string) => s }),
    green: (s: string) => s
  }
}));

// Mock console to suppress output during tests
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'clear').mockImplementation(() => {});

// Mock process.stdin for "Press Enter to continue"
vi.spyOn(process.stdin, 'once').mockImplementation((event: any, callback: any) => {
  if (event === 'data') {
    setImmediate(callback);
  }
  return process.stdin;
});

// Import after mocking
import {
  SetupWizard,
  type OnboardingResult
} from '../../src/onboarding/setupWizard';

describe('SetupWizard', () => {
  const testWorkspace = '/test/workspace';
  const testConfigPath = '/test/.autohand/config.json';

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the mock functions
    mockShowModal.mockReset();
    mockShowInput.mockReset();
    mockShowPassword.mockReset();
    mockShowConfirm.mockReset();
    mockPathExists.mockResolvedValue(false);
    mockWriteFile.mockResolvedValue(undefined);
  });

  describe('isAlreadyConfigured', () => {
    it('should return false when no config provided', async () => {
      const wizard = new SetupWizard(testWorkspace);

      // Mock all prompts to simulate user flow
      mockShowModal.mockResolvedValueOnce({ value: 'openrouter' });
      mockShowPassword.mockResolvedValueOnce('sk-test-key-long-enough');
      mockShowInput.mockResolvedValueOnce('anthropic/claude-3.5-sonnet');
      mockShowConfirm.mockResolvedValueOnce(true);
      mockShowConfirm.mockResolvedValueOnce(false);
      mockShowConfirm.mockResolvedValueOnce(false);

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
        // Missing openrouter settings
      };

      const wizard = new SetupWizard(testWorkspace, incompleteConfig);

      mockShowModal.mockResolvedValueOnce({ value: 'openrouter' });
      mockShowPassword.mockResolvedValueOnce('sk-new-key-long-enough');
      mockShowInput.mockResolvedValueOnce('anthropic/claude-3.5-sonnet');
      mockShowConfirm.mockResolvedValueOnce(false);
      mockShowConfirm.mockResolvedValueOnce(false);
      mockShowConfirm.mockResolvedValueOnce(false);

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
          // Missing apiKey
        }
      };

      const wizard = new SetupWizard(testWorkspace, configWithoutApiKey);

      mockShowModal.mockResolvedValueOnce({ value: 'openrouter' });
      mockShowPassword.mockResolvedValueOnce('sk-new-api-key-long');
      mockShowInput.mockResolvedValueOnce('anthropic/claude-3.5-sonnet');
      mockShowConfirm.mockResolvedValueOnce(false);
      mockShowConfirm.mockResolvedValueOnce(false);
      mockShowConfirm.mockResolvedValueOnce(false);

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

      mockShowModal.mockResolvedValueOnce({ value: 'openrouter' });
      mockShowPassword.mockResolvedValueOnce('sk-new-api-key-long');
      mockShowInput.mockResolvedValueOnce('anthropic/claude-3.5-sonnet');
      mockShowConfirm.mockResolvedValueOnce(false);
      mockShowConfirm.mockResolvedValueOnce(false);
      mockShowConfirm.mockResolvedValueOnce(false);

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

      mockShowModal.mockResolvedValueOnce({ value: 'openrouter' });
      mockShowConfirm.mockResolvedValueOnce(false);
      mockShowPassword.mockResolvedValueOnce('sk-new-valid-api-key');
      mockShowInput.mockResolvedValueOnce('anthropic/claude-3.5-sonnet');
      mockShowConfirm.mockResolvedValueOnce(false);
      mockShowConfirm.mockResolvedValueOnce(false);
      mockShowConfirm.mockResolvedValueOnce(false);

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

      mockShowModal.mockResolvedValueOnce({ value: 'ollama' });
      mockShowInput.mockResolvedValueOnce('llama3.2:latest');
      mockShowConfirm.mockResolvedValueOnce(true);
      mockShowConfirm.mockResolvedValueOnce(false);
      mockShowConfirm.mockResolvedValueOnce(false);

      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(true);
      expect(result.config.provider).toBe('ollama');
    });

    it('should not prompt for API key for local providers', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockShowModal.mockResolvedValueOnce({ value: 'ollama' });
      mockShowInput.mockResolvedValueOnce('llama3.2:latest');
      mockShowConfirm.mockResolvedValueOnce(true);
      mockShowConfirm.mockResolvedValueOnce(false);
      mockShowConfirm.mockResolvedValueOnce(false);

      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(true);
      // Should not have prompted for API key
      expect(mockShowModal).toHaveBeenCalledTimes(1); // provider only
      expect(mockShowPassword).not.toHaveBeenCalled(); // No API key for local providers
      expect(mockShowInput).toHaveBeenCalledTimes(1); // model
      expect(mockShowConfirm).toHaveBeenCalledTimes(3); // telemetry, prefs, agents
    });

    it('should prompt for API key for cloud providers', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockShowModal.mockResolvedValueOnce({ value: 'openrouter' });
      mockShowPassword.mockResolvedValueOnce('sk-test-key-long-enough');
      mockShowInput.mockResolvedValueOnce('anthropic/claude-3.5-sonnet');
      mockShowConfirm.mockResolvedValueOnce(true);
      mockShowConfirm.mockResolvedValueOnce(false);
      mockShowConfirm.mockResolvedValueOnce(false);

      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(true);
      // Should have prompted for API key
      expect(mockShowModal).toHaveBeenCalledTimes(1); // provider only
      expect(mockShowPassword).toHaveBeenCalledTimes(1); // API key
      expect(mockShowInput).toHaveBeenCalledTimes(1); // model
      expect(mockShowConfirm).toHaveBeenCalledTimes(3); // telemetry, prefs, agents
    });
  });

  describe('API Key Handling', () => {
    it('should save API key for OpenRouter', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockShowModal.mockResolvedValueOnce({ value: 'openrouter' });
      mockShowPassword.mockResolvedValueOnce('sk-or-test-key-long');
      mockShowInput.mockResolvedValueOnce('anthropic/claude-3.5-sonnet');
      mockShowConfirm.mockResolvedValueOnce(true);
      mockShowConfirm.mockResolvedValueOnce(false);
      mockShowConfirm.mockResolvedValueOnce(false);

      const result = await wizard.run({ skipWelcome: true });

      expect(result.config.openrouter?.apiKey).toBe('sk-or-test-key-long');
    });

    it('should save API key for OpenAI', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockShowModal.mockResolvedValueOnce({ value: 'openai' });
      mockShowPassword.mockResolvedValueOnce('sk-openai-test-key');
      mockShowInput.mockResolvedValueOnce('gpt-4o');
      mockShowConfirm.mockResolvedValueOnce(true);
      mockShowConfirm.mockResolvedValueOnce(false);
      mockShowConfirm.mockResolvedValueOnce(false);

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

      mockShowModal.mockResolvedValueOnce({ value: 'openrouter' });
      mockShowConfirm.mockResolvedValueOnce(true);
      mockShowInput.mockResolvedValueOnce('anthropic/claude-3.5-sonnet');
      mockShowConfirm.mockResolvedValueOnce(true);
      mockShowConfirm.mockResolvedValueOnce(false);
      mockShowConfirm.mockResolvedValueOnce(false);

      const result = await wizard.run({ skipWelcome: true, force: true });

      expect(result.config.openrouter?.apiKey).toBe('sk-existing-key-long');
    });
  });

  describe('Model Selection', () => {
    it('should save selected model', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockShowModal.mockResolvedValueOnce({ value: 'openrouter' });
      mockShowPassword.mockResolvedValueOnce('sk-test-long-key');
      mockShowInput.mockResolvedValueOnce('anthropic/claude-sonnet-4-20250514');
      mockShowConfirm.mockResolvedValueOnce(true);
      mockShowConfirm.mockResolvedValueOnce(false);
      mockShowConfirm.mockResolvedValueOnce(false);

      const result = await wizard.run({ skipWelcome: true });

      expect(result.config.openrouter?.model).toBe('anthropic/claude-sonnet-4-20250514');
    });
  });

  describe('Telemetry Preference', () => {
    it('should save telemetry enabled preference', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockShowModal.mockResolvedValueOnce({ value: 'ollama' });
      mockShowInput.mockResolvedValueOnce('llama3.2:latest');
      mockShowConfirm.mockResolvedValueOnce(true);
      mockShowConfirm.mockResolvedValueOnce(false);
      mockShowConfirm.mockResolvedValueOnce(false);

      const result = await wizard.run({ skipWelcome: true });

      expect(result.config.telemetry?.enabled).toBe(true);
    });

    it('should save telemetry disabled preference', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockShowModal.mockResolvedValueOnce({ value: 'ollama' });
      mockShowInput.mockResolvedValueOnce('llama3.2:latest');
      mockShowConfirm.mockResolvedValueOnce(false);
      mockShowConfirm.mockResolvedValueOnce(false);
      mockShowConfirm.mockResolvedValueOnce(false);

      const result = await wizard.run({ skipWelcome: true });

      expect(result.config.telemetry?.enabled).toBe(false);
    });
  });

  describe('Preferences', () => {
    it('should skip preferences when user declines', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockShowModal.mockResolvedValueOnce({ value: 'ollama' });
      mockShowInput.mockResolvedValueOnce('llama3.2:latest');
      mockShowConfirm.mockResolvedValueOnce(true);
      mockShowConfirm.mockResolvedValueOnce(false);
      mockShowConfirm.mockResolvedValueOnce(false);

      const result = await wizard.run({ skipWelcome: true });

      expect(result.skippedSteps).toContain('preferences');
      expect(result.config.ui).toBeUndefined();
    });

    it('should save preferences when user configures them', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockShowModal.mockResolvedValueOnce({ value: 'ollama' });
      mockShowInput.mockResolvedValueOnce('llama3.2:latest');
      mockShowConfirm.mockResolvedValueOnce(true);
      mockShowConfirm.mockResolvedValueOnce(true);
      mockShowModal.mockResolvedValueOnce({ value: 'dark' });
      mockShowConfirm.mockResolvedValueOnce(true);
      mockShowConfirm.mockResolvedValueOnce(false);
      mockShowConfirm.mockResolvedValueOnce(false);

      const result = await wizard.run({ skipWelcome: true });

      expect(result.config.ui?.theme).toBe('dark');
      expect(result.config.ui?.autoConfirm).toBe(true);
      expect(result.config.ui?.checkForUpdates).toBe(false);
    });

    it('should skip preferences in quick setup mode', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockShowModal.mockResolvedValueOnce({ value: 'ollama' });
      mockShowInput.mockResolvedValueOnce('llama3.2:latest');
      mockShowConfirm.mockResolvedValueOnce(true);
      mockShowConfirm.mockResolvedValueOnce(false);

      const result = await wizard.run({ skipWelcome: true, quickSetup: true });

      expect(result.success).toBe(true);
      expect(result.skippedSteps).toContain('preferences');
    });
  });

  describe('AGENTS.md Generation', () => {
    it('should create AGENTS.md when user agrees', async () => {
      // Mock package.json exists
      mockPathExists.mockImplementation(async (path: string) => {
        if (path === `${testWorkspace}/package.json`) return true;
        return false;
      });
      mockReadJson.mockResolvedValue({
        name: 'test',
        devDependencies: { typescript: '^5.0.0' }
      });

      const wizard = new SetupWizard(testWorkspace);

      mockShowModal.mockResolvedValueOnce({ value: 'ollama' });
      mockShowInput.mockResolvedValueOnce('llama3.2:latest');
      mockShowConfirm.mockResolvedValueOnce(true);
      mockShowConfirm.mockResolvedValueOnce(false);
      mockShowConfirm.mockResolvedValueOnce(true);

      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(true);
      expect(result.agentsFileCreated).toBe(true);
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it('should skip AGENTS.md when user declines', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockShowModal.mockResolvedValueOnce({ value: 'ollama' });
      mockShowInput.mockResolvedValueOnce('llama3.2:latest');
      mockShowConfirm.mockResolvedValueOnce(true);
      mockShowConfirm.mockResolvedValueOnce(false);
      mockShowConfirm.mockResolvedValueOnce(false);

      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(true);
      expect(result.agentsFileCreated).toBeFalsy();
      expect(result.skippedSteps).toContain('agentsFile');
    });

    it('should ask to overwrite existing AGENTS.md', async () => {
      // Mock AGENTS.md exists
      mockPathExists.mockImplementation(async (path: string) => {
        if (path === `${testWorkspace}/AGENTS.md`) return true;
        if (path === `${testWorkspace}/package.json`) return true;
        return false;
      });
      mockReadJson.mockResolvedValue({ name: 'test' });

      const wizard = new SetupWizard(testWorkspace);

      mockShowModal.mockResolvedValueOnce({ value: 'ollama' });
      mockShowInput.mockResolvedValueOnce('llama3.2:latest');
      mockShowConfirm.mockResolvedValueOnce(true);
      mockShowConfirm.mockResolvedValueOnce(false);
      mockShowConfirm.mockResolvedValueOnce(false); // Don't overwrite

      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(true);
      expect(result.agentsFileCreated).toBeFalsy();
    });
  });

  describe('Cancellation Handling', () => {
    it('should handle cancellation gracefully', async () => {
      const wizard = new SetupWizard(testWorkspace);

      // Simulate user pressing ESC
      mockShowModal.mockRejectedValueOnce({ message: 'cancelled' });

      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(false);
      expect(result.cancelled).toBe(true);
    });

    it('should handle ERR_USE_AFTER_CLOSE', async () => {
      const wizard = new SetupWizard(testWorkspace);

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

      mockShowModal.mockResolvedValueOnce({ value: 'ollama' });
      mockShowInput.mockResolvedValueOnce('llama3.2:latest');
      mockShowConfirm.mockResolvedValueOnce(true);
      mockShowConfirm.mockResolvedValueOnce(false);
      mockShowConfirm.mockResolvedValueOnce(false);

      const result = await wizard.run({ skipWelcome: true, force: true });

      expect(result.success).toBe(true);
      expect(result.config.provider).toBe('ollama');
      expect(mockShowModal).toHaveBeenCalled();
    });
  });

  describe('Provider-Specific Base URLs', () => {
    it('should set correct base URL for OpenRouter', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockShowModal.mockResolvedValueOnce({ value: 'openrouter' });
      mockShowPassword.mockResolvedValueOnce('sk-test-long-key');
      mockShowInput.mockResolvedValueOnce('test');
      mockShowConfirm.mockResolvedValueOnce(true);
      mockShowConfirm.mockResolvedValueOnce(false);
      mockShowConfirm.mockResolvedValueOnce(false);

      const result = await wizard.run({ skipWelcome: true });

      expect(result.config.openrouter?.baseUrl).toBe('https://openrouter.ai/api/v1');
    });

    it('should set correct base URL for OpenAI', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockShowModal.mockResolvedValueOnce({ value: 'openai' });
      mockShowPassword.mockResolvedValueOnce('sk-test-long-key');
      mockShowInput.mockResolvedValueOnce('gpt-4o');
      mockShowConfirm.mockResolvedValueOnce(true);
      mockShowConfirm.mockResolvedValueOnce(false);
      mockShowConfirm.mockResolvedValueOnce(false);

      const result = await wizard.run({ skipWelcome: true });

      expect(result.config.openai?.baseUrl).toBe('https://api.openai.com/v1');
    });

    it('should set correct base URL for Ollama', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockShowModal.mockResolvedValueOnce({ value: 'ollama' });
      mockShowInput.mockResolvedValueOnce('llama3.2:latest');
      mockShowConfirm.mockResolvedValueOnce(true);
      mockShowConfirm.mockResolvedValueOnce(false);
      mockShowConfirm.mockResolvedValueOnce(false);

      const result = await wizard.run({ skipWelcome: true });

      expect(result.config.ollama?.baseUrl).toBe('http://localhost:11434');
    });
  });
});
