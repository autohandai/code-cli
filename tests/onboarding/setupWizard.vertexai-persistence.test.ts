/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * E2E Vertex AI Configuration Persistence Test
 *
 * This test ensures that ALL Vertex AI-specific configuration fields are properly
 * saved to the config returned by SetupWizard.complete().
 *
 * This prevents the bug where endpoint/region/projectId were lost because
 * they weren't saved to state and complete() used generic fallback.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Use var (not const) so hoisted vi.mock can reference them
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
var mockProbeLlamaCppEnvironment = vi.fn();
var mockInstallLlamaCpp = vi.fn();

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

vi.mock("../../src/providers/llamaCppSetup.js", () => ({
  probeLlamaCppEnvironment: mockProbeLlamaCppEnvironment,
  installLlamaCpp: mockInstallLlamaCpp,
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

describe("Vertex AI Configuration Persistence E2E", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    mockShowModal.mockReset();
    mockShowInput.mockReset();
    mockShowPassword.mockReset();
    mockShowConfirm.mockReset();

    mockPathExists.mockResolvedValue(false);
    mockCheckWorkspaceSafety.mockReturnValue({ safe: true });
    mockDetectLocale.mockReturnValue({ locale: "en", source: "fallback" });
    mockChangeLanguage.mockResolvedValue(undefined);
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    (globalThis as typeof globalThis & { fetch: typeof mockFetch }).fetch = mockFetch as any;
    mockProbeLlamaCppEnvironment.mockResolvedValue({
      installed: true,
      running: false,
    });
    mockInstallLlamaCpp.mockResolvedValue({
      ok: true,
      output: "",
    });
  });

  afterEach(() => {
    (globalThis as typeof globalThis & { fetch: typeof originalFetch }).fetch = originalFetch;
  });

  it("should persist ALL Vertex AI fields: endpoint, region, projectId, authToken, model", async () => {
    // Arrange: Mock all Vertex AI prompts in exact sequence
    mockShowModal
      .mockResolvedValueOnce({ value: "en" }) // language
      .mockResolvedValueOnce({ value: "vertexai" }) // provider
      .mockResolvedValueOnce({ value: "interactive" }); // permissions

    mockShowInput
      .mockResolvedValueOnce("aiplatform.googleapis.com") // endpoint
      .mockResolvedValueOnce("us-central1") // region
      .mockResolvedValueOnce("my-gcp-project-123") // projectId
      .mockResolvedValueOnce("zai-org/glm-5-maas"); // model

    mockShowPassword.mockResolvedValueOnce("ya29.a0ARrdaM..."); // authToken

    mockShowConfirm
      .mockResolvedValueOnce(true) // remember session
      .mockResolvedValueOnce(true) // telemetry
      .mockResolvedValueOnce(true) // autoReport
      .mockResolvedValueOnce(false) // preferences (skip)
      .mockResolvedValueOnce(false) // advanced (skip)
      .mockResolvedValueOnce(false) // agents (skip)
      .mockResolvedValueOnce(false) // registration (skip)
      .mockResolvedValueOnce(true); // review confirm

    const wizard = new SetupWizard("/test/workspace");
    const result = await wizard.run({ skipWelcome: true });

    // Assert: All Vertex AI fields must be present in config
    expect(result.success).toBe(true);
    expect(result.config.provider).toBe("vertexai");
    expect(result.config.vertexai).toBeDefined();
    expect(result.config.vertexai?.authToken).toBe("ya29.a0ARrdaM...");
    expect(result.config.vertexai?.endpoint).toBe("aiplatform.googleapis.com");
    expect(result.config.vertexai?.region).toBe("us-central1");
    expect(result.config.vertexai?.projectId).toBe("my-gcp-project-123");
    expect(result.config.vertexai?.model).toBe("zai-org/glm-5-maas");
  });

  it("should persist Vertex AI with custom endpoint and region values", async () => {
    mockShowModal
      .mockResolvedValueOnce({ value: "en" })
      .mockResolvedValueOnce({ value: "vertexai" })
      .mockResolvedValueOnce({ value: "interactive" });

    mockShowInput
      .mockResolvedValueOnce("custom-endpoint.googleapis.com") // custom endpoint
      .mockResolvedValueOnce("europe-west1") // custom region
      .mockResolvedValueOnce("another-project-456")
      .mockResolvedValueOnce("custom/model-v1");

    mockShowPassword.mockResolvedValueOnce("different-token-xyz");

    mockShowConfirm
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const wizard = new SetupWizard("/test/workspace");
    const result = await wizard.run({ skipWelcome: true });

    expect(result.success).toBe(true);
    expect(result.config.provider).toBe("vertexai");
    expect(result.config.vertexai?.authToken).toBe("different-token-xyz");
    expect(result.config.vertexai?.endpoint).toBe("custom-endpoint.googleapis.com");
    expect(result.config.vertexai?.region).toBe("europe-west1");
    expect(result.config.vertexai?.projectId).toBe("another-project-456");
    expect(result.config.vertexai?.model).toBe("custom/model-v1");
  });

  it("should be recognized as configured when vertexai config exists with authToken", async () => {
    // Test that isAlreadyConfigured correctly identifies Vertex AI
    const existingConfig = {
      configPath: "/test/.autohand/config.json",
      provider: "vertexai" as const,
      vertexai: {
        authToken: "ya29.valid-token-here",
        endpoint: "aiplatform.googleapis.com",
        region: "us-central1",
        projectId: "my-project",
        model: "zai-org/glm-5-maas",
      },
    };

    const wizard = new SetupWizard("/test/workspace", existingConfig);

    // When already configured, wizard should skip all steps
    const result = await wizard.run();

    expect(result.success).toBe(true);
    expect(result.skippedSteps).toContain("provider");
    expect(result.skippedSteps).toContain("apiKey");
    expect(mockShowModal).not.toHaveBeenCalled();
  });

  it("should re-run wizard when vertexai authToken is missing", async () => {
    // Test that isAlreadyConfiguration correctly identifies incomplete Vertex AI
    const incompleteConfig = {
      configPath: "/test/.autohand/config.json",
      provider: "vertexai" as const,
      vertexai: {
        // authToken missing!
        endpoint: "aiplatform.googleapis.com",
        region: "us-central1",
        projectId: "my-project",
        model: "zai-org/glm-5-maas",
      },
    };

    // Set up mocks for full wizard flow
    mockShowModal
      .mockResolvedValueOnce({ value: "en" })
      .mockResolvedValueOnce({ value: "vertexai" })
      .mockResolvedValueOnce({ value: "interactive" });

    mockShowInput
      .mockResolvedValueOnce("aiplatform.googleapis.com")
      .mockResolvedValueOnce("us-central1")
      .mockResolvedValueOnce("my-project")
      .mockResolvedValueOnce("zai-org/glm-5-maas");

    mockShowPassword.mockResolvedValueOnce("new-auth-token-123");

    mockShowConfirm
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const wizard = new SetupWizard("/test/workspace", incompleteConfig);
    const result = await wizard.run({ skipWelcome: true });

    expect(result.success).toBe(true);
    // Should have run the wizard since config was incomplete
    expect(mockShowModal).toHaveBeenCalled();
    expect(result.config.vertexai?.authToken).toBe("new-auth-token-123");
  });

  describe("Cerebras AI (standard API key provider with model selection)", () => {
    it("should persist Cerebras config with apiKey, model, and baseUrl", async () => {
      mockShowModal
        .mockResolvedValueOnce({ value: "en" })
        .mockResolvedValueOnce({ value: "cerebras" })
        .mockResolvedValueOnce({ value: "zai-glm-4.7" }) // model selection
        .mockResolvedValueOnce({ value: "interactive" }); // permissions

      mockShowPassword.mockResolvedValueOnce("cerebras-api-key-12345");

      mockShowConfirm
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const wizard = new SetupWizard("/test/workspace");
      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(true);
      expect(result.config.provider).toBe("cerebras");
      expect(result.config.cerebras?.apiKey).toBe("cerebras-api-key-12345");
      expect(result.config.cerebras?.model).toBe("zai-glm-4.7");
      expect(result.config.cerebras?.baseUrl).toBe("https://api.cerebras.ai/v1");
    });

    it("should persist Cerebras with qwen model selection", async () => {
      mockShowModal
        .mockResolvedValueOnce({ value: "en" })
        .mockResolvedValueOnce({ value: "cerebras" })
        .mockResolvedValueOnce({ value: "qwen-3-235b-a22b-instruct-2507" }) // Qwen model
        .mockResolvedValueOnce({ value: "interactive" });

      mockShowPassword.mockResolvedValueOnce("cerebras-api-key-67890");

      mockShowConfirm
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const wizard = new SetupWizard("/test/workspace");
      const result = await wizard.run({ skipWelcome: true });

      expect(result.success).toBe(true);
      expect(result.config.provider).toBe("cerebras");
      expect(result.config.cerebras?.apiKey).toBe("cerebras-api-key-67890");
      expect(result.config.cerebras?.model).toBe("qwen-3-235b-a22b-instruct-2507");
    });

    it("should be recognized as configured when cerebras config exists with apiKey", async () => {
      const existingConfig = {
        configPath: "/test/.autohand/config.json",
        provider: "cerebras" as const,
        cerebras: {
          apiKey: "cerebras-valid-api-key",
          model: "zai-glm-4.7",
          baseUrl: "https://api.cerebras.ai/v1",
        },
      };

      const wizard = new SetupWizard("/test/workspace", existingConfig);
      const result = await wizard.run();

      expect(result.success).toBe(true);
      expect(result.skippedSteps).toContain("provider");
      expect(result.skippedSteps).toContain("apiKey");
      expect(mockShowModal).not.toHaveBeenCalled();
    });
  });
});
