/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import {
  buildDefaultSections,
  isValidLayout,
  isValidPriority,
  isValidSectionId,
  migrateLegacyStatusLine,
  resolveStatusBarConfig,
  validateStatusBarConfig,
} from "../../../src/core/agent/StatusBarConfig.js";
import type { LoadedConfig, StatusLineSettings } from "../../../types.js";

describe("buildDefaultSections", () => {
  it("returns all 20 known sections in canonical order", () => {
    const sections = buildDefaultSections();
    const ids = sections.map((s) => s.id);
    expect(ids).toEqual([
      "project", "git", "gitAhead", "gitBehind", "dirty",
      "worktree", "pr", "model", "provider", "mode",
      "context", "tokens", "cost", "clock",
      "agents", "mcp", "diff", "research", "tasks", "hints",
    ]);
  });

  it("assigns correct default priorities", () => {
    const sections = buildDefaultSections();
    const byId = Object.fromEntries(sections.map((s) => [s.id, s.priority]));
    expect(byId.project).toBe("critical");
    expect(byId.mode).toBe("critical");
    expect(byId.git).toBe("high");
    expect(byId.context).toBe("high");
    expect(byId.model).toBe("high");
    expect(byId.worktree).toBe("normal");
    expect(byId.hints).toBe("ambient");
    expect(byId.cost).toBe("low");
  });

  it("assigns correct line numbers", () => {
    const sections = buildDefaultSections();
    const line1 = sections.filter((s) => s.line === 1).map((s) => s.id);
    const line2 = sections.filter((s) => s.line === 2).map((s) => s.id);
    expect(line1).toContain("project");
    expect(line1).toContain("git");
    expect(line1).toContain("model");
    expect(line2).toContain("agents");
    expect(line2).toContain("hints");
    expect(line2).toContain("diff");
  });

  it("enables identity sections by default and disables extras", () => {
    const sections = buildDefaultSections();
    const byId = Object.fromEntries(sections.map((s) => [s.id, s.enabled]));
    expect(byId.project).toBe(true);
    expect(byId.mode).toBe(true);
    expect(byId.git).toBe(true);
    expect(byId.context).toBe(true);
    expect(byId.model).toBe(true);
    expect(byId.hints).toBe(true);
    expect(byId.worktree).toBe(false);
    expect(byId.pr).toBe(false);
    expect(byId.tokens).toBe(false);
    expect(byId.agents).toBe(false);
    expect(byId.cost).toBe(false);
  });
});

describe("migrateLegacyStatusLine", () => {
  it("returns null when no legacy config is provided", () => {
    expect(migrateLegacyStatusLine(undefined)).toBeNull();
  });

  it("migrates showGitBranch: false by removing the git section", () => {
    const legacy: StatusLineSettings = { showGitBranch: false };
    const migrated = migrateLegacyStatusLine(legacy);
    expect(migrated).not.toBeNull();
    const ids = migrated!.map((s) => s.id);
    expect(ids).not.toContain("git");
  });

  it("migrates showProviderModel: false by removing the model section", () => {
    const legacy: StatusLineSettings = { showProviderModel: false };
    const migrated = migrateLegacyStatusLine(legacy);
    const ids = migrated!.map((s) => s.id);
    expect(ids).not.toContain("model");
  });

  it("keeps sections when legacy value is true", () => {
    const legacy: StatusLineSettings = { showGitBranch: true, showContext: true };
    const migrated = migrateLegacyStatusLine(legacy);
    const ids = migrated!.map((s) => s.id);
    expect(ids).toContain("git");
    expect(ids).toContain("context");
  });

  it("keeps sections with no legacy equivalent at their default enabled state", () => {
    const legacy: StatusLineSettings = {};
    const migrated = migrateLegacyStatusLine(legacy);
    const byId = Object.fromEntries(migrated!.map((s) => [s.id, s.enabled]));
    expect(byId.worktree).toBe(false);
    expect(byId.agents).toBe(false);
    expect(byId.tokens).toBe(false);
  });

  it("maps showWorkspacePath to project section", () => {
    const legacy: StatusLineSettings = { showWorkspacePath: false };
    const migrated = migrateLegacyStatusLine(legacy);
    const ids = migrated!.map((s) => s.id);
    expect(ids).not.toContain("project");
  });

  it("maps showCommandHint to hints section", () => {
    const legacy: StatusLineSettings = { showCommandHint: false };
    const migrated = migrateLegacyStatusLine(legacy);
    const ids = migrated!.map((s) => s.id);
    expect(ids).not.toContain("hints");
  });

  it("maps showSessionLines to diff section", () => {
    const legacy: StatusLineSettings = { showSessionLines: true };
    const migrated = migrateLegacyStatusLine(legacy);
    const byId = Object.fromEntries(migrated!.map((s) => [s.id, s.enabled]));
    expect(byId.diff).toBe(true);
  });
});

describe("resolveStatusBarConfig", () => {
  it("returns defaults when config is undefined", () => {
    const result = resolveStatusBarConfig(undefined);
    expect(result.layout).toBe("classic");
    expect(result.sections).toHaveLength(20);
  });

  it("returns defaults when neither statusBar nor statusLine is set", () => {
    const config = { ui: {} } as unknown as LoadedConfig;
    const result = resolveStatusBarConfig(config);
    expect(result.layout).toBe("classic");
    expect(result.sections).toHaveLength(20);
  });

  it("uses new statusBar format when present", () => {
    const config = {
      ui: {
        statusBar: {
          layout: "two-line",
          sections: [
            { id: "project", line: 1 },
            { id: "git", line: 1 },
            { id: "agents", line: 2 },
          ],
        },
      },
    } as unknown as LoadedConfig;
    const result = resolveStatusBarConfig(config);
    expect(result.layout).toBe("two-line");
    expect(result.sections).toHaveLength(3);
    expect(result.sections[0].id).toBe("project");
    expect(result.sections[0].enabled).toBe(true);
    expect(result.sections[0].priority).toBe("critical");
  });

  it("falls back to legacy migration when only statusLine is present", () => {
    const config = {
      ui: {
        statusLine: { showGitBranch: false, showContext: true },
      },
    } as unknown as LoadedConfig;
    const result = resolveStatusBarConfig(config);
    expect(result.layout).toBe("classic");
    const ids = result.sections.map((s) => s.id);
    expect(ids).not.toContain("git");
    expect(ids).toContain("context");
  });

  it("new format takes precedence over legacy", () => {
    const config = {
      ui: {
        statusLine: { showGitBranch: false },
        statusBar: {
          layout: "two-line",
          sections: [{ id: "git", line: 1 }],
        },
      },
    } as unknown as LoadedConfig;
    const result = resolveStatusBarConfig(config);
    expect(result.layout).toBe("two-line");
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].id).toBe("git");
  });
});

describe("validateStatusBarConfig", () => {
  it("accepts a valid config", () => {
    expect(() =>
      validateStatusBarConfig(
        { layout: "two-line", sections: [{ id: "project", line: 1 }] },
        "test.json",
      ),
    ).not.toThrow();
  });

  it("accepts empty object (no sections)", () => {
    expect(() => validateStatusBarConfig({}, "test.json")).not.toThrow();
  });

  it("rejects non-object", () => {
    expect(() => validateStatusBarConfig("not an object", "test.json")).toThrow(
      "ui.statusBar must be an object",
    );
  });

  it("rejects null", () => {
    expect(() => validateStatusBarConfig(null, "test.json")).toThrow(
      "ui.statusBar must be an object",
    );
  });

  it("rejects invalid layout", () => {
    expect(() =>
      validateStatusBarConfig({ layout: "three-line" }, "test.json"),
    ).toThrow('ui.statusBar.layout must be "classic" or "two-line"');
  });

  it("rejects non-array sections", () => {
    expect(() =>
      validateStatusBarConfig({ sections: "not-array" }, "test.json"),
    ).toThrow("ui.statusBar.sections must be an array");
  });

  it("rejects unknown section id", () => {
    expect(() =>
      validateStatusBarConfig(
        { sections: [{ id: "unknown", line: 1 }] },
        "test.json",
      ),
    ).toThrow("ui.statusBar.sections[].id must be one of");
  });

  it("rejects duplicate section ids", () => {
    expect(() =>
      validateStatusBarConfig(
        {
          sections: [
            { id: "project", line: 1 },
            { id: "project", line: 1 },
          ],
        },
        "test.json",
      ),
    ).toThrow('Duplicate status bar section id "project"');
  });

  it("rejects invalid line number", () => {
    expect(() =>
      validateStatusBarConfig(
        { sections: [{ id: "project", line: 3 as unknown as 1 }] },
        "test.json",
      ),
    ).toThrow("ui.statusBar.sections[].line must be 1 or 2");
  });

  it("rejects non-boolean enabled", () => {
    expect(() =>
      validateStatusBarConfig(
        { sections: [{ id: "project", line: 1, enabled: "yes" as unknown as boolean }] },
        "test.json",
      ),
    ).toThrow("ui.statusBar.sections[].enabled must be boolean");
  });

  it("rejects invalid priority", () => {
    expect(() =>
      validateStatusBarConfig(
        { sections: [{ id: "project", line: 1, priority: "urgent" as unknown as "critical" }] },
        "test.json",
      ),
    ).toThrow("ui.statusBar.sections[].priority must be critical, high, normal, low, or ambient");
  });

  it("rejects non-string color", () => {
    expect(() =>
      validateStatusBarConfig(
        { sections: [{ id: "project", line: 1, color: 123 as unknown as string }] },
        "test.json",
      ),
    ).toThrow("ui.statusBar.sections[].color must be a string");
  });

  it("rejects non-object section entry", () => {
    expect(() =>
      validateStatusBarConfig(
        { sections: ["not-object" as unknown as { id: "project"; line: 1 }] },
        "test.json",
      ),
    ).toThrow("ui.statusBar.sections[] entries must be objects");
  });
});

describe("isValidSectionId", () => {
  it("accepts known ids", () => {
    expect(isValidSectionId("project")).toBe(true);
    expect(isValidSectionId("git")).toBe(true);
    expect(isValidSectionId("hints")).toBe(true);
  });

  it("rejects unknown ids", () => {
    expect(isValidSectionId("unknown")).toBe(false);
    expect(isValidSectionId("")).toBe(false);
  });
});

describe("isValidPriority", () => {
  it("accepts all five tiers", () => {
    expect(isValidPriority("critical")).toBe(true);
    expect(isValidPriority("high")).toBe(true);
    expect(isValidPriority("normal")).toBe(true);
    expect(isValidPriority("low")).toBe(true);
    expect(isValidPriority("ambient")).toBe(true);
  });

  it("rejects unknown tiers", () => {
    expect(isValidPriority("urgent")).toBe(false);
    expect(isValidPriority("")).toBe(false);
  });
});

describe("isValidLayout", () => {
  it("accepts classic and two-line", () => {
    expect(isValidLayout("classic")).toBe(true);
    expect(isValidLayout("two-line")).toBe(true);
  });

  it("rejects unknown layouts", () => {
    expect(isValidLayout("three-line")).toBe(false);
    expect(isValidLayout("")).toBe(false);
  });
});
