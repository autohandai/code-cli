/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import chalk from 'chalk';
import { t } from '../../i18n/index.js';
import { showModal, showInput, showPassword, type ModalOption } from '../../ui/ink/components/Modal.js';
import { ProviderFactory } from '../../providers/ProviderFactory.js';
import { sanitizeModelId } from '../../providers/errors.js';
import { saveConfig, getProviderConfig } from '../../config.js';
import { getContextWindow } from '../../utils/context.js';
import type { AgentRuntime, ProviderName, AzureSettings, AzureAuthMethod } from '../../types.js';
import type { LLMProvider } from '../../providers/LLMProvider.js';
import type { TelemetryManager } from '../../telemetry/TelemetryManager.js';
import { AgentDelegator } from '../agents/AgentDelegator.js';
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
        const current = name === this.getActiveProvider() ? chalk.cyan(' (' + t('providers.config.current') + ')') : '';
        // Add Apple Silicon indicator for MLX
        const siliconNote = name === 'mlx' ? chalk.gray(' (' + t('providers.config.appleSilicon') + ')') : '';
        // Add hosted indicator for cloud providers
        const hostedNote = name === 'llmgateway' ? chalk.gray(' (' + t('providers.config.hosted') + ')') : '';
        return {
          label: `${indicator} ${name}${current}${siliconNote}${hostedNote}`,
          value: name
        };
      });

      const result = await showModal({
        title: t('providers.config.chooseProvider'),
        options: providerChoices
      });

      if (!result) {
        console.log(chalk.gray('\n' + t('providers.config.cancelled')));
        return;
      }

      const selectedProvider = result.value as ProviderName;

      // Check if provider needs configuration
      if (!this.isProviderConfigured(selectedProvider)) {
        console.log(chalk.yellow('\n' + t('providers.config.notConfigured', { provider: selectedProvider }) + '\n'));
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

    // Azure: check auth method - managed identity needs no key, entra-id needs tenant/client, api-key needs apiKey
    if (provider === 'azure') {
      const azureConfig = config as AzureSettings;
      if (azureConfig.authMethod === 'managed-identity') return true;
      if (azureConfig.authMethod === 'entra-id') {
        return !!azureConfig.tenantId && !!azureConfig.clientId && !!azureConfig.clientSecret;
      }
      return !!config.apiKey && config.apiKey !== 'replace-me';
    }

    // For cloud providers, check API key
    if (provider === 'openrouter' || provider === 'openai' || provider === 'llmgateway') {
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
      case 'llmgateway':
        await this.configureLLMGateway();
        break;
      case 'azure':
        await this.configureAzure();
        break;
    }
  }

  /**
   * Configure OpenRouter provider (API key + model)
   */
  private async configureOpenRouter(): Promise<void> {
    try {
      console.log(chalk.cyan(t('providers.wizard.openrouter.title')));
      console.log(chalk.gray(t('providers.config.apiKeyUrl', { url: t('providers.wizard.openrouter.apiKeyUrl') }) + '\n'));

      const apiKey = await showPassword({
        title: t('providers.config.enterApiKey', { provider: t('providers.openrouter') }),
        placeholder: t('ui.apiKeyPlaceholder')
      });

      if (!apiKey) {
        console.log(chalk.gray('\n' + t('providers.config.cancelled')));
        return;
      }

      const model = await showInput({
        title: t('providers.config.enterModelId'),
        defaultValue: 'nvidia/nemotron-3-super-120b-a12b:free'
      });

      if (!model) {
        console.log(chalk.gray('\n' + t('providers.config.cancelled')));
        return;
      }

      this.runtime.config.openrouter = {
        apiKey,
        baseUrl: 'https://openrouter.ai/api/v1',
        model: sanitizeModelId(model)
      };

      this.runtime.config.provider = 'openrouter';
      this.runtime.options.model = model;
      await saveConfig(this.runtime.config);
      this.resetLlmClient('openrouter', model);

      console.log(chalk.green('\n✓ ' + t('providers.config.configuredSuccessfully', { provider: t('providers.openrouter') })));
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
      console.log(chalk.cyan(t('providers.wizard.ollama.title')));
      console.log(chalk.gray(t('providers.wizard.ollama.ensureRunning') + '\n'));

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
        console.log(chalk.yellow('⚠ ' + t('providers.wizard.ollama.cannotConnect') + '\n'));
      }

      let model: string | null;
      if (availableModels.length > 0) {
        console.log(chalk.green(t('providers.wizard.ollama.foundModels', { count: availableModels.length }) + '\n'));
        const options: ModalOption[] = availableModels.map(name => ({
          label: name,
          value: name
        }));
        const result = await showModal({
          title: t('providers.config.selectModel'),
          options
        });
        model = result?.value as string | null;
      } else {
        model = await showInput({
          title: t('providers.wizard.ollama.enterModelName'),
          defaultValue: 'llama3.2:latest'
        });
      }

      if (!model) {
        console.log(chalk.gray('\n' + t('providers.config.cancelled')));
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

      console.log(chalk.green('\n✓ ' + t('providers.config.configuredSuccessfully', { provider: t('providers.ollama') })));
    } catch (error) {
      if ((error as Error).message?.includes('cancelled')) {
        console.log(chalk.gray('\n' + t('providers.config.cancelled')));
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
      console.log(chalk.cyan(t('providers.wizard.llamacpp.title')));
      console.log(chalk.gray(t('providers.wizard.llamacpp.ensureRunning') + '\n'));

      const port = await showInput({
        title: t('providers.wizard.llamacpp.serverPort'),
        defaultValue: '8080'
      });

      if (!port) {
        console.log(chalk.gray('\n' + t('providers.config.cancelled')));
        return;
      }

      const model = await showInput({
        title: t('providers.wizard.llamacpp.modelNameDesc'),
        defaultValue: 'llama-model'
      });

      if (!model) {
        console.log(chalk.gray('\n' + t('providers.config.cancelled')));
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

      console.log(chalk.green('\n✓ ' + t('providers.config.configuredSuccessfully', { provider: t('providers.llamacpp') })));
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
      console.log(chalk.cyan(t('providers.wizard.openai.title')));
      console.log(chalk.gray(t('providers.config.apiKeyUrl', { url: t('providers.wizard.openai.apiKeyUrl') }) + '\n'));

      const apiKey = await showPassword({
        title: t('providers.config.enterApiKey', { provider: t('providers.openai') }),
        placeholder: t('ui.apiKeyPlaceholder')
      });

      if (!apiKey) {
        console.log(chalk.gray('\n' + t('providers.config.cancelled')));
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
        title: t('providers.config.selectModel'),
        options: modelChoices
      });

      if (!result) {
        console.log(chalk.gray('\n' + t('providers.config.cancelled')));
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

      console.log(chalk.green('\n✓ ' + t('providers.config.configuredSuccessfully', { provider: t('providers.openai') })));
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
      console.log(chalk.cyan(t('providers.wizard.mlx.title')));
      console.log(chalk.gray(t('providers.wizard.mlx.description')));
      console.log(chalk.gray(t('providers.wizard.mlx.ensureRunning') + '\n'));

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
        console.log(chalk.yellow('⚠ ' + t('providers.wizard.mlx.cannotConnect') + '\n'));
      }

      let model: string | null;
      if (availableModels.length > 0) {
        const options: ModalOption[] = availableModels.map(name => ({
          label: name,
          value: name
        }));
        const result = await showModal({
          title: t('providers.config.selectModel'),
          options
        });
        model = result?.value as string | null;
      } else {
        model = await showInput({
          title: t('providers.wizard.mlx.enterModelName'),
          defaultValue: 'mlx-community/Llama-3.2-3B-Instruct-4bit'
        });
      }

      if (!model) {
        console.log(chalk.gray('\n' + t('providers.config.cancelled')));
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

      console.log(chalk.green('\n✓ ' + t('providers.config.configuredSuccessfully', { provider: t('providers.mlx') })));
    } catch (error) {
      // Cancellation is now handled inline
      throw error;
    }
  }

  /**
   * Configure LLM Gateway provider (API key + model)
   */
  private async configureLLMGateway(): Promise<void> {
    try {
      console.log(chalk.cyan(t('providers.wizard.llmgateway.title')));
      console.log(chalk.gray(t('providers.config.apiKeyUrl', { url: t('providers.wizard.llmgateway.apiKeyUrl') }) + '\n'));

      const apiKey = await showPassword({
        title: t('providers.config.enterApiKey', { provider: t('providers.llmgateway') }),
        placeholder: t('ui.apiKeyPlaceholder')
      });

      if (!apiKey) {
        console.log(chalk.gray('\n' + t('providers.config.cancelled')));
        return;
      }

      const modelChoices: ModalOption[] = [
        { label: 'gpt-4o', value: 'gpt-4o' },
        { label: 'gpt-4o-mini', value: 'gpt-4o-mini' },
        { label: 'claude-3-5-sonnet-20241022', value: 'claude-3-5-sonnet-20241022' },
        { label: 'claude-3-5-haiku-20241022', value: 'claude-3-5-haiku-20241022' },
        { label: 'gemini-1.5-pro', value: 'gemini-1.5-pro' },
        { label: 'gemini-1.5-flash', value: 'gemini-1.5-flash' }
      ];

      const result = await showModal({
        title: t('providers.config.selectModel'),
        options: modelChoices
      });

      if (!result) {
        console.log(chalk.gray('\n' + t('providers.config.cancelled')));
        return;
      }

      const model = result.value as string;

      this.runtime.config.llmgateway = {
        apiKey,
        baseUrl: 'https://api.llmgateway.io/v1',
        model
      };

      this.runtime.config.provider = 'llmgateway';
      this.runtime.options.model = model;
      await saveConfig(this.runtime.config);
      this.resetLlmClient('llmgateway', model);

      console.log(chalk.green('\n✓ ' + t('providers.config.configuredSuccessfully', { provider: t('providers.llmgateway') })));
    } catch (error) {
      // Cancellation is now handled inline
      throw error;
    }
  }

  /**
   * Configure Azure OpenAI provider
   */
  private async configureAzure(): Promise<void> {
    try {
      console.log(chalk.cyan(t('providers.wizard.azure.title')));
      console.log(chalk.gray(t('providers.wizard.azure.getStarted') + '\n'));

      console.log(chalk.yellow(`\n${t('providers.wizard.azure.setupSteps.title')}`));
      console.log(chalk.gray(`  ${t('providers.wizard.azure.setupSteps.step1')}`));
      console.log(chalk.gray(`  ${t('providers.wizard.azure.setupSteps.step2')}`));
      console.log(chalk.gray(`  ${t('providers.wizard.azure.setupSteps.step3')}`));
      console.log(chalk.gray(`  ${t('providers.wizard.azure.setupSteps.step4')}`));
      console.log();

      // Step 1: Choose auth method
      const authChoices: ModalOption[] = [
        { label: t('providers.wizard.azure.authApiKey'), value: 'api-key' },
        { label: t('providers.wizard.azure.authEntraId'), value: 'entra-id' },
        { label: t('providers.wizard.azure.authManagedIdentity'), value: 'managed-identity' }
      ];

      const authResult = await showModal({
        title: t('providers.wizard.azure.selectAuthMethod'),
        options: authChoices
      });

      if (!authResult) {
        console.log(chalk.gray('\n' + t('providers.config.cancelled')));
        return;
      }

      const authMethod = authResult.value as AzureAuthMethod;
      let apiKey: string | undefined;
      let tenantId: string | undefined;
      let clientId: string | undefined;
      let clientSecret: string | undefined;

      // Step 2: Auth-specific prompts
      if (authMethod === 'api-key') {
        console.log(chalk.gray('\n' + t('providers.wizard.azure.apiKeyLocation') + '\n'));
        apiKey = await showPassword({ title: t('providers.wizard.azure.enterAzureApiKey'), placeholder: t('ui.apiKeyPlaceholder') }) ?? undefined;
        if (!apiKey) { console.log(chalk.gray('\n' + t('providers.config.cancelled'))); return; }
      } else if (authMethod === 'entra-id') {
        console.log(chalk.gray('\n' + t('providers.wizard.azure.entraIdDescription')));
        console.log(chalk.gray(t('providers.wizard.azure.entraIdDocs') + '\n'));

        tenantId = await showInput({ title: t('providers.wizard.azure.enterTenantId') }) ?? undefined;
        if (!tenantId) { console.log(chalk.gray('\n' + t('providers.config.cancelled'))); return; }

        clientId = await showInput({ title: t('providers.wizard.azure.enterClientId') }) ?? undefined;
        if (!clientId) { console.log(chalk.gray('\n' + t('providers.config.cancelled'))); return; }

        clientSecret = await showPassword({ title: t('providers.wizard.azure.enterClientSecret') }) ?? undefined;
        if (!clientSecret) { console.log(chalk.gray('\n' + t('providers.config.cancelled'))); return; }
      } else {
        console.log(chalk.gray('\n' + t('providers.wizard.azure.managedIdentityDescription')));
        console.log(chalk.gray(t('providers.wizard.azure.managedIdentityDocs') + '\n'));
      }

      // Step 3: Resource configuration
      const endpointChoice = await showModal({
        title: t('providers.wizard.azure.endpointChoice'),
        options: [
          { label: t('providers.wizard.azure.endpointStructured'), value: 'structured' },
          { label: t('providers.wizard.azure.endpointUrl'), value: 'url' }
        ]
      });

      if (!endpointChoice) { console.log(chalk.gray('\n' + t('providers.config.cancelled'))); return; }

      let resourceName: string | undefined;
      let deploymentName: string | undefined;
      let baseUrl: string | undefined;

      if (endpointChoice.value === 'structured') {
        console.log(chalk.gray(t('providers.wizard.azure.endpointUrlHint')));
        console.log(chalk.gray(t('providers.wizard.azure.endpointUrlExample') + '\n'));
        resourceName = await showInput({ title: t('providers.wizard.azure.enterEndpointOrResource') }) ?? undefined;
        if (!resourceName) { console.log(chalk.gray('\n' + t('providers.config.cancelled'))); return; }

        console.log(chalk.gray('\n' + t('providers.wizard.azure.deploymentHint')));
        console.log(chalk.gray(t('providers.wizard.azure.deploymentNotUrl') + '\n'));
        deploymentName = await showInput({ title: t('providers.wizard.azure.enterDeploymentName'), defaultValue: 'gpt-5.3-codex' }) ?? undefined;
        if (!deploymentName) { console.log(chalk.gray('\n' + t('providers.config.cancelled'))); return; }
        if (deploymentName.startsWith('http://') || deploymentName.startsWith('https://')) {
          console.log(chalk.red('\n✗ ' + t('providers.wizard.azure.deploymentUrlError')));
          console.log(chalk.gray('  ' + t('providers.wizard.azure.deploymentUrlErrorHint')));
          console.log(chalk.gray('  ' + t('providers.wizard.azure.deploymentUrlErrorLocation') + '\n'));
          return;
        }
      } else {
        baseUrl = await showInput({
          title: t('providers.wizard.azure.enterFullEndpointUrl'),
          defaultValue: 'https://your-resource.openai.azure.com/openai/deployments/gpt-5.3-codex'
        }) ?? undefined;
        if (!baseUrl) { console.log(chalk.gray('\n' + t('providers.config.cancelled'))); return; }
      }

      // Step 4: API version
      const apiVersion = await showInput({ title: t('providers.wizard.azure.apiVersion'), defaultValue: '2024-10-21' }) ?? undefined;
      if (!apiVersion) { console.log(chalk.gray('\n' + t('providers.config.cancelled'))); return; }

      const model = deploymentName ?? 'gpt-5.3-codex';

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

      this.runtime.config.azure = azureConfig;
      this.runtime.config.provider = 'azure';
      this.runtime.options.model = model;
      await saveConfig(this.runtime.config);
      this.resetLlmClient('azure', model);

      console.log(chalk.green('\n✓ ' + t('providers.config.configuredSuccessfully', { provider: t('providers.azure') })));
      console.log(chalk.gray('  ' + t('providers.wizard.azure.authLabel', { method: authMethod })));
      console.log(chalk.gray('  ' + t('providers.config.modelLabel', { model })));
    } catch (error) {
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

      // For cloud providers (openai, openrouter, llmgateway, azure), offer to change API key as well
      if (provider === 'openai' || provider === 'openrouter' || provider === 'llmgateway' || provider === 'azure') {
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
              const options: ModalOption[] = models.map((name: string) => ({
                label: name,
                value: name
              }));
              const currentIndex = models.indexOf(currentModel);
              const result = await showModal({
                title: t('providers.config.selectModel'),
                options,
                initialIndex: currentIndex >= 0 ? currentIndex : 0
              });

              if (!result) {
                console.log(chalk.gray('\n' + t('providers.config.modelChangeCancelled')));
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
        title: t('providers.config.enterModelIdToUse'),
        defaultValue: currentModel
      });

      if (!model) {
        console.log(chalk.gray('\n' + t('providers.config.modelChangeCancelled')));
        return;
      }

      await this.applyModelChange(provider, model.trim(), currentModel);
    } catch (error) {
      // Cancellation is now handled inline
      throw error;
    }
  }

  /**
   * Change settings for cloud providers (OpenAI/OpenRouter/LLMGateway) - API key and/or model
   */
  private async changeCloudProviderSettings(
    provider: 'openai' | 'openrouter' | 'llmgateway' | 'azure',
    currentModel: string,
    currentSettings: { apiKey?: string; baseUrl?: string; model?: string } | null
  ): Promise<void> {
    const providerName = t(`providers.${provider}`);
    const maskedKey = currentSettings?.apiKey
      ? `...${currentSettings.apiKey.slice(-4)}`
      : t('providers.config.notSet');

    console.log(chalk.cyan('\n' + t('providers.config.settingsTitle', { provider: providerName })));
    console.log(chalk.gray(t('providers.config.currentModel', { model: currentModel || t('providers.config.notSet') })));
    console.log(chalk.gray(t('providers.config.currentApiKey', { key: maskedKey }) + '\n'));

    const actionOptions: ModalOption[] = [
      { label: t('providers.config.changeModelOnly'), value: 'model' },
      { label: t('providers.config.changeApiKeyOnly'), value: 'apiKey' },
      { label: t('providers.config.changeBoth'), value: 'both' }
    ];

    const actionResult = await showModal({
      title: t('providers.config.whatToChange'),
      options: actionOptions
    });

    if (!actionResult) {
      console.log(chalk.gray('\n' + t('providers.config.settingsChangeCancelled')));
      return;
    }

    const action = actionResult.value as string;

    let newModel = currentModel;
    let newApiKey = currentSettings?.apiKey || '';

    // Handle API key change
    if (action === 'apiKey' || action === 'both') {
      const keyUrlMap = {
        openai: 'https://platform.openai.com/api-keys',
        openrouter: 'https://openrouter.ai/keys',
        llmgateway: 'https://llmgateway.io/dashboard',
        azure: 'https://ai.azure.com'
      };
      const keyUrl = keyUrlMap[provider];
      console.log(chalk.gray('\n' + t('providers.config.apiKeyUrl', { url: keyUrl }) + '\n'));

      const apiKey = await showPassword({
        title: t('providers.config.enterApiKey', { provider: providerName }),
        placeholder: t('ui.apiKeyPlaceholder'),
        validate: (val: string) => {
          if (!val?.trim()) return t('providers.config.apiKeyRequired');
          if (val.length < 10) return t('providers.config.apiKeyTooShort');
          return true;
        }
      });

      if (!apiKey) {
        console.log(chalk.gray('\n' + t('providers.config.settingsChangeCancelled')));
        return;
      }

      // Validate the API key
      console.log(chalk.gray('\n' + t('providers.config.validatingApiKey')));
      const validationResult = await this.validateApiKey(provider, apiKey.trim());

      if (!validationResult.valid) {
        console.log(chalk.red(`\n✗ ${validationResult.error}`));
        console.log(chalk.gray(validationResult.hint || ''));
        return;
      }

      console.log(chalk.green('✓ ' + t('providers.config.apiKeyValid') + '\n'));
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
          title: t('providers.config.selectModel'),
          options: modelOptions,
          initialIndex: currentIndex
        });

        if (!result) {
          console.log(chalk.gray('\n' + t('providers.config.settingsChangeCancelled')));
          return;
        }

        newModel = result.value as string;
      } else if (provider === 'llmgateway') {
        // LLM Gateway - offer popular models
        const models = ['gpt-4o', 'gpt-4o-mini', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'gemini-1.5-pro', 'gemini-1.5-flash'];
        const modelOptions: ModalOption[] = models.map(name => ({
          label: name,
          value: name
        }));
        const currentIndex = Math.max(0, models.indexOf(currentModel));
        const result = await showModal({
          title: t('providers.config.selectModel'),
          options: modelOptions,
          initialIndex: currentIndex
        });

        if (!result) {
          console.log(chalk.gray('\n' + t('providers.config.settingsChangeCancelled')));
          return;
        }

        newModel = result.value as string;
      } else if (provider === 'azure') {
        console.log(chalk.gray(t('providers.wizard.azure.deploymentChangeHint')));
        console.log(chalk.gray(t('providers.wizard.azure.deploymentChangeExample') + '\n'));
        const model = await showInput({
          title: t('providers.wizard.azure.enterDeploymentNameChange'),
          defaultValue: currentModel || 'gpt-5.3-codex'
        });
        if (!model) {
          console.log(chalk.gray('\n' + t('providers.config.settingsChangeCancelled')));
          return;
        }
        const trimmed = model.trim();
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
          console.log(chalk.red('\n✗ ' + t('providers.wizard.azure.deploymentUrlError')));
          console.log(chalk.gray('  ' + t('providers.wizard.azure.deploymentUrlErrorHint')));
          console.log(chalk.gray('  ' + t('providers.wizard.azure.deploymentUrlErrorLocation') + '\n'));
          return;
        }
        newModel = trimmed;
      } else {
        // OpenRouter - allow custom model input
        const model = await showInput({
          title: t('providers.config.enterModelId'),
          defaultValue: currentModel || 'anthropic/claude-sonnet-4-20250514'
        });

        if (!model) {
          console.log(chalk.gray('\n' + t('providers.config.settingsChangeCancelled')));
          return;
        }
        newModel = model.trim();
      }
    }

    // Save the changes
    if (provider === 'azure') {
      // Azure: preserve existing config, update model, deploymentName, and key
      const existing = this.runtime.config.azure ?? { model: newModel, authMethod: 'api-key' as const };
      this.runtime.config.azure = {
        ...existing,
        model: newModel,
        deploymentName: newModel,
        ...(newApiKey && { apiKey: newApiKey }),
      };
    } else {
      const baseUrlMap = {
        openai: 'https://api.openai.com/v1',
        openrouter: 'https://openrouter.ai/api/v1',
        llmgateway: 'https://api.llmgateway.io/v1'
      };
      const baseUrl = baseUrlMap[provider];

      this.runtime.config[provider] = {
        apiKey: newApiKey,
        baseUrl,
        model: newModel
      };
    }

    this.runtime.config.provider = provider;
    this.runtime.options.model = newModel;
    await saveConfig(this.runtime.config);
    this.resetLlmClient(provider, newModel);
    this.updateContextWindow(getContextWindow(newModel));
    this.resetContextPercent();
    this.emitStatus();

    console.log(chalk.green('\n✓ ' + t('providers.config.settingsUpdated', { provider: providerName })));
    console.log(chalk.gray('  ' + t('providers.config.providerLabel', { provider })));
    console.log(chalk.gray('  ' + t('providers.config.modelLabel', { model: newModel })));
  }

  /**
   * Validate API key by making a test request to the provider
   */
  private async validateApiKey(
    provider: 'openai' | 'openrouter' | 'llmgateway' | 'azure',
    apiKey: string
  ): Promise<{ valid: boolean; error?: string; hint?: string }> {
    // Azure keys can't be easily validated without resource/deployment info
    if (provider === 'azure') {
      return { valid: true };
    }

    try {
      const baseUrlMap = {
        openai: 'https://api.openai.com/v1',
        openrouter: 'https://openrouter.ai/api/v1',
        llmgateway: 'https://api.llmgateway.io/v1'
      };
      const baseUrl = baseUrlMap[provider];

      // Make a simple API call to validate the key
      const response = await fetch(`${baseUrl}/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...(provider === 'openrouter' && {
            'HTTP-Referer': 'https://autohand.dev',
            'X-OpenRouter-Title': 'Autohand Code CLI',
            'X-OpenRouter-Categories': 'cli-agent'
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

      const keyUrlMap = {
        openai: 'https://platform.openai.com/api-keys',
        openrouter: 'https://openrouter.ai/keys',
        llmgateway: 'https://llmgateway.io/dashboard'
      };

      if (status === 401) {
        return {
          valid: false,
          error: t('providers.config.invalidApiKey'),
          hint: t('providers.config.invalidApiKeyHint', { url: keyUrlMap[provider] })
        };
      }

      if (status === 403) {
        return {
          valid: false,
          error: t('providers.config.apiKeyNoPermission'),
          hint: t('providers.config.apiKeyNoPermissionHint')
        };
      }

      if (status === 429) {
        return {
          valid: false,
          error: t('providers.config.rateLimited'),
          hint: t('providers.config.rateLimitedHint')
        };
      }

      return {
        valid: false,
        error: errorData?.error?.message || t('providers.config.apiReturnedStatus', { status: String(status) }),
        hint: t('providers.config.verifyApiKeyHint')
      };
    } catch (error) {
      const err = error as Error;
      if (err.message?.includes('fetch') || err.message?.includes('network')) {
        return {
          valid: false,
          error: t('providers.config.networkError'),
          hint: t('providers.config.networkErrorHint')
        };
      }
      return {
        valid: false,
        error: t('providers.config.validationFailed', { error: err.message }),
        hint: t('providers.config.validationFailedHint')
      };
    }
  }

  /**
   * Apply a model change and update all relevant state
   */
  private async applyModelChange(provider: ProviderName, newModel: string, currentModel: string): Promise<void> {
    // Strip bracketed paste markers and control characters that can leak from terminal input
    newModel = sanitizeModelId(newModel);

    if (!newModel || (newModel === currentModel && provider === this.getActiveProvider())) {
      console.log(chalk.gray(t('providers.config.modelUnchanged')));
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

    console.log(chalk.green('✓ ' + t('providers.config.usingModel', { provider, model: newModel })));
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
      llmgateway: this.runtime.config.llmgateway ?? (this.runtime.config.llmgateway = { apiKey: '', model }),
      azure: this.runtime.config.azure ?? (this.runtime.config.azure = { model, authMethod: 'api-key' })
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
      maxDepth: 3
    });
    this.setDelegator(newDelegator);
    this.setActiveProvider(provider);
  }
}
