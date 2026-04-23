/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock chalk
vi.mock("chalk", () => ({
  default: {
    green: (s: string) => s,
    gray: (s: string) => s,
  },
}));

// Mock SetupWizard
const mockSetupWizardRun = vi.fn();
vi.mock("../../src/onboarding/setupWizard.js", () => ({
  SetupWizard: class {
    run = mockSetupWizardRun;
  },
}));

// Mock config
vi.mock("../../src/config.js", () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
  resolveWorkspaceRoot: vi.fn(),
}));

// Mock i18n
vi.mock("../../src/i18n/index.js", () => ({
  initI18n: vi.fn(),
  detectLocale: vi.fn(),
  t: (key: string) => key,
}));

// Mock console to suppress output during tests
vi.spyOn(console, "log").mockImplementation(() => {});

// Import after mocking
import { setup } from "../../src/commands/setup";
import { SetupWizard } from "../../src/onboarding/setupWizard";
import { loadConfig, saveConfig, resolveWorkspaceRoot } from "../../src/config";
import { initI18n, detectLocale } from "../../src/i18n/index";
import type { LoadedConfig } from "../../src/types";
import type { SlashCommandContext } from "../../src/core/slashCommandTypes";

describe("setup command", () => {
  const mockConfig: LoadedConfig = {
    provider: "openrouter",
    openrouter: { apiKey: "test-key", model: "test-model" },
    isNewConfig: false,
    configPath: "/test/config.json",
  };

  const mockContext: SlashCommandContext = {
    config: mockConfig,
    workspaceRoot: "/test/workspace",
  } as SlashCommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadConfig).mockResolvedValue(mockConfig);
    vi.mocked(resolveWorkspaceRoot).mockReturnValue("/test/workspace");
    vi.mocked(detectLocale).mockReturnValue({ locale: "en", source: "default" });
    vi.mocked(initI18n).mockResolvedValue(undefined);
  });

  describe("interactive mode", () => {
    it("should run setup wizard successfully", async () => {
      mockSetupWizardRun.mockResolvedValue({
        success: true,
        config: { provider: "openai", openai: { apiKey: "new-key", model: "gpt-4" } },
        skippedSteps: [],
        cancelled: false,
      });

      const result = await setup(mockContext);

      expect(vi.mocked(loadConfig)).toHaveBeenCalledWith(mockConfig.configPath, mockContext.workspaceRoot);
      expect(SetupWizard).toHaveBeenCalledWith("/test/workspace", mockConfig);
      expect(mockSetupWizardRun).toHaveBeenCalledWith({ force: true, skipWelcome: false });
      expect(vi.mocked(saveConfig)).toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it("should handle cancelled setup", async () => {
      mockSetupWizardRun.mockResolvedValue({
        success: false,
        config: {},
        skippedSteps: [],
        cancelled: true,
      });

      const result = await setup(mockContext);

      expect(mockSetupWizardRun).toHaveBeenCalledWith({ force: true, skipWelcome: false });
      expect(vi.mocked(saveConfig)).not.toHaveBeenCalled();
      expect(result).toContain("cancelled");
    });

    it("should handle setup failure", async () => {
      mockSetupWizardRun.mockResolvedValue({
        success: false,
        config: {},
        skippedSteps: [],
        cancelled: false,
      });

      const result = await setup(mockContext);

      expect(mockSetupWizardRun).toHaveBeenCalledWith({ force: true, skipWelcome: false });
      expect(vi.mocked(saveConfig)).not.toHaveBeenCalled();
      expect(result).toContain("failed");
    });

    it("should emit events during setup when event emitter is provided", async () => {
      const mockEmit = vi.fn();
      const contextWithEmitter = {
        ...mockContext,
        eventEmitter: { emit: mockEmit },
      };

      mockSetupWizardRun.mockImplementation(async () => {
        // Simulate step progress
        mockEmit("setup:step:start", { step: "welcome" });
        mockEmit("setup:step:complete", { step: "welcome" });
        return {
          success: true,
          config: {},
          skippedSteps: [],
          cancelled: false,
        };
      });

      await setup(contextWithEmitter);

      expect(mockEmit).toHaveBeenCalledWith("setup:started", expect.any(Object));
      expect(mockEmit).toHaveBeenCalledWith("setup:complete", expect.any(Object));
    });
  });

  describe("non-interactive mode (ACP/RPC)", () => {
    it("should return error message in non-interactive mode", async () => {
      const nonInteractiveContext = {
        ...mockContext,
        isNonInteractive: true,
      };

      const result = await setup(nonInteractiveContext);

      expect(result).toContain("interactive");
      expect(mockSetupWizardRun).not.toHaveBeenCalled();
    });

    it("should support JSON-RPC events when emitter provided", async () => {
      const mockEmit = vi.fn();
      const rpcContext = {
        ...mockContext,
        isNonInteractive: false,
        eventEmitter: { emit: mockEmit },
        rpcMode: true,
      };

      mockSetupWizardRun.mockResolvedValue({
        success: true,
        config: { provider: "openai" },
        skippedSteps: ["advanced"],
        cancelled: false,
      });

      await setup(rpcContext);

      expect(mockEmit).toHaveBeenCalledWith("setup:started", expect.any(Object));
      expect(mockEmit).toHaveBeenCalledWith("setup:complete", expect.objectContaining({
        success: true,
        provider: "openai",
        skippedSteps: ["advanced"],
      }));
    });
  });

  describe("i18n support", () => {
    it("should use detected locale for i18n", async () => {
      vi.mocked(detectLocale).mockReturnValue({ locale: "de", source: "user" });

      mockSetupWizardRun.mockResolvedValue({
        success: true,
        config: {},
        skippedSteps: [],
        cancelled: false,
      });

      await setup(mockContext);

      expect(vi.mocked(initI18n)).toHaveBeenCalledWith("de");
    });

    it("should fallback to en when locale detection fails", async () => {
      vi.mocked(detectLocale).mockReturnValue({ locale: null, source: "default" });

      mockSetupWizardRun.mockResolvedValue({
        success: true,
        config: {},
        skippedSteps: [],
        cancelled: false,
      });

      await setup(mockContext);

      expect(vi.mocked(initI18n)).toHaveBeenCalledWith("en");
    });
  });

  describe("force flag behavior", () => {
    it("should always use force: true to allow reconfiguration", async () => {
      mockSetupWizardRun.mockResolvedValue({
        success: true,
        config: {},
        skippedSteps: [],
        cancelled: false,
      });

      await setup(mockContext);

      expect(mockSetupWizardRun).toHaveBeenCalledWith(expect.objectContaining({
        force: true,
      }));
    });
  });
});
