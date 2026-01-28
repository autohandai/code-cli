/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import chalk from 'chalk';
import { showModal, showInput, showPassword, type ModalOption } from '../../ui/ink/components/Modal.js';
import { ProviderFactory } from '../../providers/ProviderFactory.js';
import { saveConfig, getProviderConfig } from '../../config.js';
import { getContextWindow } from '../../utils/context.js';
import type { AgentRuntime, ProviderName } from '../../types.js';
import type { LLMProvider } from '../../providers/LLMProvider.js';
import type { TelemetryManager } from '../../telemetry/TelemetryManager.js';
import type { AgentDelegator } from '../agents/AgentDelegator.js';
import type { ActionExecutor } from '../actionExecutor.js';

/**
 * ProviderConfigManager module
 *
 * Extracted from AutohandAgent for better modularity.
 * Handles all LLM provider configuration, model selection, and API key validation.
 *
 * Uses Ink Modal components for interactive prompts.
 */

export class ProviderConfigManager {
  constructor(
    private runtime: AgentRuntime,
    private getLlm: () => LLMProvider,
    private setLlm: (provider: LLMProvider) => void,
    private getActiveProvider: () => ProviderName,
    private setActiveProvider: (provider: ProviderName) => void,
    private getDelegator: () => AgentDelegator | undefined,
    private setDelegator: (delegator: AgentDelegator) => void,
    private telemetryManager: TelemetryManager,
    private actionExecutor: ActionExecutor,
    private updateContextWindow: (contextWindow: number) => void,
    private resetContextPercent: () => void,
    private emitStatus: () => void
  ) {}

  /**
   * Prompt user to select and configure an LLM provider
   */
  async promptModelSelection(): Promise<void> {
    try {
      // Show all providers with status indicators
      // Use ProviderFactory to get platform-aware list (includes MLX on Apple Silicon)
      const allProviders = ProviderFactory.getProviderNames();
      const providerChoices: ModalOption[] = allProviders.map(name => {
        const isConfigured = this.isProviderConfigured(name);
        const indicator = isConfigured ? chalk.green('●') : chalk.red('○');
        const current = name === this.getActiveProvider() ? chalk.cyan(' (current)') : '';
        // Add Apple Silicon indicator for MLX
        const siliconNote = name === 'mlx' ? chalk.gray(' (Apple Silicon)') : '';
        return {
          label: `${indicator} ${name}${current}${siliconNote}`,
          value: name
        };
      });

      const result = await showModal({
        title: 'Choose an LLM provider',
        options: providerChoices
      });

      if (!result) {
        console.log(chalk.gray('\nConfiguration cancelled.'));
        return;
      }

      const selectedProvider = result.value as ProviderName;

      // Check if provider needs configuration
      if (!this.isProviderConfigured(selectedProvider)) {
        console.log(chalk.yellow(`\n${selectedProvider} is not configured yet. Let's set it up!\n`));
        await this.configureProvider(selectedProvider);
        return;
      }

      // Provider is configured, let them change the model
      await this.changeProviderModel(selectedProvider);
    } catch (error) {
      // Re-throw unexpected errors (cancellation is now handled inline)
      throw error;
    }
  }

  /**
   * Check if a provider is configured with necessary credentials
   */
  isProviderConfigured(provider: ProviderName): boolean {
    const config = this.runtime.config[provider];
    if (!config) return false;

    // For cloud providers, check API key
    if (provider === 'openrouter' || provider === 'openai') {
      return !!config.apiKey && config.apiKey !== 'replace-me';
    }

    // For local providers, just check if model is set
    return !!config.model;
  }

  /**
   * Configure a specific provider (dispatcher to provider-specific methods)
   */
  private async configureProvider(provider: ProviderName): Promise<void> {
    switch (provider) {
      case 'openrouter':
        await this.configureOpenRouter();
        break;
      case 'ollama':
        await this.configureOllama();
        break;
      case 'llamacpp':
        await this.configureLlamaCpp();
        break;
      case 'openai':
        await this.configureOpenAI();
        break;
      case 'mlx':
        await this.configureMLX();
        break;
    }
  }

  /**
   * Configure OpenRouter provider (API key + model)
   */
  private async configureOpenRouter(): Promise<void> {
    try {
      console.log(chalk.cyan('OpenRouter Configuration'));
      console.log(chalk.gray('Get your API key at: https://openrouter.ai/keys\n'));

      const apiKey = await showPassword({
        title: 'Enter your OpenRouter API key'
      });

      if (!apiKey) {
        console.log(chalk.gray('\nConfiguration cancelled.'));
        return;
      }

      const model = await showInput({
        title: 'Enter the model ID',
        defaultValue: 'anthropic/claude-3.5-sonnet'
      });

      if (!model) {
        console.log(chalk.gray('\nConfiguration cancelled.'));
        return;
      }

      this.runtime.config.openrouter = {
        apiKey,
        baseUrl: 'https://openrouter.ai/api/v1',
        model
      };

      this.runtime.config.provider = 'openrouter';
      this.runtime.options.model = model;
      await saveConfig(this.runtime.config);
      this.resetLlmClient('openrouter', model);

      console.log(chalk.green('\n✓ OpenRouter configured successfully!'));
    } catch (error) {
      // Cancellation is now handled inline
      throw error;
    }
  }

  /**
   * Configure Ollama provider (model selection from local server)
   */
  private async configureOllama(): Promise<void> {
    try {
      console.log(chalk.cyan('Ollama Configuration'));
      console.log(chalk.gray('Make sure Ollama is running: ollama serve\n'));

      // Try to fetch available models
      const ollamaUrl = 'http://localhost:11434';
      let availableModels: string[] = [];

      try {
        const response = await fetch(`${ollamaUrl}/api/tags`);
        if (response.ok) {
          const data = await response.json();
          availableModels = data.models?.map((m: any) => m.name) || [];
        }
      } catch {
        console.log(chalk.yellow('⚠ Could not connect to Ollama. Make sure it\'s running.\n'));
      }

      let model: string | null;
      if (availableModels.length > 0) {
        console.log(chalk.green(`Found ${availableModels.length} model(s)\n`));
        const options: ModalOption[] = availableModels.map(name => ({
          label: name,
          value: name
        }));
        const result = await showModal({
          title: 'Select a model',
          options
        });
        model = result?.value as string | null;
      } else {
        model = await showInput({
          title: 'Enter the model name (e.g., llama3.2:latest)',
          defaultValue: 'llama3.2:latest'
        });
      }

      if (!model) {
        console.log(chalk.gray('\nConfiguration cancelled.'));
        return;
      }

      this.runtime.config.ollama = {
        baseUrl: ollamaUrl,
        model
      };

      this.runtime.config.provider = 'ollama';
      this.runtime.options.model = model;
      await saveConfig(this.runtime.config);
      this.resetLlmClient('ollama', model);

      console.log(chalk.green('\n✓ Ollama configured successfully!'));
    } catch (error) {
      if ((error as Error).message?.includes('cancelled')) {
        console.log(chalk.gray('\nConfiguration cancelled.'));
        return;
      }
      throw error;
    }
  }

  /**
   * Configure llama.cpp provider (port + model)
   */
  private async configureLlamaCpp(): Promise<void> {
    try {
      console.log(chalk.cyan('llama.cpp Configuration'));
      console.log(chalk.gray('Make sure llama.cpp server is running: ./server -m model.gguf\n'));

      const port = await showInput({
        title: 'Server port',
        defaultValue: '8080'
      });

      if (!port) {
        console.log(chalk.gray('\nConfiguration cancelled.'));
        return;
      }

      const model = await showInput({
        title: 'Model name/description',
        defaultValue: 'llama-model'
      });

      if (!model) {
        console.log(chalk.gray('\nConfiguration cancelled.'));
        return;
      }

      this.runtime.config.llamacpp = {
        baseUrl: `http://localhost:${port}`,
        port: parseInt(port),
        model
      };

      this.runtime.config.provider = 'llamacpp';
      this.runtime.options.model = model;
      await saveConfig(this.runtime.config);
      this.resetLlmClient('llamacpp', model);

      console.log(chalk.green('\n✓ llama.cpp configured successfully!'));
    } catch (error) {
      // Cancellation is now handled inline
      throw error;
    }
  }

  /**
   * Configure OpenAI provider (API key + model selection)
   */
  private async configureOpenAI(): Promise<void> {
    try {
      console.log(chalk.cyan('OpenAI Configuration'));
      console.log(chalk.gray('Get your API key at: https://platform.openai.com/api-keys\n'));

      const apiKey = await showPassword({
        title: 'Enter your OpenAI API key'
      });

      if (!apiKey) {
        console.log(chalk.gray('\nConfiguration cancelled.'));
        return;
      }

      const modelChoices: ModalOption[] = [
        { label: 'gpt-4o', value: 'gpt-4o' },
        { label: 'gpt-4o-mini', value: 'gpt-4o-mini' },
        { label: 'gpt-4-turbo', value: 'gpt-4-turbo' },
        { label: 'gpt-4', value: 'gpt-4' },
        { label: 'gpt-3.5-turbo', value: 'gpt-3.5-turbo' }
      ];

      const result = await showModal({
        title: 'Select a model',
        options: modelChoices
      });

      if (!result) {
        console.log(chalk.gray('\nConfiguration cancelled.'));
        return;
      }

      const model = result.value as string;

      this.runtime.config.openai = {
        apiKey,
        baseUrl: 'https://api.openai.com/v1',
        model
      };

      this.runtime.config.provider = 'openai';
      this.runtime.options.model = model;
      await saveConfig(this.runtime.config);
      this.resetLlmClient('openai', model);

      console.log(chalk.green('\n✓ OpenAI configured successfully!'));
    } catch (error) {
      // Cancellation is now handled inline
      throw error;
    }
  }

  /**
   * Configure MLX provider (Apple Silicon local inference)
   */
  private async configureMLX(): Promise<void> {
    try {
      console.log(chalk.cyan('MLX Configuration (Apple Silicon)'));
      console.log(chalk.gray('MLX provides local LLM inference optimized for Apple Silicon.'));
      console.log(chalk.gray('Make sure mlx-lm server is running: mlx_lm.server --model <model-name>\n'));

      // Try to fetch available models from MLX server
      const mlxUrl = 'http://localhost:8080';
      let availableModels: string[] = [];

      try {
        const response = await fetch(`${mlxUrl}/v1/models`);
        if (response.ok) {
          const data = await response.json();
          availableModels = data.data?.map((m: any) => m.id) || [];
        }
      } catch {
        console.log(chalk.yellow('⚠ Could not connect to MLX server. Make sure it\'s running.\n'));
      }

      let model: string | null;
      if (availableModels.length > 0) {
        const options: ModalOption[] = availableModels.map(name => ({
          label: name,
          value: name
        }));
        const result = await showModal({
          title: 'Select a model',
          options
        });
        model = result?.value as string | null;
      } else {
        model = await showInput({
          title: 'Enter model name (e.g., mlx-community/Llama-3.2-3B-Instruct-4bit)',
          defaultValue: 'mlx-community/Llama-3.2-3B-Instruct-4bit'
        });
      }

      if (!model) {
        console.log(chalk.gray('\nConfiguration cancelled.'));
        return;
      }

      this.runtime.config.mlx = {
        baseUrl: mlxUrl,
        model
      };

      this.runtime.config.provider = 'mlx';
      this.runtime.options.model = model;
      await saveConfig(this.runtime.config);
      this.resetLlmClient('mlx', model);

      console.log(chalk.green('\n✓ MLX configured successfully!'));
    } catch (error) {
      // Cancellation is now handled inline
      throw error;
    }
  }

  /**
   * Change model for an already-configured provider
   */
  async changeProviderModel(provider: ProviderName): Promise<void> {
    try {
      const currentSettings = getProviderConfig(this.runtime.config, provider);
      const currentModel = this.runtime.options.model ?? currentSettings?.model ?? '';

      // For cloud providers (openai, openrouter), offer to change API key as well
      if (provider === 'openai' || provider === 'openrouter') {
        await this.changeCloudProviderSettings(provider, currentModel, currentSettings);
        return;
      }

      // For Ollama, try to fetch available models
      if (provider === 'ollama' && currentSettings?.baseUrl) {
        try {
          const response = await fetch(`${currentSettings.baseUrl}/api/tags`);
          if (response.ok) {
            const data = await response.json();
            const models = data.models?.map((m: any) => m.name) || [];
            if (models.length > 0) {
              const options: ModalOption[] = models.map(name => ({
                label: name,
                value: name
              }));
              const currentIndex = models.indexOf(currentModel);
              const result = await showModal({
                title: 'Select a model',
                options,
                initialIndex: currentIndex >= 0 ? currentIndex : 0
              });

              if (!result) {
                console.log(chalk.gray('\nModel change cancelled.'));
                return;
              }

              await this.applyModelChange(provider, result.value as string, currentModel);
              return;
            }
          }
        } catch {
          // Fall through to manual input
        }
      }

      // For other providers, manual input
      const model = await showInput({
        title: 'Enter the model ID to use',
        defaultValue: currentModel
      });

      if (!model) {
        console.log(chalk.gray('\nModel change cancelled.'));
        return;
      }

      await this.applyModelChange(provider, model.trim(), currentModel);
    } catch (error) {
      // Cancellation is now handled inline
      throw error;
    }
  }

  /**
   * Change settings for cloud providers (OpenAI/OpenRouter) - API key and/or model
   */
  private async changeCloudProviderSettings(
    provider: 'openai' | 'openrouter',
    currentModel: string,
    currentSettings: { apiKey?: string; baseUrl?: string; model?: string } | null
  ): Promise<void> {
    const providerName = provider === 'openai' ? 'OpenAI' : 'OpenRouter';
    const maskedKey = currentSettings?.apiKey
      ? `...${currentSettings.apiKey.slice(-4)}`
      : 'not set';

    console.log(chalk.cyan(`\n${providerName} Settings`));
    console.log(chalk.gray(`Current model: ${currentModel || 'not set'}`));
    console.log(chalk.gray(`Current API key: ${maskedKey}\n`));

    const actionOptions: ModalOption[] = [
      { label: 'Change model only', value: 'model' },
      { label: 'Change API key only', value: 'apiKey' },
      { label: 'Change both model and API key', value: 'both' }
    ];

    const actionResult = await showModal({
      title: 'What would you like to change?',
      options: actionOptions
    });

    if (!actionResult) {
      console.log(chalk.gray('\nSettings change cancelled.'));
      return;
    }

    const action = actionResult.value as string;

    let newModel = currentModel;
    let newApiKey = currentSettings?.apiKey || '';

    // Handle API key change
    if (action === 'apiKey' || action === 'both') {
      const keyUrl = provider === 'openai'
        ? 'https://platform.openai.com/api-keys'
        : 'https://openrouter.ai/keys';
      console.log(chalk.gray(`\nGet your API key at: ${keyUrl}\n`));

      const apiKey = await showPassword({
        title: `Enter your ${providerName} API key`,
        validate: (val: string) => {
          if (!val?.trim()) return 'API key is required';
          if (val.length < 10) return 'API key seems too short';
          return true;
        }
      });

      if (!apiKey) {
        console.log(chalk.gray('\nSettings change cancelled.'));
        return;
      }

      // Validate the API key
      console.log(chalk.gray('\nValidating API key...'));
      const validationResult = await this.validateApiKey(provider, apiKey.trim());

      if (!validationResult.valid) {
        console.log(chalk.red(`\n✗ ${validationResult.error}`));
        console.log(chalk.gray(validationResult.hint || ''));
        return;
      }

      console.log(chalk.green('✓ API key is valid\n'));
      newApiKey = apiKey.trim();
    }

    // Handle model change
    if (action === 'model' || action === 'both') {
      if (provider === 'openai') {
        const models = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo', 'o1', 'o1-mini'];
        const modelOptions: ModalOption[] = models.map(name => ({
          label: name,
          value: name
        }));
        const currentIndex = Math.max(0, models.indexOf(currentModel));
        const result = await showModal({
          title: 'Select a model',
          options: modelOptions,
          initialIndex: currentIndex
        });

        if (!result) {
          console.log(chalk.gray('\nSettings change cancelled.'));
          return;
        }

        newModel = result.value as string;
      } else {
        // OpenRouter - allow custom model input
        const model = await showInput({
          title: 'Enter the model ID',
          defaultValue: currentModel || 'anthropic/claude-sonnet-4-20250514'
        });

        if (!model) {
          console.log(chalk.gray('\nSettings change cancelled.'));
          return;
        }
        newModel = model.trim();
      }
    }

    // Save the changes
    const baseUrl = provider === 'openai'
      ? 'https://api.openai.com/v1'
      : 'https://openrouter.ai/api/v1';

    this.runtime.config[provider] = {
      apiKey: newApiKey,
      baseUrl,
      model: newModel
    };

    this.runtime.config.provider = provider;
    this.runtime.options.model = newModel;
    await saveConfig(this.runtime.config);
    this.resetLlmClient(provider, newModel);
    this.updateContextWindow(getContextWindow(newModel));
    this.resetContextPercent();
    this.emitStatus();

    console.log(chalk.green(`\n✓ ${providerName} settings updated successfully!`));
    console.log(chalk.gray(`  Provider: ${provider}`));
    console.log(chalk.gray(`  Model: ${newModel}`));
  }

  /**
   * Validate API key by making a test request to the provider
   */
  private async validateApiKey(
    provider: 'openai' | 'openrouter',
    apiKey: string
  ): Promise<{ valid: boolean; error?: string; hint?: string }> {
    try {
      const baseUrl = provider === 'openai'
        ? 'https://api.openai.com/v1'
        : 'https://openrouter.ai/api/v1';

      // Make a simple API call to validate the key
      const response = await fetch(`${baseUrl}/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...(provider === 'openrouter' && {
            'HTTP-Referer': 'https://autohand.dev',
            'X-Title': 'Autohand CLI'
          })
        }
      });

      if (response.ok) {
        return { valid: true };
      }

      // Handle specific error codes
      const status = response.status;
      let errorData: any = {};
      try {
        errorData = await response.json();
      } catch {
        // Ignore JSON parse errors
      }

      if (status === 401) {
        return {
          valid: false,
          error: 'Invalid API key',
          hint: provider === 'openai'
            ? 'Check that your API key is correct at https://platform.openai.com/api-keys'
            : 'Check that your API key is correct at https://openrouter.ai/keys'
        };
      }

      if (status === 403) {
        return {
          valid: false,
          error: 'API key does not have permission',
          hint: 'Your API key may have restricted permissions or your account may need to add a payment method.'
        };
      }

      if (status === 429) {
        return {
          valid: false,
          error: 'Rate limited or quota exceeded',
          hint: 'You may have exceeded your API quota. Check your usage and billing settings.'
        };
      }

      return {
        valid: false,
        error: errorData?.error?.message || `API returned status ${status}`,
        hint: 'Please verify your API key and try again.'
      };
    } catch (error) {
      const err = error as Error;
      if (err.message?.includes('fetch') || err.message?.includes('network')) {
        return {
          valid: false,
          error: 'Network error - could not reach the API',
          hint: 'Check your internet connection and try again.'
        };
      }
      return {
        valid: false,
        error: `Validation failed: ${err.message}`,
        hint: 'Please try again or check your network connection.'
      };
    }
  }

  /**
   * Apply a model change and update all relevant state
   */
  private async applyModelChange(provider: ProviderName, newModel: string, currentModel: string): Promise<void> {
    if (!newModel || (newModel === currentModel && provider === this.getActiveProvider())) {
      console.log(chalk.gray('Model unchanged.'));
      return;
    }

    const previousModel = this.runtime.options.model;
    this.runtime.config.provider = provider;
    this.runtime.options.model = newModel;
    this.setProviderModel(provider, newModel);
    this.resetLlmClient(provider, newModel);
    await saveConfig(this.runtime.config);
    this.updateContextWindow(getContextWindow(newModel));
    this.resetContextPercent();
    this.emitStatus();

    // Track model switch
    await this.telemetryManager.trackModelSwitch({
      fromModel: previousModel,
      toModel: newModel,
      provider
    });

    console.log(chalk.green(`✓ Using ${provider} model ${newModel}`));
  }

  /**
   * Set provider and model in runtime config
   */
  private setProviderModel(provider: ProviderName, model: string): void {
    const cfgMap: Record<ProviderName, any> = {
      openrouter: this.runtime.config.openrouter ?? (this.runtime.config.openrouter = { apiKey: '', model }),
      ollama: this.runtime.config.ollama ?? (this.runtime.config.ollama = { model }),
      llamacpp: this.runtime.config.llamacpp ?? (this.runtime.config.llamacpp = { model }),
      openai: this.runtime.config.openai ?? (this.runtime.config.openai = { model }),
      mlx: this.runtime.config.mlx ?? (this.runtime.config.mlx = { model }),
      llmgateway: this.runtime.config.llmgateway ?? (this.runtime.config.llmgateway = { apiKey: '', model })
    };
    cfgMap[provider].model = model;
    this.setActiveProvider(provider);
  }

  /**
   * Reset the LLM client with a new provider and model
   */
  private resetLlmClient(provider: ProviderName, model: string): void {
    // Update config to use the selected provider and model
    this.runtime.config.provider = provider;
    const providerConfig = this.runtime.config[provider];
    if (providerConfig) {
      providerConfig.model = model;
    }

    // Create new provider using factory
    const newLlm = ProviderFactory.create(this.runtime.config);
    newLlm.setModel(model);
    this.setLlm(newLlm);

    // Recreate delegator with context inheritance
    const delegatorContext = this.runtime.options.clientContext
      ?? (this.runtime.options.restricted ? 'restricted' : 'cli');
    const newDelegator = new AgentDelegator(newLlm, this.actionExecutor, {
      clientContext: delegatorContext,
      maxDepth: 3,
      inherit: true
    });
    this.setDelegator(newDelegator);
    this.setActiveProvider(provider);
  }
}
