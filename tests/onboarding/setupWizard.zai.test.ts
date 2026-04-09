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

describe("SetupWizard Z.ai onboarding", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
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

  it("uses the Z.ai-specific model modal and persists Z.ai config", async () => {
    mockShowModal
      .mockResolvedValueOnce({ value: "en" })
      .mockResolvedValueOnce({ value: "zai" })
      .mockResolvedValueOnce({ value: "glm-4.5-air-2504" })
      .mockResolvedValueOnce({ value: "interactive" });

    mockShowPassword.mockResolvedValueOnce("zai-test-key-long-enough");

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
    expect(result.config.provider).toBe("zai");
    expect(result.config.zai).toEqual({
      apiKey: "zai-test-key-long-enough",
      model: "glm-4.5-air-2504",
      baseUrl: "https://api.z.ai/api/paas/v4",
    });
    expect(mockShowInput).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.z.ai/api/paas/v4/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer zai-test-key-long-enough" },
      }),
    );
  });
});
