/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");

describe("standalone model catalog binary", () => {
  it("retains required Autohand AI model metadata outside the repository checkout", () => {
    const directory = mkdtempSync(join(tmpdir(), "autohand-catalog-binary-"));
    const runDirectory = join(directory, "run");
    const autohandHome = join(directory, "autohand-home");
    const entryPath = join(directory, "entry.ts");
    const binaryPath = join(directory, "catalog-check");
    const catalogModulePath = join(ROOT, "src/providers/modelCatalog.ts");

    mkdirSync(runDirectory);
    mkdirSync(autohandHome);
    writeFileSync(entryPath, `
      import { getProviderModelOptions } from ${JSON.stringify(catalogModulePath)};

      const fantail = getProviderModelOptions("autohandai")
        .find((model) => model.id === "fantail");
      if (fantail?.contextWindow !== 64_000 || fantail.maxTokens !== 16_000) {
        throw new Error("Standalone binary is missing required Fantail metadata.");
      }
      console.log("catalog-ok");
    `);

    try {
      execFileSync("bun", [
        "build",
        entryPath,
        "--compile",
        "--outfile",
        binaryPath,
      ], { cwd: ROOT, stdio: "pipe" });
      chmodSync(binaryPath, 0o755);

      const output = execFileSync(binaryPath, [], {
        cwd: runDirectory,
        encoding: "utf8",
        env: { ...process.env, AUTOHAND_HOME: autohandHome },
        stdio: ["ignore", "pipe", "pipe"],
      });

      expect(output).toContain("catalog-ok");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
