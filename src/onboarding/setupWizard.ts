/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import chalk from 'chalk';
import { t, changeLanguage, detectLocale, SUPPORTED_LOCALES, LANGUAGE_DISPLAY_NAMES } from '../i18n/index.js';
import type { SupportedLocale } from '../i18n/index.js';
import { showModal, showInput, showPassword, showConfirm, type ModalOption } from '../ui/ink/components/Modal.js';
import fse from 'fs-extra';
import { join } from 'path';

import type { AutohandConfig, LoadedConfig, ProviderName, AzureSettings, AzureAuthMethod, PermissionMode, SearchProvider } from '../types.js';
import { getProviderConfig } from '../config.js';
import { ProviderFactory } from '../providers/ProviderFactory.js';
import { ProjectAnalyzer } from './projectAnalyzer.js';
import { AgentsGenerator } from './agentsGenerator.js';
import { checkWorkspaceSafety, printDangerousWorkspaceWarning } from '../startup/workspaceSafety.js';

/**
 * Steps in the onboarding wizard
 */
export type OnboardingStep =
  | 'welcome'
  | 'language'
  | 'workspaceSafety'
  | 'provider'
  | 'apiKey'
  | 'model'
  | 'connectionTest'
  | 'permissions'
  | 'telemetry'
  | 'autoReport'
  | 'preferences'
  | 'advanced'
  | 'notifications'
  | 'network'
  | 'search'
  | 'mcp'
  | 'agentBehavior'
  | 'communitySkills'
  | 'agentsFile'
  | 'reviewSummary'
  | 'complete';

/**
 * Internal state of the wizard
 */
interface OnboardingState {
  currentStep: OnboardingStep;
  locale?: SupportedLocale;
  provider?: ProviderName;
  apiKey?: string;
  model?: string;
  telemetryEnabled?: boolean;
  autoReportEnabled?: boolean;
  preferences?: {
    theme?: string;
    autoConfirm?: boolean;
    checkForUpdates?: boolean;
  };
  azureConfig?: AzureSettings;
  permissionMode?: PermissionMode;
  rememberSession?: boolean;
  notifications?: {
    enabled?: boolean;
    sound?: boolean;
  };
  network?: {
    maxRetries?: number;
    timeout?: number;
  };
  search?: {
    provider?: SearchProvider;
    braveApiKey?: string;
    parallelApiKey?: string;
  };
  mcpEnabled?: boolean;
  agentSettings?: {
    maxIterations?: number;
    debug?: boolean;
  };
  communitySkillsEnabled?: boolean;
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
        skippedSteps: ['welcome', 'language', 'workspaceSafety', 'provider', 'apiKey', 'model', 'permissions', 'telemetry', 'preferences', 'advanced', 'agentsFile', 'reviewSummary'],
        cancelled: false
      };
    }

    try {
      // Step 1: Welcome
      if (!options?.skipWelcome) {
        await this.showWelcome();
      }

      // Step 2: Language selection
      await this.promptLanguage();

      // Step 3: Workspace safety check
      const safeWorkspace = await this.checkWorkspaceStep();
      if (!safeWorkspace) return this.cancelled();

      // Step 4: Provider selection
      const provider = await this.promptProvider();
      if (!provider) return this.cancelled();

      // Step 5: Provider-specific configuration (API key + validation OR Azure flow)
      if (provider === 'azure') {
        const azureResult = await this.promptAzureConfig();
        if (!azureResult) return this.cancelled();
      } else {
        if (this.requiresApiKey(provider)) {
          const apiKey = await this.promptApiKey(provider);
          if (apiKey === null) return this.cancelled();
          // Validate API key for cloud providers
          await this.validateApiKeyDuringSetup();
        }

        const model = await this.promptModel(provider);
        if (!model) return this.cancelled();
      }

      // Step 7: Connection test for local providers
      if (this.isLocalProvider(provider)) {
        const connected = await this.testLocalProviderConnection();
        if (!connected) return this.cancelled();
      }

      // Step 8: Permissions mode
      await this.promptPermissions();

      // Step 9: Telemetry opt-in/opt-out
      await this.promptTelemetry();

      // Step 10: Auto Report Issues (opt-out)
      await this.promptAutoReport();

      // Step 11: Preferences (optional)
      if (!options?.quickSetup) {
        await this.promptPreferences();
      } else {
        this.state.skipped.push('preferences');
      }

      // Step 12: Advanced settings gate (skip in quickSetup)
      if (!options?.quickSetup) {
        const wantsAdvanced = await showConfirm({
          title: t('setup.advanced.prompt'),
          defaultValue: false
        });

        if (wantsAdvanced) {
          // 12a: Notifications
          await this.promptNotifications();
          // 12b: Network
          await this.promptNetwork();
          // 12c: Web search provider
          await this.promptSearch();
          // 12d: MCP support
          await this.promptMcp();
          // 12e: Agent behavior
          await this.promptAgentBehavior();
          // 12f: Community skills
          await this.promptCommunitySkills();
        } else {
          this.state.skipped.push('advanced', 'notifications', 'network', 'search', 'mcp', 'agentBehavior', 'communitySkills');
        }
      } else {
        this.state.skipped.push('advanced', 'notifications', 'network', 'search', 'mcp', 'agentBehavior', 'communitySkills');
      }

      // Step 13: Create AGENTS.md
      await this.promptAgentsFile();

      // Step 14: Review summary (skip in quickSetup)
      if (!options?.quickSetup) {
        const confirmed = await this.promptReviewConfirm();
        if (!confirmed) {
          // Restart setup
          this.state = { currentStep: 'welcome', skipped: [], completed: false };
          return this.run({ ...options, force: true });
        }
      }

      // Step 15: Complete
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
   * Requires both a provider and a valid API key (for providers that need one)
   */
  private isAlreadyConfigured(): boolean {
    if (!this.existingConfig) return false;

    const provider = this.existingConfig.provider;
    if (!provider) return false;

    const providerConfig = getProviderConfig(this.existingConfig, provider);
    if (!providerConfig) return false;

    // For providers that require an API key, check if it's set and valid
    if (this.requiresApiKey(provider)) {
      const apiKey = (providerConfig as any).apiKey;
      if (!apiKey || apiKey === 'replace-me' || apiKey.length < 10) {
        return false;
      }
    }

    return true;
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

    const options: ModalOption[] = providers.map(p => ({
      label: this.getProviderDisplayName(p),
      value: p,
      description: this.getProviderHint(p)
    }));

    // Only pre-select if there's a valid existing provider with API key
    const hasValidExistingProvider = this.existingConfig?.provider && this.isProviderConfigured(this.existingConfig.provider);

    let initialIndex = 0;
    if (hasValidExistingProvider) {
      initialIndex = providers.indexOf(this.existingConfig!.provider!);
    }

    const result = await showModal({
      title: t('providers.config.chooseProvider'),
      options,
      initialIndex: initialIndex >= 0 ? initialIndex : 0
    });

    if (!result) {
      return null;
    }

    this.state.provider = result.value as ProviderName;
    return result.value as ProviderName;
  }

  /**
   * Check if a specific provider is fully configured (has API key if required)
   */
  private isProviderConfigured(provider: ProviderName): boolean {
    if (!this.existingConfig) return false;

    const providerConfig = getProviderConfig(this.existingConfig, provider);
    if (!providerConfig) return false;

    // For providers that require an API key, check if it's set and valid
    if (this.requiresApiKey(provider)) {
      const apiKey = (providerConfig as any).apiKey;
      return apiKey && apiKey !== 'replace-me' && apiKey.length >= 10;
    }

    return true;
  }

  /**
   * Prompt for API key (cloud providers)
   */
  private async promptApiKey(provider: ProviderName): Promise<string | null> {
    this.state.currentStep = 'apiKey';

    // Check for existing key
    const existingKey = this.getExistingApiKey(provider);
    if (existingKey && existingKey !== 'replace-me') {
      const useExisting = await showConfirm({
        title: `Use existing ${this.getProviderDisplayName(provider)} API key? (ends with ...${existingKey.slice(-4)})`,
        defaultValue: true
      });

      if (useExisting) {
        this.state.apiKey = existingKey;
        return existingKey;
      }
    }

    // Show help link
    console.log(chalk.gray('\n  ' + t('providers.config.apiKeyUrl', { url: this.getApiKeyUrl(provider) }) + '\n'));

    const apiKey = await showPassword({
      title: t('providers.config.enterApiKey', { provider: this.getProviderDisplayName(provider) }),
      validate: (val: string) => {
        if (!val?.trim()) return t('providers.config.apiKeyRequired');
        if (val.length < 10) return t('providers.config.apiKeyTooShort');
        return true;
      }
    });

    if (!apiKey) {
      return null;
    }

    this.state.apiKey = apiKey.trim();
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
    const model = await showInput({
      title: t('providers.config.enterModelId'),
      defaultValue: defaultModel,
      validate: (val: string) => {
        return val?.trim() ? true : 'Model is required';
      }
    });

    if (!model) {
      return null;
    }

    this.state.model = model.trim();
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

    const telemetryEnabled = await showConfirm({
      title: 'Share anonymous usage data to help improve Autohand?',
      defaultValue: true
    });

    this.state.telemetryEnabled = telemetryEnabled;

    if (telemetryEnabled) {
      console.log(chalk.green('  Thanks for helping us improve Autohand!'));
    } else {
      console.log(chalk.gray('  No problem! You can change this anytime in config.'));
    }
  }

  /**
   * Prompt for auto report issues preference
   */
  private async promptAutoReport(): Promise<void> {
    this.state.currentStep = 'autoReport';

    console.log();
    console.log(chalk.gray('  ────────────────────────────────────────────────────────'));
    console.log(chalk.white.bold('  Auto Report Issues'));
    console.log(chalk.gray('  ────────────────────────────────────────────────────────'));
    console.log();
    console.log(chalk.gray('  When errors occur, Autohand can automatically report'));
    console.log(chalk.gray('  them as GitHub issues to help us fix bugs faster.'));
    console.log();
    console.log(chalk.gray('  What gets reported:'));
    console.log(chalk.gray('  - Error type, message, and sanitized stack trace'));
    console.log(chalk.gray('  - CLI version, platform, and model info'));
    console.log();
    console.log(chalk.gray('  What we never report:'));
    console.log(chalk.gray('  - Your code or file contents'));
    console.log(chalk.gray('  - API keys or credentials'));
    console.log(chalk.gray('  - Personal information'));
    console.log();

    const autoReportEnabled = await showConfirm({
      title: 'Automatically report errors to help us fix bugs faster?',
      defaultValue: true
    });

    this.state.autoReportEnabled = autoReportEnabled;

    if (autoReportEnabled) {
      console.log(chalk.green('  Thanks! This helps us catch and fix issues quickly.'));
    } else {
      console.log(chalk.gray('  No problem! You can enable this anytime in config.'));
    }
  }

  /**
   * Prompt for additional preferences
   */
  private async promptPreferences(): Promise<void> {
    this.state.currentStep = 'preferences';

    const configurePrefs = await showConfirm({
      title: 'Would you like to configure additional preferences? (theme, auto-confirm)',
      defaultValue: false
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

    const themeOptions: ModalOption[] = themes.map(themeName => ({
      label: themeName,
      value: themeName,
      description: themeDescriptions[themeName]
    }));

    const themeResult = await showModal({
      title: 'Select a theme',
      options: themeOptions
    });

    const theme = themeResult?.value as string || 'dark';

    const autoConfirm = await showConfirm({
      title: 'Auto-confirm non-destructive actions?',
      defaultValue: false
    });

    const checkForUpdates = await showConfirm({
      title: 'Check for updates on startup?',
      defaultValue: true
    });

    this.state.preferences = { theme, autoConfirm, checkForUpdates };
  }

  /**
   * Prompt for AGENTS.md creation
   */
  private async promptAgentsFile(): Promise<void> {
    this.state.currentStep = 'agentsFile';

    const agentsPath = join(this.workspaceRoot, 'AGENTS.md');
    const exists = await fse.pathExists(agentsPath);

    // If exists, ask to overwrite
    if (exists) {
      const overwrite = await showConfirm({
        title: 'AGENTS.md already exists. Would you like to regenerate it?',
        defaultValue: false
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

      const createAgents = await showConfirm({
        title: 'Generate AGENTS.md based on your project?',
        defaultValue: true
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
    await fse.writeFile(agentsPath, content);

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
      if (this.state.provider === 'azure' && this.state.azureConfig) {
        config.azure = this.state.azureConfig;
      } else if (this.requiresApiKey(this.state.provider)) {
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

    // Set auto report preference
    config.autoReport = {
      enabled: this.state.autoReportEnabled ?? true
    };

    // Set UI preferences (merge locale + user preferences)
    const uiConfig: Partial<AutohandConfig['ui']> = {};
    if (this.state.locale) {
      uiConfig.locale = this.state.locale;
    }
    if (this.state.preferences) {
      uiConfig.theme = this.state.preferences.theme;
      uiConfig.autoConfirm = this.state.preferences.autoConfirm;
      uiConfig.checkForUpdates = this.state.preferences.checkForUpdates;
    }
    if (this.state.notifications) {
      uiConfig.notifications = this.state.notifications;
    }
    if (Object.keys(uiConfig).length > 0) {
      config.ui = uiConfig as AutohandConfig['ui'];
    }

    // Set permissions
    if (this.state.permissionMode) {
      config.permissions = {
        mode: this.state.permissionMode,
        rememberSession: this.state.rememberSession ?? true
      };
    }

    // Set network settings
    if (this.state.network) {
      config.network = this.state.network;
    }

    // Set search settings
    if (this.state.search) {
      config.search = this.state.search;
    }

    // Set MCP settings
    if (this.state.mcpEnabled !== undefined) {
      config.mcp = { enabled: this.state.mcpEnabled };
    }

    // Set agent settings
    if (this.state.agentSettings) {
      config.agent = this.state.agentSettings;
    }

    // Set community skills settings
    if (this.state.communitySkillsEnabled !== undefined) {
      config.communitySkills = { enabled: this.state.communitySkillsEnabled };
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

  /**
   * Full Azure OpenAI configuration flow
   * Shows prerequisites, collects auth method, endpoint, deployment, and API version
   */
  private async promptAzureConfig(): Promise<boolean> {
    this.state.currentStep = 'apiKey';

    // Show title and prerequisites
    console.log(chalk.cyan('\n' + t('providers.wizard.azure.title')));
    console.log(chalk.gray(t('providers.wizard.azure.getStarted') + '\n'));

    console.log(chalk.yellow(t('providers.wizard.azure.setupSteps.title')));
    console.log(chalk.gray('  ' + t('providers.wizard.azure.setupSteps.step1')));
    console.log(chalk.gray('  ' + t('providers.wizard.azure.setupSteps.step2')));
    console.log(chalk.gray('  ' + t('providers.wizard.azure.setupSteps.step3')));
    console.log(chalk.gray('  ' + t('providers.wizard.azure.setupSteps.step4')));
    console.log();

    // Step 1: Auth method
    const authChoices: ModalOption[] = [
      { label: t('providers.wizard.azure.authApiKey'), value: 'api-key' },
      { label: t('providers.wizard.azure.authEntraId'), value: 'entra-id' },
      { label: t('providers.wizard.azure.authManagedIdentity'), value: 'managed-identity' }
    ];

    const authResult = await showModal({
      title: t('providers.wizard.azure.selectAuthMethod'),
      options: authChoices
    });

    if (!authResult) return false;

    const authMethod = authResult.value as AzureAuthMethod;
    let apiKey: string | undefined;
    let tenantId: string | undefined;
    let clientId: string | undefined;
    let clientSecret: string | undefined;

    // Step 2: Auth-specific prompts
    if (authMethod === 'api-key') {
      console.log(chalk.gray('\n' + t('providers.wizard.azure.apiKeyLocation') + '\n'));
      apiKey = await showPassword({ title: t('providers.wizard.azure.enterAzureApiKey') }) ?? undefined;
      if (!apiKey) return false;
    } else if (authMethod === 'entra-id') {
      console.log(chalk.gray('\n' + t('providers.wizard.azure.entraIdDescription')));
      console.log(chalk.gray(t('providers.wizard.azure.entraIdDocs') + '\n'));

      tenantId = await showInput({ title: t('providers.wizard.azure.enterTenantId') }) ?? undefined;
      if (!tenantId) return false;

      clientId = await showInput({ title: t('providers.wizard.azure.enterClientId') }) ?? undefined;
      if (!clientId) return false;

      clientSecret = await showPassword({ title: t('providers.wizard.azure.enterClientSecret') }) ?? undefined;
      if (!clientSecret) return false;
    } else {
      console.log(chalk.gray('\n' + t('providers.wizard.azure.managedIdentityDescription')));
      console.log(chalk.gray(t('providers.wizard.azure.managedIdentityDocs') + '\n'));
    }

    // Step 3: Endpoint configuration
    const endpointChoice = await showModal({
      title: t('providers.wizard.azure.endpointChoice'),
      options: [
        { label: t('providers.wizard.azure.endpointStructured'), value: 'structured' },
        { label: t('providers.wizard.azure.endpointUrl'), value: 'url' }
      ]
    });

    if (!endpointChoice) return false;

    let resourceName: string | undefined;
    let deploymentName: string | undefined;
    let baseUrl: string | undefined;

    if (endpointChoice.value === 'structured') {
      console.log(chalk.gray(t('providers.wizard.azure.endpointUrlHint')));
      console.log(chalk.gray(t('providers.wizard.azure.endpointUrlExample') + '\n'));
      resourceName = await showInput({ title: t('providers.wizard.azure.enterEndpointOrResource') }) ?? undefined;
      if (!resourceName) return false;

      console.log(chalk.gray('\n' + t('providers.wizard.azure.deploymentHint')));
      console.log(chalk.gray(t('providers.wizard.azure.deploymentNotUrl') + '\n'));
      deploymentName = await showInput({ title: t('providers.wizard.azure.enterDeploymentName'), defaultValue: 'gpt-5.3-codex' }) ?? undefined;
      if (!deploymentName) return false;
      if (deploymentName.startsWith('http://') || deploymentName.startsWith('https://')) {
        console.log(chalk.red('\n✗ ' + t('providers.wizard.azure.deploymentUrlError')));
        console.log(chalk.gray('  ' + t('providers.wizard.azure.deploymentUrlErrorHint')));
        console.log(chalk.gray('  ' + t('providers.wizard.azure.deploymentUrlErrorLocation') + '\n'));
        return false;
      }
    } else {
      baseUrl = await showInput({
        title: t('providers.wizard.azure.enterFullEndpointUrl'),
        defaultValue: 'https://your-resource.openai.azure.com/openai/deployments/gpt-5.3-codex'
      }) ?? undefined;
      if (!baseUrl) return false;
    }

    // Step 4: API version
    const apiVersion = await showInput({ title: t('providers.wizard.azure.apiVersion'), defaultValue: '2024-10-21' }) ?? undefined;
    if (!apiVersion) return false;

    const model = deploymentName ?? 'gpt-5.3-codex';

    // Build and store Azure config
    const azureConfig: AzureSettings = {
      model,
      authMethod,
      apiVersion,
      ...(apiKey && { apiKey }),
      ...(tenantId && { tenantId }),
      ...(clientId && { clientId }),
      ...(clientSecret && { clientSecret }),
      ...(resourceName && { resourceName }),
      ...(deploymentName && { deploymentName }),
      ...(baseUrl && { baseUrl }),
    };

    this.state.azureConfig = azureConfig;
    this.state.model = model;

    console.log(chalk.green('\n✓ ' + t('providers.config.configuredSuccessfully', { provider: t('providers.azure') })));
    console.log(chalk.gray('  ' + t('providers.wizard.azure.authLabel', { method: authMethod })));
    console.log(chalk.gray('  ' + t('providers.config.modelLabel', { model })));
    console.log();

    return true;
  }

  /**
   * Prompt for language selection
   */
  private async promptLanguage(): Promise<void> {
    this.state.currentStep = 'language';

    const detected = detectLocale();
    console.log(chalk.gray('\n  ' + t('setup.language.detected', { language: LANGUAGE_DISPLAY_NAMES[detected.locale] })));

    const options: ModalOption[] = SUPPORTED_LOCALES.map(locale => ({
      label: LANGUAGE_DISPLAY_NAMES[locale],
      value: locale
    }));

    const initialIndex = SUPPORTED_LOCALES.indexOf(detected.locale);

    const result = await showModal({
      title: t('setup.language.prompt'),
      options,
      initialIndex: initialIndex >= 0 ? initialIndex : 0
    });

    if (!result) {
      this.state.locale = detected.locale;
      return;
    }

    const selectedLocale = result.value as SupportedLocale;
    this.state.locale = selectedLocale;

    if (selectedLocale !== detected.locale) {
      await changeLanguage(selectedLocale);
      console.log(chalk.green('  ' + t('setup.language.changed', { language: LANGUAGE_DISPLAY_NAMES[selectedLocale] })));
    }
  }

  /**
   * Validate API key during setup by hitting GET /models
   */
  private async validateApiKeyDuringSetup(): Promise<void> {
    if (!this.state.provider || !this.state.apiKey) return;
    if (!this.requiresApiKey(this.state.provider)) return;

    const baseUrl = this.getDefaultBaseUrl(this.state.provider);
    console.log(chalk.gray('\n  ' + t('setup.apiKeyValidation.validating')));

    try {
      const response = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.state.apiKey}` },
        signal: AbortSignal.timeout(10000)
      });

      if (response.ok) {
        console.log(chalk.green('  ' + t('setup.apiKeyValidation.success')));
      } else {
        console.log(chalk.yellow('  ' + t('setup.apiKeyValidation.failed', { error: `HTTP ${response.status}` })));
        console.log(chalk.gray('  ' + t('setup.apiKeyValidation.hint')));
      }
    } catch {
      console.log(chalk.yellow('  ' + t('setup.apiKeyValidation.skipped')));
    }
  }

  /**
   * Test local provider connection (Ollama, llama.cpp, MLX)
   */
  private async testLocalProviderConnection(): Promise<boolean> {
    if (!this.state.provider || !this.isLocalProvider(this.state.provider)) return true;

    this.state.currentStep = 'connectionTest';
    const provider = this.state.provider;
    const baseUrl = this.getDefaultBaseUrl(provider);

    const endpoints: Record<string, string> = {
      ollama: `${baseUrl}/api/tags`,
      llamacpp: `${baseUrl}/health`,
      mlx: `${baseUrl}/v1/models`
    };

    const endpoint = endpoints[provider];
    if (!endpoint) return true;

    console.log(chalk.gray('\n  ' + t('setup.connectionTest.testing', { provider: this.getProviderDisplayName(provider) })));

    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        console.log(chalk.green('  ' + t('setup.connectionTest.success', { provider: this.getProviderDisplayName(provider) })));
        return true;
      }
      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.log(chalk.yellow('  ' + t('setup.connectionTest.failed', { provider: this.getProviderDisplayName(provider), error: errorMsg })));

      // Show provider-specific hint
      const hintKey = `setup.connectionTest.hint${provider.charAt(0).toUpperCase() + provider.slice(1)}` as const;
      const hint = t(hintKey as string);
      if (hint !== hintKey) {
        console.log(chalk.gray('  ' + hint));
      }

      const continueAnyway = await showConfirm({
        title: t('setup.connectionTest.continueAnyway'),
        defaultValue: true
      });

      return continueAnyway;
    }
  }

  /**
   * Prompt for permission mode selection
   */
  private async promptPermissions(): Promise<void> {
    this.state.currentStep = 'permissions';

    console.log();
    console.log(chalk.gray('  ────────────────────────────────────────────────────────'));
    console.log(chalk.white.bold('  ' + t('setup.permissions.title')));
    console.log(chalk.gray('  ────────────────────────────────────────────────────────'));
    console.log();
    console.log(chalk.gray('  ' + t('setup.permissions.description')));
    console.log();

    const options: ModalOption[] = [
      { label: t('setup.permissions.interactive'), value: 'interactive' },
      { label: t('setup.permissions.unrestricted'), value: 'unrestricted' },
      { label: t('setup.permissions.restricted'), value: 'restricted' }
    ];

    const result = await showModal({
      title: t('setup.permissions.title'),
      options
    });

    const mode = (result?.value as PermissionMode) ?? 'interactive';
    this.state.permissionMode = mode;

    if (mode === 'unrestricted') {
      console.log(chalk.yellow('  ' + t('setup.permissions.warning')));
    }

    console.log(chalk.green('  ' + t('setup.permissions.set', { mode })));

    const rememberSession = await showConfirm({
      title: t('setup.permissions.rememberPrompt'),
      defaultValue: true
    });

    this.state.rememberSession = rememberSession;
  }

  /**
   * Check workspace safety
   */
  private async checkWorkspaceStep(): Promise<boolean> {
    this.state.currentStep = 'workspaceSafety';

    console.log(chalk.gray('\n  ' + t('setup.workspaceSafety.checking')));

    const result = checkWorkspaceSafety(this.workspaceRoot);

    if (result.safe) {
      console.log(chalk.green('  ' + t('setup.workspaceSafety.safe')));
      return true;
    }

    printDangerousWorkspaceWarning(this.workspaceRoot, result);
    console.log(chalk.yellow('  ' + t('setup.workspaceSafety.unsafe', { reason: result.reason || '' })));

    const continueUnsafe = await showConfirm({
      title: t('setup.workspaceSafety.continueUnsafe'),
      defaultValue: false
    });

    return continueUnsafe;
  }

  /**
   * Prompt for notification preferences
   */
  private async promptNotifications(): Promise<void> {
    this.state.currentStep = 'notifications';

    console.log();
    console.log(chalk.gray('  ────────────────────────────────────────────────────────'));
    console.log(chalk.white.bold('  ' + t('setup.notifications.title')));
    console.log(chalk.gray('  ────────────────────────────────────────────────────────'));
    console.log();
    console.log(chalk.gray('  ' + t('setup.notifications.description')));
    console.log();

    const enabled = await showConfirm({
      title: t('setup.notifications.enablePrompt'),
      defaultValue: true
    });

    let sound = true;
    if (enabled) {
      sound = await showConfirm({
        title: t('setup.notifications.soundPrompt'),
        defaultValue: true
      });
    }

    this.state.notifications = { enabled, sound };
  }

  /**
   * Prompt for network settings
   */
  private async promptNetwork(): Promise<void> {
    this.state.currentStep = 'network';

    const needCustom = await showConfirm({
      title: t('setup.network.needCustom'),
      defaultValue: false
    });

    if (!needCustom) {
      this.state.skipped.push('network');
      return;
    }

    const maxRetriesStr = await showInput({
      title: t('setup.network.maxRetries'),
      defaultValue: '3',
      validate: (val: string) => {
        const n = parseInt(val, 10);
        if (isNaN(n) || n < 1 || n > 5) return 'Enter a number between 1 and 5';
        return true;
      }
    });

    const timeoutStr = await showInput({
      title: t('setup.network.timeout'),
      defaultValue: '30000',
      validate: (val: string) => {
        const n = parseInt(val, 10);
        if (isNaN(n) || n < 5000 || n > 120000) return 'Enter a number between 5000 and 120000';
        return true;
      }
    });

    this.state.network = {
      maxRetries: parseInt(maxRetriesStr || '3', 10),
      timeout: parseInt(timeoutStr || '30000', 10)
    };
  }

  /**
   * Prompt for web search provider
   */
  private async promptSearch(): Promise<void> {
    this.state.currentStep = 'search';

    const options: ModalOption[] = [
      { label: 'Google', value: 'google', description: 'Default web search' },
      { label: 'Brave Search', value: 'brave', description: 'Privacy-focused search (requires API key)' },
      { label: 'DuckDuckGo', value: 'duckduckgo', description: 'Privacy-focused, no API key needed' },
      { label: 'Parallel.ai', value: 'parallel', description: 'AI-optimized search (requires API key)' }
    ];

    const result = await showModal({
      title: t('setup.search.prompt'),
      options
    });

    const provider = (result?.value as SearchProvider) ?? 'google';
    const searchState: OnboardingState['search'] = { provider };

    if (provider === 'brave') {
      const key = await showPassword({ title: t('setup.search.braveKeyPrompt') });
      if (key) searchState.braveApiKey = key;
    } else if (provider === 'parallel') {
      const key = await showPassword({ title: t('setup.search.parallelKeyPrompt') });
      if (key) searchState.parallelApiKey = key;
    }

    this.state.search = searchState;
  }

  /**
   * Prompt for MCP support
   */
  private async promptMcp(): Promise<void> {
    this.state.currentStep = 'mcp';

    console.log();
    console.log(chalk.gray('  ' + t('setup.mcp.description')));
    console.log();

    const enabled = await showConfirm({
      title: t('setup.mcp.enablePrompt'),
      defaultValue: true
    });

    this.state.mcpEnabled = enabled;

    if (enabled) {
      console.log(chalk.green('  ' + t('setup.mcp.enabled')));
    }
  }

  /**
   * Prompt for agent behavior settings
   */
  private async promptAgentBehavior(): Promise<void> {
    this.state.currentStep = 'agentBehavior';

    const maxIterStr = await showInput({
      title: t('setup.agent.maxIterationsPrompt'),
      defaultValue: '100',
      validate: (val: string) => {
        const n = parseInt(val, 10);
        if (isNaN(n) || n < 10 || n > 500) return 'Enter a number between 10 and 500';
        return true;
      }
    });

    const debug = await showConfirm({
      title: t('setup.agent.debugPrompt'),
      defaultValue: false
    });

    this.state.agentSettings = {
      maxIterations: parseInt(maxIterStr || '100', 10),
      debug
    };

    console.log(chalk.green('  ' + t('setup.agent.set')));
  }

  /**
   * Prompt for community skills
   */
  private async promptCommunitySkills(): Promise<void> {
    this.state.currentStep = 'communitySkills';

    console.log();
    console.log(chalk.gray('  ' + t('setup.communitySkills.description')));
    console.log();

    const enabled = await showConfirm({
      title: t('setup.communitySkills.enablePrompt'),
      defaultValue: true
    });

    this.state.communitySkillsEnabled = enabled;
  }

  /**
   * Show review summary and confirm settings
   */
  private async promptReviewConfirm(): Promise<boolean> {
    this.state.currentStep = 'reviewSummary';

    console.log();
    console.log(chalk.gray('  ────────────────────────────────────────────────────────'));
    console.log(chalk.white.bold('  ' + t('setup.review.title')));
    console.log(chalk.gray('  ────────────────────────────────────────────────────────'));
    console.log();

    if (this.state.locale) {
      console.log(chalk.white(`  Language: ${LANGUAGE_DISPLAY_NAMES[this.state.locale]}`));
    }
    if (this.state.provider) {
      console.log(chalk.white('  ' + t('setup.review.provider', { provider: this.getProviderDisplayName(this.state.provider) })));
    }
    if (this.state.model) {
      console.log(chalk.white('  ' + t('setup.review.model', { model: this.state.model })));
    }
    if (this.state.permissionMode) {
      console.log(chalk.white(`  Permissions: ${this.state.permissionMode}`));
    }
    console.log(chalk.white(`  Telemetry: ${this.state.telemetryEnabled ? 'enabled' : 'disabled'}`));
    console.log(chalk.white(`  Auto-report: ${this.state.autoReportEnabled ? 'enabled' : 'disabled'}`));

    if (this.state.notifications) {
      console.log(chalk.white(`  Notifications: ${this.state.notifications.enabled ? 'enabled' : 'disabled'}`));
    }
    if (this.state.search?.provider) {
      console.log(chalk.white(`  Search: ${this.state.search.provider}`));
    }
    if (this.state.mcpEnabled !== undefined) {
      console.log(chalk.white(`  MCP: ${this.state.mcpEnabled ? 'enabled' : 'disabled'}`));
    }
    console.log();

    const confirmed = await showConfirm({
      title: t('setup.review.confirm'),
      defaultValue: true
    });

    if (!confirmed) {
      console.log(chalk.gray('  ' + t('setup.review.goBack')));
    }

    return confirmed;
  }

  /**
   * Check if a provider is local (no API key, has server to test)
   */
  private isLocalProvider(provider: ProviderName): boolean {
    return provider === 'ollama' || provider === 'llamacpp' || provider === 'mlx';
  }
  // Helper methods

  private requiresApiKey(provider: ProviderName): boolean {
    return provider === 'openrouter' || provider === 'openai' || provider === 'llmgateway';
  }

  private getProviderDisplayName(provider: ProviderName): string {
    return t(`providers.${provider}`);
  }

  private getProviderHint(provider: ProviderName): string {
    return t(`providers.hints.${provider}`);
  }

  private getApiKeyUrl(provider: ProviderName): string {
    const urls: Record<string, string> = {
      openrouter: t('providers.wizard.openrouter.apiKeyUrl'),
      openai: t('providers.wizard.openai.apiKeyUrl'),
      llmgateway: t('providers.wizard.llmgateway.apiKeyUrl')
    };
    return urls[provider] || '';
  }

  private getDefaultModel(provider: ProviderName): string {
    const defaults: Record<ProviderName, string> = {
      openrouter: 'anthropic/claude-sonnet-4-20250514',
      openai: 'gpt-4o',
      ollama: 'llama3.2:latest',
      llamacpp: 'default',
      mlx: 'mlx-community/Llama-3.2-3B-Instruct-4bit',
      llmgateway: 'gpt-4o',
      azure: 'gpt-5.3-codex'
    };
    return defaults[provider] || '';
  }

  private getDefaultBaseUrl(provider: ProviderName): string {
    const urls: Record<ProviderName, string> = {
      openrouter: 'https://openrouter.ai/api/v1',
      openai: 'https://api.openai.com/v1',
      ollama: 'http://localhost:11434',
      llamacpp: 'http://localhost:8080',
      mlx: 'http://localhost:8080',
      llmgateway: 'https://api.llmgateway.io/v1',
      azure: 'https://{resourceName}.openai.azure.com'
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
    // Wait for Enter key
    await new Promise<void>(resolve => {
      process.stdin.once('data', () => resolve());
    });
  }
}
