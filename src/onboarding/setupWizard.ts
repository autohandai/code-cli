/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import chalk from 'chalk';
import enquirer from 'enquirer';
import { pathExists, writeFile } from 'fs-extra';
import { join } from 'path';

import type { AutohandConfig, LoadedConfig, ProviderName } from '../types.js';
import { getProviderConfig } from '../config.js';
import { ProviderFactory } from '../providers/ProviderFactory.js';
import { ProjectAnalyzer, type ProjectInfo } from './projectAnalyzer.js';
import { AgentsGenerator } from './agentsGenerator.js';

/**
 * Steps in the onboarding wizard
 */
export type OnboardingStep =
  | 'welcome'
  | 'provider'
  | 'apiKey'
  | 'model'
  | 'telemetry'
  | 'preferences'
  | 'agentsFile'
  | 'complete';

/**
 * Internal state of the wizard
 */
interface OnboardingState {
  currentStep: OnboardingStep;
  provider?: ProviderName;
  apiKey?: string;
  model?: string;
  telemetryEnabled?: boolean;
  preferences?: {
    theme?: string;
    autoConfirm?: boolean;
    checkForUpdates?: boolean;
  };
  agentsFileCreated?: boolean;
  skipped: OnboardingStep[];
  completed: boolean;
}

/**
 * Options for running the wizard
 */
export interface OnboardingOptions {
  force?: boolean;
  skipWelcome?: boolean;
  quickSetup?: boolean;
}

/**
 * Result of running the wizard
 */
export interface OnboardingResult {
  success: boolean;
  config: Partial<AutohandConfig>;
  skippedSteps: OnboardingStep[];
  cancelled: boolean;
  agentsFileCreated?: boolean;
}

// ASCII art banner (same as in index.ts)
const ASCII_FRIEND = [
  '⢀⡴⠛⠛⠻⣷⡄⠀⣠⡶⠟⠛⠻⣶⡄⢀⣴⡾⠛⠛⢿⣦⠀⢀⣴⠞⠛⠛⠶⡀',
  '⡎⠀⢰⣶⡆⠈⣿⣴⣿⠁⣴⣶⡄⠘⣿⣾⡏⢀⣶⣦⠀⢻⡇⣿⠃⢠⣶⡆⠀⢹',
  '⢧⠀⠘⠛⠃⢠⡿⠙⣿⡀⠙⠛⠃⣰⡿⢻⣧⠈⠛⠛⢀⣾⠇⢻⣆⠈⠛⠋⠀⡼',
  '⠈⠻⢶⣶⡾⠟⠁⠀⠘⠿⢶⣶⡾⠟⠁⠀⠙⠷⣶⣶⠿⠋⠀⠈⠻⠷⣶⡶⠚⠁',
  '⢀⣴⠿⠿⠷⣦⡀⠀⣠⣶⠿⠻⢷⣦⡀⠀⣠⡾⠟⠿⣶⣄⠀⢀⣴⡾⠿⠿⣶⣄',
  '⡾⠃⢠⣤⡄⠘⣿⣠⣿⠁⣠⣤⡄⠹⣷⣼⡏⢀⣤⣤⠈⢿⡆⣾⠏⢀⣤⣄⠈⢿',
  '⢧⡀⠸⠿⠇⢀⣿⠺⣿⡀⠻⠿⠃⢰⣿⢿⣇⠈⠿⠿⠀⣼⡇⢿⣇⠘⠿⠇⠀⣸',
  '⠈⢿⣦⣤⣴⡿⠃⠀⠙⢷⣦⣤⣶⡿⠁⠈⠻⣷⣤⣤⡾⠛⠀⠈⢿⣦⣤⣤⠴⠁'
].join('\n');

/**
 * Setup wizard for first-run onboarding
 */
export class SetupWizard {
  private state: OnboardingState;
  private existingConfig: LoadedConfig | null;
  private workspaceRoot: string;

  constructor(workspaceRoot: string, existingConfig?: LoadedConfig) {
    this.workspaceRoot = workspaceRoot;
    this.existingConfig = existingConfig ?? null;
    this.state = {
      currentStep: 'welcome',
      skipped: [],
      completed: false
    };
  }

  /**
   * Run the full onboarding wizard
   */
  async run(options?: OnboardingOptions): Promise<OnboardingResult> {
    // Check if setup is already complete
    if (!options?.force && this.isAlreadyConfigured()) {
      return {
        success: true,
        config: {},
        skippedSteps: ['welcome', 'provider', 'apiKey', 'model', 'telemetry', 'preferences', 'agentsFile'],
        cancelled: false
      };
    }

    try {
      // Step 1: Welcome
      if (!options?.skipWelcome) {
        await this.showWelcome();
      }

      // Step 2: Provider selection
      const provider = await this.promptProvider();
      if (!provider) return this.cancelled();

      // Step 3: API key (for cloud providers)
      if (this.requiresApiKey(provider)) {
        const apiKey = await this.promptApiKey(provider);
        if (apiKey === null) return this.cancelled();
      }

      // Step 4: Model selection
      const model = await this.promptModel(provider);
      if (!model) return this.cancelled();

      // Step 5: Telemetry opt-in/opt-out
      await this.promptTelemetry();

      // Step 6: Preferences (optional)
      if (!options?.quickSetup) {
        await this.promptPreferences();
      } else {
        this.state.skipped.push('preferences');
      }

      // Step 7: Create AGENTS.md
      await this.promptAgentsFile();

      // Step 8: Complete
      return this.complete();

    } catch (error) {
      if (this.isCancellation(error)) {
        return this.cancelled();
      }
      throw error;
    }
  }

  /**
   * Check if configuration is already complete
   */
  private isAlreadyConfigured(): boolean {
    if (!this.existingConfig) return false;

    const provider = this.existingConfig.provider;
    if (!provider) return false;

    const providerConfig = getProviderConfig(this.existingConfig, provider);
    return providerConfig !== null;
  }

  /**
   * Show welcome screen
   */
  private async showWelcome(): Promise<void> {
    console.clear();
    console.log(chalk.gray(ASCII_FRIEND));
    console.log();
    console.log(chalk.cyan.bold('  Welcome to Autohand!'));
    console.log(chalk.gray('  Your super fast AI coding agent'));
    console.log();
    console.log(chalk.white('  Let\'s get you set up in just a few steps.'));
    console.log();

    await this.pressEnter();
  }

  /**
   * Prompt for provider selection
   */
  private async promptProvider(): Promise<ProviderName | null> {
    this.state.currentStep = 'provider';

    const providers = ProviderFactory.getProviderNames();

    const choices = providers.map(p => ({
      name: p,
      message: this.getProviderDisplayName(p),
      hint: this.getProviderHint(p)
    }));

    const result = await enquirer.prompt<{ provider: ProviderName }>({
      type: 'select',
      name: 'provider',
      message: 'Which LLM provider would you like to use?',
      choices,
      initial: this.existingConfig?.provider
        ? providers.indexOf(this.existingConfig.provider)
        : 0
    });

    this.state.provider = result.provider;
    return result.provider;
  }

  /**
   * Prompt for API key (cloud providers)
   */
  private async promptApiKey(provider: ProviderName): Promise<string | null> {
    this.state.currentStep = 'apiKey';

    // Check for existing key
    const existingKey = this.getExistingApiKey(provider);
    if (existingKey && existingKey !== 'replace-me') {
      const { useExisting } = await enquirer.prompt<{ useExisting: boolean }>({
        type: 'confirm',
        name: 'useExisting',
        message: `Use existing ${this.getProviderDisplayName(provider)} API key? (ends with ...${existingKey.slice(-4)})`,
        initial: true
      });

      if (useExisting) {
        this.state.apiKey = existingKey;
        return existingKey;
      }
    }

    // Show help link
    console.log(chalk.gray(`\n  Get your API key at: ${this.getApiKeyUrl(provider)}\n`));

    const result = await enquirer.prompt<{ apiKey: string }>({
      type: 'password',
      name: 'apiKey',
      message: `Enter your ${this.getProviderDisplayName(provider)} API key`,
      validate: (val: unknown) => {
        const v = val as string;
        if (!v?.trim()) return 'API key is required';
        if (v.length < 10) return 'API key seems too short';
        return true;
      }
    });

    this.state.apiKey = result.apiKey.trim();
    return this.state.apiKey;
  }

  /**
   * Prompt for model selection
   */
  private async promptModel(provider: ProviderName): Promise<string | null> {
    this.state.currentStep = 'model';

    const defaultModel = this.getDefaultModel(provider);

    // For simplicity, just use input with default
    // In a full implementation, we'd fetch available models
    const result = await enquirer.prompt<{ model: string }>({
      type: 'input',
      name: 'model',
      message: 'Enter model ID',
      initial: defaultModel,
      validate: (val: unknown) => {
        const v = val as string;
        return v?.trim() ? true : 'Model is required';
      }
    });

    this.state.model = result.model.trim();
    return this.state.model;
  }

  /**
   * Prompt for telemetry preference
   */
  private async promptTelemetry(): Promise<void> {
    this.state.currentStep = 'telemetry';

    console.log();
    console.log(chalk.gray('  ────────────────────────────────────────────────────────'));
    console.log(chalk.white.bold('  Help us improve Autohand'));
    console.log(chalk.gray('  ────────────────────────────────────────────────────────'));
    console.log();
    console.log(chalk.gray('  We collect anonymous usage data to understand how'));
    console.log(chalk.gray('  Autohand is used and where we can make it better.'));
    console.log();
    console.log(chalk.gray('  What we collect:'));
    console.log(chalk.gray('  - Command usage (which features are popular)'));
    console.log(chalk.gray('  - Error rates (to fix bugs faster)'));
    console.log(chalk.gray('  - Performance metrics (to speed things up)'));
    console.log();
    console.log(chalk.gray('  What we never collect:'));
    console.log(chalk.gray('  - Your code or file contents'));
    console.log(chalk.gray('  - API keys or credentials'));
    console.log(chalk.gray('  - Personal information'));
    console.log();

    const { telemetryEnabled } = await enquirer.prompt<{ telemetryEnabled: boolean }>({
      type: 'confirm',
      name: 'telemetryEnabled',
      message: 'Share anonymous usage data to help improve Autohand?',
      initial: true
    });

    this.state.telemetryEnabled = telemetryEnabled;

    if (telemetryEnabled) {
      console.log(chalk.green('  Thanks for helping us improve Autohand!'));
    } else {
      console.log(chalk.gray('  No problem! You can change this anytime in config.'));
    }
  }

  /**
   * Prompt for additional preferences
   */
  private async promptPreferences(): Promise<void> {
    this.state.currentStep = 'preferences';

    const { configurePrefs } = await enquirer.prompt<{ configurePrefs: boolean }>({
      type: 'confirm',
      name: 'configurePrefs',
      message: 'Would you like to configure additional preferences? (theme, auto-confirm)',
      initial: false
    });

    if (!configurePrefs) {
      this.state.skipped.push('preferences');
      return;
    }

    // Built-in themes from src/ui/theme/themes.ts
    const themes = ['dark', 'light', 'dracula', 'sandy', 'tui'];
    const themeDescriptions: Record<string, string> = {
      dark: 'Default dark theme',
      light: 'Light theme for light backgrounds',
      dracula: 'Popular Dracula color scheme',
      sandy: 'Warm, earthy desert tones',
      tui: 'New Zealand inspired colors'
    };

    const { theme } = await enquirer.prompt<{ theme: string }>({
      type: 'select',
      name: 'theme',
      message: 'Select a theme',
      choices: themes.map(t => ({ name: t, message: t, hint: themeDescriptions[t] })),
      initial: 0
    });

    const { autoConfirm } = await enquirer.prompt<{ autoConfirm: boolean }>({
      type: 'confirm',
      name: 'autoConfirm',
      message: 'Auto-confirm non-destructive actions?',
      initial: false
    });

    const { checkForUpdates } = await enquirer.prompt<{ checkForUpdates: boolean }>({
      type: 'confirm',
      name: 'checkForUpdates',
      message: 'Check for updates on startup?',
      initial: true
    });

    this.state.preferences = { theme, autoConfirm, checkForUpdates };
  }

  /**
   * Prompt for AGENTS.md creation
   */
  private async promptAgentsFile(): Promise<void> {
    this.state.currentStep = 'agentsFile';

    const agentsPath = join(this.workspaceRoot, 'AGENTS.md');
    const exists = await pathExists(agentsPath);

    // If exists, ask to overwrite
    if (exists) {
      const { overwrite } = await enquirer.prompt<{ overwrite: boolean }>({
        type: 'confirm',
        name: 'overwrite',
        message: 'AGENTS.md already exists. Would you like to regenerate it?',
        initial: false
      });

      if (!overwrite) {
        this.state.skipped.push('agentsFile');
        console.log(chalk.gray('  Keeping existing AGENTS.md'));
        return;
      }
    } else {
      // Ask if they want to create it
      console.log();
      console.log(chalk.gray('  ────────────────────────────────────────────────────────'));
      console.log(chalk.white.bold('  Project Configuration'));
      console.log(chalk.gray('  ────────────────────────────────────────────────────────'));
      console.log();
      console.log(chalk.gray('  AGENTS.md helps Autohand understand your project better.'));
      console.log(chalk.gray('  It contains instructions specific to your codebase.'));
      console.log();

      const { createAgents } = await enquirer.prompt<{ createAgents: boolean }>({
        type: 'confirm',
        name: 'createAgents',
        message: 'Generate AGENTS.md based on your project?',
        initial: true
      });

      if (!createAgents) {
        this.state.skipped.push('agentsFile');
        console.log(chalk.gray('  You can create it later with /init'));
        return;
      }
    }

    // Analyze project and generate
    console.log();
    console.log(chalk.gray('  Analyzing your project...'));

    const analyzer = new ProjectAnalyzer(this.workspaceRoot);
    const projectInfo = await analyzer.analyze();

    // Show what was detected
    if (Object.keys(projectInfo).length > 0) {
      console.log();
      console.log(chalk.gray('  Detected:'));
      if (projectInfo.language) {
        console.log(chalk.white(`  - Language: ${projectInfo.language}`));
      }
      if (projectInfo.framework) {
        console.log(chalk.white(`  - Framework: ${projectInfo.framework}`));
      }
      if (projectInfo.packageManager) {
        console.log(chalk.white(`  - Package manager: ${projectInfo.packageManager}`));
      }
      if (projectInfo.testFramework) {
        console.log(chalk.white(`  - Test framework: ${projectInfo.testFramework}`));
      }
    }

    // Generate and write
    const generator = new AgentsGenerator();
    const content = generator.generateContent(projectInfo);
    await writeFile(agentsPath, content);

    this.state.agentsFileCreated = true;
    console.log();
    console.log(chalk.green('  Created AGENTS.md'));
    console.log(chalk.gray('  You can customize it anytime to improve Autohand\'s understanding.'));
  }

  /**
   * Build final config and return success
   */
  private complete(): OnboardingResult {
    this.state.currentStep = 'complete';
    this.state.completed = true;

    const config: Partial<AutohandConfig> = {
      provider: this.state.provider
    };

    // Set provider-specific config
    if (this.state.provider) {
      if (this.requiresApiKey(this.state.provider)) {
        (config as any)[this.state.provider] = {
          apiKey: this.state.apiKey,
          model: this.state.model,
          baseUrl: this.getDefaultBaseUrl(this.state.provider)
        };
      } else {
        (config as any)[this.state.provider] = {
          model: this.state.model,
          baseUrl: this.getDefaultBaseUrl(this.state.provider)
        };
      }
    }

    // Set telemetry preference
    config.telemetry = {
      enabled: this.state.telemetryEnabled ?? true
    };

    // Set UI preferences
    if (this.state.preferences) {
      config.ui = {
        theme: this.state.preferences.theme,
        autoConfirm: this.state.preferences.autoConfirm,
        checkForUpdates: this.state.preferences.checkForUpdates
      };
    }

    // Show completion message
    this.showCompletionMessage();

    return {
      success: true,
      config,
      skippedSteps: this.state.skipped,
      cancelled: false,
      agentsFileCreated: this.state.agentsFileCreated
    };
  }

  /**
   * Show setup complete message
   */
  private showCompletionMessage(): void {
    console.log();
    console.log();
    console.log(chalk.green('  Setup complete!'));
    console.log();

    console.log(chalk.gray('  What was created:'));
    console.log(chalk.white('  - ~/.autohand/config.json (your settings)'));
    if (this.state.agentsFileCreated) {
      console.log(chalk.white('  - AGENTS.md (project instructions for Autohand)'));
    }
    console.log();

    console.log(chalk.gray('  Quick tips:'));
    console.log(chalk.white('  - Type your request and press Enter to start'));
    console.log(chalk.white('  - Use @filename to mention files'));
    console.log(chalk.white('  - Type /help for all commands'));
    console.log(chalk.white('  - Press Ctrl+C twice to exit'));
    console.log();
  }

  /**
   * Return cancelled result
   */
  private cancelled(): OnboardingResult {
    return {
      success: false,
      config: {},
      skippedSteps: [],
      cancelled: true
    };
  }

  // Helper methods

  private requiresApiKey(provider: ProviderName): boolean {
    return provider === 'openrouter' || provider === 'openai';
  }

  private getProviderDisplayName(provider: ProviderName): string {
    const names: Record<ProviderName, string> = {
      openrouter: 'OpenRouter',
      openai: 'OpenAI',
      ollama: 'Ollama',
      llamacpp: 'llama.cpp',
      mlx: 'MLX (Apple Silicon)'
    };
    return names[provider] || provider;
  }

  private getProviderHint(provider: ProviderName): string {
    const hints: Record<ProviderName, string> = {
      openrouter: 'Cloud - Access to 100+ models (Claude, GPT-4, etc.)',
      openai: 'Cloud - Official OpenAI models (GPT-4o, o1, etc.)',
      ollama: 'Local - Run models on your machine (free)',
      llamacpp: 'Local - Fast inference with GGUF models',
      mlx: 'Local - Optimized for Apple Silicon Macs'
    };
    return hints[provider] || '';
  }

  private getApiKeyUrl(provider: ProviderName): string {
    const urls: Record<string, string> = {
      openrouter: 'https://openrouter.ai/keys',
      openai: 'https://platform.openai.com/api-keys'
    };
    return urls[provider] || '';
  }

  private getDefaultModel(provider: ProviderName): string {
    const defaults: Record<ProviderName, string> = {
      openrouter: 'anthropic/claude-sonnet-4-20250514',
      openai: 'gpt-4o',
      ollama: 'llama3.2:latest',
      llamacpp: 'default',
      mlx: 'mlx-community/Llama-3.2-3B-Instruct-4bit'
    };
    return defaults[provider] || '';
  }

  private getDefaultBaseUrl(provider: ProviderName): string {
    const urls: Record<ProviderName, string> = {
      openrouter: 'https://openrouter.ai/api/v1',
      openai: 'https://api.openai.com/v1',
      ollama: 'http://localhost:11434',
      llamacpp: 'http://localhost:8080',
      mlx: 'http://localhost:8080'
    };
    return urls[provider] || '';
  }

  private getExistingApiKey(provider: ProviderName): string | null {
    if (!this.existingConfig) return null;
    const config = (this.existingConfig as any)[provider];
    return config?.apiKey || null;
  }

  private isCancellation(error: unknown): boolean {
    if (error && typeof error === 'object') {
      const e = error as any;
      return (
        e.code === 'ERR_USE_AFTER_CLOSE' ||
        e.message?.includes('cancelled') ||
        e.message?.includes('canceled')
      );
    }
    return false;
  }

  private async pressEnter(): Promise<void> {
    console.log(chalk.gray('  Press Enter to continue...'));
    await enquirer.prompt({
      type: 'invisible',
      name: 'continue',
      message: ''
    });
  }
}
