/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import chalk from 'chalk';
import { t, changeLanguage, detectLocale, SUPPORTED_LOCALES, LANGUAGE_DISPLAY_NAMES } from '../i18n/index.js';
import type { SupportedLocale } from '../i18n/index.js';
import { showModal, showInput, showPassword, showConfirm, type ModalOption } from '../ui/ink/components/Modal.js';
import { ASCII_FRIEND } from '../utils/asciiArt.js';
import fse from 'fs-extra';
import { join } from 'path';

import type { AutohandConfig, LoadedConfig, ProviderName, AzureSettings, AzureAuthMethod, PermissionMode, SearchProvider, ReasoningEffort, OpenAIAuthMode, OpenAIChatGPTAuth, OpenAISettings, VertexAISettings } from '../types.js';
import { getProviderConfig } from '../config.js';
import { ProviderFactory } from '../providers/ProviderFactory.js';
import { ZAI_MODELS, ZAI_DEFAULT_BASE_URL } from '../providers/ZaiProvider.js';
import { CEREBRAS_MODELS, CEREBRAS_DEFAULT_BASE_URL } from '../providers/CerebrasProvider.js';
import { authenticateOpenAIChatGPT, isChatGPTAuthExpired } from '../providers/openaiAuth.js';
import { installLlamaCpp, probeLlamaCppEnvironment } from '../providers/llamaCppSetup.js';
import { ProjectAnalyzer } from './projectAnalyzer.js';
import { AgentsGenerator } from './agentsGenerator.js';
import { checkWorkspaceSafety, printDangerousWorkspaceWarning } from '../startup/workspaceSafety.js';
import { getAuthClient } from '../auth/index.js';
import { AUTH_CONFIG } from '../constants.js';
import {
  isGcloudInstalled,
  getGcloudProject,
  getGcloudAccessToken,
  getGcloudAccount,
} from '../utils/gcloudAuth.js';

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
  | 'registration'
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
  providerBaseUrl?: string;
  telemetryEnabled?: boolean;
  autoReportEnabled?: boolean;
  preferences?: {
    theme?: string;
    autoConfirm?: boolean;
    checkForUpdates?: boolean;
  };
  azureConfig?: AzureSettings;
  vertexaiConfig?: VertexAISettings;
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
  reasoningEffort?: ReasoningEffort;
  openAIAuthMode?: OpenAIAuthMode;
  openAIChatGPTAuth?: OpenAIChatGPTAuth;
  authToken?: string;
  authUser?: { id: string; email: string; name: string };
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
        skippedSteps: ['welcome', 'language', 'workspaceSafety', 'provider', 'apiKey', 'model', 'permissions', 'telemetry', 'preferences', 'advanced', 'agentsFile', 'registration', 'reviewSummary'],
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

      // Step 5: Provider-specific configuration (API key + validation OR Azure/VertexAI flow)
      if (provider === 'azure') {
        const azureResult = await this.promptAzureConfig();
        if (!azureResult) return this.cancelled();
      } else if (provider === 'vertexai') {
        const vertexaiResult = await this.promptVertexAIConfig();
        if (!vertexaiResult) return this.cancelled();
      } else {
        if (provider === 'llamacpp') {
          const ready = await this.prepareLlamaCpp();
          if (!ready) return this.cancelled();
        }

        if (provider === 'openai') {
          const authMode = await this.promptOpenAIAuthMode();
          if (!authMode) return this.cancelled();
          this.state.openAIAuthMode = authMode;

          if (authMode === 'chatgpt') {
            const chatgptAuth = await this.promptOpenAIChatGPTAuth();
            if (!chatgptAuth) return this.cancelled();
            this.state.openAIChatGPTAuth = chatgptAuth;
          } else {
            const apiKey = await this.promptApiKey(provider);
            if (apiKey === null) return this.cancelled();
            await this.validateApiKeyDuringSetup();
          }
        } else if (this.requiresApiKey(provider)) {
          const apiKey = await this.promptApiKey(provider);
          if (apiKey === null) return this.cancelled();
          // Validate API key for cloud providers
          await this.validateApiKeyDuringSetup();
        }

        const model = await this.promptModel(provider);
        if (!model) return this.cancelled();

        // Step 6b: Reasoning effort for OpenAI
        if (provider === 'openai') {
          await this.promptReasoningEffort();
        }
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

      // Step 14: Autohand account registration (optional, skip in quickSetup)
      if (!options?.quickSetup) {
        await this.promptRegistration();
      } else {
        this.state.skipped.push('registration');
      }

      // Step 15: Review summary (skip in quickSetup)
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
    if (provider === 'openai') {
      return this.isOpenAIConfigured(providerConfig as OpenAISettings);
    }

    if (provider === 'vertexai') {
      const vertexaiConfig = providerConfig as VertexAISettings;
      return !!(vertexaiConfig.authToken && vertexaiConfig.authToken.length >= 10);
    }

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
    if (provider === 'openai') {
      return this.isOpenAIConfigured(providerConfig as OpenAISettings);
    }

    if (provider === 'vertexai') {
      const vertexaiConfig = providerConfig as VertexAISettings;
      return !!(vertexaiConfig.authToken && vertexaiConfig.authToken.length >= 10);
    }

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
      placeholder: t('ui.apiKeyPlaceholder'),
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

  private async promptOpenAIAuthMode(): Promise<OpenAIAuthMode | null> {
    const result = await showModal({
      title: t('providers.openaiAuth.chooseTitle'),
      options: [
        {
          label: t('providers.openaiAuth.apiKeyLabel'),
          value: 'api-key',
          description: t('providers.openaiAuth.apiKeyDescription')
        },
        {
          label: t('providers.openaiAuth.chatgptLabel'),
          value: 'chatgpt',
          description: t('providers.openaiAuth.chatgptDescription')
        }
      ],
      initialIndex: this.getExistingOpenAIAuthMode() === 'chatgpt' ? 1 : 0
    });

    return (result?.value as OpenAIAuthMode | undefined) ?? null;
  }

  private async promptOpenAIChatGPTAuth(): Promise<OpenAIChatGPTAuth | null> {
    const existing = this.getExistingOpenAIChatGPTAuth();
    if (existing && !isChatGPTAuthExpired(existing)) {
      this.state.openAIChatGPTAuth = existing;
      return existing;
    }

    try {
      console.log(chalk.gray(`\n  ${t('providers.openaiAuth.starting')}`));
      const auth = await authenticateOpenAIChatGPT({
        onPrompt: ({ authorizationUrl, browserOpened }) => {
          console.log(chalk.gray(`\n  ${t('providers.openaiAuth.browserPrompt')}`));
          console.log(chalk.white(`  ${authorizationUrl}`));
          console.log(chalk.gray(`  ${browserOpened ? t('providers.openaiAuth.browserOpened') : t('providers.openaiAuth.openManually')}`));
          console.log(chalk.gray(`  ${t('providers.openaiAuth.waiting')}\n`));
        },
      });
      this.state.openAIChatGPTAuth = auth;
      return auth;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(chalk.red(`\n  ${t('providers.openaiAuth.failed', { message })}`));
      throw error;
    }
  }

  /**
   * Prompt for model selection
   */
  private async promptModel(provider: ProviderName): Promise<string | null> {
    this.state.currentStep = 'model';

    const defaultModel = this.getDefaultModel(provider);

    if (provider === 'llamacpp') {
      this.state.model = defaultModel;
      return this.state.model;
    }

    if (provider === 'zai') {
      const options: ModalOption[] = ZAI_MODELS.map((modelName) => ({
        label: modelName,
        value: modelName,
      }));
      const defaultIndex = Math.max(0, ZAI_MODELS.indexOf(defaultModel as (typeof ZAI_MODELS)[number]));
      const result = await showModal({
        title: t('providers.config.selectModel'),
        options,
        initialIndex: defaultIndex >= 0 ? defaultIndex : 0,
      });

      if (!result) {
        return null;
      }

      this.state.model = result.value as string;
      return this.state.model;
    }

    if (provider === 'cerebras') {
      const options: ModalOption[] = CEREBRAS_MODELS.map((modelName) => ({
        label: modelName,
        value: modelName,
      }));
      const defaultIndex = Math.max(0, CEREBRAS_MODELS.indexOf(defaultModel as (typeof CEREBRAS_MODELS)[number]));
      const result = await showModal({
        title: t('providers.config.selectModel'),
        options,
        initialIndex: defaultIndex >= 0 ? defaultIndex : 0,
      });

      if (!result) {
        return null;
      }

      this.state.model = result.value as string;
      return this.state.model;
    }

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
   * Prompt for reasoning effort level (OpenAI only)
   */
  private async promptReasoningEffort(): Promise<void> {
    const options: ModalOption[] = [
      { label: 'none', value: 'none', description: 'No extended reasoning' },
      { label: 'low', value: 'low', description: 'Faster responses, minimal reasoning' },
      { label: 'medium', value: 'medium', description: 'Balanced speed and reasoning' },
      { label: 'high', value: 'high', description: 'Thorough reasoning (recommended)' },
      { label: 'xhigh', value: 'xhigh', description: 'Maximum reasoning depth' },
    ];

    const result = await showModal({
      title: t('providers.config.selectReasoningEffort'),
      options,
      initialIndex: 3, // default to 'high'
    });

    if (result) {
      this.state.reasoningEffort = result.value as ReasoningEffort;
    }
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
   * Prompt user to create an Autohand account using device-flow auth.
   * Account creation is now mandatory to use Autohand.
   * Reuses the same flow as /login command.
   */
  private async promptRegistration(): Promise<void> {
    this.state.currentStep = 'registration';

    console.log();
    console.log(chalk.gray('  ────────────────────────────────────────────────────────'));
    console.log(chalk.white.bold('  ' + t('setup.registration.title')));
    console.log(chalk.gray('  ────────────────────────────────────────────────────────'));
    console.log();
    console.log(chalk.gray('  ' + t('setup.registration.descriptionMandatory')));
    console.log();

    // Run device-flow auth (same as /login)
    const authClient = getAuthClient();

    console.log(chalk.gray('  ' + t('setup.registration.initiating')));
    const initResult = await authClient.initiateDeviceAuth();

    if (!initResult.success || !initResult.deviceCode || !initResult.userCode) {
      console.log(chalk.yellow('  ' + t('setup.registration.failed', { error: initResult.error || 'Unknown error' })));
      
      // Allow retry since auth failed
      const retry = await showConfirm({
        title: t('setup.registration.retryPrompt'),
        defaultValue: true
      });
      
      if (retry) {
        return this.promptRegistration();
      }
      
      this.state.skipped.push('registration');
      console.log(chalk.gray('  ' + t('setup.registration.tryLater')));
      return;
    }

    // Display user code and open browser
    const authUrl = initResult.verificationUriComplete || `${AUTH_CONFIG.authorizationUrl}?code=${initResult.userCode}`;
    console.log();
    console.log(chalk.white('  ' + t('setup.registration.visit')));
    console.log(chalk.cyan(  '  ' + authUrl));
    console.log();
    console.log(chalk.gray('  ' + t('setup.registration.code')));
    console.log(chalk.bold.yellow(`  ${initResult.userCode}`));
    console.log();

    // Try to open browser
    try {
      const open = await import('open').then(m => m.default).catch(() => null);
      if (open) {
        await open(authUrl);
        console.log(chalk.gray('  ' + t('setup.registration.browserOpened')));
      } else {
        console.log(chalk.yellow('  ' + t('setup.registration.openManually')));
      }
    } catch {
      console.log(chalk.yellow('  ' + t('setup.registration.openManually')));
    }

    console.log();
    console.log(chalk.gray('  ' + t('setup.registration.waiting')));

    // Poll for authorization (shorter timeout for onboarding — 3 minutes)
    const startTime = Date.now();
    const timeout = 3 * 60 * 1000;
    const pollInterval = initResult.interval ? initResult.interval * 1000 : AUTH_CONFIG.pollInterval;

    let dots = 0;
    const maxDots = 3;

    while (Date.now() - startTime < timeout) {
      process.stdout.write(`\r  ${chalk.gray('Waiting' + '.'.repeat(dots + 1) + ' '.repeat(maxDots - dots))}`);
      dots = (dots + 1) % (maxDots + 1);

      await this.sleep(pollInterval);

      const pollResult = await authClient.pollDeviceAuth(initResult.deviceCode);

      if (pollResult.status === 'authorized' && pollResult.token && pollResult.user) {
        process.stdout.write('\r' + ' '.repeat(20) + '\r');

        this.state.authToken = pollResult.token;
        this.state.authUser = pollResult.user;

        console.log();
        console.log(chalk.green('  ' + t('setup.registration.success', { name: pollResult.user.name || pollResult.user.email })));
        return;
      }

      if (pollResult.status === 'expired') {
        process.stdout.write('\r' + ' '.repeat(20) + '\r');
        console.log(chalk.yellow('  ' + t('setup.registration.expired')));
        
        // Allow retry
        const retry = await showConfirm({
          title: t('setup.registration.retryPrompt'),
          defaultValue: true
        });
        
        if (retry) {
          return this.promptRegistration();
        }
        
        this.state.skipped.push('registration');
        console.log(chalk.gray('  ' + t('setup.registration.tryLater')));
        return;
      }
    }

    // Timeout
    process.stdout.write('\r' + ' '.repeat(20) + '\r');
    console.log(chalk.yellow('  ' + t('setup.registration.timeout')));
    
    // Allow retry
    const retry = await showConfirm({
      title: t('setup.registration.retryPrompt'),
      defaultValue: true
    });
    
    if (retry) {
      return this.promptRegistration();
    }
    
    this.state.skipped.push('registration');
    console.log(chalk.gray('  ' + t('setup.registration.tryLater')));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
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
      } else if (this.state.provider === 'openai' && this.state.openAIAuthMode === 'chatgpt') {
        config.openai = {
          authMode: 'chatgpt',
          chatgptAuth: this.state.openAIChatGPTAuth,
          model: this.state.model ?? this.getDefaultModel('openai'),
          baseUrl: 'https://chatgpt.com/backend-api/codex',
          ...(this.state.reasoningEffort !== undefined && { reasoningEffort: this.state.reasoningEffort })
        };
      } else if (this.state.provider === 'openai') {
        config.openai = {
          authMode: 'api-key',
          apiKey: this.state.apiKey,
          model: this.state.model ?? this.getDefaultModel('openai'),
          baseUrl: this.getDefaultBaseUrl('openai'),
          ...(this.state.reasoningEffort !== undefined && { reasoningEffort: this.state.reasoningEffort })
        };
      } else if (this.state.provider === 'vertexai' && this.state.vertexaiConfig) {
        config.vertexai = this.state.vertexaiConfig;
      } else if (this.requiresApiKey(this.state.provider)) {
        (config as any)[this.state.provider] = {
          apiKey: this.state.apiKey,
          model: this.state.model,
          baseUrl: this.getDefaultBaseUrl(this.state.provider),
          ...(this.state.reasoningEffort !== undefined && { reasoningEffort: this.state.reasoningEffort })
        };
      } else {
        (config as any)[this.state.provider] = {
          model: this.state.model,
          baseUrl: this.state.providerBaseUrl ?? this.getDefaultBaseUrl(this.state.provider)
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

    // Set auth if registered during onboarding
    if (this.state.authToken && this.state.authUser) {
      config.auth = {
        token: this.state.authToken,
        user: this.state.authUser,
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
      apiKey = await showPassword({ title: t('providers.wizard.azure.enterAzureApiKey'), placeholder: t('ui.apiKeyPlaceholder') }) ?? undefined;
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
   * Full Google Cloud Vertex AI configuration flow
   * Shows prerequisites, collects endpoint, region, project ID, auth token, and model
   * Auto-detects gcloud CLI and uses it for automatic token management
   */
  private async promptVertexAIConfig(): Promise<boolean> {
    this.state.currentStep = 'apiKey';

    // Show title and prerequisites
    console.log(chalk.cyan('\n' + t('providers.wizard.vertexai.title')));
    console.log(chalk.gray(t('providers.wizard.vertexai.getStarted') + '\n'));

    // Check if gcloud CLI is installed
    const gcloudInstalled = await isGcloudInstalled();
    const gcloudAccount = gcloudInstalled ? await getGcloudAccount() : null;
    const gcloudProject = gcloudInstalled ? await getGcloudProject() : null;

    // Get existing config for prefills
    const existingConfig = this.existingConfig?.vertexai;
    const existingProjectId = existingConfig?.projectId;
    const existingEndpoint = existingConfig?.endpoint;
    const existingRegion = existingConfig?.region;
    const existingModel = existingConfig?.model;

    // Show gcloud status
    if (gcloudInstalled) {
      console.log(chalk.green('  ✓ gcloud CLI detected'));
      if (gcloudAccount) {
        console.log(chalk.gray(`    Account: ${gcloudAccount}`));
      }
      if (gcloudProject) {
        console.log(chalk.gray(`    Project: ${gcloudProject}`));
      }
      console.log();
    } else {
      console.log(chalk.yellow('  ⚠ gcloud CLI not detected'));
      console.log(chalk.gray('  Install it for automatic token management:'));
      console.log(chalk.gray('  https://cloud.google.com/sdk/docs/install'));
      console.log();
    }

    // Step 1: Endpoint
    const endpoint = await showInput({
      title: t('providers.wizard.vertexai.enterEndpoint'),
      defaultValue: existingEndpoint || 'aiplatform.googleapis.com'
    });
    if (!endpoint) return false;

    // Step 2: Region
    const region = await showInput({
      title: t('providers.wizard.vertexai.enterRegion'),
      defaultValue: existingRegion || 'global'
    });
    if (!region) return false;

    // Step 3: Project ID - prefill from gcloud or existing config
    const defaultProjectId = existingProjectId || gcloudProject || '';
    const projectId = await showInput({
      title: t('providers.wizard.vertexai.enterProjectId'),
      defaultValue: defaultProjectId,
      placeholder: 'YOUR_PROJECT_ID'
    });
    if (!projectId) return false;

    // Step 4: Auth Token - auto-fetch from gcloud if available
    let authToken: string;

    if (gcloudInstalled) {
      console.log(chalk.gray('\n  Fetching access token from gcloud...'));
      const tokenResult = await getGcloudAccessToken();

      if (tokenResult.token) {
        console.log(chalk.green('  ✓ Access token obtained (valid for ~25 minutes)'));
        console.log(chalk.gray('  Tokens are automatically refreshed when using gcloud.'));
        authToken = tokenResult.token;
      } else {
        console.log(chalk.yellow(`  ⚠ ${tokenResult.error}`));
        console.log(chalk.gray('  Please enter token manually or run: gcloud auth login'));
        console.log();

        const manualToken = await showPassword({
          title: t('providers.wizard.vertexai.enterAuthToken'),
          placeholder: t('ui.apiKeyPlaceholder')
        });
        if (!manualToken) return false;
        authToken = manualToken;
      }
    } else {
      // Manual token entry
      console.log(chalk.gray('\n' + t('providers.wizard.vertexai.authTokenHint')));
      console.log(chalk.gray('  ' + t('providers.wizard.vertexai.authTokenCommand')));
      console.log();

      const manualToken = await showPassword({
        title: t('providers.wizard.vertexai.enterAuthToken'),
        placeholder: t('ui.apiKeyPlaceholder')
      });
      if (!manualToken) return false;
      authToken = manualToken;
    }

    // Step 5: Model
    const model = await showInput({
      title: t('providers.wizard.vertexai.enterModel'),
      defaultValue: existingModel || 'zai-org/glm-5-maas'
    });
    if (!model) return false;

    // Store config in state
    this.state.provider = 'vertexai';
    this.state.apiKey = authToken;
    this.state.model = model;
    this.state.providerBaseUrl = `https://${endpoint}/v1/projects/${projectId}/locations/${region}/endpoints/openapi`;
    this.state.vertexaiConfig = {
      authToken,
      endpoint,
      region,
      projectId,
      model
    };

    console.log(chalk.green('\n✓ ' + t('providers.config.configuredSuccessfully', { provider: t('providers.vertexai') })));
    console.log(chalk.gray('  ' + t('providers.config.modelLabel', { model })));
    if (gcloudInstalled) {
      console.log(chalk.gray('  Token auto-refresh enabled via gcloud CLI'));
    }
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
    const baseUrl = this.state.providerBaseUrl ?? this.getDefaultBaseUrl(provider);

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

  private async prepareLlamaCpp(): Promise<boolean> {
    const probe = await probeLlamaCppEnvironment(this.workspaceRoot);
    let detectedPort = probe.port;

    if (probe.baseUrl) {
      this.state.providerBaseUrl = probe.baseUrl;
      console.log(chalk.green(`  Detected llama.cpp server at ${probe.baseUrl}`));
    } else if (probe.installed) {
      console.log(chalk.gray('  llama.cpp is installed but no running server was detected.'));
    } else if (!probe.installPlan) {
      console.log(chalk.yellow('  llama.cpp is not installed and no supported package manager was detected.'));
    } else {
      console.log(chalk.yellow(`  llama.cpp is not installed. Autohand can install it with: ${probe.installPlan.label}`));
      const shouldInstall = await showConfirm({
        title: 'Install llama.cpp now?',
        defaultValue: true
      });

      if (shouldInstall) {
        console.log(chalk.gray(`  Installing llama.cpp with ${probe.installPlan.label}...`));
        const install = await installLlamaCpp(probe.installPlan, this.workspaceRoot);

        if (!install.ok) {
          console.log(chalk.red('  llama.cpp installation failed.'));
          if (install.output) {
            console.log(chalk.gray(`  ${install.output}`));
          }
          return false;
        }

        console.log(chalk.green('  llama.cpp installation completed.'));

        const refreshed = await probeLlamaCppEnvironment(this.workspaceRoot);
        detectedPort = refreshed.port;
        if (refreshed.baseUrl) {
          this.state.providerBaseUrl = refreshed.baseUrl;
          console.log(chalk.green(`  Detected llama.cpp server at ${refreshed.baseUrl}`));
        } else {
          console.log(chalk.gray('  Start llama-server with your model, then Autohand will connect on the detected port.'));
        }
      }
    }

    const port = await showInput({
      title: t('providers.wizard.llamacpp.serverPort'),
      defaultValue: String(detectedPort ?? 80)
    });

    if (!port) {
      return false;
    }

    this.state.providerBaseUrl = `http://localhost:${port}`;

    return true;
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
      const key = await showPassword({ title: t('setup.search.braveKeyPrompt'), placeholder: t('ui.apiKeyPlaceholder') });
      if (key) searchState.braveApiKey = key;
    } else if (provider === 'parallel') {
      const key = await showPassword({ title: t('setup.search.parallelKeyPrompt'), placeholder: t('ui.apiKeyPlaceholder') });
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
    if (this.state.reasoningEffort) {
      console.log(chalk.white('  ' + t('providers.config.reasoningEffortLabel', { level: this.state.reasoningEffort })));
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
    if (this.state.authUser) {
      console.log(chalk.white(`  Account: ${this.state.authUser.email}`));
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
    return provider === 'openrouter' || provider === 'llmgateway' || provider === 'zai' || provider === 'vertexai' || provider === 'xai' || provider === 'cerebras';
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
      llmgateway: t('providers.wizard.llmgateway.apiKeyUrl'),
      zai: t('providers.wizard.zai.apiKeyUrl')
    };
    return urls[provider] || '';
  }

  private getDefaultModel(provider: ProviderName): string {
    const defaults: Record<ProviderName, string> = {
      openrouter: 'nvidia/nemotron-3-super-120b-a12b:free',
      openai: 'gpt-5.4',
      ollama: 'llama3.2:latest',
      llamacpp: 'local',
      mlx: 'mlx-community/Llama-3.2-3B-Instruct-4bit',
      llmgateway: 'gpt-4o',
      azure: 'gpt-5.3-codex',
      zai: 'glm-4.5',
      vertexai: 'zai-org/glm-5-maas',
      xai: 'grok-4.20-reasoning',
      cerebras: 'zai-glm-4.7'
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
      azure: 'https://{resourceName}.openai.azure.com',
      zai: ZAI_DEFAULT_BASE_URL,
      vertexai: 'https://aiplatform.googleapis.com',
      xai: 'https://api.x.ai/v1',
      cerebras: CEREBRAS_DEFAULT_BASE_URL
    };
    return urls[provider] || '';
  }

  private getExistingApiKey(provider: ProviderName): string | null {
    if (!this.existingConfig) return null;
    const config = (this.existingConfig as any)[provider];
    return config?.apiKey || null;
  }

  private getExistingOpenAIAuthMode(): OpenAIAuthMode {
    const config = this.existingConfig?.openai;
    return config?.authMode === 'chatgpt' ? 'chatgpt' : 'api-key';
  }

  private getExistingOpenAIChatGPTAuth(): OpenAIChatGPTAuth | null {
    const auth = this.existingConfig?.openai?.chatgptAuth;
    return auth && auth.accessToken && auth.accountId ? auth : null;
  }

  private isOpenAIConfigured(config: OpenAISettings): boolean {
    if (config.authMode === 'chatgpt') {
      return !!config.chatgptAuth?.accessToken && !!config.chatgptAuth?.accountId;
    }

    return !!config.apiKey && config.apiKey !== 'replace-me' && config.apiKey.length >= 10;
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
