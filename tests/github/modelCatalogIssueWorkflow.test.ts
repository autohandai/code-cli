/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const ROOT = resolve(import.meta.dirname, "../..");
const ISSUE_TEMPLATE_PATH = join(ROOT, ".github/ISSUE_TEMPLATE/model_catalog.yml");
const WORKFLOW_PATH = join(ROOT, ".github/workflows/model-catalog-pr.yml");
const UPDATER_PATH = join(ROOT, ".github/scripts/update-model-catalog.mjs");

interface CatalogFixture {
  providers: Record<string, {
    defaultModel: string;
    runtimeDefaultModel: string;
    models: Array<string | Record<string, unknown>>;
  }>;
}

interface UpdateResult {
  status: "added" | "duplicate" | "invalid";
  provider?: string;
  modelId?: string;
  message: string;
}

interface IssueFormField {
  type: string;
  id?: string;
  attributes?: {
    options?: string[];
  };
}

interface IssueForm {
  name: string;
  title: string;
  body: IssueFormField[];
}

interface WorkflowDefinition {
  on: {
    issues: {
      types: string[];
    };
  };
  permissions: Record<string, string>;
}

function requestBody(fields: {
  provider: string;
  modelId: string;
  displayName?: string;
  contextWindow?: string;
  reasoningEffort?: string;
}): string {
  return [
    "### Provider",
    fields.provider,
    "### Model ID",
    fields.modelId,
    "### Display name",
    fields.displayName ?? "_No response_",
    "### Context window",
    fields.contextWindow ?? "_No response_",
    "### Reasoning effort",
    fields.reasoningEffort ?? "Not specified",
  ].join("\n\n");
}

function runUpdater(catalog: CatalogFixture, body: string): {
  catalog: CatalogFixture;
  result: UpdateResult;
  pullRequestBody: string;
} {
  const directory = mkdtempSync(join(tmpdir(), "autohand-model-catalog-workflow-"));
  const catalogPath = join(directory, "models.json");
  const issueBodyPath = join(directory, "issue.md");
  const resultPath = join(directory, "result.json");
  const pullRequestBodyPath = join(directory, "pull-request.md");

  writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  writeFileSync(issueBodyPath, body);

  try {
    execFileSync(process.execPath, [
      UPDATER_PATH,
      "--catalog",
      catalogPath,
      "--issue-body",
      issueBodyPath,
      "--result",
      resultPath,
      "--pull-request-body",
      pullRequestBodyPath,
      "--issue-number",
      "42",
    ]);

    return {
      catalog: JSON.parse(readFileSync(catalogPath, "utf8")) as CatalogFixture,
      result: JSON.parse(readFileSync(resultPath, "utf8")) as UpdateResult,
      pullRequestBody: readFileSync(pullRequestBodyPath, "utf8"),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("model catalog issue automation", () => {
  it("keeps the issue provider dropdown synchronized with models.json", () => {
    const catalog = JSON.parse(
      readFileSync(join(ROOT, "src/providers/models.json"), "utf8"),
    ) as CatalogFixture;
    const issueForm = parseYaml(readFileSync(ISSUE_TEMPLATE_PATH, "utf8")) as IssueForm;
    const providerField = issueForm.body.find((field) => field.id === "provider");

    expect(issueForm.name).toBe("Add model catalog entry");
    expect(issueForm.title).toBe("[Model]: ");
    expect(providerField?.type).toBe("dropdown");
    expect(providerField?.attributes?.options).toEqual(Object.keys(catalog.providers));
  });

  it("limits the workflow to trusted issue authors and minimum write permissions", () => {
    const source = readFileSync(WORKFLOW_PATH, "utf8");
    const workflow = parseYaml(source) as WorkflowDefinition;

    expect(workflow.on.issues.types).toEqual(["opened"]);
    expect(workflow.permissions).toEqual({
      contents: "write",
      issues: "write",
      "pull-requests": "write",
    });
    expect(source).toContain('body.includes("### Provider")');
    expect(source).toContain('body.includes("### Model ID")');
    expect(source).toContain("github.event.issue.author_association");
    expect(source).toContain("OWNER");
    expect(source).toContain("MEMBER");
    expect(source).toContain("COLLABORATOR");
    expect(source).toContain("qualify_model_request:");
    expect(source).toContain("permissions: {}");
    expect(source).toContain("needs: qualify_model_request");
    expect(source).toContain("needs.qualify_model_request.outputs.accepted == 'true'");
    expect(source).toContain("accepted=${accepted}");
    expect(source).toContain(".github/scripts/update-model-catalog.mjs");
    expect(source).toContain("git add -- src/providers/models.json");
    expect(source).toContain("gh pr create");
    expect(source).not.toContain("gh pr merge");
    expect(source).not.toContain("gh pr review --approve");
    expect(source).not.toMatch(/run:\s*[|>-][\s\S]*github\.event\.issue\.body/);
  });

  it("appends a plain model ID without changing provider defaults", () => {
    const catalog: CatalogFixture = {
      providers: {
        nvidia: {
          defaultModel: "nvidia/existing",
          runtimeDefaultModel: "nvidia/existing",
          models: ["nvidia/existing"],
        },
      },
    };

    const updated = runUpdater(catalog, requestBody({
      provider: "nvidia",
      modelId: "nvidia/new-model",
    }));

    expect(updated.result).toMatchObject({
      status: "added",
      provider: "nvidia",
      modelId: "nvidia/new-model",
    });
    expect(updated.catalog.providers.nvidia).toEqual({
      defaultModel: "nvidia/existing",
      runtimeDefaultModel: "nvidia/existing",
      models: ["nvidia/existing", "nvidia/new-model"],
    });
    expect(updated.pullRequestBody).toContain("Closes #42");
  });

  it("writes a structured entry when optional model metadata is provided", () => {
    const catalog: CatalogFixture = {
      providers: {
        openrouter: {
          defaultModel: "vendor/existing",
          runtimeDefaultModel: "vendor/existing",
          models: [{ id: "vendor/existing", displayName: "Existing" }],
        },
      },
    };

    const updated = runUpdater(catalog, requestBody({
      provider: "openrouter",
      modelId: "vendor/new-model",
      displayName: "New Model",
      contextWindow: "131072",
      reasoningEffort: "high",
    }));

    expect(updated.result.status).toBe("added");
    expect(updated.catalog.providers.openrouter.models.at(-1)).toEqual({
      id: "vendor/new-model",
      displayName: "New Model",
      contextWindow: 131072,
      reasoningEffort: "high",
    });
  });

  it("reports an existing model without rewriting the catalog", () => {
    const catalog: CatalogFixture = {
      providers: {
        openrouter: {
          defaultModel: "vendor/existing",
          runtimeDefaultModel: "vendor/existing",
          models: [{ id: "vendor/existing" }],
        },
      },
    };

    const updated = runUpdater(catalog, requestBody({
      provider: "openrouter",
      modelId: "vendor/existing",
    }));

    expect(updated.result.status).toBe("duplicate");
    expect(updated.catalog).toEqual(catalog);
  });

  it("rejects providers outside the catalog and unsafe model IDs", () => {
    const catalog: CatalogFixture = {
      providers: {
        openai: {
          defaultModel: "gpt-existing",
          runtimeDefaultModel: "gpt-existing",
          models: ["gpt-existing"],
        },
      },
    };

    const unsupported = runUpdater(catalog, requestBody({
      provider: "unsupported",
      modelId: "vendor/model",
    }));
    const unsafeId = runUpdater(catalog, requestBody({
      provider: "openai",
      modelId: "model with spaces",
    }));

    expect(unsupported.result).toMatchObject({
      status: "invalid",
      message: "Unsupported provider: unsupported",
    });
    expect(unsafeId.result).toMatchObject({
      status: "invalid",
      message: "Model ID contains unsupported characters",
    });
  });
});
