/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import chalk from "chalk";
import { t } from "../../i18n/index.js";
import {
  showConfirm,
  showModal,
  showInput,
  showPassword,
  type ModalOption,
} from "../../ui/ink/components/Modal.js";
import { ProviderFactory } from "../../providers/ProviderFactory.js";
import { OPENAI_MODELS } from "../../providers/OpenAIProvider.js";
import {
  installLlamaCpp,
  probeLlamaCppEnvironment,
} from "../../providers/llamaCppSetup.js";
import { ZAI_MODELS, ZAI_DEFAULT_BASE_URL } from "../../providers/ZaiProvider.js";
import { SAKANA_MODELS, SAKANA_DEFAULT_BASE_URL } from "../../providers/SakanaProvider.js";
import { NVIDIA_MODELS, NVIDIA_DEFAULT_BASE_URL } from "../../providers/NVIDIAProvider.js";
import { DEEPSEEK_MODELS, DEEPSEEK_DEFAULT_BASE_URL } from "../../providers/DeepSeekProvider.js";
import {
  BEDROCK_DEFAULT_MODEL,
  BEDROCK_DEFAULT_REGION,
  BEDROCK_MODELS,
  resolveBedrockAuthMode,
} from "../../providers/BedrockProvider.js";
import { VERTEX_AI_CODING_MODELS } from "../../providers/VertexAIProvider.js";
import { sanitizeModelId } from "../../providers/errors.js";
import { getOpenRouterModelContextWindow } from "../../providers/modelCapabilities.js";
import { saveConfig, getProviderConfig } from "../../config.js";
import { getContextWindow } from "../../utils/context.js";
import {
  getProviderDefaultModel,
  getProviderModelIds,
  getProviderRuntimeDefaultModel,
  mergeModelIds,
} from "../../providers/modelCatalog.js";
import type {
  AgentRuntime,
  ProviderName,
  AzureSettings,
  AzureAuthMethod,
  ReasoningEffort,
  OpenAIAuthMode,
  OpenAISettings,
  VertexAISettings,
  BedrockApiMode,
  BedrockAuthMode,
  CustomProviderId,
  CustomProviderSettings,
} from "../../types.js";
import type { LLMProvider } from "../../providers/LLMProvider.js";
import type { TelemetryManager } from "../../telemetry/TelemetryManager.js";
import { AgentDelegator } from "../agents/AgentDelegator.js";
import type { ActionExecutor } from "../actionExecutor.js";
import { authenticateOpenAIChatGPT } from "../../providers/openaiAuth.js";
import {
  getCustomProviderConfig,
  isCustomProviderName,
  normalizeCustomProviderId,
  toCustomProviderName,
} from "../../providers/customProviders.js";

/**
 * ProviderConfigManager module
 *
 * Extracted from AutohandAgent for better modularity.
 * Handles all LLM provider configuration, model selection, and API key validation.
 *
 * Uses Ink Modal components for interactive prompts.
 */

type CloudProviderWithSettings =
  | "openai"
  | "openrouter"
  | "llmgateway"
  | "azure"
  | "zai"
  | "sakana"
  | "xai"
  | "nvidia"
  | "deepseek"
  | CustomProviderId;

type CloudProviderSettingsAction =
  | "model"
  | "apiKey"
  | "auth"
  | "both"
  | "reasoning"
  | "remove";

type ProviderSettingsSummary = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  authToken?: string;
  reasoningEffort?: ReasoningEffort;
};

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
    private emitStatus: () => void,
  ) {}

  private async resolveContextWindow(provider: ProviderName, model: string): Promise<number> {
    const customSettings = getCustomProviderConfig(this.runtime.config, provider);
    if (customSettings) {
      const modelMetadata = customSettings.models?.find((entry) => entry.id === model);
      return modelMetadata?.contextWindow ?? customSettings.contextWindow ?? getContextWindow(model);
    }

    if (provider === "openrouter") {
      try {
        const contextWindow = await getOpenRouterModelContextWindow(model);
        if (contextWindow) return contextWindow;
      } catch {
        // OpenRouter metadata is best-effort; fall back to local inference.
      }
    }

    return getContextWindow(model);
  }

  /**
   * Prompt user to select and configure an LLM provider
   */
  async promptModelSelection(): Promise<void> {
    try {
      const activeProvider = this.getActiveProvider();
      if (activeProvider && this.isProviderConfigured(activeProvider)) {
        await this.promptConfiguredProviderSettings(activeProvider);
        return;
      }

      await this.promptProviderSelection();
    } catch (error) {
      // Re-throw unexpected errors (cancellation is now handled inline)
      throw error;
    }
  }

  private async promptProviderSelection(): Promise<void> {
    // Use ProviderFactory to get platform-aware list (includes MLX on Apple Silicon).
    const allProviders = ProviderFactory.getProviderNames(this.runtime.config);
    const providerChoices: ModalOption[] = allProviders.map((name) => {
      const isConfigured = this.isProviderConfigured(name);
      const indicator = isConfigured ? chalk.green("●") : chalk.red("○");
      const displayName = this.getProviderDisplayName(name);
      const current =
        name === this.getActiveProvider()
          ? chalk.cyan(" (" + t("providers.config.current") + ")")
          : "";
      const siliconNote =
        name === "mlx"
          ? chalk.gray(" (" + t("providers.config.appleSilicon") + ")")
          : "";
      const hostedNote =
        this.isHostedProvider(name)
          ? chalk.gray(" (" + t("providers.config.hosted") + ")")
          : "";
      return {
        label: `${indicator} ${displayName}${current}${siliconNote}${hostedNote}`,
        value: name,
      };
    });
    providerChoices.push({
      label: chalk.cyan("+ " + t("providers.config.newProvider")),
      value: "new-custom-provider",
    });

    const result = await showModal({
      title: t("providers.config.chooseProvider"),
      options: providerChoices,
    });

    if (!result) {
      console.log(chalk.gray("\n" + t("providers.config.cancelled")));
      return;
    }

    if (result.value === "new-custom-provider") {
      await this.configureCustomProvider();
      return;
    }

    const selectedProvider = result.value as ProviderName;

    if (!this.isProviderConfigured(selectedProvider)) {
      console.log(
        chalk.yellow(
          "\n" +
            t("providers.config.notConfigured", {
              provider: selectedProvider,
            }) +
            "\n",
        ),
      );
      await this.configureProvider(selectedProvider);
      return;
    }

    await this.changeProviderModel(selectedProvider);
  }

  private async promptConfiguredProviderSettings(
    provider: ProviderName,
  ): Promise<void> {
    const currentSettings = getProviderConfig(this.runtime.config, provider);
    const currentModel =
      this.runtime.options.model ?? currentSettings?.model ?? "";

    this.printProviderSettingsSummary(provider, currentModel, currentSettings);

    const actionOptions = this.buildConfiguredProviderActions(provider);
    const actionResult = await showModal({
      title: t("providers.config.whatToChange"),
      options: actionOptions,
    });

    if (!actionResult) {
      console.log(
        chalk.gray("\n" + t("providers.config.settingsChangeCancelled")),
      );
      return;
    }

    const action = actionResult.value as string;
    if (action === "provider") {
      await this.promptProviderSelection();
      return;
    }
    if (action === "remove" && isCustomProviderName(provider)) {
      await this.removeCustomProvider(provider);
      return;
    }

    if (provider === "vertexai") {
      await this.changeVertexAISettings(
        currentModel,
        currentSettings as VertexAISettings | null,
      );
      return;
    }

    if (provider === "bedrock") {
      if (action === "model") {
        await this.changeBedrockModel(currentModel);
      } else {
        await this.configureBedrock();
      }
      return;
    }

    if (this.isCloudSettingsProvider(provider)) {
      await this.changeCloudProviderSettings(
        provider,
        currentModel,
        currentSettings,
        action as CloudProviderSettingsAction,
      );
      return;
    }

    await this.changeProviderModel(provider);
  }

  private printProviderSettingsSummary(
    provider: ProviderName,
    currentModel: string,
    currentSettings: ProviderSettingsSummary | null,
  ): void {
    const providerName = this.getProviderDisplayName(provider);
    console.log(
      chalk.cyan(
        "\n" + t("providers.config.settingsTitle", { provider: providerName }),
      ),
    );
    console.log(
      chalk.gray(
        t("providers.config.currentModel", {
          model: currentModel || t("providers.config.notSet"),
        }),
      ),
    );

    const configuredReasoningEffort =
      provider === "openai"
        ? this.runtime.config.openai?.reasoningEffort
        : currentSettings?.reasoningEffort;
    if (configuredReasoningEffort !== undefined || isCustomProviderName(provider)) {
      const reasoningEffort =
        configuredReasoningEffort ?? t("providers.config.notSet");
      console.log(
        chalk.gray(
          t("providers.config.reasoningEffortLabel", {
            level: reasoningEffort,
          }),
        ),
      );
    }

    const authSummary = this.getAuthSummary(provider, currentSettings);
    if (authSummary) {
      console.log(chalk.gray(authSummary + "\n"));
    }
  }

  private getAuthSummary(
    provider: ProviderName,
    currentSettings: ProviderSettingsSummary | null,
  ): string | null {
    if (provider === "openai") {
      const openAISettings = this.runtime.config.openai;
      if (openAISettings?.authMode === "chatgpt") {
        return t("providers.config.authTypeChatGPT");
      }
      const key = currentSettings?.apiKey
        ? `...${currentSettings.apiKey.slice(-4)}`
        : t("providers.config.notSet");
      return t("providers.config.authTypeApiKey", { key });
    }

    if (provider === "vertexai") {
      const key = currentSettings?.authToken
        ? `...${currentSettings.authToken.slice(-8)}`
        : t("providers.config.notSet");
      return t("providers.config.currentAuthToken", { key });
    }

    if (provider === "bedrock") {
      const bedrockSettings = this.runtime.config.bedrock;
      const authMode = resolveBedrockAuthMode(
        bedrockSettings?.apiMode ?? "converse",
        bedrockSettings?.authMode,
      );
      const authLabel =
        authMode === "aws-credentials"
          ? `AWS credentials${bedrockSettings?.profile ? ` (${bedrockSettings.profile})` : ""}`
          : bedrockSettings?.apiKey
            ? `Bedrock API key: ...${bedrockSettings.apiKey.slice(-4)}`
            : t("providers.config.notSet");
      return `API mode: ${bedrockSettings?.apiMode ?? "converse"} · Auth: ${authLabel} · Region: ${bedrockSettings?.region ?? BEDROCK_DEFAULT_REGION}`;
    }

    if (this.isHostedProvider(provider)) {
      const key = currentSettings?.apiKey
        ? `...${currentSettings.apiKey.slice(-4)}`
        : t("providers.config.notSet");
      return t("providers.config.currentApiKey", { key });
    }

    return null;
  }

  private getProviderDisplayName(provider: ProviderName): string {
    return getCustomProviderConfig(this.runtime.config, provider)?.displayName ?? t(`providers.${provider}`);
  }

  private buildConfiguredProviderActions(provider: ProviderName): ModalOption[] {
    if (isCustomProviderName(provider)) {
      return [
        { label: t("providers.config.changeReasoningEffort"), value: "reasoning" },
        { label: t("providers.config.changeModelOnly"), value: "model" },
        { label: t("providers.config.changeApiKeyOnly"), value: "apiKey" },
        { label: t("providers.config.changeBoth"), value: "both" },
        { label: t("providers.custom.removeProvider"), value: "remove" },
        { label: t("providers.config.changeProvider"), value: "provider" },
      ];
    }

    if (provider === "openai") {
      return [
        {
          label: t("providers.config.changeReasoningEffort"),
          value: "reasoning",
        },
        { label: t("providers.config.changeModelOnly"), value: "model" },
        { label: t("providers.openaiAuth.changeAuthOnly"), value: "auth" },
        { label: t("providers.config.changeProvider"), value: "provider" },
      ];
    }

    if (provider === "bedrock") {
      return [
        { label: t("providers.config.changeModelOnly"), value: "model" },
        { label: "Change Bedrock API mode, region, auth, or endpoint", value: "bedrock" },
        { label: t("providers.config.changeProvider"), value: "provider" },
      ];
    }

    if (this.isCloudSettingsProvider(provider)) {
      return [
        { label: t("providers.config.changeModelOnly"), value: "model" },
        { label: t("providers.config.changeApiKeyOnly"), value: "apiKey" },
        { label: t("providers.config.changeProvider"), value: "provider" },
      ];
    }

    if (provider === "vertexai") {
      return [
        { label: t("providers.config.changeModelOnly"), value: "model" },
        { label: t("providers.config.changeApiKeyOnly"), value: "authToken" },
        { label: t("providers.config.changeProvider"), value: "provider" },
      ];
    }

    return [
      { label: t("providers.config.changeModelOnly"), value: "model" },
      { label: t("providers.config.changeProvider"), value: "provider" },
    ];
  }

  private isCloudSettingsProvider(
    provider: ProviderName,
  ): provider is CloudProviderWithSettings {
    if (isCustomProviderName(provider)) {
      return true;
    }

    return [
      "openai",
      "openrouter",
      "llmgateway",
      "azure",
      "zai",
      "sakana",
      "xai",
      "nvidia",
      "deepseek",
    ].includes(provider);
  }

  private isHostedProvider(provider: ProviderName): boolean {
    if (isCustomProviderName(provider)) {
      return true;
    }

    return [
      "openrouter",
      "openai",
      "llmgateway",
      "azure",
      "zai",
      "sakana",
      "vertexai",
      "xai",
      "cerebras",
      "nvidia",
      "deepseek",
      "bedrock",
    ].includes(provider);
  }

  /**
   * Check if a provider is configured with necessary credentials
   */
  isProviderConfigured(provider: ProviderName): boolean {
    const customConfig = getCustomProviderConfig(this.runtime.config, provider);
    if (customConfig) {
      return (
        Boolean(customConfig.model) &&
        Boolean(customConfig.baseUrl) &&
        (customConfig.apiKeyRequired === false ||
          (!!customConfig.apiKey && customConfig.apiKey !== "replace-me"))
      );
    }

    const config = getProviderConfig(this.runtime.config, provider);
    if (!config) return false;

    // Azure: check auth method - managed identity needs no key, entra-id needs tenant/client, api-key needs apiKey
    if (provider === "azure") {
      const azureConfig = config as AzureSettings;
      if (azureConfig.authMethod === "managed-identity") return true;
      if (azureConfig.authMethod === "entra-id") {
        return (
          !!azureConfig.tenantId &&
          !!azureConfig.clientId &&
          !!azureConfig.clientSecret
        );
      }
      return !!config.apiKey && config.apiKey !== "replace-me";
    }

    // For cloud providers, check API key
    if (provider === "openai") {
      const openAIConfig = config as OpenAISettings;
      if (openAIConfig.authMode === "chatgpt") {
        return (
          !!openAIConfig.chatgptAuth?.accessToken &&
          !!openAIConfig.chatgptAuth?.accountId
        );
      }
      return !!openAIConfig.apiKey && openAIConfig.apiKey !== "replace-me";
    }

    if (
      provider === "openrouter" ||
      provider === "llmgateway" ||
      provider === "zai" ||
      provider === "sakana" ||
      provider === "xai" ||
      provider === "nvidia" ||
      provider === "deepseek"
    ) {
      return !!config.apiKey && config.apiKey !== "replace-me";
    }

    if (provider === "bedrock") {
      return getProviderConfig(this.runtime.config, "bedrock") !== null;
    }

    // For local providers, just check if model is set
    return !!config.model;
  }

  /**
   * Configure a specific provider (dispatcher to provider-specific methods)
   */
  private async configureProvider(provider: ProviderName): Promise<void> {
    if (isCustomProviderName(provider)) {
      await this.configureCustomProvider(provider);
      return;
    }

    if (!ProviderFactory.isValidProvider(provider, this.runtime.config)) {
      console.log(chalk.yellow(`\nProvider "${provider}" is not available.`));
      return;
    }

    switch (provider) {
      case "openrouter":
        await this.configureOpenRouter();
        break;
      case "ollama":
        await this.configureOllama();
        break;
      case "llamacpp":
        await this.configureLlamaCpp();
        break;
      case "openai":
        await this.configureOpenAI();
        break;
      case "mlx":
        await this.configureMLX();
        break;
      case "llmgateway":
        await this.configureLLMGateway();
        break;
      case "azure":
        await this.configureAzure();
        break;
      case "zai":
        await this.configureZai();
        break;
      case "sakana":
        await this.configureSakana();
        break;
      case "vertexai":
        await this.configureVertexAI();
        break;
      case "xai":
        await this.configureXAI();
        break;
      case "nvidia":
        await this.configureNvidia();
        break;
      case "deepseek":
        await this.configureDeepSeek();
        break;
      case "bedrock":
        await this.configureBedrock();
        break;
    }
  }

  /**
   * Configure OpenRouter provider (API key + model)
   */
  private async configureOpenRouter(): Promise<void> {
    try {
      console.log(chalk.cyan(t("providers.wizard.openrouter.title")));
      console.log(
        chalk.gray(
          t("providers.config.apiKeyUrl", {
            url: t("providers.wizard.openrouter.apiKeyUrl"),
          }) + "\n",
        ),
      );

      const apiKey = await showPassword({
        title: t("providers.config.enterApiKey", {
          provider: t("providers.openrouter"),
        }),
        placeholder: t("ui.apiKeyPlaceholder"),
      });

      if (!apiKey) {
        console.log(chalk.gray("\n" + t("providers.config.cancelled")));
        return;
      }

      const model = await showInput({
        title: t("providers.config.enterModelId"),
        defaultValue: "nvidia/nemotron-3-super-120b-a12b:free",
      });

      if (!model) {
        console.log(chalk.gray("\n" + t("providers.config.cancelled")));
        return;
      }

      const sanitizedModel = sanitizeModelId(model);
      const contextWindow = await this.resolveContextWindow("openrouter", sanitizedModel);
      this.runtime.config.openrouter = {
        apiKey,
        baseUrl: "https://openrouter.ai/api/v1",
        model: sanitizedModel,
        contextWindow,
      };

      this.runtime.config.provider = "openrouter";
      this.runtime.options.model = sanitizedModel;
      await saveConfig(this.runtime.config);
      this.resetLlmClient("openrouter", sanitizedModel);
      this.updateContextWindow(contextWindow);
      this.resetContextPercent();
      this.emitStatus();

      console.log(
        chalk.green(
          "\n✓ " +
            t("providers.config.configuredSuccessfully", {
              provider: t("providers.openrouter"),
            }),
        ),
      );
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
      console.log(chalk.cyan(t("providers.wizard.ollama.title")));
      console.log(
        chalk.gray(t("providers.wizard.ollama.ensureRunning") + "\n"),
      );

      // Try to fetch available models
      const ollamaUrl =
        this.runtime.config.ollama?.baseUrl?.replace(/\/+$/, "") ??
        "http://localhost:11434";
      let availableModels: string[] = [];

      try {
        const response = await fetch(`${ollamaUrl}/api/tags`);
        if (response.ok) {
          const data = await response.json() as { models?: Array<{ name: string }> };
          availableModels =
            mergeModelIds(
              data.models
                ?.map((model) => model.name)
                .filter((name): name is string => typeof name === "string" && name.length > 0) ??
                [],
              getProviderModelIds("ollama"),
            );
        }
      } catch {
        console.log(
          chalk.yellow(
            "⚠ " + t("providers.wizard.ollama.cannotConnect") + "\n",
          ),
        );
      }
      if (availableModels.length === 0) {
        availableModels = getProviderModelIds("ollama");
      }

      let model: string | null;
      if (availableModels.length > 0) {
        console.log(
          chalk.green(
            t("providers.wizard.ollama.foundModels", {
              count: availableModels.length,
            }) + "\n",
          ),
        );
        const options: ModalOption[] = availableModels.map((name) => ({
          label: name,
          value: name,
        }));
        const result = await showModal({
          title: t("providers.config.selectModel"),
          options,
        });
        model = result?.value as string | null;
      } else {
        model = await showInput({
          title: t("providers.wizard.ollama.enterModelName"),
          defaultValue: getProviderDefaultModel("ollama", "llama3.2:latest"),
        });
      }

      if (!model) {
        console.log(chalk.gray("\n" + t("providers.config.cancelled")));
        return;
      }

      this.runtime.config.ollama = {
        baseUrl: ollamaUrl,
        model,
      };

      this.runtime.config.provider = "ollama";
      this.runtime.options.model = model;
      await saveConfig(this.runtime.config);
      this.resetLlmClient("ollama", model);

      console.log(
        chalk.green(
          "\n✓ " +
            t("providers.config.configuredSuccessfully", {
              provider: t("providers.ollama"),
            }),
        ),
      );
    } catch (error) {
      if ((error as Error).message?.includes("cancelled")) {
        console.log(chalk.gray("\n" + t("providers.config.cancelled")));
        return;
      }
      throw error;
    }
  }

  /**
   * Configure llama.cpp provider (port only)
   */
  private async configureLlamaCpp(): Promise<void> {
    try {
      console.log(chalk.cyan(t("providers.wizard.llamacpp.title")));
      console.log(
        chalk.gray(t("providers.wizard.llamacpp.ensureRunning") + "\n"),
      );

      const probe = await probeLlamaCppEnvironment(this.runtime.workspaceRoot);

      if (!probe.installed && probe.installPlan) {
        console.log(
          chalk.yellow(
            `llama.cpp is not installed. Autohand can install it with: ${probe.installPlan.label}`,
          ),
        );
        const shouldInstall = await showConfirm({
          title: "Install llama.cpp now?",
          defaultValue: true,
        });

        if (shouldInstall) {
          console.log(
            chalk.gray(
              `Installing llama.cpp with ${probe.installPlan.label}...`,
            ),
          );
          const install = await installLlamaCpp(
            probe.installPlan,
            this.runtime.workspaceRoot,
          );
          if (!install.ok) {
            console.log(chalk.red("llama.cpp installation failed."));
            if (install.output) {
              console.log(chalk.gray(install.output));
            }
            return;
          }
          console.log(chalk.green("llama.cpp installation completed."));
        }
      }

      const refreshed = await probeLlamaCppEnvironment(
        this.runtime.workspaceRoot,
      );
      if (refreshed.baseUrl) {
        console.log(
          chalk.green(`\n✓ Detected llama.cpp server at ${refreshed.baseUrl}`),
        );
      }

      const port = await showInput({
        title: t("providers.wizard.llamacpp.serverPort"),
        defaultValue: String(refreshed.port ?? 80),
      });

      if (!port) {
        console.log(chalk.gray("\n" + t("providers.config.cancelled")));
        return;
      }

      const model = getProviderRuntimeDefaultModel("llamacpp", "local");

      this.runtime.config.llamacpp = {
        baseUrl: `http://localhost:${port}`,
        port: parseInt(port),
        model,
      };

      this.runtime.config.provider = "llamacpp";
      this.runtime.options.model = model;
      await saveConfig(this.runtime.config);
      this.resetLlmClient("llamacpp", model);

      console.log(
        chalk.green(
          "\n✓ " +
            t("providers.config.configuredSuccessfully", {
              provider: t("providers.llamacpp"),
            }),
        ),
      );
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
      console.log(chalk.cyan(t("providers.wizard.openai.title")));

      const authMode = await this.promptOpenAIAuthMode();
      if (!authMode) {
        console.log(chalk.gray("\n" + t("providers.config.cancelled")));
        return;
      }

      let apiKey = "";
      let chatgptAuth;
      if (authMode === "chatgpt") {
        try {
          console.log(chalk.gray(`\n${t("providers.openaiAuth.starting")}`));
          chatgptAuth = await authenticateOpenAIChatGPT({
            onPrompt: ({ authorizationUrl, browserOpened }) => {
              console.log(
                chalk.gray(`${t("providers.openaiAuth.browserPrompt")}\n`),
              );
              console.log(chalk.white(authorizationUrl));
              console.log(
                chalk.gray(
                  t(
                    browserOpened
                      ? "providers.openaiAuth.browserOpened"
                      : "providers.openaiAuth.openManually",
                  ),
                ),
              );
              console.log(chalk.gray(t("providers.openaiAuth.waiting") + "\n"));
            },
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          console.log(
            chalk.red(`\n${t("providers.openaiAuth.failed", { message })}`),
          );
          throw error;
        }
      } else {
        console.log(
          chalk.gray(
            t("providers.config.apiKeyUrl", {
              url: t("providers.wizard.openai.apiKeyUrl"),
            }) + "\n",
          ),
        );

        apiKey =
          (await showPassword({
            title: t("providers.config.enterApiKey", {
              provider: t("providers.openai"),
            }),
            placeholder: t("ui.apiKeyPlaceholder"),
          })) ?? "";

        if (!apiKey) {
          console.log(chalk.gray("\n" + t("providers.config.cancelled")));
          return;
        }
      }

      const modelChoices: ModalOption[] = OPENAI_MODELS.map((name) => ({
        label: name,
        value: name,
      }));

      const result = await showModal({
        title: t("providers.config.selectModel"),
        options: modelChoices,
      });

      if (!result) {
        console.log(chalk.gray("\n" + t("providers.config.cancelled")));
        return;
      }

      const model = result.value as string;

      // Prompt for reasoning effort level
      const reasoningEffort = await this.promptReasoningEffort();

      this.runtime.config.openai = {
        authMode,
        ...(authMode === "api-key" && { apiKey }),
        ...(authMode === "chatgpt" && { chatgptAuth }),
        baseUrl:
          authMode === "chatgpt"
            ? "https://chatgpt.com/backend-api/codex"
            : "https://api.openai.com/v1",
        model,
        ...(reasoningEffort !== undefined && { reasoningEffort }),
      };

      this.runtime.config.provider = "openai";
      this.runtime.options.model = model;
      await saveConfig(this.runtime.config);
      this.resetLlmClient("openai", model);

      console.log(
        chalk.green(
          "\n✓ " +
            t("providers.config.configuredSuccessfully", {
              provider: t("providers.openai"),
            }),
        ),
      );
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
      console.log(chalk.cyan(t("providers.wizard.mlx.title")));
      console.log(chalk.gray(t("providers.wizard.mlx.description")));
      console.log(chalk.gray(t("providers.wizard.mlx.ensureRunning") + "\n"));

      // Try to fetch available models from MLX server
      const mlxUrl = "http://localhost:8080";
      let availableModels: string[] = [];

      try {
        const response = await fetch(`${mlxUrl}/v1/models`);
        if (response.ok) {
          const data = await response.json() as { data?: Array<{ id: string }> };
          availableModels = mergeModelIds(
            data.data
              ?.map((model) => model.id)
              .filter((name): name is string => typeof name === "string" && name.length > 0) ??
              [],
            getProviderModelIds("mlx"),
          );
        }
      } catch {
        console.log(
          chalk.yellow("⚠ " + t("providers.wizard.mlx.cannotConnect") + "\n"),
        );
      }
      if (availableModels.length === 0) {
        availableModels = getProviderModelIds("mlx");
      }

      let model: string | null;
      if (availableModels.length > 0) {
        const options: ModalOption[] = availableModels.map((name) => ({
          label: name,
          value: name,
        }));
        const result = await showModal({
          title: t("providers.config.selectModel"),
          options,
        });
        model = result?.value as string | null;
      } else {
        model = await showInput({
          title: t("providers.wizard.mlx.enterModelName"),
          defaultValue: getProviderDefaultModel(
            "mlx",
            "mlx-community/Llama-3.2-3B-Instruct-4bit",
          ),
        });
      }

      if (!model) {
        console.log(chalk.gray("\n" + t("providers.config.cancelled")));
        return;
      }

      this.runtime.config.mlx = {
        baseUrl: mlxUrl,
        model,
      };

      this.runtime.config.provider = "mlx";
      this.runtime.options.model = model;
      await saveConfig(this.runtime.config);
      this.resetLlmClient("mlx", model);

      console.log(
        chalk.green(
          "\n✓ " +
            t("providers.config.configuredSuccessfully", {
              provider: t("providers.mlx"),
            }),
        ),
      );
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
      console.log(chalk.cyan(t("providers.wizard.llmgateway.title")));
      console.log(
        chalk.gray(
          t("providers.config.apiKeyUrl", {
            url: t("providers.wizard.llmgateway.apiKeyUrl"),
          }) + "\n",
        ),
      );

      const apiKey = await showPassword({
        title: t("providers.config.enterApiKey", {
          provider: t("providers.llmgateway"),
        }),
        placeholder: t("ui.apiKeyPlaceholder"),
      });

      if (!apiKey) {
        console.log(chalk.gray("\n" + t("providers.config.cancelled")));
        return;
      }

      const modelChoices: ModalOption[] = [
        { label: "gpt-4o", value: "gpt-4o" },
        { label: "gpt-4o-mini", value: "gpt-4o-mini" },
        {
          label: "claude-3-5-sonnet-20241022",
          value: "claude-3-5-sonnet-20241022",
        },
        {
          label: "claude-3-5-haiku-20241022",
          value: "claude-3-5-haiku-20241022",
        },
        { label: "gemini-1.5-pro", value: "gemini-1.5-pro" },
        { label: "gemini-1.5-flash", value: "gemini-1.5-flash" },
      ];

      const result = await showModal({
        title: t("providers.config.selectModel"),
        options: modelChoices,
      });

      if (!result) {
        console.log(chalk.gray("\n" + t("providers.config.cancelled")));
        return;
      }

      const model = result.value as string;

      this.runtime.config.llmgateway = {
        apiKey,
        baseUrl: "https://api.llmgateway.io/v1",
        model,
      };

      this.runtime.config.provider = "llmgateway";
      this.runtime.options.model = model;
      await saveConfig(this.runtime.config);
      this.resetLlmClient("llmgateway", model);

      console.log(
        chalk.green(
          "\n✓ " +
            t("providers.config.configuredSuccessfully", {
              provider: t("providers.llmgateway"),
            }),
        ),
      );
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
      console.log(chalk.cyan(t("providers.wizard.azure.title")));
      console.log(chalk.gray(t("providers.wizard.azure.getStarted") + "\n"));

      console.log(
        chalk.yellow(`\n${t("providers.wizard.azure.setupSteps.title")}`),
      );
      console.log(
        chalk.gray(`  ${t("providers.wizard.azure.setupSteps.step1")}`),
      );
      console.log(
        chalk.gray(`  ${t("providers.wizard.azure.setupSteps.step2")}`),
      );
      console.log(
        chalk.gray(`  ${t("providers.wizard.azure.setupSteps.step3")}`),
      );
      console.log(
        chalk.gray(`  ${t("providers.wizard.azure.setupSteps.step4")}`),
      );
      console.log();

      // Step 1: Choose auth method
      const authChoices: ModalOption[] = [
        { label: t("providers.wizard.azure.authApiKey"), value: "api-key" },
        { label: t("providers.wizard.azure.authEntraId"), value: "entra-id" },
        {
          label: t("providers.wizard.azure.authManagedIdentity"),
          value: "managed-identity",
        },
      ];

      const authResult = await showModal({
        title: t("providers.wizard.azure.selectAuthMethod"),
        options: authChoices,
      });

      if (!authResult) {
        console.log(chalk.gray("\n" + t("providers.config.cancelled")));
        return;
      }

      const authMethod = authResult.value as AzureAuthMethod;
      let apiKey: string | undefined;
      let tenantId: string | undefined;
      let clientId: string | undefined;
      let clientSecret: string | undefined;

      // Step 2: Auth-specific prompts
      if (authMethod === "api-key") {
        console.log(
          chalk.gray("\n" + t("providers.wizard.azure.apiKeyLocation") + "\n"),
        );
        apiKey =
          (await showPassword({
            title: t("providers.wizard.azure.enterAzureApiKey"),
            placeholder: t("ui.apiKeyPlaceholder"),
          })) ?? undefined;
        if (!apiKey) {
          console.log(chalk.gray("\n" + t("providers.config.cancelled")));
          return;
        }
      } else if (authMethod === "entra-id") {
        console.log(
          chalk.gray("\n" + t("providers.wizard.azure.entraIdDescription")),
        );
        console.log(chalk.gray(t("providers.wizard.azure.entraIdDocs") + "\n"));

        tenantId =
          (await showInput({
            title: t("providers.wizard.azure.enterTenantId"),
          })) ?? undefined;
        if (!tenantId) {
          console.log(chalk.gray("\n" + t("providers.config.cancelled")));
          return;
        }

        clientId =
          (await showInput({
            title: t("providers.wizard.azure.enterClientId"),
          })) ?? undefined;
        if (!clientId) {
          console.log(chalk.gray("\n" + t("providers.config.cancelled")));
          return;
        }

        clientSecret =
          (await showPassword({
            title: t("providers.wizard.azure.enterClientSecret"),
          })) ?? undefined;
        if (!clientSecret) {
          console.log(chalk.gray("\n" + t("providers.config.cancelled")));
          return;
        }
      } else {
        console.log(
          chalk.gray(
            "\n" + t("providers.wizard.azure.managedIdentityDescription"),
          ),
        );
        console.log(
          chalk.gray(t("providers.wizard.azure.managedIdentityDocs") + "\n"),
        );
      }

      // Step 3: Resource configuration
      const endpointChoice = await showModal({
        title: t("providers.wizard.azure.endpointChoice"),
        options: [
          {
            label: t("providers.wizard.azure.endpointStructured"),
            value: "structured",
          },
          { label: t("providers.wizard.azure.endpointUrl"), value: "url" },
        ],
      });

      if (!endpointChoice) {
        console.log(chalk.gray("\n" + t("providers.config.cancelled")));
        return;
      }

      let resourceName: string | undefined;
      let deploymentName: string | undefined;
      let baseUrl: string | undefined;

      if (endpointChoice.value === "structured") {
        console.log(chalk.gray(t("providers.wizard.azure.endpointUrlHint")));
        console.log(
          chalk.gray(t("providers.wizard.azure.endpointUrlExample") + "\n"),
        );
        resourceName =
          (await showInput({
            title: t("providers.wizard.azure.enterEndpointOrResource"),
          })) ?? undefined;
        if (!resourceName) {
          console.log(chalk.gray("\n" + t("providers.config.cancelled")));
          return;
        }

        console.log(
          chalk.gray("\n" + t("providers.wizard.azure.deploymentHint")),
        );
        console.log(
          chalk.gray(t("providers.wizard.azure.deploymentNotUrl") + "\n"),
        );
        deploymentName =
          (await showInput({
            title: t("providers.wizard.azure.enterDeploymentName"),
            defaultValue: "gpt-5.3-codex",
          })) ?? undefined;
        if (!deploymentName) {
          console.log(chalk.gray("\n" + t("providers.config.cancelled")));
          return;
        }
        if (
          deploymentName.startsWith("http://") ||
          deploymentName.startsWith("https://")
        ) {
          console.log(
            chalk.red("\n✗ " + t("providers.wizard.azure.deploymentUrlError")),
          );
          console.log(
            chalk.gray(
              "  " + t("providers.wizard.azure.deploymentUrlErrorHint"),
            ),
          );
          console.log(
            chalk.gray(
              "  " +
                t("providers.wizard.azure.deploymentUrlErrorLocation") +
                "\n",
            ),
          );
          return;
        }
      } else {
        baseUrl =
          (await showInput({
            title: t("providers.wizard.azure.enterFullEndpointUrl"),
            defaultValue:
              "https://your-resource.openai.azure.com/openai/deployments/gpt-5.3-codex",
          })) ?? undefined;
        if (!baseUrl) {
          console.log(chalk.gray("\n" + t("providers.config.cancelled")));
          return;
        }
      }

      // Step 4: API version
      const apiVersion =
        (await showInput({
          title: t("providers.wizard.azure.apiVersion"),
          defaultValue: "2024-10-21",
        })) ?? undefined;
      if (!apiVersion) {
        console.log(chalk.gray("\n" + t("providers.config.cancelled")));
        return;
      }

      const model = deploymentName ?? "gpt-5.3-codex";

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
      this.runtime.config.provider = "azure";
      this.runtime.options.model = model;
      await saveConfig(this.runtime.config);
      this.resetLlmClient("azure", model);

      console.log(
        chalk.green(
          "\n✓ " +
            t("providers.config.configuredSuccessfully", {
              provider: t("providers.azure"),
            }),
        ),
      );
      console.log(
        chalk.gray(
          "  " + t("providers.wizard.azure.authLabel", { method: authMethod }),
        ),
      );
      console.log(
        chalk.gray("  " + t("providers.config.modelLabel", { model })),
      );
    } catch (error) {
      throw error;
    }
  }

  /**
   * Change model for an already-configured provider
   */
  async changeProviderModel(provider: ProviderName): Promise<void> {
    try {
      if (!ProviderFactory.isValidProvider(provider, this.runtime.config)) {
        console.log(chalk.yellow(`\nProvider "${provider}" is not available.`));
        return;
      }

      const currentSettings = getProviderConfig(this.runtime.config, provider);
      const currentModel =
        this.runtime.options.model ?? currentSettings?.model ?? "";

      // For cloud providers, offer to change API key as well.
      if (
        provider === "openai" ||
        provider === "openrouter" ||
        provider === "llmgateway" ||
        provider === "azure" ||
        provider === "zai" ||
        provider === "sakana" ||
        provider === "vertexai" ||
        provider === "xai" ||
        provider === "nvidia" ||
        provider === "deepseek" ||
        provider === "bedrock"
      ) {
        if (provider === "bedrock") {
          await this.configureBedrock();
          return;
        }
        if (provider === "vertexai") {
          await this.changeVertexAISettings(currentModel, currentSettings as VertexAISettings | null);
          return;
        }
        if (provider === "xai") {
          await this.configureXAI();
          return;
        }
        await this.changeCloudProviderSettings(
          provider,
          currentModel,
          currentSettings,
        );
        return;
      }

      if (provider === "llamacpp") {
        await this.configureLlamaCpp();
        return;
      }

      // For Ollama, try to fetch available models
      if (provider === "ollama" && currentSettings?.baseUrl) {
        try {
          const response = await fetch(`${currentSettings.baseUrl}/api/tags`);
          if (response.ok) {
            const data = await response.json() as { models?: Array<{ name: string }> };
            const models = data.models?.map((m: any) => m.name) || [];
            if (models.length > 0) {
              const options: ModalOption[] = models.map((name: string) => ({
                label: name,
                value: name,
              }));
              const currentIndex = models.indexOf(currentModel);
              const result = await showModal({
                title: t("providers.config.selectModel"),
                options,
                initialIndex: currentIndex >= 0 ? currentIndex : 0,
              });

              if (!result) {
                console.log(
                  chalk.gray("\n" + t("providers.config.modelChangeCancelled")),
                );
                return;
              }

              await this.applyModelChange(
                provider,
                result.value as string,
                currentModel,
              );
              return;
            }
          }
        } catch {
          // Fall through to manual input
        }
      }

      // For other providers, manual input
      const model = await showInput({
        title: t("providers.config.enterModelIdToUse"),
        defaultValue: currentModel,
      });

      if (!model) {
        console.log(
          chalk.gray("\n" + t("providers.config.modelChangeCancelled")),
        );
        return;
      }

      await this.applyModelChange(provider, model.trim(), currentModel);
    } catch (error) {
      // Cancellation is now handled inline
      throw error;
    }
  }

  /**
   * Configure DeepSeek provider (API key + model)
   */
  private async configureDeepSeek(): Promise<void> {
    try {
      console.log(chalk.cyan(t("providers.wizard.deepseek.title")));
      console.log(
        chalk.gray(
          t("providers.config.apiKeyUrl", {
            url: t("providers.wizard.deepseek.apiKeyUrl"),
          }) + "\n",
        ),
      );

      const apiKey = await showPassword({
        title: t("providers.config.enterApiKey", {
          provider: t("providers.deepseek"),
        }),
        placeholder: t("ui.apiKeyPlaceholder"),
      });

      if (!apiKey) {
        console.log(chalk.gray("\n" + t("providers.config.cancelled")));
        return;
      }

      const modelChoices: ModalOption[] = DEEPSEEK_MODELS.map((model) => ({
        label: model,
        value: model,
      }));

      const result = await showModal({
        title: t("providers.config.selectModel"),
        options: modelChoices,
      });

      if (!result) {
        console.log(chalk.gray("\n" + t("providers.config.cancelled")));
        return;
      }

      const model = result.value as string;

      this.runtime.config.deepseek = {
        apiKey,
        baseUrl: DEEPSEEK_DEFAULT_BASE_URL,
        model,
      };

      this.runtime.config.provider = "deepseek";
      this.runtime.options.model = model;
      await saveConfig(this.runtime.config);
      this.resetLlmClient("deepseek", model);

      console.log(
        chalk.green(
          "\n✓ " +
            t("providers.config.configuredSuccessfully", {
              provider: t("providers.deepseek"),
            }),
        ),
      );
    } catch (error) {
      throw error;
    }
  }

  private async configureBedrock(): Promise<void> {
    const existing = this.runtime.config.bedrock;
    console.log(chalk.cyan(t("providers.wizard.bedrock.title")));
    console.log(chalk.gray(t("providers.wizard.bedrock.getStarted") + "\n"));

    const apiMode = await this.promptBedrockApiMode(existing?.apiMode);
    if (!apiMode) {
      console.log(chalk.gray("\n" + t("providers.config.cancelled")));
      return;
    }

    const authMode = await this.promptBedrockAuthMode(apiMode, existing?.authMode);
    if (!authMode) {
      console.log(chalk.gray("\n" + t("providers.config.cancelled")));
      return;
    }

    let apiKey = existing?.apiKey;
    if (authMode === "bedrock-api-key") {
      console.log(chalk.gray("\n" + t("providers.wizard.bedrock.apiKeyHint") + "\n"));
      const entered = await showPassword({
        title: t("providers.config.enterApiKey", {
          provider: t("providers.bedrock"),
        }),
        placeholder: t("ui.apiKeyPlaceholder"),
        validate: (val: string) => {
          if (!val?.trim()) return t("providers.config.apiKeyRequired");
          if (val.length < 10) return t("providers.config.apiKeyTooShort");
          return true;
        },
      });
      if (!entered) {
        console.log(chalk.gray("\n" + t("providers.config.cancelled")));
        return;
      }
      apiKey = entered.trim();
    }

    const defaultRegion =
      existing?.region ||
      process.env.AWS_REGION ||
      process.env.AWS_DEFAULT_REGION ||
      BEDROCK_DEFAULT_REGION;
    const region = await showInput({
      title: t("providers.wizard.bedrock.enterRegion"),
      defaultValue: defaultRegion,
    });
    if (!region) {
      console.log(chalk.gray("\n" + t("providers.config.cancelled")));
      return;
    }

    const profile = await showInput({
      title: t("providers.wizard.bedrock.enterProfile"),
      defaultValue: existing?.profile ?? "",
    });

    const endpoint = await showInput({
      title: t("providers.wizard.bedrock.enterEndpoint"),
      defaultValue: existing?.endpoint ?? "",
    });

    const model = await this.promptBedrockModel(existing?.model);
    if (!model) {
      console.log(chalk.gray("\n" + t("providers.config.cancelled")));
      return;
    }

    this.runtime.config.bedrock = {
      model,
      region: region.trim(),
      apiMode,
      authMode,
      ...(profile?.trim() && { profile: profile.trim() }),
      ...(endpoint?.trim() && { endpoint: endpoint.trim() }),
      ...(authMode === "bedrock-api-key" && apiKey ? { apiKey } : {}),
    };
    this.runtime.config.provider = "bedrock";
    this.runtime.options.model = model;
    await saveConfig(this.runtime.config);
    this.resetLlmClient("bedrock", model);
    this.resetContextPercent();
    this.emitStatus();

    console.log(
      chalk.green(
        "\n✓ " +
          t("providers.config.configuredSuccessfully", {
            provider: t("providers.bedrock"),
          }),
      ),
    );
  }

  private async changeBedrockModel(currentModel: string): Promise<void> {
    const model = await this.promptBedrockModel(currentModel);
    if (!model) {
      console.log(chalk.gray("\n" + t("providers.config.modelChangeCancelled")));
      return;
    }
    this.runtime.config.bedrock = {
      ...(this.runtime.config.bedrock ?? {
        region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || BEDROCK_DEFAULT_REGION,
      }),
      model,
    };
    this.runtime.options.model = model;
    await saveConfig(this.runtime.config);
    this.resetLlmClient("bedrock", model);
    this.resetContextPercent();
    this.emitStatus();
    console.log(
      chalk.green(
        "\n✓ " +
          t("providers.config.settingsUpdated", {
            provider: t("providers.bedrock"),
          }),
      ),
    );
  }

  private async promptBedrockApiMode(
    current?: BedrockApiMode,
  ): Promise<BedrockApiMode | null> {
    const modes: Array<{ label: string; value: BedrockApiMode; description: string }> = [
      {
        label: t("providers.wizard.bedrock.modeConverse"),
        value: "converse",
        description: t("providers.wizard.bedrock.modeConverseHint"),
      },
      {
        label: t("providers.wizard.bedrock.modeOpenAIChat"),
        value: "openai-chat",
        description: t("providers.wizard.bedrock.modeOpenAIChatHint"),
      },
      {
        label: t("providers.wizard.bedrock.modeOpenAIResponses"),
        value: "openai-responses",
        description: t("providers.wizard.bedrock.modeOpenAIResponsesHint"),
      },
    ];
    const result = await showModal({
      title: t("providers.wizard.bedrock.chooseApiMode"),
      options: modes,
      initialIndex: Math.max(0, modes.findIndex((mode) => mode.value === current)),
    });
    return (result?.value as BedrockApiMode | undefined) ?? null;
  }

  private async promptBedrockAuthMode(
    apiMode: BedrockApiMode,
    current?: BedrockAuthMode,
  ): Promise<BedrockAuthMode | null> {
    const defaultAuth = resolveBedrockAuthMode(apiMode, current);
    const options: ModalOption[] =
      apiMode === "converse"
        ? [
            {
              label: t("providers.wizard.bedrock.authAwsCredentials"),
              value: "aws-credentials",
              description: t("providers.wizard.bedrock.authAwsCredentialsHint"),
            },
          ]
        : [
            {
              label: t("providers.wizard.bedrock.authBedrockApiKey"),
              value: "bedrock-api-key",
              description: t("providers.wizard.bedrock.authBedrockApiKeyHint"),
            },
          ];
    const result = await showModal({
      title: t("providers.wizard.bedrock.chooseAuthMode"),
      options,
      initialIndex: Math.max(0, options.findIndex((option) => option.value === defaultAuth)),
    });
    return (result?.value as BedrockAuthMode | undefined) ?? null;
  }

  private async promptBedrockModel(current?: string): Promise<string | null> {
    const options: ModalOption[] = BEDROCK_MODELS.map((model) => ({
      label: model,
      value: model,
    }));
    const result = await showModal({
      title: t("providers.config.selectModel"),
      options,
      allowCustomInput: true,
      initialIndex: Math.max(0, [...BEDROCK_MODELS].indexOf((current ?? BEDROCK_DEFAULT_MODEL) as (typeof BEDROCK_MODELS)[number])),
    });
    return (result?.value as string | undefined)?.trim() || null;
  }

  /**
   * Configure Z.ai provider (API key + model)
   */
  private async configureZai(): Promise<void> {
    try {
      console.log(chalk.cyan(t("providers.wizard.zai.title")));
      console.log(
        chalk.gray(
          t("providers.config.apiKeyUrl", {
            url: t("providers.wizard.zai.apiKeyUrl"),
          }) + "\n",
        ),
      );

      const apiKey = await showPassword({
        title: t("providers.config.enterApiKey", {
          provider: t("providers.zai"),
        }),
        placeholder: t("ui.apiKeyPlaceholder"),
      });

      if (!apiKey) {
        console.log(chalk.gray("\n" + t("providers.config.cancelled")));
        return;
      }

      const modelChoices: ModalOption[] = ZAI_MODELS.map((model) => ({
        label: model,
        value: model,
      }));

      const result = await showModal({
        title: t("providers.config.selectModel"),
        options: modelChoices,
      });

      if (!result) {
        console.log(chalk.gray("\n" + t("providers.config.cancelled")));
        return;
      }

      const model = result.value as string;

      this.runtime.config.zai = {
        apiKey,
        baseUrl: ZAI_DEFAULT_BASE_URL,
        model,
      };

      this.runtime.config.provider = "zai";
      this.runtime.options.model = model;
      await saveConfig(this.runtime.config);
      this.resetLlmClient("zai", model);

      console.log(
        chalk.green(
          "\n✓ " +
            t("providers.config.configuredSuccessfully", {
              provider: t("providers.zai"),
            }),
        ),
      );
    } catch (error) {
      throw error;
    }
  }

  /**
   * Configure Sakana.AI provider (API key + Fugu model)
   */
  private async configureSakana(): Promise<void> {
    try {
      console.log(chalk.cyan(t("providers.wizard.sakana.title")));
      console.log(
        chalk.gray(
          t("providers.config.apiKeyUrl", {
            url: t("providers.wizard.sakana.apiKeyUrl"),
          }) + "\n",
        ),
      );

      const apiKey = await showPassword({
        title: t("providers.config.enterApiKey", {
          provider: t("providers.sakana"),
        }),
        placeholder: t("ui.apiKeyPlaceholder"),
      });

      if (!apiKey) {
        console.log(chalk.gray("\n" + t("providers.config.cancelled")));
        return;
      }

      const modelChoices: ModalOption[] = SAKANA_MODELS.map((model) => ({
        label: model,
        value: model,
      }));

      const result = await showModal({
        title: t("providers.config.selectModel"),
        options: modelChoices,
      });

      if (!result) {
        console.log(chalk.gray("\n" + t("providers.config.cancelled")));
        return;
      }

      const model = result.value as string;

      this.runtime.config.sakana = {
        apiKey,
        baseUrl: SAKANA_DEFAULT_BASE_URL,
        model,
      };

      this.runtime.config.provider = "sakana";
      this.runtime.options.model = model;
      await saveConfig(this.runtime.config);
      this.resetLlmClient("sakana", model);

      console.log(
        chalk.green(
          "\n✓ " +
            t("providers.config.configuredSuccessfully", {
              provider: t("providers.sakana"),
            }),
        ),
      );
    } catch (error) {
      throw error;
    }
  }

  /**
   * Configure a user-defined OpenAI-compatible provider.
   */
  private async configureCustomProvider(provider?: CustomProviderId): Promise<void> {
    const existing = provider
      ? getCustomProviderConfig(this.runtime.config, provider)
      : undefined;

    const displayName = await showInput({
      title: t("providers.custom.enterDisplayName"),
      defaultValue: existing?.displayName ?? "",
      validate: (val: string) =>
        val.trim().length > 0 ? true : t("providers.custom.displayNameRequired"),
    });
    if (!displayName) {
      console.log(chalk.gray("\n" + t("providers.config.cancelled")));
      return;
    }

    const id = existing?.id ?? normalizeCustomProviderId(displayName);
    if (!id) {
      console.log(chalk.red("\n" + t("providers.custom.invalidId")));
      return;
    }

    const providerName = toCustomProviderName(id);
    const baseUrl = await showInput({
      title: t("providers.custom.enterBaseUrl"),
      defaultValue: existing?.baseUrl ?? "https://api.example.com/v1",
      validate: (val: string) => {
        const trimmed = val.trim();
        if (!trimmed) return t("providers.custom.baseUrlRequired");
        if (!/^https?:\/\//.test(trimmed)) return t("providers.custom.baseUrlInvalid");
        return true;
      },
    });
    if (!baseUrl) {
      console.log(chalk.gray("\n" + t("providers.config.cancelled")));
      return;
    }

    const apiKeyRequired = await showConfirm({
      title: t("providers.custom.apiKeyRequired"),
      defaultValue: existing?.apiKeyRequired ?? true,
    });

    let apiKey = existing?.apiKey ?? "";
    const enteredApiKey = await showPassword({
      title: apiKeyRequired
        ? t("providers.config.enterApiKey", { provider: displayName.trim() })
        : t("providers.custom.enterOptionalApiKey", { provider: displayName.trim() }),
      placeholder: t("ui.apiKeyPlaceholder"),
      validate: (val: string) => {
        if (!apiKeyRequired) return true;
        if (!val?.trim()) return t("providers.config.apiKeyRequired");
        if (val.length < 10) return t("providers.config.apiKeyTooShort");
        return true;
      },
    });
    if (enteredApiKey) {
      apiKey = enteredApiKey.trim();
    } else if (apiKeyRequired && !apiKey) {
      console.log(chalk.gray("\n" + t("providers.config.cancelled")));
      return;
    }

    const model = await showInput({
      title: t("providers.config.enterModelId"),
      defaultValue: existing?.model ?? "gpt-4o",
      validate: (val: string) =>
        val.trim().length > 0 ? true : t("providers.custom.modelRequired"),
    });
    if (!model) {
      console.log(chalk.gray("\n" + t("providers.config.cancelled")));
      return;
    }

    const contextWindowInput = await showInput({
      title: t("providers.custom.enterContextWindow"),
      defaultValue: existing?.contextWindow ? String(existing.contextWindow) : "",
    });
    const contextWindow = contextWindowInput?.trim()
      ? Number(contextWindowInput.trim())
      : undefined;
    if (
      contextWindow !== undefined &&
      (!Number.isFinite(contextWindow) || contextWindow <= 0)
    ) {
      console.log(chalk.red("\n" + t("providers.custom.contextWindowInvalid")));
      return;
    }

    const configureReasoning = await showConfirm({
      title: t("providers.custom.configureReasoningEffort"),
      defaultValue: existing?.reasoningEffort !== undefined,
    });
    const reasoningEffort = configureReasoning
      ? await this.promptReasoningEffort(existing?.reasoningEffort)
      : undefined;
    if (configureReasoning && !reasoningEffort) {
      console.log(chalk.gray("\n" + t("providers.config.cancelled")));
      return;
    }

    const sanitizedModel = sanitizeModelId(model);
    if (!sanitizedModel) {
      console.log(chalk.red("\n" + t("providers.custom.modelRequired")));
      return;
    }

    const customProvider: CustomProviderSettings = {
      id,
      displayName: displayName.trim(),
      apiFormat: "openai-compatible",
      baseUrl: baseUrl.trim().replace(/\/+$/, ""),
      apiKeyRequired,
      ...(apiKey && { apiKey }),
      model: sanitizedModel,
      ...(contextWindow !== undefined && { contextWindow }),
      ...(reasoningEffort !== undefined && { reasoningEffort }),
      models: [
        {
          id: sanitizedModel,
          ...(contextWindow !== undefined && { contextWindow }),
          ...(reasoningEffort !== undefined && { reasoningEffort }),
        },
      ],
    };

    const verification = await this.verifyCustomProvider(customProvider);
    if (!verification.valid) {
      console.log(chalk.red(`\n✗ ${verification.error}`));
      if (verification.hint) {
        console.log(chalk.gray(verification.hint));
      }
      return;
    }

    this.runtime.config.customProviders = {
      ...this.runtime.config.customProviders,
      [id]: customProvider,
    };
    this.runtime.config.provider = providerName;
    this.runtime.options.model = customProvider.model;
    await saveConfig(this.runtime.config);
    this.resetLlmClient(providerName, customProvider.model);
    this.updateContextWindow(getContextWindow(customProvider.model, contextWindow));
    this.resetContextPercent();
    this.emitStatus();

    console.log(
      chalk.green(
        "\n✓ " +
          t("providers.config.configuredSuccessfully", {
            provider: customProvider.displayName,
          }),
      ),
    );
  }

  private async verifyCustomProvider(
    provider: CustomProviderSettings,
  ): Promise<{ valid: boolean; error?: string; hint?: string }> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (provider.apiKey) {
      headers.Authorization = `Bearer ${provider.apiKey}`;
    }

    try {
      const response = await fetch(`${provider.baseUrl}/models`, { headers });
      if (!response.ok) {
        return {
          valid: false,
          error: t("providers.custom.verificationFailedStatus", {
            status: String(response.status),
          }),
          hint: t("providers.custom.verificationFailedHint"),
        };
      }

      const body = (await response.json()) as unknown;
      const modelIds = this.extractOpenAIModelIds(body);
      if (modelIds.length > 0 && !modelIds.includes(provider.model)) {
        return {
          valid: false,
          error: t("providers.custom.modelNotFound", {
            model: provider.model,
          }),
          hint: t("providers.custom.modelNotFoundHint", {
            models: modelIds.slice(0, 8).join(", "),
          }),
        };
      }

      return { valid: true };
    } catch {
      return {
        valid: false,
        error: t("providers.custom.verificationNetworkError"),
        hint: t("providers.custom.verificationFailedHint"),
      };
    }
  }

  private extractOpenAIModelIds(body: unknown): string[] {
    if (!body || typeof body !== "object" || !("data" in body)) {
      return [];
    }
    const data = (body as { data?: unknown }).data;
    if (!Array.isArray(data)) {
      return [];
    }
    return data
      .map((entry) =>
        entry && typeof entry === "object" && "id" in entry
          ? (entry as { id?: unknown }).id
          : undefined,
      )
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  }

  private async removeCustomProvider(provider: CustomProviderId): Promise<void> {
    const id = normalizeCustomProviderId(provider);
    const existing = getCustomProviderConfig(this.runtime.config, provider);
    if (!existing) {
      console.log(chalk.gray("\n" + t("providers.custom.removeMissing")));
      return;
    }

    const confirmed = await showConfirm({
      title: t("providers.custom.removeConfirm", { provider: existing.displayName }),
      defaultValue: false,
    });
    if (!confirmed) {
      console.log(chalk.gray("\n" + t("providers.config.cancelled")));
      return;
    }

    const nextCustomProviders = { ...(this.runtime.config.customProviders ?? {}) };
    delete nextCustomProviders[id];
    this.runtime.config.customProviders =
      Object.keys(nextCustomProviders).length > 0 ? nextCustomProviders : undefined;

    this.runtime.config.provider = "openrouter";
    const fallbackModel =
      getProviderConfig(this.runtime.config, "openrouter")?.model ??
      getProviderDefaultModel("openrouter", "openrouter/auto");
    this.runtime.options.model = fallbackModel;

    await saveConfig(this.runtime.config);
    this.resetLlmClient("openrouter", fallbackModel);
    this.resetContextPercent();
    this.emitStatus();

    console.log(
      chalk.green(
        "\n✓ " + t("providers.custom.removed", { provider: existing.displayName }),
      ),
    );
  }

  /**
   * Change Vertex AI settings with pre-populated values
   */
  private async changeVertexAISettings(
    currentModel: string,
    currentSettings: VertexAISettings | null,
  ): Promise<void> {
    try {
      console.log(chalk.cyan(t("providers.wizard.vertexai.title")));

      // Show current settings
      const maskedToken = currentSettings?.authToken
        ? `...${currentSettings.authToken.slice(-8)}`
        : t("ui.notSet");
      const currentEndpoint = currentSettings?.endpoint || "aiplatform.googleapis.com";
      const currentProject = currentSettings?.projectId || t("ui.notSet");
      const currentRegion = currentSettings?.region || "global";

      console.log(chalk.gray(`\n${t("providers.config.currentSettings")}:`));
      console.log(chalk.gray(`  Project ID: ${currentProject}`));
      console.log(chalk.gray(`  Region: ${currentRegion}`));
      console.log(chalk.gray(`  Endpoint: ${currentEndpoint}`));
      console.log(chalk.gray(`  Auth Token: ${maskedToken}`));
      console.log(chalk.gray(`  Model: ${currentModel || t("ui.notSet")}`));

      // Ask what to change
      const actionOptions: ModalOption[] = [
        { label: t("providers.config.changeModelOnly"), value: "model" },
        { label: t("providers.config.changeApiKeyOnly"), value: "authToken" },
        { label: t("providers.config.changeBoth"), value: "both" },
        { label: t("providers.config.changeBaseUrl"), value: "endpoint" },
        { label: t("ui.cancel"), value: "cancel" },
      ];

      const actionResult = await showModal({
        title: t("providers.config.whatToChange"),
        options: actionOptions,
      });

      if (!actionResult || actionResult.value === "cancel") {
        console.log(chalk.gray("\n" + t("providers.config.settingsChangeCancelled")));
        return;
      }

      const action = actionResult.value as string;
      let newAuthToken = currentSettings?.authToken || "";
      let newProjectId = currentSettings?.projectId || "";
      let newRegion = currentSettings?.region || "global";
      let newEndpoint = currentSettings?.endpoint || "aiplatform.googleapis.com";
      let newModel = currentModel;

      // Handle auth token change
      if (action === "authToken" || action === "both") {
        const authToken = await showInput({
          title: t("providers.wizard.vertexai.enterAuthToken"),
          placeholder: currentSettings?.authToken ? maskedToken : t("ui.apiKeyPlaceholder"),
          defaultValue: "",
        });

        if (!authToken) {
          console.log(chalk.gray("\n" + t("providers.config.cancelled")));
          return;
        }
        newAuthToken = authToken.trim();

        // Also ask for project ID if changing auth
        const projectId = await showInput({
          title: t("providers.wizard.vertexai.enterProjectId"),
          placeholder: currentSettings?.projectId || "my-gcp-project",
          defaultValue: currentSettings?.projectId || "",
        });

        if (!projectId) {
          console.log(chalk.gray("\n" + t("providers.config.cancelled")));
          return;
        }
        newProjectId = projectId.trim();

        // Ask for region
        const region = await showInput({
          title: t("providers.wizard.vertexai.enterRegion"),
          placeholder: currentSettings?.region || "global",
          defaultValue: currentSettings?.region || "global",
        });
        newRegion = region?.trim() || "global";
      }

      // Handle endpoint change
      if (action === "endpoint") {
        const endpoint = await showInput({
          title: t("providers.wizard.vertexai.enterEndpoint"),
          placeholder: currentSettings?.endpoint || "aiplatform.googleapis.com",
          defaultValue: currentSettings?.endpoint || "aiplatform.googleapis.com",
        });
        newEndpoint = endpoint?.trim() || "aiplatform.googleapis.com";
      }

      // Handle model change
      if (action === "model" || action === "both") {
        // Build model list: user's current model first (if not in defaults), then recommended coding models
        const userModel = currentModel?.trim();
        const models: string[] = [];

        // Always put the user's current model first if it's set and not already in the recommended list
        if (userModel && !VERTEX_AI_CODING_MODELS.includes(userModel)) {
          models.push(userModel);
        }

        // Add recommended coding-capable models
        models.push(...VERTEX_AI_CODING_MODELS);

        const modelOptions: ModalOption[] = models.map((name) => ({
          label: name === userModel ? `${name} (current)` : name,
          value: name,
        }));

        const currentIndex = Math.max(0, models.indexOf(userModel));
        const result = await showModal({
          title: t("providers.config.selectModel"),
          options: modelOptions,
          initialIndex: currentIndex,
          allowCustomInput: true,
        });

        if (!result) {
          console.log(chalk.gray("\n" + t("providers.config.settingsChangeCancelled")));
          return;
        }

        newModel = result.value as string;
      }

      // Update config
      this.runtime.config.vertexai = {
        authToken: newAuthToken,
        projectId: newProjectId,
        region: newRegion,
        endpoint: newEndpoint,
        model: newModel,
      };
      const contextWindow = await this.resolveContextWindow("vertexai", newModel);
      this.runtime.config.provider = "vertexai";
      this.runtime.options.model = newModel;

      console.log(chalk.green("\n✓ " + t("providers.config.settingsUpdated", { provider: "Vertex AI" })));
      console.log(chalk.gray(`  Model: ${newModel}`));

      this.updateContextWindow(contextWindow);
      this.resetContextPercent();
      this.resetLlmClient("vertexai", newModel);
      this.emitStatus();
    } catch (error) {
      console.log(chalk.red(`\n✗ ${t("providers.config.error")}`));
      console.log(chalk.gray((error as Error).message));
    }
  }

  /**
   * Configure Google Cloud Vertex AI provider
   */
  private async configureVertexAI(): Promise<void> {
    try {
      console.log(chalk.cyan(t("providers.wizard.vertexai.title")));
      console.log(
        chalk.gray(
          t("providers.wizard.vertexai.getStarted") + "\n",
        ),
      );

      console.log(
        chalk.yellow(`\n${t("providers.wizard.vertexai.setupSteps.title")}`),
      );
      console.log(
        chalk.gray(`  ${t("providers.wizard.vertexai.setupSteps.step1")}`),
      );
      console.log(
        chalk.gray(`  ${t("providers.wizard.vertexai.setupSteps.step2")}`),
      );
      console.log(
        chalk.gray(`  ${t("providers.wizard.vertexai.setupSteps.step3")}`),
      );
      console.log();

      // Step 1: Endpoint
      const endpoint =
        (await showInput({
          title: t("providers.wizard.vertexai.enterEndpoint"),
          defaultValue: "aiplatform.googleapis.com",
        })) ?? undefined;
      if (!endpoint) {
        console.log(chalk.gray("\n" + t("providers.config.cancelled")));
        return;
      }

      // Step 2: Region
      const region =
        (await showInput({
          title: t("providers.wizard.vertexai.enterRegion"),
          defaultValue: "global",
        })) ?? undefined;
      if (!region) {
        console.log(chalk.gray("\n" + t("providers.config.cancelled")));
        return;
      }

      // Step 3: Project ID
      const projectId =
        (await showInput({
          title: t("providers.wizard.vertexai.enterProjectId"),
          placeholder: "YOUR_PROJECT_ID",
        })) ?? undefined;
      if (!projectId) {
        console.log(chalk.gray("\n" + t("providers.config.cancelled")));
        return;
      }

      // Step 4: Auth Token
      console.log(
        chalk.gray("\n" + t("providers.wizard.vertexai.authTokenHint")),
      );
      console.log(
        chalk.gray(`  ${t("providers.wizard.vertexai.authTokenCommand")}`),
      );
      console.log();

      const authToken =
        (await showPassword({
          title: t("providers.wizard.vertexai.enterAuthToken"),
          placeholder: t("ui.apiKeyPlaceholder"),
        })) ?? undefined;
      if (!authToken) {
        console.log(chalk.gray("\n" + t("providers.config.cancelled")));
        return;
      }

      // Step 5: Model selection with recommended coding models
      const modelOptions: ModalOption[] = VERTEX_AI_CODING_MODELS.map((name) => ({
        label: name,
        value: name,
      }));
      const modelResult = await showModal({
        title: t("providers.config.selectModel"),
        options: modelOptions,
        allowCustomInput: true,
      });
      if (!modelResult) {
        console.log(chalk.gray("\n" + t("providers.config.cancelled")));
        return;
      }
      const model = modelResult.value as string;

      this.runtime.config.vertexai = {
        authToken,
        endpoint,
        region,
        projectId,
        model: sanitizeModelId(model),
      };

      this.runtime.config.provider = "vertexai";
      this.runtime.options.model = model;
      await saveConfig(this.runtime.config);
      this.resetLlmClient("vertexai", model);

      console.log(
        chalk.green(
          "\n✓ " +
            t("providers.config.configuredSuccessfully", {
              provider: t("providers.vertexai"),
            }),
        ),
      );
      console.log(
        chalk.gray(
          "  " + t("providers.config.modelLabel", { model }),
        ),
      );
    } catch (error) {
      throw error;
    }
  }

  /**
   * Configure xAI provider (API key + model)
   */
  private async configureXAI(): Promise<void> {
    try {
      console.log(chalk.cyan(t("providers.wizard.xai.title")));
      console.log(
        chalk.gray(
          t("providers.config.apiKeyUrl", {
            url: t("providers.wizard.xai.apiKeyUrl"),
          }) + "\n",
        ),
      );

      const apiKey = await showPassword({
        title: t("providers.config.enterApiKey", {
          provider: t("providers.xai"),
        }),
        placeholder: t("ui.apiKeyPlaceholder"),
      });

      if (!apiKey) {
        console.log(chalk.gray("\n" + t("providers.config.cancelled")));
        return;
      }

      const model =
        (await showInput({
          title: t("providers.wizard.xai.enterModel"),
          defaultValue: getProviderDefaultModel("xai", "grok-4.20-reasoning"),
        })) ?? undefined;
      if (!model) {
        console.log(chalk.gray("\n" + t("providers.config.cancelled")));
        return;
      }

      this.runtime.config.xai = {
        apiKey,
        baseUrl: "https://api.x.ai/v1",
        model,
      };

      this.runtime.config.provider = "xai";
      this.runtime.options.model = model;
      await saveConfig(this.runtime.config);
      this.resetLlmClient("xai", model);

      console.log(
        chalk.green(
          "\n✓ " +
            t("providers.config.configuredSuccessfully", {
              provider: t("providers.xai"),
            }),
        ),
      );
      console.log(
        chalk.gray(
          "  " + t("providers.config.modelLabel", { model }),
        ),
      );
    } catch (error) {
      throw error;
    }
  }

  /**
   * Configure NVIDIA AI Cloud provider (API key + model selection)
   */
  private async configureNvidia(): Promise<void> {
    try {
      console.log(chalk.cyan(t("providers.wizard.nvidia.title")));
      console.log(
        chalk.gray(
          t("providers.config.apiKeyUrl", {
            url: t("providers.wizard.nvidia.apiKeyUrl"),
          }) + "\n",
        ),
      );

      const apiKey = await showPassword({
        title: t("providers.config.enterApiKey", {
          provider: t("providers.nvidia"),
        }),
        placeholder: t("ui.apiKeyPlaceholder"),
      });

      if (!apiKey) {
        console.log(chalk.gray("\n" + t("providers.config.cancelled")));
        return;
      }

      const modelChoices: ModalOption[] = NVIDIA_MODELS.map((model) => ({
        label: model,
        value: model,
      }));

      const result = await showModal({
        title: t("providers.config.selectModel"),
        options: modelChoices,
      });

      if (!result) {
        console.log(chalk.gray("\n" + t("providers.config.cancelled")));
        return;
      }

      const model = result.value as string;

      this.runtime.config.nvidia = {
        apiKey,
        baseUrl: NVIDIA_DEFAULT_BASE_URL,
        model,
      };

      this.runtime.config.provider = "nvidia";
      this.runtime.options.model = model;
      await saveConfig(this.runtime.config);
      this.resetLlmClient("nvidia", model);

      console.log(
        chalk.green(
          "\n✓ " +
            t("providers.config.configuredSuccessfully", {
              provider: t("providers.nvidia"),
            }),
        ),
      );
    } catch (error) {
      throw error;
    }
  }

  private async changeCloudProviderSettings(
    provider: CloudProviderWithSettings,
    currentModel: string,
    currentSettings: {
      apiKey?: string;
      baseUrl?: string;
      model?: string;
    } | null,
    forcedAction?: CloudProviderSettingsAction,
  ): Promise<void> {
    const providerName = this.getProviderDisplayName(provider);
    const openAISettings =
      provider === "openai" ? this.runtime.config.openai : undefined;
    const maskedKey =
      provider === "openai" && openAISettings?.authMode === "chatgpt"
        ? "ChatGPT account"
        : currentSettings?.apiKey
          ? `...${currentSettings.apiKey.slice(-4)}`
          : t("providers.config.notSet");

    if (!forcedAction) {
      console.log(
        chalk.cyan(
          "\n" + t("providers.config.settingsTitle", { provider: providerName }),
        ),
      );
      console.log(
        chalk.gray(
          t("providers.config.currentModel", {
            model: currentModel || t("providers.config.notSet"),
          }),
        ),
      );
      console.log(
        chalk.gray(
          t("providers.config.currentApiKey", { key: maskedKey }) + "\n",
        ),
      );
    }

    const action = forcedAction ?? await this.promptCloudProviderSettingsAction(provider);
    if (!action) return;

    let newModel = currentModel;
    let newApiKey = currentSettings?.apiKey || "";
    const customSettings = getCustomProviderConfig(this.runtime.config, provider);
    let authMode: OpenAIAuthMode | undefined =
      provider === "openai"
        ? this.runtime.config.openai?.authMode === "chatgpt"
          ? "chatgpt"
          : "api-key"
        : undefined;
    let chatgptAuth =
      provider === "openai"
        ? this.runtime.config.openai?.chatgptAuth
        : undefined;

    let reasoningEffort: ReasoningEffort | undefined;
    if ((provider === "openai" || isCustomProviderName(provider)) && action === "reasoning") {
      reasoningEffort = await this.promptReasoningEffort(
        provider === "openai"
          ? this.runtime.config.openai?.reasoningEffort
          : customSettings?.reasoningEffort,
      );
      if (!reasoningEffort) {
        console.log(
          chalk.gray("\n" + t("providers.config.settingsChangeCancelled")),
        );
        return;
      }
    }

    // Handle API key change
    if (provider === "openai" && (action === "auth" || action === "both")) {
      const selectedAuthMode = await this.promptOpenAIAuthMode(authMode);
      if (!selectedAuthMode) {
        console.log(
          chalk.gray("\n" + t("providers.config.settingsChangeCancelled")),
        );
        return;
      }

      authMode = selectedAuthMode;
      if (authMode === "chatgpt") {
        console.log(chalk.gray("\n" + t("providers.openaiAuth.starting")));
        chatgptAuth = await authenticateOpenAIChatGPT({
          onPrompt: ({ authorizationUrl, browserOpened }) => {
            console.log(
              chalk.gray(t("providers.openaiAuth.browserPrompt") + "\n"),
            );
            console.log(chalk.white(authorizationUrl));
            console.log(
              chalk.gray(
                t(
                  browserOpened
                    ? "providers.openaiAuth.browserOpened"
                    : "providers.openaiAuth.openManually",
                ),
              ),
            );
            console.log(chalk.gray(t("providers.openaiAuth.waiting") + "\n"));
          },
        });
        newApiKey = "";
      } else {
        chatgptAuth = undefined;
      }
    }

    if (
      (provider !== "openai" && (action === "apiKey" || action === "both")) ||
      (provider === "openai" &&
        authMode === "api-key" &&
        (action === "auth" || action === "both"))
    ) {
      const keyUrlMap: Partial<Record<Exclude<CloudProviderWithSettings, CustomProviderId>, string>> = {
        openai: "https://platform.openai.com/api-keys",
        openrouter: "https://openrouter.ai/keys",
        llmgateway: "https://llmgateway.io/dashboard",
        azure: "https://ai.azure.com",
        zai: "https://z.ai/api-keys",
        sakana: "https://sakana.ai",
        xai: "https://console.x.ai/keys",
        nvidia: "https://build.nvidia.com/api-key",
        deepseek: "https://platform.deepseek.com/api_keys",
      };
      const keyUrl = isCustomProviderName(provider) ? customSettings?.baseUrl : keyUrlMap[provider];
      if (keyUrl) {
        console.log(
          chalk.gray(
            "\n" + t("providers.config.apiKeyUrl", { url: keyUrl }) + "\n",
          ),
        );
      }

      const apiKey = await showPassword({
        title: t("providers.config.enterApiKey", { provider: providerName }),
        placeholder: t("ui.apiKeyPlaceholder"),
        validate: (val: string) => {
          if (isCustomProviderName(provider) && customSettings?.apiKeyRequired === false) return true;
          if (!val?.trim()) return t("providers.config.apiKeyRequired");
          if (val.length < 10) return t("providers.config.apiKeyTooShort");
          return true;
        },
      });

      if (!apiKey) {
        console.log(
          chalk.gray("\n" + t("providers.config.settingsChangeCancelled")),
        );
        return;
      }

      if (!isCustomProviderName(provider)) {
        console.log(chalk.gray("\n" + t("providers.config.validatingApiKey")));
        const validationResult = await this.validateApiKey(
          provider,
          apiKey.trim(),
        );

        if (!validationResult.valid) {
          console.log(chalk.red(`\n✗ ${validationResult.error}`));
          console.log(chalk.gray(validationResult.hint || ""));
          return;
        }

        console.log(chalk.green("✓ " + t("providers.config.apiKeyValid") + "\n"));
      }
      newApiKey = apiKey.trim();
    }

    // Handle model change
    if (action === "model" || action === "both") {
      if (provider === "openai") {
        const models: string[] = [...OPENAI_MODELS];
        const modelOptions: ModalOption[] = models.map((name) => ({
          label: name,
          value: name,
        }));
        const currentIndex = Math.max(0, models.indexOf(currentModel));
        const result = await showModal({
          title: t("providers.config.selectModel"),
          options: modelOptions,
          initialIndex: currentIndex,
        });

        if (!result) {
          console.log(
            chalk.gray("\n" + t("providers.config.settingsChangeCancelled")),
          );
          return;
        }

        newModel = result.value as string;
      } else if (provider === "llmgateway") {
        // LLM Gateway - offer popular models
        const models = [
          "gpt-4o",
          "gpt-4o-mini",
          "claude-3-5-sonnet-20241022",
          "claude-3-5-haiku-20241022",
          "gemini-1.5-pro",
          "gemini-1.5-flash",
        ];
        const modelOptions: ModalOption[] = models.map((name) => ({
          label: name,
          value: name,
        }));
        const currentIndex = Math.max(0, models.indexOf(currentModel));
        const result = await showModal({
          title: t("providers.config.selectModel"),
          options: modelOptions,
          initialIndex: currentIndex,
        });

        if (!result) {
          console.log(
            chalk.gray("\n" + t("providers.config.settingsChangeCancelled")),
          );
          return;
        }

        newModel = result.value as string;
      } else if (provider === "zai") {
        const modelOptions: ModalOption[] = ZAI_MODELS.map((name) => ({
          label: name,
          value: name,
        }));
        const currentIndex = Math.max(
          0,
          ZAI_MODELS.indexOf(currentModel as (typeof ZAI_MODELS)[number]),
        );
        const result = await showModal({
          title: t("providers.config.selectModel"),
          options: modelOptions,
          initialIndex: currentIndex,
        });

        if (!result) {
          console.log(
            chalk.gray("\n" + t("providers.config.settingsChangeCancelled")),
          );
          return;
        }

        newModel = result.value as string;
      } else if (provider === "sakana") {
        const modelOptions: ModalOption[] = SAKANA_MODELS.map((name) => ({
          label: name,
          value: name,
        }));
        const currentIndex = Math.max(
          0,
          SAKANA_MODELS.indexOf(currentModel as (typeof SAKANA_MODELS)[number]),
        );
        const result = await showModal({
          title: t("providers.config.selectModel"),
          options: modelOptions,
          initialIndex: currentIndex,
        });

        if (!result) {
          console.log(
            chalk.gray("\n" + t("providers.config.settingsChangeCancelled")),
          );
          return;
        }

        newModel = result.value as string;
      } else if (isCustomProviderName(provider)) {
        const configuredModels = customSettings?.models?.map((entry) => entry.id) ?? [];
        if (configuredModels.length > 0) {
          const modelOptions: ModalOption[] = configuredModels.map((name) => ({
            label: name,
            value: name,
          }));
          const currentIndex = Math.max(0, configuredModels.indexOf(currentModel));
          const result = await showModal({
            title: t("providers.config.selectModel"),
            options: [
              ...modelOptions,
              { label: t("providers.config.customModel"), value: "__custom_model__" },
            ],
            initialIndex: currentIndex,
          });

          if (!result) {
            console.log(
              chalk.gray("\n" + t("providers.config.settingsChangeCancelled")),
            );
            return;
          }

          if (result.value === "__custom_model__") {
            const model = await showInput({
              title: t("providers.config.enterModelId"),
              defaultValue: currentModel,
            });
            if (!model) {
              console.log(
                chalk.gray("\n" + t("providers.config.settingsChangeCancelled")),
              );
              return;
            }
            newModel = model.trim();
          } else {
            newModel = result.value as string;
          }
        } else {
          const model = await showInput({
            title: t("providers.config.enterModelId"),
            defaultValue: currentModel,
          });
          if (!model) {
            console.log(
              chalk.gray("\n" + t("providers.config.settingsChangeCancelled")),
            );
            return;
          }
          newModel = model.trim();
        }
      } else if (provider === "nvidia") {
        const modelOptions: ModalOption[] = NVIDIA_MODELS.map((name) => ({
          label: name,
          value: name,
        }));
        const currentIndex = Math.max(
          0,
          [...NVIDIA_MODELS].indexOf(currentModel as (typeof NVIDIA_MODELS)[number]),
        );
        const result = await showModal({
          title: t("providers.config.selectModel"),
          options: modelOptions,
          initialIndex: currentIndex,
        });

        if (!result) {
          console.log(
            chalk.gray("\n" + t("providers.config.settingsChangeCancelled")),
          );
          return;
        }

        newModel = result.value as string;
      } else if (provider === "deepseek") {
        const modelOptions: ModalOption[] = DEEPSEEK_MODELS.map((name) => ({
          label: name,
          value: name,
        }));
        const currentIndex = Math.max(
          0,
          DEEPSEEK_MODELS.indexOf(currentModel as (typeof DEEPSEEK_MODELS)[number]),
        );
        const result = await showModal({
          title: t("providers.config.selectModel"),
          options: modelOptions,
          initialIndex: currentIndex,
        });

        if (!result) {
          console.log(
            chalk.gray("\n" + t("providers.config.settingsChangeCancelled")),
          );
          return;
        }

        newModel = result.value as string;
      } else if (provider === "azure") {
        console.log(
          chalk.gray(t("providers.wizard.azure.deploymentChangeHint")),
        );
        console.log(
          chalk.gray(
            t("providers.wizard.azure.deploymentChangeExample") + "\n",
          ),
        );
        const model = await showInput({
          title: t("providers.wizard.azure.enterDeploymentNameChange"),
          defaultValue: currentModel || "gpt-5.3-codex",
        });
        if (!model) {
          console.log(
            chalk.gray("\n" + t("providers.config.settingsChangeCancelled")),
          );
          return;
        }
        const trimmed = model.trim();
        if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
          console.log(
            chalk.red("\n✗ " + t("providers.wizard.azure.deploymentUrlError")),
          );
          console.log(
            chalk.gray(
              "  " + t("providers.wizard.azure.deploymentUrlErrorHint"),
            ),
          );
          console.log(
            chalk.gray(
              "  " +
                t("providers.wizard.azure.deploymentUrlErrorLocation") +
                "\n",
            ),
          );
          return;
        }
        newModel = trimmed;
      } else {
        // OpenRouter - allow custom model input
        const model = await showInput({
          title: t("providers.config.enterModelId"),
          defaultValue: currentModel || "your-modelcard-id-here",
        });

        if (!model) {
          console.log(
            chalk.gray("\n" + t("providers.config.settingsChangeCancelled")),
          );
          return;
        }
        newModel = model.trim();
      }
    }

    // Prompt for reasoning effort when changing OpenAI model
    if ((provider === "openai" || isCustomProviderName(provider)) && (action === "model" || action === "both")) {
      reasoningEffort = await this.promptReasoningEffort(
        provider === "openai"
          ? this.runtime.config.openai?.reasoningEffort
          : customSettings?.reasoningEffort,
      );
    }

    const contextWindow = await this.resolveContextWindow(provider, newModel);

    // Save the changes
    if (provider === "azure") {
      // Azure: preserve existing config, update model, deploymentName, and key
      const existing = this.runtime.config.azure ?? {
        model: newModel,
        authMethod: "api-key" as const,
      };
      this.runtime.config.azure = {
        ...existing,
        model: newModel,
        deploymentName: newModel,
        contextWindow,
        ...(newApiKey && { apiKey: newApiKey }),
      };
    } else {
      const baseUrlMap: Partial<Record<Exclude<CloudProviderWithSettings, CustomProviderId>, string>> = {
        openai:
          authMode === "chatgpt"
            ? "https://chatgpt.com/backend-api/codex"
            : "https://api.openai.com/v1",
        openrouter: "https://openrouter.ai/api/v1",
        llmgateway: "https://api.llmgateway.io/v1",
        zai: ZAI_DEFAULT_BASE_URL,
        sakana: SAKANA_DEFAULT_BASE_URL,
        xai: "https://api.x.ai/v1",
        nvidia: NVIDIA_DEFAULT_BASE_URL,
        deepseek: DEEPSEEK_DEFAULT_BASE_URL,
      };
      const baseUrl = isCustomProviderName(provider) ? customSettings?.baseUrl : baseUrlMap[provider];

      if (isCustomProviderName(provider) && customSettings) {
        const model = sanitizeModelId(newModel);
        this.runtime.config.customProviders = {
          ...this.runtime.config.customProviders,
          [customSettings.id]: {
            ...customSettings,
            apiKey: newApiKey,
            baseUrl: baseUrl ?? customSettings.baseUrl,
            model,
            contextWindow,
            ...(reasoningEffort !== undefined && { reasoningEffort }),
            models: [
              ...(customSettings.models?.filter((entry) => entry.id !== model) ?? []),
              {
                id: model,
                contextWindow,
                ...(reasoningEffort !== undefined && { reasoningEffort }),
              },
            ],
          },
        };
      } else if (provider === "openai") {
        this.runtime.config.openai = {
          authMode,
          ...(authMode === "chatgpt" ? { chatgptAuth } : { apiKey: newApiKey }),
          baseUrl,
          model: newModel,
          contextWindow,
          ...(reasoningEffort !== undefined && { reasoningEffort }),
        };
      } else if (provider === "openrouter") {
        this.runtime.config.openrouter = {
          apiKey: newApiKey,
          baseUrl,
          model: newModel,
          contextWindow,
        };
      } else if (provider === "nvidia") {
        this.runtime.config.nvidia = {
          apiKey: newApiKey,
          baseUrl,
          model: newModel,
          contextWindow,
        };
      } else if (provider === "zai") {
        this.runtime.config.zai = {
          apiKey: newApiKey,
          baseUrl,
          model: newModel,
          contextWindow,
        };
      } else if (provider === "sakana") {
        this.runtime.config.sakana = {
          apiKey: newApiKey,
          baseUrl,
          model: newModel,
          contextWindow,
        };
      } else if (provider === "deepseek") {
        this.runtime.config.deepseek = {
          apiKey: newApiKey,
          baseUrl,
          model: newModel,
          contextWindow,
        };
      } else {
        this.runtime.config.llmgateway = {
          apiKey: newApiKey,
          baseUrl,
          model: newModel,
          contextWindow,
        };
      }
    }
    this.runtime.options.model = newModel;
    await saveConfig(this.runtime.config);
    this.resetLlmClient(provider, newModel);
    this.updateContextWindow(contextWindow);
    this.resetContextPercent();
    this.emitStatus();

    console.log(
      chalk.green(
        "\n✓ " +
          t("providers.config.settingsUpdated", { provider: providerName }),
      ),
    );
    console.log(
      chalk.gray("  " + t("providers.config.providerLabel", { provider })),
    );
    console.log(
      chalk.gray("  " + t("providers.config.modelLabel", { model: newModel })),
    );
  }

  private async promptCloudProviderSettingsAction(
    provider: CloudProviderWithSettings,
  ): Promise<CloudProviderSettingsAction | null> {
    const actionOptions: ModalOption[] =
      provider === "openai"
        ? [
            { label: t("providers.config.changeModelOnly"), value: "model" },
            { label: t("providers.openaiAuth.changeAuthOnly"), value: "auth" },
            {
              label: t("providers.openaiAuth.changeModelAndAuth"),
              value: "both",
            },
          ]
        : [
            { label: t("providers.config.changeModelOnly"), value: "model" },
            { label: t("providers.config.changeApiKeyOnly"), value: "apiKey" },
            { label: t("providers.config.changeBoth"), value: "both" },
          ];

    const actionResult = await showModal({
      title: t("providers.config.whatToChange"),
      options: actionOptions,
    });

    if (!actionResult) {
      console.log(
        chalk.gray("\n" + t("providers.config.settingsChangeCancelled")),
      );
      return null;
    }

    return actionResult.value as CloudProviderSettingsAction;
  }

  /**
   * Prompt user to select reasoning effort level for OpenAI models
   */
  private async promptReasoningEffort(
    currentEffort?: ReasoningEffort,
  ): Promise<ReasoningEffort | undefined> {
    const options: ModalOption[] = [
      { label: "none", value: "none", description: "No extended reasoning" },
      {
        label: "low",
        value: "low",
        description: "Faster responses, minimal reasoning",
      },
      {
        label: "medium",
        value: "medium",
        description: "Balanced speed and reasoning",
      },
      {
        label: "high",
        value: "high",
        description: "Thorough reasoning (recommended)",
      },
      {
        label: "xhigh",
        value: "xhigh",
        description: "Maximum reasoning depth",
      },
    ];

    const result = await showModal({
      title: t("providers.config.selectReasoningEffort"),
      options,
      initialIndex: Math.max(
        0,
        options.findIndex((option) => option.value === (currentEffort ?? "high")),
      ),
    });

    if (!result) return undefined;
    return result.value as ReasoningEffort;
  }

  /**
   * Validate API key by making a test request to the provider
   */
  private async validateApiKey(
    provider: "openai" | "openrouter" | "llmgateway" | "azure" | "zai" | "sakana" | "xai" | "cerebras" | "nvidia" | "deepseek",
    apiKey: string,
  ): Promise<{ valid: boolean; error?: string; hint?: string }> {
    // Azure keys can't be easily validated without resource/deployment info
    if (provider === "azure") {
      return { valid: true };
    }

    try {
      const baseUrlMap = {
        openai: "https://api.openai.com/v1",
        openrouter: "https://openrouter.ai/api/v1",
        llmgateway: "https://api.llmgateway.io/v1",
        zai: ZAI_DEFAULT_BASE_URL,
        sakana: SAKANA_DEFAULT_BASE_URL,
        xai: "https://api.x.ai/v1",
        cerebras: "https://api.cerebras.ai/v1",
        nvidia: NVIDIA_DEFAULT_BASE_URL,
        deepseek: DEEPSEEK_DEFAULT_BASE_URL,
      };
      const baseUrl = baseUrlMap[provider];

      // Make a simple API call to validate the key
      const response = await fetch(`${baseUrl}/models`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(provider === "llmgateway" && {
            "x-source": "Autohand Code CLI",
          }),
          ...(provider === "openrouter" && {
            "HTTP-Referer": "https://autohand.dev",
            "X-OpenRouter-Title": "Autohand Code CLI",
            "X-OpenRouter-Categories": "cli-agent",
          }),
        },
        signal: AbortSignal.timeout(10000), // 10s timeout for validation
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
        openai: "https://platform.openai.com/api-keys",
        openrouter: "https://openrouter.ai/keys",
        llmgateway: "https://llmgateway.io/dashboard",
        zai: "https://z.ai/api-keys",
        sakana: "https://sakana.ai",
        xai: "https://console.x.ai/keys",
        cerebras: "https://cloud.cerebras.ai/platform/",
        nvidia: "https://build.nvidia.com/api-key",
        deepseek: "https://platform.deepseek.com/api_keys",
      };

      if (status === 401) {
        return {
          valid: false,
          error: t("providers.config.invalidApiKey"),
          hint: t("providers.config.invalidApiKeyHint", {
            url: keyUrlMap[provider],
          }),
        };
      }

      if (status === 403) {
        return {
          valid: false,
          error: t("providers.config.apiKeyNoPermission"),
          hint: t("providers.config.apiKeyNoPermissionHint"),
        };
      }

      if (status === 429) {
        return {
          valid: false,
          error: t("providers.config.rateLimited"),
          hint: t("providers.config.rateLimitedHint"),
        };
      }

      return {
        valid: false,
        error:
          errorData?.error?.message ||
          t("providers.config.apiReturnedStatus", { status: String(status) }),
        hint: t("providers.config.verifyApiKeyHint"),
      };
    } catch (error) {
      const err = error as Error;
      if (err.message?.includes("fetch") || err.message?.includes("network")) {
        return {
          valid: false,
          error: t("providers.config.networkError"),
          hint: t("providers.config.networkErrorHint"),
        };
      }
      return {
        valid: false,
        error: t("providers.config.validationFailed", { error: err.message }),
        hint: t("providers.config.validationFailedHint"),
      };
    }
  }

  /**
   * Apply a model change and update all relevant state
   */
  private async applyModelChange(
    provider: ProviderName,
    newModel: string,
    currentModel: string,
  ): Promise<void> {
    // Strip bracketed paste markers and control characters that can leak from terminal input
    newModel = sanitizeModelId(newModel);

    if (
      !newModel ||
      (newModel === currentModel && provider === this.getActiveProvider())
    ) {
      console.log(chalk.gray(t("providers.config.modelUnchanged")));
      return;
    }

    const previousModel = this.runtime.options.model;
    const contextWindow = await this.resolveContextWindow(provider, newModel);
    this.runtime.config.provider = provider;
    this.runtime.options.model = newModel;
    this.setProviderModel(provider, newModel, contextWindow);
    this.resetLlmClient(provider, newModel);
    await saveConfig(this.runtime.config);
    this.updateContextWindow(contextWindow);
    this.resetContextPercent();
    this.emitStatus();

    // Track model switch
    await this.telemetryManager.trackModelSwitch({
      fromModel: previousModel,
      toModel: newModel,
      provider,
      ...this.getProviderTelemetryMetadata(provider, newModel, contextWindow),
    });

    console.log(
      chalk.green(
        "✓ " + t("providers.config.usingModel", { provider, model: newModel }),
      ),
    );
  }

  /**
   * Set provider and model in runtime config
   */
  private setProviderModel(provider: ProviderName, model: string, contextWindow: number): void {
    if (isCustomProviderName(provider)) {
      const customSettings = getCustomProviderConfig(this.runtime.config, provider);
      if (customSettings) {
        this.runtime.config.customProviders = {
          ...this.runtime.config.customProviders,
          [customSettings.id]: {
            ...customSettings,
            model,
            contextWindow,
            models: [
              ...(customSettings.models?.filter((entry) => entry.id !== model) ?? []),
              { id: model, contextWindow },
            ],
          },
        };
      }
      this.setActiveProvider(provider);
      return;
    }

    const cfgMap = {
      openrouter:
        this.runtime.config.openrouter ??
        (this.runtime.config.openrouter = { apiKey: "", model }),
      ollama:
        this.runtime.config.ollama ?? (this.runtime.config.ollama = { model }),
      llamacpp:
        this.runtime.config.llamacpp ??
        (this.runtime.config.llamacpp = { model }),
      openai:
        this.runtime.config.openai ??
        (this.runtime.config.openai = {
          authMode: "api-key",
          apiKey: "",
          model,
        }),
      mlx: this.runtime.config.mlx ?? (this.runtime.config.mlx = { model }),
      llmgateway:
        this.runtime.config.llmgateway ??
        (this.runtime.config.llmgateway = { apiKey: "", model }),
      azure:
        this.runtime.config.azure ??
        (this.runtime.config.azure = { model, authMethod: "api-key" }),
      zai:
        this.runtime.config.zai ??
        (this.runtime.config.zai = { apiKey: "", model }),
      sakana:
        this.runtime.config.sakana ??
        (this.runtime.config.sakana = { apiKey: "", model }),
      vertexai:
        this.runtime.config.vertexai ??
        (this.runtime.config.vertexai = {
          authToken: "",
          endpoint: "aiplatform.googleapis.com",
          region: "global",
          projectId: "",
          model,
        }),
      xai:
        this.runtime.config.xai ??
        (this.runtime.config.xai = { apiKey: "", model }),
      cerebras:
        this.runtime.config.cerebras ??
        (this.runtime.config.cerebras = { apiKey: "", model }),
      nvidia:
        this.runtime.config.nvidia ??
        (this.runtime.config.nvidia = { apiKey: "", model }),
      deepseek:
        this.runtime.config.deepseek ??
        (this.runtime.config.deepseek = { apiKey: "", model }),
      bedrock:
        this.runtime.config.bedrock ??
        (this.runtime.config.bedrock = {
          model,
          region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || BEDROCK_DEFAULT_REGION,
        }),
    };
    cfgMap[provider].model = model;
    cfgMap[provider].contextWindow = contextWindow;
    this.setActiveProvider(provider);
  }

  private getProviderTelemetryMetadata(
    provider: ProviderName,
    model: string,
    contextWindow: number,
  ): {
    providerDisplayName?: string;
    providerApiFormat?: string;
    reasoningEffort?: ReasoningEffort;
    contextWindow: number;
  } {
    const customSettings = getCustomProviderConfig(this.runtime.config, provider);
    if (customSettings) {
      const modelMetadata = customSettings.models?.find((entry) => entry.id === model);
      return {
        providerDisplayName: customSettings.displayName,
        providerApiFormat: customSettings.apiFormat,
        reasoningEffort: modelMetadata?.reasoningEffort ?? customSettings.reasoningEffort,
        contextWindow,
      };
    }

    const providerSettings = getProviderConfig(this.runtime.config, provider);
    return {
      providerDisplayName: this.getProviderDisplayName(provider),
      reasoningEffort: providerSettings?.reasoningEffort,
      contextWindow,
    };
  }

  private async promptOpenAIAuthMode(
    currentMode: OpenAIAuthMode = "api-key",
  ): Promise<OpenAIAuthMode | null> {
    const result = await showModal({
      title: t("providers.openaiAuth.chooseTitle"),
      options: [
        {
          label: t("providers.openaiAuth.apiKeyLabel"),
          value: "api-key",
          description: t("providers.openaiAuth.apiKeyDescription"),
        },
        {
          label: t("providers.openaiAuth.chatgptLabel"),
          value: "chatgpt",
          description: t("providers.openaiAuth.chatgptDescription"),
        },
      ],
      initialIndex: currentMode === "chatgpt" ? 1 : 0,
    });

    return (result?.value as OpenAIAuthMode | undefined) ?? null;
  }

  /**
   * Reset the LLM client with a new provider and model
   */
  private resetLlmClient(provider: ProviderName, model: string): void {
    // Update config to use the selected provider and model
    this.runtime.config.provider = provider;
    const providerConfig = getProviderConfig(this.runtime.config, provider);
    if (providerConfig && !isCustomProviderName(provider)) {
      providerConfig.model = model;
    }

    // Create new provider using factory
    const newLlm = ProviderFactory.create(this.runtime.config);
    newLlm.setModel(model);
    this.setLlm(newLlm);

    // Recreate delegator with context inheritance
    const delegatorContext =
      this.runtime.options.clientContext ??
      (this.runtime.options.restricted ? "restricted" : "cli");
    const newDelegator = new AgentDelegator(newLlm, this.actionExecutor, {
      clientContext: delegatorContext,
      maxDepth: 3,
      featureConfig: this.runtime.config,
      authorization: this.getDelegator()?.getAuthorizationOptions(),
      confirmApproval: this.getDelegator()?.getConfirmApproval(),
    });
    this.setDelegator(newDelegator);
    this.setActiveProvider(provider);
    this.updateContextWindow(
      getContextWindow(model, providerConfig?.contextWindow),
    );
  }
}
