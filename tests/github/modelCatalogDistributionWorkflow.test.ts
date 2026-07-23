/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const ROOT = resolve(import.meta.dirname, "../..");
const GENERATOR = join(ROOT, ".github/scripts/generate-model-catalog.mjs");
const PUBLISH_SCRIPT = join(ROOT, ".github/scripts/publish-model-catalog.mjs");
const PUBLISH_WORKFLOW = join(ROOT, ".github/workflows/publish-model-catalog.yml");
const ADMIN_WORKFLOW = join(ROOT, ".github/workflows/model-catalog-admin-pr.yml");

describe("model catalog distribution automation", () => {
  it("generates a Pi-compatible keyed catalog from the bundled source", () => {
    const directory = mkdtempSync(join(tmpdir(), "autohand-model-distribution-"));
    const sourcePath = join(directory, "source.json");
    const outputPath = join(directory, "models.json");
    writeFileSync(sourcePath, JSON.stringify({
      providers: {
        nvidia: {
          defaultModel: "nvidia/example",
          runtimeDefaultModel: "nvidia/example",
          models: [{
            id: "nvidia/example",
            displayName: "Example",
            contextWindow: 262144,
            reasoningEffort: "high",
          }],
        },
      },
    }));

    try {
      execFileSync(process.execPath, [
        GENERATOR,
        "--catalog",
        sourcePath,
        "--output",
        outputPath,
      ]);
      const catalog = JSON.parse(readFileSync(outputPath, "utf8"));

      expect(catalog).toEqual({
        nvidia: {
          "nvidia/example": expect.objectContaining({
            id: "nvidia/example",
            name: "Example",
            api: "openai-completions",
            provider: "nvidia",
            reasoning: true,
            input: ["text"],
            contextWindow: 262144,
            maxTokens: expect.any(Number),
          }),
        },
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("publishes immutable revisions and promotes the stable key only from main", () => {
    const source = readFileSync(PUBLISH_WORKFLOW, "utf8");
    const workflow = parseYaml(source) as {
      on: { push: { branches: string[]; paths: string[] }; schedule: Array<{ cron: string }>; workflow_dispatch: unknown };
    };

    expect(workflow.on.push.branches).toEqual(["main"]);
    expect(workflow.on.push.paths).toContain("src/providers/models.json");
    expect(workflow.on.schedule).toEqual([{ cron: "17 */4 * * *" }]);
    expect(workflow.on.workflow_dispatch).toBeDefined();
    expect(source).toContain(".github/scripts/generate-model-catalog.mjs");
    expect(source).toContain("cli/revisions/");
    expect(source).toContain("cli/models.json");
    expect(source.indexOf("cli/revisions/")).toBeLessThan(source.indexOf("cli/models.json"));
    expect(source).toContain("R2_MODELS_BUCKET");
  });

  it("stores the catalog revision as R2 object metadata", () => {
    const source = readFileSync(PUBLISH_SCRIPT, "utf8");

    expect(source).toContain('"--metadata"');
    expect(source).toContain('`revision=${revision}`');
  });

  it("reports a clear error when a required flag's value is empty, e.g. an unset GitHub secret", () => {
    let error: (Error & { stderr?: string }) | undefined;
    try {
      execFileSync(process.execPath, [
        PUBLISH_SCRIPT,
        "--input", "/nonexistent/models.json",
        "--bucket", "",
        "--endpoint", "https://example.r2.cloudflarestorage.com",
        "--source-commit", "abc123",
        "--revision-prefix", "cli/revisions/",
        "--latest-key", "cli/models.json",
        "--metadata-key", "cli/catalog.json",
      ], { encoding: "utf8" });
    } catch (caught) {
      error = caught as Error & { stderr?: string };
    }

    expect(error).toBeDefined();
    expect(String(error?.stderr)).toContain("--bucket");
    expect(String(error?.stderr)).toContain("empty or unset");
  });

  it("turns an R2 admin draft into a reviewable pull request without auto-merging", () => {
    const source = readFileSync(ADMIN_WORKFLOW, "utf8");
    const workflow = parseYaml(source) as {
      on: { workflow_dispatch: { inputs: Record<string, unknown> } };
    };

    expect(workflow.on.workflow_dispatch.inputs).toHaveProperty("draft_id");
    expect(workflow.on.workflow_dispatch.inputs).toHaveProperty("source_sha");
    expect(source).toContain("cli/drafts/${DRAFT_ID}.json");
    expect(source).toContain("src/providers/models.json");
    expect(source).toContain("gh pr create");
    expect(source).not.toContain("gh pr merge");
    expect(source).not.toContain("git push origin main");
  });
});
