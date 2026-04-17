/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Use vi.hoisted() to ensure mock functions are available when vi.mock is hoisted
const {
  mockSetupWizardRun,
  mockLoadConfig,
  mockSaveConfig,
  mockResolveWorkspaceRoot,
  mockInitI18n,
  mockDetectLocale,
  mockChalkGreen,
  mockChalkGray,
} = vi.hoisted(() => ({
  mockSetupWizardRun: vi.fn(),
  mockLoadConfig: vi.fn(),
  mockSaveConfig: vi.fn(),
  mockResolveWorkspaceRoot: vi.fn(),
  mockInitI18n: vi.fn(),
  mockDetectLocale: vi.fn(),
  mockChalkGreen: vi.fn((s: string) => s),
  mockChalkGray: vi.fn((s: string) => s),
}));

// Mock chalk
vi.mock("chalk", () => ({
  default: {
    green: mockChalkGreen,
    gray: mockChalkGray,
  },
}));

// Mock SetupWizard
vi.mock("../../src/onboarding/setupWizard.js", () => ({
  SetupWizard: vi.fn().mockImplementation(() => ({
    run: mockSetupWizardRun,
  })),
}));

// Mock config
vi.mock("../../src/config.js", () => ({
  loadConfig: mockLoadConfig,
  saveConfig: mockSaveConfig,
  resolveWorkspaceRoot: mockResolveWorkspaceRoot,
}));

// Mock i18n
vi.mock("../../src/i18n/index.js", () => ({
  initI18n: mockInitI18n,
  detectLocale: mockDetectLocale,
  t: (key: string) => key,
}));

// Mock console to suppress output during tests
vi.spyOn(console, "log").mockImplementation(() => {});

// Import after mocking
import { setup } from "../../src/commands/setup";
import { SetupWizard } from "../../src/onboarding/setupWizard";
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
    mockLoadConfig.mockResolvedValue(mockConfig);
    mockResolveWorkspaceRoot.mockReturnValue("/test/workspace");
    mockDetectLocale.mockReturnValue({ locale: "en", source: "default" });
    mockInitI18n.mockResolvedValue(undefined);
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

      expect(mockLoadConfig).toHaveBeenCalledWith(mockConfig.configPath, mockContext.workspaceRoot);
      expect(SetupWizard).toHaveBeenCalledWith("/test/workspace", mockConfig);
      expect(mockSetupWizardRun).toHaveBeenCalledWith({ force: true, skipWelcome: false });
      expect(mockSaveConfig).toHaveBeenCalled();
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
      expect(mockSaveConfig).not.toHaveBeenCalled();
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
      expect(mockSaveConfig).not.toHaveBeenCalled();
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
      mockDetectLocale.mockReturnValue({ locale: "de", source: "user" });

      mockSetupWizardRun.mockResolvedValue({
        success: true,
        config: {},
        skippedSteps: [],
        cancelled: false,
      });

      await setup(mockContext);

      expect(mockInitI18n).toHaveBeenCalledWith("de");
    });

    it("should fallback to en when locale detection fails", async () => {
      mockDetectLocale.mockReturnValue({ locale: null, source: "default" });

      mockSetupWizardRun.mockResolvedValue({
        success: true,
        config: {},
        skippedSteps: [],
        cancelled: false,
      });

      await setup(mockContext);

      expect(mockInitI18n).toHaveBeenCalledWith("en");
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
