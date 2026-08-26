/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModalOption } from "../../../src/ui/ink/components/Modal.js";

var mockShowModal = vi.fn();
var mockShowInput = vi.fn();
var mockShowConfirm = vi.fn();
var mockShowPassword = vi.fn();
var mockSaveConfig = vi.fn();

vi.mock("../../../src/ui/ink/components/Modal.js", () => ({
  showConfirm: mockShowConfirm,
  showModal: mockShowModal,
  showInput: mockShowInput,
  showPassword: mockShowPassword,
}));

vi.mock("../../../src/config.js", () => ({
  saveConfig: mockSaveConfig,
  getProviderConfig: (config: Record<string, unknown>, provider?: string) => {
    const chosen = provider ?? (config.provider as string | undefined);
    if (chosen?.startsWith("custom:")) {
      const id = chosen.slice("custom:".length);
      return (
        ((config.customProviders as Record<string, unknown> | undefined)?.[id] as
          | Record<string, unknown>
          | null
          | undefined) ?? null
      );
    }
    return chosen ? ((config[chosen] as Record<string, unknown> | null) ?? null) : null;
  },
}));

vi.mock("../../../src/i18n/index.js", () => ({
  t: (key: string, params?: Record<string, string>) => {
    const map: Record<string, string> = {
      "providers.autohandai": "Autohand AI",
      "providers.anthropic": "Anthropic",
      "providers.openrouter": "OpenRouter",
      "providers.openai": "OpenAI",
      "providers.ollama": "Ollama",
      "providers.llamacpp": "llama.cpp",
      "providers.mlx": "MLX (Apple Silicon)",
      "providers.llmgateway": "LLM Gateway",
      "providers.azure": "Azure OpenAI",
      "providers.zai": "Z.ai",
      "providers.sakana": "Sakana.AI",
      "providers.vertexai": "Google Cloud Vertex AI",
      "providers.xai": "xAI (Grok)",
      "providers.cerebras": "Cerebras AI",
      "providers.nvidia": "NVIDIA AI Cloud",
      "providers.deepseek": "DeepSeek",
      "providers.config.groupAutohand": "Autohand AI",
      "providers.config.groupThirdParty": "Third-party providers",
      "providers.config.groupCustom": "Custom providers",
      "providers.config.chooseProvider": "Choose your LLM provider",
      "providers.config.newProvider": "New provider...",
      "providers.config.selectModel": "Select a model",
      "providers.config.whatToChange": "What would you like to change?",
      "providers.config.current": "current",
      "providers.config.hosted": "hosted",
      "providers.config.appleSilicon": "Apple Silicon",
      "providers.config.notSet": "not set",
      "providers.config.settingsTitle": `${params?.provider ?? "{{provider}}"} Settings`,
      "providers.config.currentModel": `Current model: ${params?.model ?? "{{model}}"}`,
      "providers.config.currentApiKey": `Current API key: ${params?.key ?? "{{key}}"}`,
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

const { ProviderConfigManager } = await import(
  "../../../src/core/agent/ProviderConfigManager.js"
);

const CUSTOM_PROVIDERS = {
  "zeta-gateway": {
    id: "zeta-gateway",
    displayName: "Zeta Gateway",
    apiFormat: "openai-compatible" as const,
    baseUrl: "https://zeta.example/v1",
    model: "zeta-large",
    apiKey: "zeta-key-long-enough",
    apiKeyRequired: true,
  },
  "alpha-gateway": {
    id: "alpha-gateway",
    displayName: "Alpha Gateway",
    apiFormat: "openai-compatible" as const,
    baseUrl: "https://alpha.example/v1",
    model: "alpha-large",
    apiKey: "alpha-key-long-enough",
    apiKeyRequired: true,
  },
};

function lastProviderModalOptions(): ModalOption[] {
  const call = mockShowModal.mock.calls.find(
    ([args]) => args?.title === "Choose your LLM provider",
  );
  if (!call) throw new Error("provider selection modal was never shown");
  return call[0].options as ModalOption[];
}

function headerFor(options: ModalOption[], value: string): string | undefined {
  return options.find((option) => option.value === value)?.header;
}

describe("ProviderConfigManager grouped provider selection", () => {
  let runtime: any;
  let manager: InstanceType<typeof ProviderConfigManager>;
  const originalInferenceFlag = process.env.AUTOHAND_FEATURE_AUTOHAND_INFERENCE;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    process.env.AUTOHAND_FEATURE_AUTOHAND_INFERENCE = "1";

    runtime = {
      workspaceRoot: "/repo",
      config: {
        configPath: "/tmp/config.json",
        provider: "openrouter",
        openrouter: { apiKey: "openrouter-key", model: "openai/gpt-4o-mini" },
        customProviders: { ...CUSTOM_PROVIDERS },
      },
      options: { model: "openai/gpt-4o-mini" },
    };

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
      vi.fn(),
      vi.fn(),
      vi.fn(),
    );
  });

  afterEach(() => {
    if (originalInferenceFlag === undefined) {
      delete process.env.AUTOHAND_FEATURE_AUTOHAND_INFERENCE;
    } else {
      process.env.AUTOHAND_FEATURE_AUTOHAND_INFERENCE = originalInferenceFlag;
    }
  });

  it("lists Autohand AI first, under its own section header", async () => {
    mockShowModal.mockResolvedValueOnce(null);

    await (manager as any).promptProviderSelection();

    const options = lastProviderModalOptions();
    expect(options[0].value).toBe("autohandai");
    expect(options[0].header).toBe("Autohand AI");
    expect(options[0].label).toContain("Autohand AI");
  });

  it("groups every non-Autohand built-in provider under Third-party providers", async () => {
    mockShowModal.mockResolvedValueOnce(null);

    await (manager as any).promptProviderSelection();

    const options = lastProviderModalOptions();
    const firstThirdParty = options[1];
    expect(firstThirdParty.header).toBe("Third-party providers");

    const thirdPartyValues = options
      .slice(1)
      .filter((option) => !String(option.value).startsWith("custom:"))
      .map((option) => option.value)
      .filter((value) => value !== "new-custom-provider");
    expect(thirdPartyValues).toContain("openrouter");
    expect(thirdPartyValues).toContain("anthropic");
    expect(thirdPartyValues).not.toContain("autohandai");
    expect(headerFor(options, "openrouter")).not.toBe("Autohand AI");
  });

  it("sorts third-party providers by their localized display name", async () => {
    mockShowModal.mockResolvedValueOnce(null);

    await (manager as any).promptProviderSelection();

    const options = lastProviderModalOptions();
    const thirdParty = options.filter(
      (option) =>
        option.value !== "autohandai" &&
        option.value !== "new-custom-provider" &&
        !String(option.value).startsWith("custom:"),
    );
    const anthropicIndex = thirdParty.findIndex((o) => o.value === "anthropic");
    const zaiIndex = thirdParty.findIndex((o) => o.value === "zai");
    expect(anthropicIndex).toBeGreaterThanOrEqual(0);
    expect(anthropicIndex).toBeLessThan(zaiIndex);
  });

  it("groups configured custom providers last, sorted, under Custom providers", async () => {
    mockShowModal.mockResolvedValueOnce(null);

    await (manager as any).promptProviderSelection();

    const options = lastProviderModalOptions();
    const customValues = options
      .filter((option) => String(option.value).startsWith("custom:"))
      .map((option) => option.value);

    expect(customValues).toEqual(["custom:alpha-gateway", "custom:zeta-gateway"]);
    expect(headerFor(options, "custom:alpha-gateway")).toBe("Custom providers");
    expect(headerFor(options, "custom:zeta-gateway")).toBeUndefined();
    expect(options[options.length - 1].value).toBe("new-custom-provider");
  });

  it("keeps the Custom providers header visible when nothing custom is configured yet", async () => {
    runtime.config.customProviders = {};
    mockShowModal.mockResolvedValueOnce(null);

    await (manager as any).promptProviderSelection();

    const options = lastProviderModalOptions();
    const addRow = options[options.length - 1];
    expect(addRow.value).toBe("new-custom-provider");
    expect(addRow.header).toBe("Custom providers");
  });

  it("still routes the add row into the custom provider wizard", async () => {
    mockShowModal.mockResolvedValueOnce({ value: "new-custom-provider" });
    const configureCustomProvider = vi
      .spyOn(manager as any, "configureCustomProvider")
      .mockResolvedValue(undefined);

    await (manager as any).promptProviderSelection();

    expect(configureCustomProvider).toHaveBeenCalledOnce();
  });

  it("opens the settings menu for a configured custom provider", async () => {
    mockShowModal.mockResolvedValueOnce({ value: "custom:alpha-gateway" });
    const promptConfiguredProviderSettings = vi
      .spyOn(manager as any, "promptConfiguredProviderSettings")
      .mockResolvedValue(undefined);

    await (manager as any).promptProviderSelection();

    expect(promptConfiguredProviderSettings).toHaveBeenCalledWith("custom:alpha-gateway");
  });

  it("hides the Autohand AI section when the inference feature is disabled", async () => {
    runtime.config.features = { autohand_inference: false };
    mockShowModal.mockResolvedValueOnce(null);

    await (manager as any).promptProviderSelection();

    const options = lastProviderModalOptions();
    expect(options.some((option) => option.value === "autohandai")).toBe(false);
    expect(options[0].header).toBe("Third-party providers");
  });

  it("does not repeat a platform note the provider display name already carries", () => {
    const label = (manager as any).buildProviderChoiceLabel("mlx") as string;

    expect(label).toContain("MLX (Apple Silicon)");
    expect(label.match(/Apple Silicon/g)).toHaveLength(1);
  });

  it("still flags hosted providers and the active provider in the row label", () => {
    const label = (manager as any).buildProviderChoiceLabel("openrouter") as string;

    expect(label).toContain("OpenRouter");
    expect(label).toContain("(current)");
    expect(label).toContain("(hosted)");
  });

  it("jumps straight to the model picker when Autohand AI is already configured", async () => {
    runtime.config.autohandai = {
      plan: "cloud",
      authMode: "api-key",
      apiKey: "autohand-key-long-enough",
      model: "fantail",
      baseUrl: "https://api.autohand.ai/v1",
    };

    mockShowModal
      .mockResolvedValueOnce({ value: "autohandai" })
      .mockResolvedValueOnce({ value: "fantail" });

    await (manager as any).promptProviderSelection();

    const titles = mockShowModal.mock.calls.map(([args]) => args.title);
    expect(titles).toEqual(["Choose your LLM provider", "Select a model"]);
    expect(titles).not.toContain("What would you like to change?");
  });

  it("configures Autohand AI from scratch when it is not set up yet", async () => {
    mockShowModal.mockResolvedValueOnce({ value: "autohandai" });
    const configureProvider = vi
      .spyOn(manager as any, "configureProvider")
      .mockResolvedValue(undefined);

    await (manager as any).promptProviderSelection();

    expect(configureProvider).toHaveBeenCalledWith("autohandai");
  });
});
