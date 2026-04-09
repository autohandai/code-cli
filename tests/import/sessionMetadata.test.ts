/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from "vitest";
import type { SessionMetadata } from "../../src/session/types.js";

describe("SessionMetadata importedFrom field", () => {
  it("should allow creating metadata without importedFrom", () => {
    const metadata: SessionMetadata = {
      sessionId: "session-001",
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      projectPath: "/home/user/project",
      projectName: "my-project",
      model: "your-modelcard-id-here",
      messageCount: 5,
      status: "completed",
    };
    expect(metadata.importedFrom).toBeUndefined();
  });

  it("should accept importedFrom with full provenance data", () => {
    const metadata: SessionMetadata = {
      sessionId: "session-imported-001",
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      projectPath: "/home/user/project",
      projectName: "my-project",
      model: "your-modelcard-id-here",
      messageCount: 10,
      status: "completed",
      importedFrom: {
        source: "claude",
        originalId: "claude-session-abc123",
        importedAt: new Date().toISOString(),
      },
    };
    expect(metadata.importedFrom).toBeDefined();
    expect(metadata.importedFrom!.source).toBe("claude");
    expect(metadata.importedFrom!.originalId).toBe("claude-session-abc123");
    expect(metadata.importedFrom!.importedAt).toBeDefined();
  });

  it("should preserve all existing SessionMetadata fields alongside importedFrom", () => {
    const now = new Date().toISOString();
    const metadata: SessionMetadata = {
      sessionId: "session-full",
      createdAt: now,
      lastActiveAt: now,
      closedAt: now,
      projectPath: "/home/user/project",
      projectName: "my-project",
      model: "your-modelcard-id-here",
      messageCount: 20,
      summary: "Imported session",
      status: "completed",
      exitCode: 0,
      type: "interactive",
      client: "terminal",
      clientVersion: "1.0.0",
      importedFrom: {
        source: "codex",
        originalId: "codex-sess-xyz",
        importedAt: now,
      },
    };
    // Verify existing fields still work
    expect(metadata.sessionId).toBe("session-full");
    expect(metadata.closedAt).toBe(now);
    expect(metadata.type).toBe("interactive");
    expect(metadata.client).toBe("terminal");
    // Verify new field
    expect(metadata.importedFrom?.source).toBe("codex");
    expect(metadata.importedFrom?.originalId).toBe("codex-sess-xyz");
  });

  it("should support various source strings in importedFrom", () => {
    const sources = [
      "claude",
      "codex",
      "gemini",
      "cursor",
      "cline",
      "continue",
      "augment",
    ];
    for (const source of sources) {
      const metadata: SessionMetadata = {
        sessionId: `session-${source}`,
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        projectPath: "/tmp",
        projectName: "test",
        model: "test-model",
        messageCount: 0,
        status: "completed",
        importedFrom: {
          source,
          originalId: `${source}-original-id`,
          importedAt: new Date().toISOString(),
        },
      };
      expect(metadata.importedFrom?.source).toBe(source);
    }
  });
});
