/**
 * Regression tests for config parse error handling (Issue #3)
 *
 * Bug: parseConfigFile() doesn't handle YAML returning `null` for empty files.
 *      Error messages lack recovery suggestions.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fse from "fs-extra";

// We test the public loadConfig API so we exercise the real parse/normalize path.
// We use a temp dir so we don't touch the user's real config.
const TMP_BASE = path.join(os.tmpdir(), "autohand-config-test");

async function writeTempConfig(
  dir: string,
  filename: string,
  content: string,
): Promise<string> {
  await fse.ensureDir(dir);
  const filePath = path.join(dir, filename);
  await fse.writeFile(filePath, content, "utf8");
  return filePath;
}

// We must import AFTER we know the path so we can pass it as customPath.
// Lazy import keeps module mocking simple.
async function importLoadConfig() {
  const mod = await import("../../src/config.js");
  return mod.loadConfig;
}

async function importConfigModule() {
  return import("../../src/config.js");
}

describe("configParser – error handling (Issue #3)", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(
      TMP_BASE,
      `run-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fse.ensureDir(testDir);
    // Suppress noisy console.warn calls from validateConfig theme checks
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fse.remove(testDir);
  });

  // ─── JSON ──────────────────────────────────────────────────────────────────

  it("returns a friendly error message for malformed JSON", async () => {
    const configPath = await writeTempConfig(
      testDir,
      "config.json",
      "{ this is not valid json",
    );
    const loadConfig = await importLoadConfig();

    await expect(loadConfig(configPath)).rejects.toThrow(
      /Failed to parse config/,
    );
  });

  it("error message for malformed JSON includes the config file path", async () => {
    const configPath = await writeTempConfig(
      testDir,
      "config.json",
      "{ bad json }",
    );
    const loadConfig = await importLoadConfig();

    let caughtError: Error | null = null;
    try {
      await loadConfig(configPath);
    } catch (e) {
      caughtError = e as Error;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toContain(configPath);
  });

  it("error message for malformed JSON includes a recovery suggestion mentioning autohand --setup", async () => {
    const configPath = await writeTempConfig(
      testDir,
      "config.json",
      "{ broken }",
    );
    const loadConfig = await importLoadConfig();

    let caughtError: Error | null = null;
    try {
      await loadConfig(configPath);
    } catch (e) {
      caughtError = e as Error;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toMatch(/autohand --setup/i);
  });

  it("does not throw an unhandled rejection for malformed JSON (promise rejects cleanly)", async () => {
    const configPath = await writeTempConfig(testDir, "config.json", "###");
    const loadConfig = await importLoadConfig();

    // If the promise rejects cleanly this will NOT throw unhandled rejection
    const result = loadConfig(configPath).then(
      () => "resolved",
      (e: Error) => e.message,
    );
    const message = await result;
    expect(typeof message).toBe("string");
    expect(message).toMatch(/Failed to parse config/);
  });

  it("loads JSON configs that start with a UTF-8 byte order mark", async () => {
    const configPath = await writeTempConfig(
      testDir,
      "config.json",
      `\uFEFF${JSON.stringify({
        provider: "openrouter",
        openrouter: {
          apiKey: "sk-test-key",
          baseUrl: "https://openrouter.ai/api/v1",
          model: "your-modelcard-id-here",
        },
      })}`,
    );
    const loadConfig = await importLoadConfig();

    const result = await loadConfig(configPath);

    expect(result.provider).toBe("openrouter");
  });

  // ─── YAML ──────────────────────────────────────────────────────────────────

  it("returns a friendly error for an empty YAML file (YAML.parse returns null)", async () => {
    // An empty YAML file is valid YAML that produces `null` — this is the bug.
    const configPath = await writeTempConfig(testDir, "config.yaml", "");
    const loadConfig = await importLoadConfig();

    let caughtError: Error | null = null;
    try {
      await loadConfig(configPath);
    } catch (e) {
      caughtError = e as Error;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toMatch(/Failed to parse config|empty|null/i);
  });

  it("error message for empty YAML includes the config file path", async () => {
    const configPath = await writeTempConfig(testDir, "config.yaml", "");
    const loadConfig = await importLoadConfig();

    let caughtError: Error | null = null;
    try {
      await loadConfig(configPath);
    } catch (e) {
      caughtError = e as Error;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toContain(configPath);
  });

  it("error message for empty YAML includes a recovery suggestion mentioning autohand --setup", async () => {
    const configPath = await writeTempConfig(testDir, "config.yaml", "");
    const loadConfig = await importLoadConfig();

    let caughtError: Error | null = null;
    try {
      await loadConfig(configPath);
    } catch (e) {
      caughtError = e as Error;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toMatch(/autohand --setup/i);
  });

  it("handles YAML with only comments (also produces null)", async () => {
    const configPath = await writeTempConfig(
      testDir,
      "config.yml",
      "# just a comment\n# nothing here\n",
    );
    const loadConfig = await importLoadConfig();

    let caughtError: Error | null = null;
    try {
      await loadConfig(configPath);
    } catch (e) {
      caughtError = e as Error;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toMatch(/autohand --setup/i);
  });

  it('handles YAML that parses to null explicitly ("null" string)', async () => {
    const configPath = await writeTempConfig(testDir, "config.yaml", "null\n");
    const loadConfig = await importLoadConfig();

    await expect(loadConfig(configPath)).rejects.toThrow(
      /Failed to parse config|empty|null/i,
    );
  });

  it("rejects duplicate config files in the same directory", async () => {
    const jsonPath = await writeTempConfig(
      testDir,
      "config.json",
      JSON.stringify({
        provider: "openrouter",
        openrouter: {
          apiKey: "sk-test-key",
          baseUrl: "https://openrouter.ai/api/v1",
          model: "your-modelcard-id-here",
        },
      }),
    );
    await writeTempConfig(testDir, "config.yaml", "provider: openrouter\n");

    const loadConfig = await importLoadConfig();

    await expect(loadConfig(jsonPath)).rejects.toThrow(
      /multiple config files|invalid settings|review/i,
    );
  });

  it("does not throw unhandled rejection for empty YAML (promise rejects cleanly)", async () => {
    const configPath = await writeTempConfig(testDir, "config.yaml", "");
    const loadConfig = await importLoadConfig();

    const result = loadConfig(configPath).then(
      () => "resolved",
      (e: Error) => e.message,
    );
    const message = await result;
    expect(typeof message).toBe("string");
    // Must not be 'resolved' — should be an error message
    expect(message).not.toBe("resolved");
  });

  // ─── normalizeConfig null guard ────────────────────────────────────────────

  it("normalizeConfig produces a descriptive error when called with a null-parsed config", async () => {
    // Simulate what happens when YAML returns null before our fix: parseConfigFile
    // returns null, loadConfig calls normalizeConfig(null).  After the fix,
    // parseConfigFile throws before we ever reach normalizeConfig — but we also
    // add a defensive guard inside normalizeConfig itself.
    //
    // We test this via a real YAML null file, which exercises the full path.
    const configPath = await writeTempConfig(testDir, "config.yaml", "null\n");
    const loadConfig = await importLoadConfig();

    let caughtError: Error | null = null;
    try {
      await loadConfig(configPath);
    } catch (e) {
      caughtError = e as Error;
    }

    expect(caughtError).not.toBeNull();
    // The error should be a proper Error, not an unhandled "Cannot read property of null"
    expect(caughtError).toBeInstanceOf(Error);
  });

  // ─── Valid configs still work ───────────────────────────────────────────────

  it("loads a valid JSON config without errors", async () => {
    const configPath = await writeTempConfig(
      testDir,
      "config.json",
      JSON.stringify({
        provider: "openrouter",
        openrouter: {
          apiKey: "sk-test-key",
          baseUrl: "https://openrouter.ai/api/v1",
          model: "your-modelcard-id-here",
        },
      }),
    );
    const loadConfig = await importLoadConfig();

    const result = await loadConfig(configPath);
    expect(result.provider).toBe("openrouter");
  });

  it("loads Bedrock settings from JSON", async () => {
    const configPath = await writeTempConfig(
      testDir,
      "config.json",
      JSON.stringify({
        provider: "bedrock",
        bedrock: {
          apiMode: "converse",
          authMode: "aws-credentials",
          profile: "enterprise-prod",
          region: "us-east-1",
          model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
        },
      }),
    );
    const loadConfig = await importLoadConfig();

    const result = await loadConfig(configPath);

    expect(result.provider).toBe("bedrock");
    expect(result.bedrock).toMatchObject({
      apiMode: "converse",
      authMode: "aws-credentials",
      profile: "enterprise-prod",
      region: "us-east-1",
      model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
    });
  });

  it("loads Bedrock settings from YAML", async () => {
    const configPath = await writeTempConfig(
      testDir,
      "config.yaml",
      [
        "provider: bedrock",
        "bedrock:",
        "  apiMode: openai-chat",
        "  authMode: bedrock-api-key",
        "  apiKey: bedrock-api-key",
        "  region: us-east-1",
        "  model: openai.gpt-oss-120b-1:0",
      ].join("\n"),
    );
    const loadConfig = await importLoadConfig();

    const result = await loadConfig(configPath);

    expect(result.provider).toBe("bedrock");
    expect(result.bedrock).toMatchObject({
      apiMode: "openai-chat",
      authMode: "bedrock-api-key",
      apiKey: "bedrock-api-key",
      region: "us-east-1",
      model: "openai.gpt-oss-120b-1:0",
    });
  });

  it("loads Bedrock settings from TOML", async () => {
    const configPath = await writeTempConfig(
      testDir,
      "config.toml",
      [
        'provider = "bedrock"',
        "",
        "[bedrock]",
        'apiMode = "openai-responses"',
        'authMode = "bedrock-api-key"',
        'apiKey = "bedrock-api-key"',
        'region = "us-west-2"',
        'endpoint = "https://bedrock-runtime.us-west-2.amazonaws.com/openai/v1"',
        'model = "openai.gpt-oss-120b-1:0"',
      ].join("\n"),
    );
    const loadConfig = await importLoadConfig();

    const result = await loadConfig(configPath);

    expect(result.provider).toBe("bedrock");
    expect(result.bedrock).toMatchObject({
      apiMode: "openai-responses",
      authMode: "bedrock-api-key",
      apiKey: "bedrock-api-key",
      region: "us-west-2",
      endpoint: "https://bedrock-runtime.us-west-2.amazonaws.com/openai/v1",
      model: "openai.gpt-oss-120b-1:0",
    });
  });

  it("creates new JSON config with on-by-default runtime helpers", async () => {
    const configPath = path.join(testDir, "config.json");
    const loadConfig = await importLoadConfig();

    const result = await loadConfig(configPath);
    const saved = await fse.readJson(configPath);

    expect(result.agent?.toolSelectionCache).toBe(true);
    expect(result.ui?.activityVerbsEnabled).toBe(true);
    expect(saved.agent.toolSelectionCache).toBe(true);
    expect(saved.ui.activityVerbsEnabled).toBe(true);
  });

  it("loads explicit tool selection cache opt-out from config", async () => {
    const configPath = await writeTempConfig(
      testDir,
      "config.json",
      JSON.stringify({
        provider: "openrouter",
        openrouter: {
          apiKey: "sk-test-key",
          baseUrl: "https://openrouter.ai/api/v1",
          model: "your-modelcard-id-here",
        },
        agent: {
          toolSelectionCache: false,
        },
      }),
    );
    const loadConfig = await importLoadConfig();

    const result = await loadConfig(configPath);

    expect(result.agent?.toolSelectionCache).toBe(false);
  });

  it("rejects non-boolean tool selection cache config", async () => {
    const configPath = await writeTempConfig(
      testDir,
      "config.json",
      JSON.stringify({
        provider: "openrouter",
        openrouter: {
          apiKey: "sk-test-key",
          baseUrl: "https://openrouter.ai/api/v1",
          model: "your-modelcard-id-here",
        },
        agent: {
          toolSelectionCache: "yes",
        },
      }),
    );
    const loadConfig = await importLoadConfig();

    await expect(loadConfig(configPath)).rejects.toThrow(/agent\.toolSelectionCache must be boolean/);
  });

  it("loads DeepSeek config and applies the default DeepSeek base URL", async () => {
    const configPath = await writeTempConfig(
      testDir,
      "config.json",
      JSON.stringify({
        provider: "deepseek",
        deepseek: {
          apiKey: "deepseek-api-key-12345",
          model: "deepseek-v4-flash",
        },
      }),
    );
    const { getProviderConfig, loadConfig } = await importConfigModule();

    const result = await loadConfig(configPath);
    const providerConfig = getProviderConfig(result, "deepseek");

    expect(result.provider).toBe("deepseek");
    expect(providerConfig?.baseUrl).toBe("https://api.deepseek.com");
  });

  it("loads a valid YAML config without errors", async () => {
    const yamlContent = `provider: openrouter\nopenrouter:\n  apiKey: sk-test-key\n  baseUrl: https://openrouter.ai/api/v1\n  model: your-modelcard-id-here\n`;
    const configPath = await writeTempConfig(
      testDir,
      "config.yaml",
      yamlContent,
    );
    const loadConfig = await importLoadConfig();

    const result = await loadConfig(configPath);
    expect(result.provider).toBe("openrouter");
  });

  it("loads a valid TOML config without errors", async () => {
    const tomlContent = [
      'provider = "openrouter"',
      '',
      '[openrouter]',
      'apiKey = "sk-test-key"',
      'baseUrl = "https://openrouter.ai/api/v1"',
      'model = "your-modelcard-id-here"',
      '',
      '[workspace]',
      'allowDangerousOps = false',
      '',
      '[ui]',
      'promptSuggestions = true',
    ].join("\n");
    const configPath = await writeTempConfig(testDir, "config.toml", tomlContent);
    const loadConfig = await importLoadConfig();

    const result = await loadConfig(configPath);

    expect(result.provider).toBe("openrouter");
    expect(result.openrouter?.apiKey).toBe("sk-test-key");
    expect(result.workspace?.allowDangerousOps).toBe(false);
    expect(result.ui?.promptSuggestions).toBe(true);
  });

  it("registers inline custom themes from config before theme initialization", async () => {
    const configPath = await writeTempConfig(
      testDir,
      "config.json",
      JSON.stringify({
        provider: "openrouter",
        openrouter: {
          apiKey: "sk-test-key",
          model: "your-modelcard-id-here",
        },
        ui: {
          theme: "company",
          customThemes: {
            company: {
              colors: {
                accent: "#123456",
              },
            },
          },
        },
      }),
    );
    const loadConfig = await importLoadConfig();
    const { getTheme } = await import("../../src/ui/theme/index.js");

    const result = await loadConfig(configPath);

    expect(result.ui?.theme).toBe("company");
    expect(getTheme().name).toBe("company");
    expect(getTheme().colors.accent).toBe("#123456");
  });

  it("saves TOML config back as TOML when loaded from config.toml", async () => {
    const configPath = await writeTempConfig(
      testDir,
      "config.toml",
      [
        'provider = "openrouter"',
        '',
        '[openrouter]',
        'apiKey = "sk-test-key"',
        'model = "anthropic/claude-4-sonnet"',
      ].join("\n"),
    );
    const { loadConfig, saveConfig } = await importConfigModule();

    const config = await loadConfig(configPath);
    config.ui = { ...config.ui, theme: "dark", promptSuggestions: false };
    await saveConfig(config);

    const saved = await fse.readFile(configPath, "utf8");
    expect(saved).toContain('provider = "openrouter"');
    expect(saved).toContain("[openrouter]");
    expect(saved).toContain('apiKey = "sk-test-key"');
    expect(saved).toContain("[ui]");
    expect(saved).toContain("promptSuggestions = false");
    expect(saved.trim().startsWith("{")).toBe(false);
  });

  // ─── EACCES / EEXIST handling ─────────────────────────────────────────────

  it("throws a clear error when config dir is not writable (EACCES)", async () => {
    // Create a read-only dir and point config at a subdir
    const readonlyDir = path.join(testDir, "readonly");
    await fse.ensureDir(readonlyDir);
    await fse.chmod(readonlyDir, 0o444);

    const configPath = path.join(readonlyDir, "subdir", "config.json");
    const loadConfig = await importLoadConfig();

    let caughtError: Error | null = null;
    try {
      await loadConfig(configPath);
    } catch (e) {
      caughtError = e as Error;
    }

    // Restore permissions for cleanup
    await fse.chmod(readonlyDir, 0o755);

    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toMatch(
      /permission denied|EACCES|Cannot create/i,
    );
  });
});
