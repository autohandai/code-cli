/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import { buildStatusBarExtensions, type StatusBarRenderData } from "../../../src/core/agent/StatusBarRenderer.js";
import type { LoadedConfig } from "../../../types.js";

const baseData: StatusBarRenderData = {
  workspaceRoot: "/home/user/my-project",
  gitLabel: "main",
  interactionMode: "default",
  model: "opus-5",
  contextPercentLeft: 80,
  commandHint: "ctrl+t for commands",
};

describe("buildStatusBarExtensions", () => {
  it("returns undefined when no config is provided (uses defaults)", () => {
    const result = buildStatusBarExtensions(undefined, baseData);
    expect(result).toBeDefined();
    expect(result?.help).toBeDefined();
    expect(result?.help?.segments).toBeDefined();
    expect(result!.help!.segments!.length).toBeGreaterThan(0);
  });

  it("produces replaceDefault: true on help extension", () => {
    const result = buildStatusBarExtensions(undefined, baseData);
    expect(result?.help?.replaceDefault).toBe(true);
  });

  it("hides sections with no data (context-aware hiding)", () => {
    const config: LoadedConfig = {
      ui: {
        statusBar: {
          layout: "classic",
          sections: [
            { id: "project", line: 1, enabled: true },
            { id: "git", line: 1, enabled: true },
            { id: "agents", line: 2, enabled: true },
          ],
        },
      },
    } as unknown as LoadedConfig;

    const data: StatusBarRenderData = {
      ...baseData,
      agentCount: 0,
    };

    const result = buildStatusBarExtensions(config, data);
    expect(result?.help?.segments).toBeDefined();
    const ids = result!.help!.segments!.map((s) => s.id);
    expect(ids).toContain("project");
    expect(ids).toContain("git");
    expect(ids).not.toContain("agents");
  });

  it("renders project segment with emoji", () => {
    const config: LoadedConfig = {
      ui: {
        statusBar: {
          layout: "classic",
          sections: [{ id: "project", line: 1, enabled: true }],
        },
      },
    } as unknown as LoadedConfig;

    const result = buildStatusBarExtensions(config, baseData);
    const projectSegment = result?.help?.segments?.find((s) => s.id === "project");
    expect(projectSegment).toBeDefined();
    expect(projectSegment!.text).toContain("my-project");
    expect(projectSegment!.text).toMatch(/^[\p{Emoji}\u200d\ufe0f]+\s/u);
  });

  it("renders git segment", () => {
    const config: LoadedConfig = {
      ui: {
        statusBar: {
          layout: "classic",
          sections: [{ id: "git", line: 1, enabled: true }],
        },
      },
    } as unknown as LoadedConfig;

    const result = buildStatusBarExtensions(config, baseData);
    const gitSegment = result?.help?.segments?.find((s) => s.id === "git");
    expect(gitSegment).toBeDefined();
    expect(gitSegment!.text).toBe("main");
  });

  it("hides git segment when no gitLabel", () => {
    const config: LoadedConfig = {
      ui: {
        statusBar: {
          layout: "classic",
          sections: [{ id: "git", line: 1, enabled: true }],
        },
      },
    } as unknown as LoadedConfig;

    const data: StatusBarRenderData = { ...baseData, gitLabel: undefined };
    const result = buildStatusBarExtensions(config, data);
    const gitSegment = result?.help?.segments?.find((s) => s.id === "git");
    expect(gitSegment).toBeUndefined();
  });

  it("renders mode segment for non-default modes", () => {
    const config: LoadedConfig = {
      ui: {
        statusBar: {
          layout: "classic",
          sections: [{ id: "mode", line: 1, enabled: true }],
        },
      },
    } as unknown as LoadedConfig;

    const planData: StatusBarRenderData = { ...baseData, interactionMode: "plan" };
    const result = buildStatusBarExtensions(config, planData);
    const modeSegment = result?.help?.segments?.find((s) => s.id === "mode");
    expect(modeSegment).toBeDefined();
    expect(modeSegment!.text).toContain("PLAN");
  });

  it("hides mode segment for default mode", () => {
    const config: LoadedConfig = {
      ui: {
        statusBar: {
          layout: "classic",
          sections: [{ id: "mode", line: 1, enabled: true }],
        },
      },
    } as unknown as LoadedConfig;

    const result = buildStatusBarExtensions(config, baseData);
    const modeSegment = result?.help?.segments?.find((s) => s.id === "mode");
    expect(modeSegment).toBeUndefined();
  });

  it("renders context bar segment", () => {
    const config: LoadedConfig = {
      ui: {
        statusBar: {
          layout: "classic",
          sections: [{ id: "context", line: 1, enabled: true }],
        },
      },
    } as unknown as LoadedConfig;

    const result = buildStatusBarExtensions(config, baseData);
    const ctxSegment = result?.help?.segments?.find((s) => s.id === "context");
    expect(ctxSegment).toBeDefined();
    expect(ctxSegment!.text).toContain("█");
    expect(ctxSegment!.text).toContain("░");
  });

  it("hides context segment when contextPercentLeft is undefined", () => {
    const config: LoadedConfig = {
      ui: {
        statusBar: {
          layout: "classic",
          sections: [{ id: "context", line: 1, enabled: true }],
        },
      },
    } as unknown as LoadedConfig;

    const data: StatusBarRenderData = { ...baseData, contextPercentLeft: undefined };
    const result = buildStatusBarExtensions(config, data);
    const ctxSegment = result?.help?.segments?.find((s) => s.id === "context");
    expect(ctxSegment).toBeUndefined();
  });

  it("renders gitAhead segment when ahead > 0", () => {
    const config: LoadedConfig = {
      ui: {
        statusBar: {
          layout: "classic",
          sections: [{ id: "gitAhead", line: 1, enabled: true }],
        },
      },
    } as unknown as LoadedConfig;

    const data: StatusBarRenderData = { ...baseData, gitAhead: 3 };
    const result = buildStatusBarExtensions(config, data);
    const segment = result?.help?.segments?.find((s) => s.id === "gitAhead");
    expect(segment).toBeDefined();
    expect(segment!.text).toBe("↑3");
  });

  it("hides gitAhead segment when ahead is 0", () => {
    const config: LoadedConfig = {
      ui: {
        statusBar: {
          layout: "classic",
          sections: [{ id: "gitAhead", line: 1, enabled: true }],
        },
      },
    } as unknown as LoadedConfig;

    const data: StatusBarRenderData = { ...baseData, gitAhead: 0 };
    const result = buildStatusBarExtensions(config, data);
    const segment = result?.help?.segments?.find((s) => s.id === "gitAhead");
    expect(segment).toBeUndefined();
  });

  it("renders agents segment when agentCount > 0", () => {
    const config: LoadedConfig = {
      ui: {
        statusBar: {
          layout: "classic",
          sections: [{ id: "agents", line: 2, enabled: true }],
        },
      },
    } as unknown as LoadedConfig;

    const data: StatusBarRenderData = { ...baseData, agentCount: 3 };
    const result = buildStatusBarExtensions(config, data);
    const segment = result?.help?.segments?.find((s) => s.id === "agents");
    expect(segment).toBeDefined();
    expect(segment!.text).toContain("3");
    expect(segment!.text).toContain("agents");
  });

  it("renders two-line layout with help and status extensions", () => {
    const config: LoadedConfig = {
      ui: {
        statusBar: {
          layout: "two-line",
          sections: [
            { id: "project", line: 1, enabled: true },
            { id: "git", line: 1, enabled: true },
            { id: "agents", line: 2, enabled: true },
            { id: "hints", line: 2, enabled: true },
          ],
        },
      },
    } as unknown as LoadedConfig;

    const data: StatusBarRenderData = { ...baseData, agentCount: 2 };
    const result = buildStatusBarExtensions(config, data);
    expect(result?.help).toBeDefined();
    expect(result?.status).toBeDefined();

    const helpIds = result!.help!.segments!.map((s) => s.id);
    const statusIds = result!.status!.segments!.map((s) => s.id);
    expect(helpIds).toContain("project");
    expect(helpIds).toContain("git");
    expect(statusIds).toContain("agents");
    expect(statusIds).toContain("hints");
  });

  it("returns undefined status extension when line 2 has no visible segments", () => {
    const config: LoadedConfig = {
      ui: {
        statusBar: {
          layout: "two-line",
          sections: [
            { id: "project", line: 1, enabled: true },
            { id: "agents", line: 2, enabled: true },
          ],
        },
      },
    } as unknown as LoadedConfig;

    const data: StatusBarRenderData = { ...baseData, agentCount: 0 };
    const result = buildStatusBarExtensions(config, data);
    expect(result?.help).toBeDefined();
    expect(result?.status).toBeUndefined();
  });

  it("respects enabled: false", () => {
    const config: LoadedConfig = {
      ui: {
        statusBar: {
          layout: "classic",
          sections: [
            { id: "project", line: 1, enabled: true },
            { id: "git", line: 1, enabled: false },
          ],
        },
      },
    } as unknown as LoadedConfig;

    const result = buildStatusBarExtensions(config, baseData);
    const ids = result!.help!.segments!.map((s) => s.id);
    expect(ids).toContain("project");
    expect(ids).not.toContain("git");
  });

  it("renders tokens segment with compact format", () => {
    const config: LoadedConfig = {
      ui: {
        statusBar: {
          layout: "classic",
          sections: [{ id: "tokens", line: 1, enabled: true }],
        },
      },
    } as unknown as LoadedConfig;

    const data: StatusBarRenderData = { ...baseData, sessionTokensUsed: 45000 };
    const result = buildStatusBarExtensions(config, data);
    const segment = result?.help?.segments?.find((s) => s.id === "tokens");
    expect(segment).toBeDefined();
    expect(segment!.text).toBe("45.0k");
  });

  it("hides tokens segment when usage unavailable", () => {
    const config: LoadedConfig = {
      ui: {
        statusBar: {
          layout: "classic",
          sections: [{ id: "tokens", line: 1, enabled: true }],
        },
      },
    } as unknown as LoadedConfig;

    const data: StatusBarRenderData = {
      ...baseData,
      sessionTokensUsed: 50000,
      sessionTokenUsageUnavailable: true,
    };
    const result = buildStatusBarExtensions(config, data);
    const segment = result?.help?.segments?.find((s) => s.id === "tokens");
    expect(segment).toBeUndefined();
  });

  it("renders mcp segment with connected/total", () => {
    const config: LoadedConfig = {
      ui: {
        statusBar: {
          layout: "classic",
          sections: [{ id: "mcp", line: 2, enabled: true }],
        },
      },
    } as unknown as LoadedConfig;

    const data: StatusBarRenderData = { ...baseData, mcpConnected: 2, mcpTotal: 3 };
    const result = buildStatusBarExtensions(config, data);
    const segment = result?.help?.segments?.find((s) => s.id === "mcp");
    expect(segment).toBeDefined();
    expect(segment!.text).toContain("2/3");
  });

  it("renders mcp segment with failed indicator", () => {
    const config: LoadedConfig = {
      ui: {
        statusBar: {
          layout: "classic",
          sections: [{ id: "mcp", line: 2, enabled: true }],
        },
      },
    } as unknown as LoadedConfig;

    const data: StatusBarRenderData = { ...baseData, mcpConnected: 1, mcpTotal: 3, mcpFailed: 1 };
    const result = buildStatusBarExtensions(config, data);
    const segment = result?.help?.segments?.find((s) => s.id === "mcp");
    expect(segment).toBeDefined();
    expect(segment!.text).toContain("failed");
  });

  it("renders tasks segment with pending count", () => {
    const config: LoadedConfig = {
      ui: {
        statusBar: {
          layout: "classic",
          sections: [{ id: "tasks", line: 2, enabled: true }],
        },
      },
    } as unknown as LoadedConfig;

    const data: StatusBarRenderData = { ...baseData, taskPending: 2, taskTotal: 5 };
    const result = buildStatusBarExtensions(config, data);
    const segment = result?.help?.segments?.find((s) => s.id === "tasks");
    expect(segment).toBeDefined();
    expect(segment!.text).toContain("2/5");
  });

  it("renders diff segment when session has file changes", () => {
    const config: LoadedConfig = {
      ui: {
        statusBar: {
          layout: "classic",
          sections: [{ id: "diff", line: 2, enabled: true }],
        },
      },
    } as unknown as LoadedConfig;

    const data: StatusBarRenderData = {
      ...baseData,
      sessionHasFileChanges: true,
      sessionDiffStats: { added: 10, removed: 3, modified: 0 } as never,
    };
    const result = buildStatusBarExtensions(config, data);
    const segment = result?.help?.segments?.find((s) => s.id === "diff");
    expect(segment).toBeDefined();
    expect(segment!.text).toContain("10");
  });

  it("hides diff segment when no file changes", () => {
    const config: LoadedConfig = {
      ui: {
        statusBar: {
          layout: "classic",
          sections: [{ id: "diff", line: 2, enabled: true }],
        },
      },
    } as unknown as LoadedConfig;

    const data: StatusBarRenderData = { ...baseData, sessionHasFileChanges: false };
    const result = buildStatusBarExtensions(config, data);
    const segment = result?.help?.segments?.find((s) => s.id === "diff");
    expect(segment).toBeUndefined();
  });

  it("preserves section order from config", () => {
    const config: LoadedConfig = {
      ui: {
        statusBar: {
          layout: "classic",
          sections: [
            { id: "hints", line: 1, enabled: true },
            { id: "git", line: 1, enabled: true },
            { id: "project", line: 1, enabled: true },
          ],
        },
      },
    } as unknown as LoadedConfig;

    const result = buildStatusBarExtensions(config, baseData);
    const ids = result!.help!.segments!.map((s) => s.id);
    expect(ids).toEqual(["hints", "git", "project"]);
  });

  it("returns undefined when all enabled sections produce empty text", () => {
    const config: LoadedConfig = {
      ui: {
        statusBar: {
          layout: "classic",
          sections: [{ id: "agents", line: 2, enabled: true }],
        },
      },
    } as unknown as LoadedConfig;

    const result = buildStatusBarExtensions(config, baseData);
    expect(result).toBeUndefined();
  });
});
