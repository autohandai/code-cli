/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fsExtra from 'fs-extra';
import type { LoadedConfig } from '../../src/types';

// Use vi.hoisted to define mocks before vi.mock runs (both are hoisted together)
const { mockPromptFn, fsMocks } = vi.hoisted(() => ({
  mockPromptFn: vi.fn(),
  fsMocks: {
    pathExists: vi.fn(),
    readJson: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn()
  }
}));

// Mock fs-extra
vi.mock('fs-extra', () => fsMocks);

const mockPathExists = fsMocks.pathExists;
const mockReadJson = fsMocks.readJson;
const mockReadFile = fsMocks.readFile;
const mockWriteFile = fsMocks.writeFile;

// Mock enquirer - uses vi.hoisted variable
vi.mock('enquirer', () => ({
  default: {
    prompt: mockPromptFn
  }
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
    // Reset the mock function
    mockPromptFn.mockReset();
    mockPathExists.mockResolvedValue(false);
    mockWriteFile.mockResolvedValue(undefined);
  });

  describe('isAlreadyConfigured', () => {
    it('should return false when no config provided', async () => {
      const wizard = new SetupWizard(testWorkspace);

      // Mock all prompts to simulate user flow
      mockPromptFn
        .mockResolvedValueOnce({ provider: 'openrouter' })
        .mockResolvedValueOnce({ apiKey: 'sk-test-key' })
        .mockResolvedValueOnce({ model: 'anthropic/claude-3.5-sonnet' })
        .mockResolvedValueOnce({ telemetryEnabled: true })
        .mockResolvedValueOnce({ configurePrefs: false })
        .mockResolvedValueOnce({ createAgents: false });

      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(true);
    });

    it('should skip wizard when config is already complete', async () => {
      const existingConfig: LoadedConfig = {
        configPath: testConfigPath,
        provider: 'openrouter',
        openrouter: {
          apiKey: 'sk-existing-key',
          model: 'anthropic/claude-3.5-sonnet'
        }
      };

      const wizard = new SetupWizard(testWorkspace, existingConfig);
      const result = await wizard.run();

      expect(result.success).toBe(true);
      expect(result.skippedSteps).toContain('welcome');
      expect(result.skippedSteps).toContain('provider');
      expect(mockPromptFn).not.toHaveBeenCalled();
    });

    it('should run wizard when config exists but provider not configured', async () => {
      const incompleteConfig: LoadedConfig = {
        configPath: testConfigPath,
        provider: 'openrouter'
        // Missing openrouter settings
      };

      const wizard = new SetupWizard(testWorkspace, incompleteConfig);

      mockPromptFn
        .mockResolvedValueOnce({ provider: 'openrouter' })
        .mockResolvedValueOnce({ apiKey: 'sk-new-key' })
        .mockResolvedValueOnce({ model: 'anthropic/claude-3.5-sonnet' })
        .mockResolvedValueOnce({ telemetryEnabled: false })
        .mockResolvedValueOnce({ configurePrefs: false })
        .mockResolvedValueOnce({ createAgents: false });

      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(true);
      expect(mockPromptFn).toHaveBeenCalled();
    });
  });

  describe('Provider Selection', () => {
    it('should set provider in result config', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockPromptFn
        .mockResolvedValueOnce({ provider: 'ollama' })
        .mockResolvedValueOnce({ model: 'llama3.2:latest' })
        .mockResolvedValueOnce({ telemetryEnabled: true })
        .mockResolvedValueOnce({ configurePrefs: false })
        .mockResolvedValueOnce({ createAgents: false });

      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(true);
      expect(result.config.provider).toBe('ollama');
    });

    it('should not prompt for API key for local providers', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockPromptFn
        .mockResolvedValueOnce({ provider: 'ollama' })
        .mockResolvedValueOnce({ model: 'llama3.2:latest' })
        .mockResolvedValueOnce({ telemetryEnabled: true })
        .mockResolvedValueOnce({ configurePrefs: false })
        .mockResolvedValueOnce({ createAgents: false });

      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(true);
      // Should not have prompted for API key
      expect(mockPromptFn).toHaveBeenCalledTimes(5); // provider, model, telemetry, prefs, agents
    });

    it('should prompt for API key for cloud providers', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockPromptFn
        .mockResolvedValueOnce({ provider: 'openrouter' })
        .mockResolvedValueOnce({ apiKey: 'sk-test-key' })
        .mockResolvedValueOnce({ model: 'anthropic/claude-3.5-sonnet' })
        .mockResolvedValueOnce({ telemetryEnabled: true })
        .mockResolvedValueOnce({ configurePrefs: false })
        .mockResolvedValueOnce({ createAgents: false });

      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(true);
      // Should have prompted for API key
      expect(mockPromptFn).toHaveBeenCalledTimes(6); // provider, apiKey, model, telemetry, prefs, agents
    });
  });

  describe('API Key Handling', () => {
    it('should save API key for OpenRouter', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockPromptFn
        .mockResolvedValueOnce({ provider: 'openrouter' })
        .mockResolvedValueOnce({ apiKey: 'sk-or-test-key' })
        .mockResolvedValueOnce({ model: 'anthropic/claude-3.5-sonnet' })
        .mockResolvedValueOnce({ telemetryEnabled: true })
        .mockResolvedValueOnce({ configurePrefs: false })
        .mockResolvedValueOnce({ createAgents: false });

      const result = await wizard.run({ skipWelcome: true });

      expect(result.config.openrouter?.apiKey).toBe('sk-or-test-key');
    });

    it('should save API key for OpenAI', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockPromptFn
        .mockResolvedValueOnce({ provider: 'openai' })
        .mockResolvedValueOnce({ apiKey: 'sk-openai-test-key' })
        .mockResolvedValueOnce({ model: 'gpt-4o' })
        .mockResolvedValueOnce({ telemetryEnabled: true })
        .mockResolvedValueOnce({ configurePrefs: false })
        .mockResolvedValueOnce({ createAgents: false });

      const result = await wizard.run({ skipWelcome: true });

      expect(result.config.openai?.apiKey).toBe('sk-openai-test-key');
    });

    it('should offer to use existing API key', async () => {
      const existingConfig: LoadedConfig = {
        configPath: testConfigPath,
        provider: 'openrouter',
        openrouter: {
          apiKey: 'sk-existing-key',
          model: '' // Model missing, so wizard should run
        }
      };

      const wizard = new SetupWizard(testWorkspace, existingConfig);

      mockPromptFn
        .mockResolvedValueOnce({ provider: 'openrouter' })
        .mockResolvedValueOnce({ useExisting: true }) // Use existing key
        .mockResolvedValueOnce({ model: 'anthropic/claude-3.5-sonnet' })
        .mockResolvedValueOnce({ telemetryEnabled: true })
        .mockResolvedValueOnce({ configurePrefs: false })
        .mockResolvedValueOnce({ createAgents: false });

      const result = await wizard.run({ skipWelcome: true, force: true });

      expect(result.config.openrouter?.apiKey).toBe('sk-existing-key');
    });
  });

  describe('Model Selection', () => {
    it('should save selected model', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockPromptFn
        .mockResolvedValueOnce({ provider: 'openrouter' })
        .mockResolvedValueOnce({ apiKey: 'sk-test' })
        .mockResolvedValueOnce({ model: 'anthropic/claude-sonnet-4-20250514' })
        .mockResolvedValueOnce({ telemetryEnabled: true })
        .mockResolvedValueOnce({ configurePrefs: false })
        .mockResolvedValueOnce({ createAgents: false });

      const result = await wizard.run({ skipWelcome: true });

      expect(result.config.openrouter?.model).toBe('anthropic/claude-sonnet-4-20250514');
    });
  });

  describe('Telemetry Preference', () => {
    it('should save telemetry enabled preference', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockPromptFn
        .mockResolvedValueOnce({ provider: 'ollama' })
        .mockResolvedValueOnce({ model: 'llama3.2:latest' })
        .mockResolvedValueOnce({ telemetryEnabled: true })
        .mockResolvedValueOnce({ configurePrefs: false })
        .mockResolvedValueOnce({ createAgents: false });

      const result = await wizard.run({ skipWelcome: true });

      expect(result.config.telemetry?.enabled).toBe(true);
    });

    it('should save telemetry disabled preference', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockPromptFn
        .mockResolvedValueOnce({ provider: 'ollama' })
        .mockResolvedValueOnce({ model: 'llama3.2:latest' })
        .mockResolvedValueOnce({ telemetryEnabled: false })
        .mockResolvedValueOnce({ configurePrefs: false })
        .mockResolvedValueOnce({ createAgents: false });

      const result = await wizard.run({ skipWelcome: true });

      expect(result.config.telemetry?.enabled).toBe(false);
    });
  });

  describe('Preferences', () => {
    it('should skip preferences when user declines', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockPromptFn
        .mockResolvedValueOnce({ provider: 'ollama' })
        .mockResolvedValueOnce({ model: 'llama3.2:latest' })
        .mockResolvedValueOnce({ telemetryEnabled: true })
        .mockResolvedValueOnce({ configurePrefs: false })
        .mockResolvedValueOnce({ createAgents: false });

      const result = await wizard.run({ skipWelcome: true });

      expect(result.skippedSteps).toContain('preferences');
      expect(result.config.ui).toBeUndefined();
    });

    it('should save preferences when user configures them', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockPromptFn
        .mockResolvedValueOnce({ provider: 'ollama' })
        .mockResolvedValueOnce({ model: 'llama3.2:latest' })
        .mockResolvedValueOnce({ telemetryEnabled: true })
        .mockResolvedValueOnce({ configurePrefs: true })
        .mockResolvedValueOnce({ theme: 'dark' })
        .mockResolvedValueOnce({ autoConfirm: true })
        .mockResolvedValueOnce({ checkForUpdates: false })
        .mockResolvedValueOnce({ createAgents: false });

      const result = await wizard.run({ skipWelcome: true });

      expect(result.config.ui?.theme).toBe('dark');
      expect(result.config.ui?.autoConfirm).toBe(true);
      expect(result.config.ui?.checkForUpdates).toBe(false);
    });

    it('should skip preferences in quick setup mode', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockPromptFn
        .mockResolvedValueOnce({ provider: 'ollama' })
        .mockResolvedValueOnce({ model: 'llama3.2:latest' })
        .mockResolvedValueOnce({ telemetryEnabled: true })
        .mockResolvedValueOnce({ createAgents: false });

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

      mockPromptFn
        .mockResolvedValueOnce({ provider: 'ollama' })
        .mockResolvedValueOnce({ model: 'llama3.2:latest' })
        .mockResolvedValueOnce({ telemetryEnabled: true })
        .mockResolvedValueOnce({ configurePrefs: false })
        .mockResolvedValueOnce({ createAgents: true });

      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(true);
      expect(result.agentsFileCreated).toBe(true);
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it('should skip AGENTS.md when user declines', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockPromptFn
        .mockResolvedValueOnce({ provider: 'ollama' })
        .mockResolvedValueOnce({ model: 'llama3.2:latest' })
        .mockResolvedValueOnce({ telemetryEnabled: true })
        .mockResolvedValueOnce({ configurePrefs: false })
        .mockResolvedValueOnce({ createAgents: false });

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

      mockPromptFn
        .mockResolvedValueOnce({ provider: 'ollama' })
        .mockResolvedValueOnce({ model: 'llama3.2:latest' })
        .mockResolvedValueOnce({ telemetryEnabled: true })
        .mockResolvedValueOnce({ configurePrefs: false })
        .mockResolvedValueOnce({ overwrite: false }); // Don't overwrite

      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(true);
      expect(result.agentsFileCreated).toBeFalsy();
    });
  });

  describe('Cancellation Handling', () => {
    it('should handle cancellation gracefully', async () => {
      const wizard = new SetupWizard(testWorkspace);

      // Simulate user pressing ESC
      mockPromptFn.mockRejectedValueOnce({ message: 'cancelled' });

      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(false);
      expect(result.cancelled).toBe(true);
    });

    it('should handle ERR_USE_AFTER_CLOSE', async () => {
      const wizard = new SetupWizard(testWorkspace);

      const closeError = new Error('readline was closed');
      (closeError as any).code = 'ERR_USE_AFTER_CLOSE';
      mockPromptFn.mockRejectedValueOnce(closeError);

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
          apiKey: 'sk-existing',
          model: 'anthropic/claude-3.5-sonnet'
        }
      };

      const wizard = new SetupWizard(testWorkspace, existingConfig);

      mockPromptFn
        .mockResolvedValueOnce({ provider: 'ollama' })
        .mockResolvedValueOnce({ model: 'llama3.2:latest' })
        .mockResolvedValueOnce({ telemetryEnabled: true })
        .mockResolvedValueOnce({ configurePrefs: false })
        .mockResolvedValueOnce({ createAgents: false });

      const result = await wizard.run({ skipWelcome: true, force: true });

      expect(result.success).toBe(true);
      expect(result.config.provider).toBe('ollama');
      expect(mockPromptFn).toHaveBeenCalled();
    });
  });

  describe('Provider-Specific Base URLs', () => {
    it('should set correct base URL for OpenRouter', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockPromptFn
        .mockResolvedValueOnce({ provider: 'openrouter' })
        .mockResolvedValueOnce({ apiKey: 'sk-test' })
        .mockResolvedValueOnce({ model: 'test' })
        .mockResolvedValueOnce({ telemetryEnabled: true })
        .mockResolvedValueOnce({ configurePrefs: false })
        .mockResolvedValueOnce({ createAgents: false });

      const result = await wizard.run({ skipWelcome: true });

      expect(result.config.openrouter?.baseUrl).toBe('https://openrouter.ai/api/v1');
    });

    it('should set correct base URL for OpenAI', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockPromptFn
        .mockResolvedValueOnce({ provider: 'openai' })
        .mockResolvedValueOnce({ apiKey: 'sk-test' })
        .mockResolvedValueOnce({ model: 'gpt-4o' })
        .mockResolvedValueOnce({ telemetryEnabled: true })
        .mockResolvedValueOnce({ configurePrefs: false })
        .mockResolvedValueOnce({ createAgents: false });

      const result = await wizard.run({ skipWelcome: true });

      expect(result.config.openai?.baseUrl).toBe('https://api.openai.com/v1');
    });

    it('should set correct base URL for Ollama', async () => {
      const wizard = new SetupWizard(testWorkspace);

      mockPromptFn
        .mockResolvedValueOnce({ provider: 'ollama' })
        .mockResolvedValueOnce({ model: 'llama3.2:latest' })
        .mockResolvedValueOnce({ telemetryEnabled: true })
        .mockResolvedValueOnce({ configurePrefs: false })
        .mockResolvedValueOnce({ createAgents: false });

      const result = await wizard.run({ skipWelcome: true });

      expect(result.config.ollama?.baseUrl).toBe('http://localhost:11434');
    });
  });
});