/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import chalk from 'chalk';
import enquirer from 'enquirer';
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
 * NOTE: Uses enquirer for prompts - will be migrated to Ink later.
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
      const providerChoices = allProviders.map(name => {
        const isConfigured = this.isProviderConfigured(name);
        const indicator = isConfigured ? chalk.green('●') : chalk.red('○');
        const current = name === this.getActiveProvider() ? chalk.cyan(' (current)') : '';
        // Add Apple Silicon indicator for MLX
        const siliconNote = name === 'mlx' ? chalk.gray(' (Apple Silicon)') : '';
        return {
          name,
          message: `${indicator} ${name}${current}${siliconNote}`,
          value: name
        };
      });

      const providerAnswer = await enquirer.prompt<{ provider: ProviderName }>([
        {
          type: 'select',
          name: 'provider',
          message: 'Choose an LLM provider',
          choices: providerChoices
        }
      ]);

      const selectedProvider = providerAnswer.provider;

      // Check if provider needs configuration
      if (!this.isProviderConfigured(selectedProvider)) {
        console.log(chalk.yellow(`\n${selectedProvider} is not configured yet. Let's set it up!\n`));
        await this.configureProvider(selectedProvider);
        return;
      }

      // Provider is configured, let them change the model
      await this.changeProviderModel(selectedProvider);
    } catch (error) {
      // Handle cancellation gracefully (ESC or Ctrl+C)
      if ((error as any).name === 'ExitPromptError' || (error as Error).message?.includes('canceled')) {
        console.log(chalk.gray('\nConfiguration cancelled.'));
        return;
      }
      // Re-throw unexpected errors
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

      const answers = await enquirer.prompt<{ apiKey: string; model: string }>([
        {
          type: 'password',
          name: 'apiKey',
          message: 'Enter your OpenRouter API key'
        },
        {
          type: 'input',
          name: 'model',
          message: 'Enter the model ID',
          initial: 'anthropic/claude-3.5-sonnet'
        }
      ]);

      this.runtime.config.openrouter = {
        apiKey: answers.apiKey,
        baseUrl: 'https://openrouter.ai/api/v1',
        model: answers.model
      };

      this.runtime.config.provider = 'openrouter';
      this.runtime.options.model = answers.model;
      await saveConfig(this.runtime.config);
      this.resetLlmClient('openrouter', answers.model);

      console.log(chalk.green('\n✓ OpenRouter configured successfully!'));
    } catch (error) {
      if ((error as any).name === 'ExitPromptError' || (error as Error).message?.includes('canceled')) {
        console.log(chalk.gray('\nConfiguration cancelled.'));
        return;
      }
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

      let modelAnswer;
      if (availableModels.length > 0) {
        console.log(chalk.green(`Found ${availableModels.length} model(s)\n`));
        modelAnswer = await enquirer.prompt<{ model: string }>([
          {
            type: 'select',
            name: 'model',
            message: 'Select a model',
            choices: availableModels
          }
        ]);
      } else {
        modelAnswer = await enquirer.prompt<{ model: string }>([
          {
            type: 'input',
            name: 'model',
            message: 'Enter the model name (e.g., llama3.2:latest)',
            initial: 'llama3.2:latest'
          }
        ]);
      }

      this.runtime.config.ollama = {
        baseUrl: ollamaUrl,
        model: modelAnswer.model
      };

      this.runtime.config.provider = 'ollama';
      this.runtime.options.model = modelAnswer.model;
      await saveConfig(this.runtime.config);
      this.resetLlmClient('ollama', modelAnswer.model);

      console.log(chalk.green('\n✓ Ollama configured successfully!'));
    } catch (error) {
      if ((error as any).name === 'ExitPromptError' || (error as Error).message?.includes('canceled')) {
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

      const answers = await enquirer.prompt<{ port: string; model: string }>([
        {
          type: 'input',
          name: 'port',
          message: 'Server port',
          initial: '8080'
        },
        {
          type: 'input',
          name: 'model',
          message: 'Model name/description',
          initial: 'llama-model'
        }
      ]);

      this.runtime.config.llamacpp = {
        baseUrl: `http://localhost:${answers.port}`,
        port: parseInt(answers.port),
        model: answers.model
      };

      this.runtime.config.provider = 'llamacpp';
      this.runtime.options.model = answers.model;
      await saveConfig(this.runtime.config);
      this.resetLlmClient('llamacpp', answers.model);

      console.log(chalk.green('\n✓ llama.cpp configured successfully!'));
    } catch (error) {
      if ((error as any).name === 'ExitPromptError' || (error as Error).message?.includes('canceled')) {
        console.log(chalk.gray('\nConfiguration cancelled.'));
        return;
      }
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

      const modelChoices = [
        'gpt-4o',
        'gpt-4o-mini',
        'gpt-4-turbo',
        'gpt-4',
        'gpt-3.5-turbo'
      ];

      const answers = await enquirer.prompt<{ apiKey: string; model: string }>([
        {
          type: 'password',
          name: 'apiKey',
          message: 'Enter your OpenAI API key'
        },
        {
          type: 'select',
          name: 'model',
          message: 'Select a model',
          choices: modelChoices
        }
      ]);

      this.runtime.config.openai = {
        apiKey: answers.apiKey,
        baseUrl: 'https://api.openai.com/v1',
        model: answers.model
      };

      this.runtime.config.provider = 'openai';
      this.runtime.options.model = answers.model;
      await saveConfig(this.runtime.config);
      this.resetLlmClient('openai', answers.model);

      console.log(chalk.green('\n✓ OpenAI configured successfully!'));
    } catch (error) {
      if ((error as any).name === 'ExitPromptError' || (error as Error).message?.includes('canceled')) {
        console.log(chalk.gray('\nConfiguration cancelled.'));
        return;
      }
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

      let modelAnswer;
      if (availableModels.length > 0) {
        modelAnswer = await enquirer.prompt<{ model: string }>([
          {
            type: 'select',
            name: 'model',
            message: 'Select a model',
            choices: availableModels
          }
        ]);
      } else {
        modelAnswer = await enquirer.prompt<{ model: string }>([
          {
            type: 'input',
            name: 'model',
            message: 'Enter model name (e.g., mlx-community/Llama-3.2-3B-Instruct-4bit)',
            initial: 'mlx-community/Llama-3.2-3B-Instruct-4bit'
          }
        ]);
      }

      this.runtime.config.mlx = {
        baseUrl: mlxUrl,
        model: modelAnswer.model
      };

      this.runtime.config.provider = 'mlx';
      this.runtime.options.model = modelAnswer.model;
      await saveConfig(this.runtime.config);
      this.resetLlmClient('mlx', modelAnswer.model);

      console.log(chalk.green('\n✓ MLX configured successfully!'));
    } catch (error) {
      if ((error as any).name === 'ExitPromptError' || (error as Error).message?.includes('canceled')) {
        console.log(chalk.gray('\nConfiguration cancelled.'));
        return;
      }
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
              const answer = await enquirer.prompt<{ model: string }>([
                {
                  type: 'select',
                  name: 'model',
                  message: 'Select a model',
                  choices: models,
                  initial: models.indexOf(currentModel)
                }
              ]);
              await this.applyModelChange(provider, answer.model, currentModel);
              return;
            }
          }
        } catch {
          // Fall through to manual input
        }
      }

      // For other providers, manual input
      const answer = await enquirer.prompt<{ model: string }>([
        {
          type: 'input',
          name: 'model',
          message: 'Enter the model ID to use',
          initial: currentModel
        }
      ]);

      await this.applyModelChange(provider, answer.model?.trim(), currentModel);
    } catch (error) {
      if ((error as any).name === 'ExitPromptError' || (error as Error).message?.includes('canceled')) {
        console.log(chalk.gray('\nModel change cancelled.'));
        return;
      }
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

    const { action } = await enquirer.prompt<{ action: string }>([
      {
        type: 'select',
        name: 'action',
        message: 'What would you like to change?',
        choices: [
          { name: 'model', message: 'Change model only' },
          { name: 'apiKey', message: 'Change API key only' },
          { name: 'both', message: 'Change both model and API key' }
        ]
      }
    ]);

    let newModel = currentModel;
    let newApiKey = currentSettings?.apiKey || '';

    // Handle API key change
    if (action === 'apiKey' || action === 'both') {
      const keyUrl = provider === 'openai'
        ? 'https://platform.openai.com/api-keys'
        : 'https://openrouter.ai/keys';
      console.log(chalk.gray(`\nGet your API key at: ${keyUrl}\n`));

      const { apiKey } = await enquirer.prompt<{ apiKey: string }>([
        {
          type: 'password',
          name: 'apiKey',
          message: `Enter your ${providerName} API key`,
          validate: (val: unknown) => {
            const v = val as string;
            if (!v?.trim()) return 'API key is required';
            if (v.length < 10) return 'API key seems too short';
            return true;
          }
        }
      ]);

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
        const { model } = await enquirer.prompt<{ model: string }>([
          {
            type: 'select',
            name: 'model',
            message: 'Select a model',
            choices: models,
            initial: Math.max(0, models.indexOf(currentModel))
          }
        ]);
        newModel = model;
      } else {
        // OpenRouter - allow custom model input
        const { model } = await enquirer.prompt<{ model: string }>([
          {
            type: 'input',
            name: 'model',
            message: 'Enter the model ID',
            initial: currentModel || 'anthropic/claude-sonnet-4-20250514'
          }
        ]);
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
