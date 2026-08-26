/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModalOption } from "../../src/ui/ink/components/Modal.js";

var mockShowModal = vi.fn();
var mockShowInput = vi.fn();
var mockShowPassword = vi.fn();
var mockShowConfirm = vi.fn();
var mockPathExists = vi.fn();
var mockWriteFile = vi.fn();
var mockCheckWorkspaceSafety = vi.fn();
var mockPrintDangerousWorkspaceWarning = vi.fn();
var mockChangeLanguage = vi.fn();
var mockDetectLocale = vi.fn();

vi.mock("../../src/ui/ink/components/Modal.js", () => ({
  showModal: mockShowModal,
  showInput: mockShowInput,
  showPassword: mockShowPassword,
  showConfirm: mockShowConfirm,
  prepareModalRender: vi.fn(),
  cleanupModalRender: vi.fn(),
}));

vi.mock("fs-extra", () => ({
  default: {
    pathExists: mockPathExists,
    writeFile: mockWriteFile,
  },
}));

vi.mock("../../src/startup/workspaceSafety.js", () => ({
  checkWorkspaceSafety: mockCheckWorkspaceSafety,
  printDangerousWorkspaceWarning: mockPrintDangerousWorkspaceWarning,
}));

vi.mock("../../src/i18n/index.js", () => ({
  t: (key: string, opts?: Record<string, string | number>) => {
    const map: Record<string, string> = {
      "providers.autohandai": "Autohand AI",
      "providers.anthropic": "Anthropic",
      "providers.openrouter": "OpenRouter",
      "providers.zai": "Z.ai",
      "providers.config.groupAutohand": "Autohand AI",
      "providers.config.groupThirdParty": "Third-party providers",
      "providers.config.groupCustom": "Custom providers",
      "providers.config.chooseProvider": "Choose your LLM provider",
    };
    if (map[key]) return map[key];
    if (!opts) return key;
    let result = key;
    for (const [k, v] of Object.entries(opts)) {
      result = result.replace(`{{${k}}}`, String(v));
    }
    return result;
  },
  changeLanguage: mockChangeLanguage,
  detectLocale: mockDetectLocale,
  SUPPORTED_LOCALES: ["en"],
  LANGUAGE_DISPLAY_NAMES: { en: "English" },
}));

vi.mock("open", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("chalk", () => ({
  default: {
    gray: (s: string) => s,
    cyan: (s: string) => s,
    white: Object.assign((s: string) => s, { bold: (s: string) => s }),
    green: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
  },
}));

vi.spyOn(console, "log").mockImplementation(() => {});

const { SetupWizard } = await import("../../src/onboarding/setupWizard.js");

function providerModalArgs(): { options: ModalOption[]; initialIndex?: number } {
  const call = mockShowModal.mock.calls.find(
    ([args]) => args?.title === "Choose your LLM provider",
  );
  if (!call) throw new Error("provider selection modal was never shown");
  return call[0];
}

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

describe("SetupWizard grouped provider selection", () => {
  const originalInferenceFlag = process.env.AUTOHAND_FEATURE_AUTOHAND_INFERENCE;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTOHAND_FEATURE_AUTOHAND_INFERENCE = "1";
    mockPathExists.mockResolvedValue(false);
    mockCheckWorkspaceSafety.mockReturnValue({ safe: true });
    mockDetectLocale.mockReturnValue({ locale: "en", source: "fallback" });
  });

  afterEach(() => {
    if (originalInferenceFlag === undefined) {
      delete process.env.AUTOHAND_FEATURE_AUTOHAND_INFERENCE;
    } else {
      process.env.AUTOHAND_FEATURE_AUTOHAND_INFERENCE = originalInferenceFlag;
    }
  });

  it("offers Autohand AI first with its own section header", async () => {
    mockShowModal.mockResolvedValueOnce({ value: "autohandai" });

    const wizard = new SetupWizard("/test/workspace");
    const selected = await (wizard as any).promptProvider();

    expect(selected).toBe("autohandai");
    const { options } = providerModalArgs();
    expect(options[0].value).toBe("autohandai");
    expect(options[0].header).toBe("Autohand AI");
    expect(options[1].header).toBe("Third-party providers");
  });

  it("keeps the provider hint descriptions on every row", async () => {
    mockShowModal.mockResolvedValueOnce({ value: "openrouter" });

    const wizard = new SetupWizard("/test/workspace");
    await (wizard as any).promptProvider();

    const { options } = providerModalArgs();
    expect(options.every((option) => typeof option.description === "string")).toBe(true);
  });

  it("groups custom providers last under Custom providers", async () => {
    mockShowModal.mockResolvedValueOnce({ value: "custom:alpha-gateway" });

    const wizard = new SetupWizard("/test/workspace", {
      customProviders: { ...CUSTOM_PROVIDERS },
    } as any);
    const selected = await (wizard as any).promptProvider();

    expect(selected).toBe("custom:alpha-gateway");
    const { options } = providerModalArgs();
    const customValues = options
      .filter((option) => String(option.value).startsWith("custom:"))
      .map((option) => option.value);
    expect(customValues).toEqual(["custom:alpha-gateway", "custom:zeta-gateway"]);
    expect(options[options.length - 1].value).toBe("custom:zeta-gateway");
    expect(
      options.find((option) => option.value === "custom:alpha-gateway")?.header,
    ).toBe("Custom providers");
  });

  it("labels custom providers with their display name and base URL, not a raw i18n key", async () => {
    mockShowModal.mockResolvedValueOnce({ value: "custom:alpha-gateway" });

    const wizard = new SetupWizard("/test/workspace", {
      customProviders: { ...CUSTOM_PROVIDERS },
    } as any);
    await (wizard as any).promptProvider();

    const row = providerModalArgs().options.find(
      (option) => option.value === "custom:alpha-gateway",
    );
    expect(row?.label).toBe("Alpha Gateway");
    expect(row?.description).toBe("https://alpha.example/v1");
  });

  it("preselects the configured provider at its position in the grouped list", async () => {
    mockShowModal.mockResolvedValueOnce({ value: "openrouter" });

    const wizard = new SetupWizard("/test/workspace", {
      provider: "openrouter",
      openrouter: { apiKey: "openrouter-key-long-enough", model: "openai/gpt-4o-mini" },
    } as any);
    await (wizard as any).promptProvider();

    const { options, initialIndex } = providerModalArgs();
    expect(options[initialIndex ?? 0].value).toBe("openrouter");
  });

  it("falls back to the first row when no provider is configured yet", async () => {
    mockShowModal.mockResolvedValueOnce({ value: "autohandai" });

    const wizard = new SetupWizard("/test/workspace");
    await (wizard as any).promptProvider();

    expect(providerModalArgs().initialIndex).toBe(0);
  });
});
