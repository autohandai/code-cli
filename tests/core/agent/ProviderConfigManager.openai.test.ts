/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

var mockShowModal = vi.fn();
var mockShowInput = vi.fn();
var mockShowConfirm = vi.fn();
var mockShowPassword = vi.fn();
var mockSaveConfig = vi.fn();
var mockEnsureOpenAIChatGPTAuth = vi.fn();
var mockAuthenticateOpenAIChatGPT = vi.fn();
var mockEnsureAutohandAILocalDependencies = vi.fn();
var mockEnsureAutohandAILocalRuntime = vi.fn();
var mockRecommendAutohandAILocalModels = vi.fn();

vi.mock("../../../src/ui/ink/components/Modal.js", () => ({
  showConfirm: mockShowConfirm,
  showModal: mockShowModal,
  showInput: mockShowInput,
  showPassword: mockShowPassword,
  showConfirm: mockShowConfirm,
}));

vi.mock("../../../src/config.js", () => ({
  saveConfig: mockSaveConfig,
  getProviderConfig: (config: Record<string, unknown>, provider?: string) => {
    const chosen = provider ?? (config.provider as string | undefined);
    if (chosen?.startsWith("custom:")) {
      const id = chosen.slice("custom:".length);
      return (
        ((config.customProviders as Record<string, unknown> | undefined)?.[
          id
        ] as Record<string, unknown> | null | undefined) ?? null
      );
    }
    return chosen
      ? ((config[chosen] as Record<string, unknown> | null) ?? null)
      : null;
  },
}));

vi.mock("../../../src/providers/openaiAuth.js", () => ({
  ensureOpenAIChatGPTAuth: mockEnsureOpenAIChatGPTAuth,
  authenticateOpenAIChatGPT: mockAuthenticateOpenAIChatGPT,
  refreshChatGPTAuth: vi.fn(),
  isChatGPTAuthExpired: vi.fn(() => false),
}));

vi.mock("../../../src/providers/autohandAILocalSetup.js", () => ({
  AUTOHAND_AI_LOCAL_CODING_MODEL_FALLBACKS: [
    {
      id: "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit",
      label: "Qwen2.5 Coder 7B",
      description: "Fast local coding model",
      source: "curated",
    },
  ],
  ensureAutohandAILocalDependencies: mockEnsureAutohandAILocalDependencies,
  ensureAutohandAILocalRuntime: mockEnsureAutohandAILocalRuntime,
  recommendAutohandAILocalModels: mockRecommendAutohandAILocalModels,
  renderAutohandAISetupProgress: (event: { label: string }) => event.label,
}));

vi.mock("../../../src/i18n/index.js", () => ({
  t: (key: string, params?: Record<string, string>) => {
    const map: Record<string, string> = {
      "providers.zai": "Z.ai",
      "providers.sakana": "Sakana.AI",
      "providers.llmgateway": "LLM Gateway",
      "providers.autohandai": "Autohand AI",
      "providers.deepseek": "DeepSeek",
      "providers.openrouter": "OpenRouter",
      "providers.openai": "OpenAI",
      "providers.ollama": "Ollama",
      "providers.azure": "Azure OpenAI",
      "providers.config.hosted": "hosted",
      "providers.config.current": "current",
      "providers.config.appleSilicon": "Apple Silicon",
      "providers.config.settingsTitle": `${params?.provider ?? "{{provider}}"} Settings`,
      "providers.config.currentModel": `Current model: ${params?.model ?? "{{model}}"}`,
      "providers.config.currentApiKey": `Current API key: ${params?.key ?? "{{key}}"}`,
      "providers.config.authTypeApiKey": `Auth type: API Key: ${params?.key ?? "{{key}}"}`,
      "providers.config.authTypeChatGPT": "Auth type: ChatGPT account",
      "providers.config.reasoningEffortLabel": `Reasoning effort: ${params?.level ?? "{{level}}"}`,
      "providers.config.whatToChange": "What would you like to change?",
      "providers.config.changeModelOnly": "Change model",
      "providers.config.changeApiKeyOnly": "Change API key",
      "providers.config.changeProvider": "Change provider",
      "providers.config.newProvider": "New provider...",
      "providers.config.chooseProvider": "Choose provider",
      "providers.config.configuredSuccessfully": `${params?.provider ?? "{{provider}}"} configured successfully`,
      "providers.config.changeReasoningEffort": "Change reasoning effort",
      "providers.config.notSet": "not set",
      "providers.openaiAuth.changeAuthOnly": "Change authentication",
      "providers.custom.enterDisplayName": "Provider display name",
      "providers.custom.enterBaseUrl": "OpenAI-compatible base URL",
      "providers.custom.apiKeyRequired": "Does this provider require an API key?",
      "providers.custom.enterContextWindow": "Context window tokens",
      "providers.custom.configureReasoningEffort": "Configure reasoning effort?",
      "providers.custom.modelRequired": "Model ID is required",
      "providers.autohandaiPlan.detectModels": "Detecting local coding models",
      "providers.autohandaiPlan.selectLocalModel": "Choose a local coding model",
      "providers.autohandaiPlan.selectMoaEffort": "Choose Moa thinking effort",
    };
    return map[key] ?? key;
  },
}));

vi.mock("chalk", () => ({
  default: {
    green: (s: string) => s,
    red: (s: string) => s,
    gray: (s: string) => s,
    cyan: (s: string) => s,
    yellow: (s: string) => s,
    white: (s: string) => s,
  },
}));

// Dynamic import ensures mocks are applied even when the module cache
// has been populated by other test files in the same Bun process.
const { ProviderConfigManager } =
  await import("../../../src/core/agent/ProviderConfigManager.js");

describe("ProviderConfigManager openai auth mode", () => {
  let runtime: any;
  let manager: ProviderConfigManager;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let mockUpdateContextWindow: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    runtime = {
      config: {
        configPath: "/tmp/config.json",
        provider: "openrouter",
        openrouter: { apiKey: "test", model: "your-modelcard-id-here" },
      },
      workspaceRoot: "/workspace",
      options: {},
    };
    mockUpdateContextWindow = vi.fn();

    manager = new ProviderConfigManager(
      runtime,
      () => ({ setModel: vi.fn(), getName: () => "openrouter" }) as any,
      vi.fn(),
      () => runtime.config.provider,
      vi.fn(),
      () => undefined,
      vi.fn(),
      { trackModelSwitch: vi.fn().mockResolvedValue(undefined) } as any,
      {} as any,
      mockUpdateContextWindow,
      vi.fn(),
      vi.fn(),
    );
  });

  it("configures openai with chatgpt auth mode", async () => {
    mockAuthenticateOpenAIChatGPT.mockResolvedValue({
      accessToken: "chatgpt-access-token",
      refreshToken: "chatgpt-refresh-token",
      accountId: "chatgpt-account-123",
    });

    mockShowModal
      .mockResolvedValueOnce({ value: "chatgpt" })
      .mockResolvedValueOnce({ value: "gpt-5.4" })
      .mockResolvedValueOnce({ value: "high" });

    await (manager as any).configureOpenAI();

    expect(runtime.config.openai.authMode).toBe("chatgpt");
    expect(runtime.config.openai.chatgptAuth.accountId).toBe(
      "chatgpt-account-123",
    );
    expect(mockUpdateContextWindow).toHaveBeenCalledWith(1_050_000);
    expect(mockAuthenticateOpenAIChatGPT).toHaveBeenCalledOnce();
    expect(mockSaveConfig).toHaveBeenCalledOnce();
  });

  it("prints a visible sign-in status before starting chatgpt auth", async () => {
    mockAuthenticateOpenAIChatGPT.mockResolvedValue({
      accessToken: "chatgpt-access-token",
      refreshToken: "chatgpt-refresh-token",
      accountId: "chatgpt-account-123",
    });

    mockShowModal
      .mockResolvedValueOnce({ value: "chatgpt" })
      .mockResolvedValueOnce({ value: "gpt-5.4" })
      .mockResolvedValueOnce({ value: "high" });

    await (manager as any).configureOpenAI();

    const logCalls = consoleLogSpy.mock.calls
      .map((c: any[]) => c[0])
      .filter(Boolean);
    expect(
      logCalls.some(
        (msg: string) =>
          typeof msg === "string" &&
          msg.includes("providers.openaiAuth.starting"),
      ),
    ).toBe(true);
  });

  it("considers openai chatgpt auth mode configured", () => {
    runtime.config.openai = {
      authMode: "chatgpt",
      model: "gpt-5.4",
      chatgptAuth: {
        accessToken: "chatgpt-access-token",
        accountId: "chatgpt-account-123",
      },
    };

    expect(manager.isProviderConfigured("openai")).toBe(true);
  });

  it("configures Z.ai with Z.ai-specific models", async () => {
    mockShowPassword.mockResolvedValueOnce("zai-key-long-enough");
    mockShowModal.mockResolvedValueOnce({ value: "glm-5.2" });

    await (manager as any).configureZai();

    expect(runtime.config.zai).toEqual({
      apiKey: "zai-key-long-enough",
      baseUrl: "https://api.z.ai/api/paas/v4",
      model: "glm-5.2",
    });
    const modelModalOptions = mockShowModal.mock.calls[0][0].options;
    expect(modelModalOptions.slice(0, 2)).toEqual([
      { label: "glm-5.2", value: "glm-5.2" },
      { label: "glm-5.1", value: "glm-5.1" },
    ]);
    expect(runtime.config.provider).toBe("zai");
    expect(mockSaveConfig).toHaveBeenCalledOnce();
  });

  it("configures Sakana.AI with Fugu models", async () => {
    mockShowPassword.mockResolvedValueOnce("sakana-key-long-enough");
    mockShowModal.mockResolvedValueOnce({ value: "fugu-ultra" });

    await (manager as any).configureSakana();

    expect(runtime.config.sakana).toEqual({
      apiKey: "sakana-key-long-enough",
      baseUrl: "https://api.sakana.ai/v1",
      model: "fugu-ultra",
    });
    const modelModalOptions = mockShowModal.mock.calls[0][0].options;
    expect(modelModalOptions).toEqual([
      { label: "fugu", value: "fugu" },
      { label: "fugu-ultra", value: "fugu-ultra" },
    ]);
    expect(runtime.config.provider).toBe("sakana");
    expect(mockSaveConfig).toHaveBeenCalledOnce();
  });

  it("configures DeepSeek with current DeepSeek API models", async () => {
    mockShowPassword.mockResolvedValueOnce("deepseek-key-long-enough");
    mockShowModal.mockResolvedValueOnce({ value: "deepseek-v4-pro" });

    await (manager as any).configureDeepSeek();

    expect(runtime.config.deepseek).toEqual({
      apiKey: "deepseek-key-long-enough",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-pro",
    });
    expect(runtime.config.provider).toBe("deepseek");
    expect(mockSaveConfig).toHaveBeenCalledOnce();
  });

  it("configures Autohand AI Cloud with account auth when logged in", async () => {
    runtime.config.auth = { token: "account-session-token" };
    mockShowModal
      .mockResolvedValueOnce({ value: "cloud" })
      .mockResolvedValueOnce({ value: "moa" })
      .mockResolvedValueOnce({ value: "high" });

    await (manager as any).configureAutohandAI();

    expect(runtime.config.autohandai).toEqual({
      plan: "cloud",
      authMode: "account",
      accountToken: "account-session-token",
      baseUrl: "https://api.autohand.ai/v1",
      model: "moa",
      contextWindow: 1000000,
      reasoningEffort: "high",
    });
    expect(runtime.config.provider).toBe("autohandai");
    expect(mockSaveConfig).toHaveBeenCalledOnce();
  });

  it("configures Autohand AI Cloud with API key when not logged in", async () => {
    mockShowModal
      .mockResolvedValueOnce({ value: "cloud" })
      .mockResolvedValueOnce({ value: "fantail" });
    mockShowPassword.mockResolvedValueOnce("ah-api-key-long-enough");

    await (manager as any).configureAutohandAI();

    expect(runtime.config.autohandai).toEqual({
      plan: "cloud",
      authMode: "api-key",
      apiKey: "ah-api-key-long-enough",
      baseUrl: "https://api.autohand.ai/v1",
      model: "fantail",
      contextWindow: 16000,
    });
    expect(runtime.config.provider).toBe("autohandai");
    expect(mockSaveConfig).toHaveBeenCalledOnce();
  });

  it("configures Autohand AI Local by installing dependencies, selecting a llmfit model, and starting MLX", async () => {
    const localModel = {
      id: "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit",
      label: "Qwen2.5 Coder 7B",
      description: "Fast local coding model",
      source: "llmfit",
    };
    mockEnsureAutohandAILocalDependencies.mockResolvedValueOnce({
      ok: true,
      probe: { baseUrl: "http://127.0.0.1:8080", port: 8080 },
    });
    mockRecommendAutohandAILocalModels.mockResolvedValueOnce([localModel]);
    mockEnsureAutohandAILocalRuntime.mockResolvedValueOnce({
      ok: true,
      model: localModel,
      baseUrl: "http://127.0.0.1:8080",
      port: 8080,
      serverCommand: "mlx_lm.server --model mlx-community/Qwen2.5-Coder-7B-Instruct-4bit --port 8080",
    });
    mockShowModal
      .mockResolvedValueOnce({ value: "local" })
      .mockResolvedValueOnce({ value: localModel.id });

    await (manager as any).configureAutohandAI();

    expect(mockEnsureAutohandAILocalDependencies).toHaveBeenCalledWith(
      "/workspace",
      expect.any(Function),
    );
    expect(runtime.config.autohandai).toEqual({
      plan: "local",
      baseUrl: "http://127.0.0.1:8080",
      port: 8080,
      model: localModel.id,
      contextWindow: 1000000,
      serverCommand: "mlx_lm.server --model mlx-community/Qwen2.5-Coder-7B-Instruct-4bit --port 8080",
    });
    expect(runtime.config.provider).toBe("autohandai");
    expect(mockSaveConfig).toHaveBeenCalledOnce();
  });

  it("keeps Autohand AI Local on the local model-change path", async () => {
    const localModel = {
      id: "mlx-community/Qwen2.5-Coder-14B-Instruct-4bit",
      label: "Qwen2.5 Coder 14B",
      description: "Larger local coding model",
      source: "llmfit",
    };
    runtime.config.provider = "autohandai";
    runtime.config.autohandai = {
      plan: "local",
      baseUrl: "http://127.0.0.1:8080",
      port: 8080,
      model: "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit",
      contextWindow: 256000,
    };
    runtime.options.model = "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit";
    mockEnsureAutohandAILocalDependencies.mockResolvedValueOnce({
      ok: true,
      probe: { baseUrl: "http://127.0.0.1:8080", port: 8080 },
    });
    mockRecommendAutohandAILocalModels.mockResolvedValueOnce([localModel]);
    mockEnsureAutohandAILocalRuntime.mockResolvedValueOnce({
      ok: true,
      model: localModel,
      baseUrl: "http://127.0.0.1:8081",
      port: 8081,
      serverCommand: "mlx_lm.server --model mlx-community/Qwen2.5-Coder-14B-Instruct-4bit --port 8081",
    });
    mockShowModal.mockResolvedValueOnce({ value: localModel.id });

    await manager.changeProviderModel("autohandai");

    expect(runtime.config.autohandai).toEqual({
      plan: "local",
      baseUrl: "http://127.0.0.1:8081",
      port: 8081,
      model: localModel.id,
      contextWindow: 1000000,
      serverCommand: "mlx_lm.server --model mlx-community/Qwen2.5-Coder-14B-Instruct-4bit --port 8081",
    });
    expect(mockEnsureAutohandAILocalRuntime).toHaveBeenCalledWith(
      {
        cwd: "/workspace",
        model: localModel,
        baseUrl: "http://127.0.0.1:8080",
        port: 8080,
      },
      expect.any(Function),
    );
    expect(mockSaveConfig).toHaveBeenCalledOnce();
  });

  it("uses the configured Ollama base URL when selecting local models", async () => {
    const ollamaBaseUrl = "http://127.0.0.1:4321";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        models: [{ name: "local-model:latest" }],
      }),
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    runtime.config.ollama = {
      baseUrl: ollamaBaseUrl,
      model: "previous-model:latest",
    };
    mockShowModal.mockResolvedValueOnce({ value: "local-model:latest" });

    try {
      await (manager as unknown as { configureOllama: () => Promise<void> }).configureOllama();

      expect(fetchMock).toHaveBeenCalledWith(`${ollamaBaseUrl}/api/tags`);
      expect(runtime.config.ollama).toEqual({
        baseUrl: ollamaBaseUrl,
        model: "local-model:latest",
      });
      expect(runtime.config.provider).toBe("ollama");
      expect(mockSaveConfig).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("opens the current provider settings menu when the active provider is configured", async () => {
    runtime.config.provider = "openai";
    runtime.config.openai = {
      authMode: "api-key",
      apiKey: "sk-openai-key-1234567890",
      model: "gpt-5.4",
      reasoningEffort: "xhigh",
    };
    runtime.options.model = "gpt-5.4";

    mockShowModal.mockResolvedValueOnce(null);

    await manager.promptModelSelection();

    const firstPrompt = mockShowModal.mock.calls[0][0];
    expect(firstPrompt.title).toBe("What would you like to change?");
    expect(firstPrompt.options.map((option: { value: string }) => option.value)).toEqual([
      "reasoning",
      "model",
      "auth",
      "provider",
    ]);

    const logOutput = consoleLogSpy.mock.calls
      .map((call: unknown[]) => String(call[0] ?? ""))
      .join("\n");
    expect(logOutput).toContain("OpenAI Settings");
    expect(logOutput).toContain("Current model: gpt-5.4");
    expect(logOutput).toContain("Reasoning effort: xhigh");
    expect(logOutput).toContain("Auth type: API Key: ...7890");
  });

  it("shows the provider list from current settings only after choosing change provider", async () => {
    runtime.config.provider = "openai";
    runtime.config.openai = {
      authMode: "api-key",
      apiKey: "sk-openai-key-1234567890",
      model: "gpt-5.4",
    };
    runtime.options.model = "gpt-5.4";

    mockShowModal
      .mockResolvedValueOnce({ value: "provider" })
      .mockResolvedValueOnce(null);

    await manager.promptModelSelection();

    expect(mockShowModal.mock.calls[0][0].title).toBe("What would you like to change?");
    expect(mockShowModal.mock.calls[1][0].title).toBe("Choose provider");
    const providerOptions = mockShowModal.mock.calls[1][0].options;
    expect(providerOptions.some((option: { label: string }) => option.label.includes("OpenAI"))).toBe(true);
    expect(providerOptions.some((option: { label: string }) => option.label.includes("Z.ai"))).toBe(true);
  });

  it("hides Bedrock from /model provider choices when the feature flag is disabled", async () => {
    runtime.config.provider = "openai";
    runtime.config.features = {
      awsBedrockProvider: false,
    };
    runtime.config.openai = {
      authMode: "api-key",
      apiKey: "sk-openai-key-1234567890",
      model: "gpt-5.4",
    };
    runtime.options.model = "gpt-5.4";

    mockShowModal
      .mockResolvedValueOnce({ value: "provider" })
      .mockResolvedValueOnce(null);

    await manager.promptModelSelection();

    const providerOptions = mockShowModal.mock.calls[1][0].options;
    expect(providerOptions.some((option: { value: string }) => option.value === "bedrock")).toBe(false);
  });

  it("updates OpenAI reasoning effort from the configured provider menu", async () => {
    runtime.config.provider = "openai";
    runtime.config.openai = {
      authMode: "api-key",
      apiKey: "sk-openai-key-1234567890",
      model: "gpt-5.4",
      reasoningEffort: "high",
    };
    runtime.options.model = "gpt-5.4";

    mockShowModal
      .mockResolvedValueOnce({ value: "reasoning" })
      .mockResolvedValueOnce({ value: "xhigh" });

    await manager.promptModelSelection();

    expect(runtime.config.openai.reasoningEffort).toBe("xhigh");
    expect(mockSaveConfig).toHaveBeenCalledOnce();
    expect(mockShowModal.mock.calls[1][0].initialIndex).toBe(3);
  });

  it("shows user-facing provider names in provider selection when no active provider is configured", async () => {
    runtime.config.provider = "zai";
    runtime.config.features = { autohand_inference: true };

    mockShowModal.mockResolvedValueOnce(null);

    await manager.promptModelSelection();

    const options = mockShowModal.mock.calls[0][0].options;
    expect(options.some((option: { label: string }) => option.label.includes("Z.ai"))).toBe(true);
    expect(options.some((option: { label: string }) => option.label.includes("Sakana.AI"))).toBe(true);
    const autohandOption = options.find((option: { value: string }) => option.value === "autohandai");
    expect(autohandOption?.label).toContain("Autohand");
    expect(autohandOption?.label).not.toContain("(hosted)");
    expect(options.some((option: { label: string }) => option.label.includes("LLM Gateway"))).toBe(true);
    expect(options.some((option: { label: string }) => option.label.includes("DeepSeek"))).toBe(true);
  });

  it("shows a configured custom provider as the current provider in the provider list", async () => {
    runtime.config.provider = "custom:acme";
    runtime.config.customProviders = {
      acme: {
        id: "acme",
        displayName: "Acme AI",
        apiFormat: "openai-compatible",
        baseUrl: "https://api.acme.example/v1",
        apiKey: "acme-key-long-enough",
        apiKeyRequired: true,
        model: "acme-code-1",
        reasoningEffort: "high",
        contextWindow: 256000,
      },
    };
    runtime.options.model = "acme-code-1";

    mockShowModal
      .mockResolvedValueOnce({ value: "provider" })
      .mockResolvedValueOnce(null);

    await manager.promptModelSelection();

    const providerOptions = mockShowModal.mock.calls[1][0].options;
    const customOption = providerOptions.find(
      (option: { value: string }) => option.value === "custom:acme",
    );
    expect(customOption?.label).toContain("Acme AI");
    expect(customOption?.label).toContain("current");

    const logOutput = consoleLogSpy.mock.calls
      .map((call: unknown[]) => String(call[0] ?? ""))
      .join("\n");
    expect(logOutput).toContain("Acme AI Settings");
    expect(logOutput).toContain("Current model: acme-code-1");
    expect(logOutput).toContain("Reasoning effort: high");
  });

  it("verifies a custom OpenAI-compatible provider before saving it", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: [{ id: "acme-code-1" }],
      }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    mockShowInput
      .mockResolvedValueOnce("Acme AI")
      .mockResolvedValueOnce("https://api.acme.example/v1/")
      .mockResolvedValueOnce("acme-code-1")
      .mockResolvedValueOnce("256000");
    mockShowConfirm
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);
    mockShowPassword.mockResolvedValueOnce("acme-key-long-enough");
    mockShowModal.mockResolvedValueOnce({ value: "high" });

    await (manager as any).configureCustomProvider();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.acme.example/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer acme-key-long-enough",
        }),
      }),
    );
    expect(runtime.config.provider).toBe("custom:acme-ai");
    expect(runtime.config.customProviders["acme-ai"]).toEqual(
      expect.objectContaining({
        id: "acme-ai",
        displayName: "Acme AI",
        baseUrl: "https://api.acme.example/v1",
        apiKey: "acme-key-long-enough",
        apiKeyRequired: true,
        model: "acme-code-1",
        reasoningEffort: "high",
        contextWindow: 256000,
      }),
    );
    expect(mockSaveConfig).toHaveBeenCalledOnce();
  });

  it("does not save a custom provider when verification rejects the model", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: [{ id: "other-model" }],
      }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    mockShowInput
      .mockResolvedValueOnce("Acme AI")
      .mockResolvedValueOnce("https://api.acme.example/v1")
      .mockResolvedValueOnce("acme-code-1")
      .mockResolvedValueOnce("256000");
    mockShowConfirm
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);
    mockShowPassword.mockResolvedValueOnce("acme-key-long-enough");
    mockShowModal.mockResolvedValueOnce({ value: "high" });

    await (manager as any).configureCustomProvider();

    expect(runtime.config.customProviders).toBeUndefined();
    expect(runtime.config.provider).toBe("openrouter");
    expect(mockSaveConfig).not.toHaveBeenCalled();
  });

  it("updates reasoning effort from a configured custom provider menu", async () => {
    runtime.config.provider = "custom:acme";
    runtime.config.customProviders = {
      acme: {
        id: "acme",
        displayName: "Acme AI",
        apiFormat: "openai-compatible",
        baseUrl: "https://api.acme.example/v1",
        apiKey: "acme-key-long-enough",
        apiKeyRequired: true,
        model: "acme-code-1",
        reasoningEffort: "medium",
        contextWindow: 256000,
      },
    };
    runtime.options.model = "acme-code-1";

    mockShowModal
      .mockResolvedValueOnce({ value: "reasoning" })
      .mockResolvedValueOnce({ value: "xhigh" });

    await manager.promptModelSelection();

    expect(runtime.config.customProviders.acme.reasoningEffort).toBe("xhigh");
    expect(runtime.config.customProviders.acme.models.at(-1)).toEqual({
      id: "acme-code-1",
      contextWindow: 256000,
      reasoningEffort: "xhigh",
    });
    expect(mockSaveConfig).toHaveBeenCalledOnce();
  });

  it("hides Autohand from provider selection while autohand_inference is disabled", async () => {
    runtime.config.provider = "zai";
    runtime.config.zai = {
      apiKey: "zai-key-long-enough",
      model: "glm-4.5",
      baseUrl: "https://api.z.ai/api/paas/v4",
    };
    mockShowModal.mockResolvedValueOnce(null);

    await manager.promptModelSelection();

    const options = mockShowModal.mock.calls[0][0].options;
    expect(options.some((option: { value: string }) => option.value === "autohandai")).toBe(false);
  });
});
