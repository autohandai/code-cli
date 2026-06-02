/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
var mockFetch = vi.fn();
var mockEnsureLocalDependencies = vi.fn();
var mockEnsureLocalRuntime = vi.fn();
var mockRecommendLocalModels = vi.fn();
var mockRenderSetupProgress = vi.fn();

vi.mock("../../src/ui/ink/components/Modal.js", () => ({
  showModal: mockShowModal,
  showInput: mockShowInput,
  showPassword: mockShowPassword,
  showConfirm: mockShowConfirm,
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

vi.mock("../../src/auth/index.js", () => ({
  getAuthClient: () => ({
    initiateDeviceAuth: vi.fn().mockResolvedValue({ success: false, error: "not configured" }),
    pollDeviceAuth: vi.fn().mockResolvedValue({ success: false, status: "pending" }),
  }),
}));

vi.mock("../../src/providers/autohandAILocalSetup.js", () => ({
  ensureAutohandAILocalDependencies: mockEnsureLocalDependencies,
  ensureAutohandAILocalRuntime: mockEnsureLocalRuntime,
  recommendAutohandAILocalModels: mockRecommendLocalModels,
  renderAutohandAISetupProgress: mockRenderSetupProgress,
  // Re-export the constant consumed by AutohandAIProvider so the mocked module
  // still satisfies its transitive importers.
  AUTOHAND_AI_LOCAL_CODING_MODEL_FALLBACKS: [
    {
      id: "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit",
      label: "Qwen2.5 Coder 7B",
      description: "Fast local coding model",
      source: "curated",
    },
  ],
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
vi.spyOn(process.stdin, "once").mockImplementation((event: any, callback: any) => {
  if (event === "data") {
    setImmediate(callback);
  }
  return process.stdin;
});

const { SetupWizard } = await import("../../src/onboarding/setupWizard.js");

/**
 * Confirm sequence shared by the cloud paths (workspace is reported safe so it
 * never prompts a continue-unsafe confirm):
 *   1. permissions.rememberSession
 *   2. telemetry opt-in
 *   3. autoReport opt-in
 *   4. preferences.configurePrefs (false → no theme modal)
 *   5. advanced gate (false → no advanced modals)
 *   6. agentsFile create (false → no AGENTS.md written)
 *   7. registration retry (false → device auth fails then we decline retry)
 *   8. review confirm (true → finish)
 */
function primeCloudConfirms(): void {
  mockShowConfirm
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(true);
}

describe("SetupWizard autohandai onboarding", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPathExists.mockResolvedValue(false);
    mockCheckWorkspaceSafety.mockReturnValue({ safe: true });
    mockDetectLocale.mockReturnValue({ locale: "en", source: "fallback" });
    mockChangeLanguage.mockResolvedValue(undefined);
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    (globalThis as typeof globalThis & { fetch: typeof mockFetch }).fetch = mockFetch as any;
    mockRenderSetupProgress.mockReturnValue("[progress]");
  });

  afterEach(() => {
    (globalThis as typeof globalThis & { fetch: typeof originalFetch }).fetch = originalFetch;
  });

  it("uses the cloud account token when an existing auth token is present and skips the API key prompt", async () => {
    mockShowModal
      .mockResolvedValueOnce({ value: "en" }) // language
      .mockResolvedValueOnce({ value: "autohandai" }) // provider
      .mockResolvedValueOnce({ value: "cloud" }) // plan
      .mockResolvedValueOnce({ value: "fantail" }) // model
      .mockResolvedValueOnce({ value: "interactive" }); // permissions

    primeCloudConfirms();

    const wizard = new SetupWizard("/test/workspace", {
      auth: { token: "account-token-123", user: { id: "u1", email: "a@b.co", name: "Ada" } },
    } as any);

    const result = await wizard.run({ skipWelcome: true });

    expect(result.success).toBe(true);
    expect(result.config.provider).toBe("autohandai");
    expect(result.config.autohandai).toMatchObject({
      plan: "cloud",
      authMode: "account",
      accountToken: "account-token-123",
      model: "fantail",
      baseUrl: "https://api.autohand.ai/v1",
    });
    expect(result.config.autohandai).not.toHaveProperty("apiKey");
    expect(mockShowPassword).not.toHaveBeenCalled();
  });

  it("falls back to an API key when no account token exists and persists authMode api-key", async () => {
    mockShowModal
      .mockResolvedValueOnce({ value: "en" }) // language
      .mockResolvedValueOnce({ value: "autohandai" }) // provider
      .mockResolvedValueOnce({ value: "cloud" }) // plan
      .mockResolvedValueOnce({ value: "fantail" }) // model
      .mockResolvedValueOnce({ value: "interactive" }); // permissions

    mockShowPassword.mockResolvedValueOnce("autohandai-api-key-long-enough");

    primeCloudConfirms();

    const wizard = new SetupWizard("/test/workspace");
    const result = await wizard.run({ skipWelcome: true });

    expect(result.success).toBe(true);
    expect(result.config.provider).toBe("autohandai");
    expect(result.config.autohandai).toMatchObject({
      plan: "cloud",
      authMode: "api-key",
      apiKey: "autohandai-api-key-long-enough",
      model: "fantail",
      baseUrl: "https://api.autohand.ai/v1",
    });
    expect(result.config.autohandai).not.toHaveProperty("accountToken");
    expect(mockShowPassword).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.autohand.ai/v1/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer autohandai-api-key-long-enough" },
      }),
    );
  });

  it("aborts the autohandai config when the local machine does not support MLX", async () => {
    mockShowModal
      .mockResolvedValueOnce({ value: "en" }) // language
      .mockResolvedValueOnce({ value: "autohandai" }) // provider
      .mockResolvedValueOnce({ value: "local" }); // plan

    mockEnsureLocalDependencies.mockResolvedValueOnce({
      ok: false,
      probe: {
        supported: false,
        mlxServerInstalled: false,
        llmfitInstalled: false,
        running: false,
        baseUrl: "http://127.0.0.1:8080",
        port: 8080,
      },
      error: "Autohand AI Local requires a Mac with Apple Silicon.",
    });

    const wizard = new SetupWizard("/test/workspace");
    const result = await wizard.run({ skipWelcome: true });

    expect(result.cancelled).toBe(true);
    expect(result.success).toBe(false);
    expect(result.config.autohandai).toBeUndefined();
    expect(mockEnsureLocalDependencies).toHaveBeenCalledTimes(1);
    expect(mockRecommendLocalModels).not.toHaveBeenCalled();
    expect(mockEnsureLocalRuntime).not.toHaveBeenCalled();
  });

  it("completes the local flow by probing, recommending, selecting, and starting the MLX runtime", async () => {
    const recommendedModel = {
      id: "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit",
      label: "Qwen2.5 Coder 7B",
      description: "Fast local coding model",
      source: "curated" as const,
    };

    mockShowModal
      .mockResolvedValueOnce({ value: "en" }) // language
      .mockResolvedValueOnce({ value: "autohandai" }) // provider
      .mockResolvedValueOnce({ value: "local" }) // plan
      .mockResolvedValueOnce({ value: recommendedModel.id }) // local model
      .mockResolvedValueOnce({ value: "interactive" }); // permissions

    mockEnsureLocalDependencies.mockResolvedValueOnce({
      ok: true,
      probe: {
        supported: true,
        mlxServerInstalled: true,
        llmfitInstalled: true,
        running: false,
        baseUrl: "http://127.0.0.1:8080",
        port: 8080,
      },
    });
    mockRecommendLocalModels.mockResolvedValueOnce([recommendedModel]);
    mockEnsureLocalRuntime.mockResolvedValueOnce({
      ok: true,
      model: recommendedModel,
      baseUrl: "http://127.0.0.1:8081",
      port: 8081,
      serverCommand: `mlx_lm.server --model ${recommendedModel.id} --port 8081`,
    });

    // Local plan reuses the cloud confirm tail: rememberSession, telemetry,
    // autoReport, preferences, advanced, agentsFile, registration, review.
    primeCloudConfirms();

    const wizard = new SetupWizard("/test/workspace");
    const result = await wizard.run({ skipWelcome: true });

    expect(result.success).toBe(true);
    expect(result.config.provider).toBe("autohandai");
    expect(result.config.autohandai).toMatchObject({
      plan: "local",
      model: recommendedModel.id,
      baseUrl: "http://127.0.0.1:8081",
      port: 8081,
      serverCommand: `mlx_lm.server --model ${recommendedModel.id} --port 8081`,
    });
    expect(result.config.autohandai).not.toHaveProperty("authMode");
    expect(mockShowPassword).not.toHaveBeenCalled();
    expect(mockEnsureLocalRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/test/workspace",
        model: recommendedModel,
        baseUrl: "http://127.0.0.1:8080",
        port: 8080,
      }),
      expect.any(Function),
    );
  });

  it("exposes both cloud and local plans from the plan picker", async () => {
    const recommendedModel = {
      id: "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit",
      label: "Qwen2.5 Coder 7B",
      description: "Fast local coding model",
      source: "curated" as const,
    };

    let capturedPlanOptions: Array<{ value: string }> = [];
    mockShowModal.mockImplementation(async (config: { options?: Array<{ value: string }> }) => {
      const options = config.options ?? [];
      const values = options.map((option) => option.value);
      if (values.includes("cloud") && values.includes("local")) {
        capturedPlanOptions = options;
        return { value: "local" };
      }
      if (values.includes("autohandai")) return { value: "autohandai" };
      if (values.includes("en")) return { value: "en" };
      if (values.includes(recommendedModel.id)) return { value: recommendedModel.id };
      return { value: values[0] };
    });

    mockEnsureLocalDependencies.mockResolvedValue({
      ok: true,
      probe: {
        supported: true,
        mlxServerInstalled: true,
        llmfitInstalled: true,
        running: false,
        baseUrl: "http://127.0.0.1:8080",
        port: 8080,
      },
    });
    mockRecommendLocalModels.mockResolvedValue([recommendedModel]);
    mockEnsureLocalRuntime.mockResolvedValue({
      ok: true,
      model: recommendedModel,
      baseUrl: "http://127.0.0.1:8080",
      port: 8080,
      serverCommand: `mlx_lm.server --model ${recommendedModel.id} --port 8080`,
    });

    primeCloudConfirms();

    const wizard = new SetupWizard("/test/workspace");
    const result = await wizard.run({ skipWelcome: true });

    expect(result.success).toBe(true);
    const planValues = capturedPlanOptions.map((option) => option.value);
    expect(planValues).toEqual(expect.arrayContaining(["cloud", "local"]));
    expect(planValues).toHaveLength(2);
  });
});
