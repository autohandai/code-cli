/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from "fs-extra";
import path from "node:path";
import YAML from "yaml";
import type {
  AutohandConfig,
  LoadedConfig,
  ProviderName,
  ProviderSettings,
  AzureSettings,
  OpenAISettings,
} from "./types.js";
import { AUTOHAND_FILES } from "./constants.js";
import { autoInitTheme, themeExists } from "./ui/theme/index.js";

const DEFAULT_CONFIG_PATH = AUTOHAND_FILES.configJson;
const YAML_CONFIG_PATH = AUTOHAND_FILES.configYaml;
const YML_CONFIG_PATH = AUTOHAND_FILES.configYml;
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OLLAMA_URL = "http://localhost:11434";
const DEFAULT_LLAMACPP_URL = "http://localhost:8080";
const DEFAULT_OPENAI_URL = "https://api.openai.com/v1";
const DEFAULT_MLX_URL = "http://localhost:8080";
const DEFAULT_LLMGATEWAY_URL = "https://api.llmgateway.io/v1";
const DEFAULT_ZAI_URL = "https://api.z.ai/api/paas/v4";

interface LegacyConfigShape {
  api_key?: string;
  base_url?: string;
  model?: string;
  max_tokens?: number;
  dry_run?: boolean;
  log_level?: string;
  [key: string]: unknown;
}

export function getDefaultConfigPath(): string {
  return DEFAULT_CONFIG_PATH;
}

/**
 * Detect config file path - checks for YAML first, then JSON
 */
async function detectConfigPath(customPath?: string): Promise<string> {
  if (customPath) {
    return path.resolve(customPath);
  }

  const envPath = process.env.AUTOHAND_CONFIG;
  if (envPath) {
    return path.resolve(envPath);
  }

  // Check for YAML configs first (user preference)
  if (await fs.pathExists(YAML_CONFIG_PATH)) {
    return YAML_CONFIG_PATH;
  }
  if (await fs.pathExists(YML_CONFIG_PATH)) {
    return YML_CONFIG_PATH;
  }

  // Default to JSON
  return DEFAULT_CONFIG_PATH;
}

/**
 * Check for existence of config files in a directory
 */
async function checkConfigFilesExist(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const filename of ["config.json", "config.yaml", "config.yml"]) {
    const candidate = path.join(dir, filename);
    if (await fs.pathExists(candidate)) {
      files.push(filename);
    }
  }
  return files.sort();
}

/**
 * Check if path is a YAML file
 */
function isYamlFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".yaml" || ext === ".yml";
}

/**
 * Parse config file based on extension
 */
async function parseConfigFile(
  configPath: string,
): Promise<AutohandConfig | LegacyConfigShape> {
  const content = await fs.readFile(configPath, "utf8");

  if (isYamlFile(configPath)) {
    const parsed = YAML.parse(content) as
      | AutohandConfig
      | LegacyConfigShape
      | null;
    if (parsed === null || parsed === undefined) {
      throw new Error(
        `Config file is empty or contains no valid data. ` +
          `You can fix this by editing ${configPath}, or delete it and run 'autohand --setup' to recreate.`,
      );
    }
    return parsed;
  }

  return JSON.parse(content) as AutohandConfig | LegacyConfigShape;
}

export async function loadConfig(customPath?: string): Promise<LoadedConfig> {
  const configPath = await detectConfigPath(customPath);

  // Check for duplicate config files in the same directory.
  const configDir = path.dirname(configPath);
  const configFiles = await checkConfigFilesExist(configDir);
  if (configFiles.length > 1) {
    throw new Error(
      `Multiple config files found in ${configDir} (${configFiles.join(", ")}). ` +
        `Only one config file is allowed. Please review and remove the duplicate, ` +
        `or set the AUTOHAND_CONFIG environment variable to specify which one to use.`,
    );
  }

  await fs.ensureDir(path.dirname(configPath));

  let isNewConfig = false;

  if (!(await fs.pathExists(configPath))) {
    const defaultConfig: AutohandConfig = {
      provider: "openrouter",
      openrouter: {
        apiKey: "",
        baseUrl: "https://openrouter.ai/api/v1",
        model: "anthropic/claude-sonnet-4-20250514",
      },
      workspace: {
        defaultRoot: process.cwd(),
        allowDangerousOps: false,
      },
      ui: {
        theme: "dark",
        autoConfirm: false,
        promptSuggestions: true,
      },
      telemetry: {
        enabled: false,
      },
      autoReport: {
        enabled: true,
      },
    };

    // Create config silently with safe defaults
    await fs.writeJson(configPath, defaultConfig, { spaces: 2 });
    isNewConfig = true;
  }

  let parsed: AutohandConfig | LegacyConfigShape;
  try {
    parsed = await parseConfigFile(configPath);
  } catch (error) {
    const originalMessage = (error as Error).message;
    // If the error already contains a recovery suggestion (e.g. from null-YAML guard),
    // surface it directly so the path context is still prepended.
    const alreadyHasSuggestion = originalMessage.includes("autohand --setup");
    const suggestion = alreadyHasSuggestion
      ? ""
      : ` You can fix this by editing ${configPath}, or delete it and run 'autohand --setup' to recreate.`;
    throw new Error(
      `Failed to parse config at ${configPath}: ${originalMessage}${suggestion}`,
    );
  }
  const normalized = normalizeConfig(parsed);

  // Merge environment variables for API settings
  const withEnv = mergeEnvVariables(normalized);

  validateConfig(withEnv, configPath);

  // Initialize theme from config
  const themeName = withEnv.ui?.theme || "dark";
  autoInitTheme(themeName);

  return { ...withEnv, configPath, isNewConfig };
}

/**
 * Merge environment variables into config
 * Env vars take precedence over config file values
 */
function mergeEnvVariables(config: AutohandConfig): AutohandConfig {
  config = {
    ...config,
    api: {
      baseUrl:
        process.env.AUTOHAND_API_URL ||
        config.api?.baseUrl ||
        "https://api.autohand.ai",
      companySecret:
        process.env.AUTOHAND_SECRET || config.api?.companySecret || "",
    },
  };

  // Resolve Azure env vars
  if (
    process.env.AZURE_OPENAI_KEY ||
    process.env.AZURE_OPENAI_ENDPOINT ||
    process.env.AZURE_OPENAI_DEPLOYMENT
  ) {
    const azureEnv: Record<string, string | undefined> = {
      apiKey: process.env.AZURE_OPENAI_KEY,
      baseUrl: process.env.AZURE_OPENAI_ENDPOINT,
      deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT,
      apiVersion: process.env.AZURE_OPENAI_API_VERSION,
      tenantId: process.env.AZURE_TENANT_ID,
      clientId: process.env.AZURE_CLIENT_ID,
      clientSecret: process.env.AZURE_CLIENT_SECRET,
    };

    const existing = config.azure ?? {
      model: azureEnv.deploymentName ?? "gpt-4o",
    };
    config = {
      ...config,
      azure: {
        ...existing,
        ...(azureEnv.apiKey && { apiKey: azureEnv.apiKey }),
        ...(azureEnv.baseUrl && { baseUrl: azureEnv.baseUrl }),
        ...(azureEnv.deploymentName && {
          deploymentName: azureEnv.deploymentName,
        }),
        ...(azureEnv.apiVersion && { apiVersion: azureEnv.apiVersion }),
        ...(azureEnv.tenantId && { tenantId: azureEnv.tenantId }),
        ...(azureEnv.clientId && { clientId: azureEnv.clientId }),
        ...(azureEnv.clientSecret && { clientSecret: azureEnv.clientSecret }),
      } as AzureSettings,
    };
  }

  return config;
}

function normalizeConfig(
  config: AutohandConfig | LegacyConfigShape,
): AutohandConfig {
  if (config === null || config === undefined || typeof config !== "object") {
    throw new Error(
      `Config file produced an invalid value (got ${config === null ? "null" : typeof config}). ` +
        `Delete the config file and run 'autohand --setup' to recreate it.`,
    );
  }

  if (isModernConfig(config)) {
    const provider = config.provider ?? "openrouter";
    return { provider, ...config };
  }

  if (isLegacyConfig(config)) {
    return {
      provider: "openrouter",
      openrouter: {
        apiKey: config.api_key ?? "replace-me",
        baseUrl: config.base_url ?? DEFAULT_BASE_URL,
        model: config.model ?? "anthropic/claude-sonnet-4-20250514",
      },
      workspace: {
        defaultRoot: process.cwd(),
        allowDangerousOps: false,
      },
      ui: {
        autoConfirm: config.dry_run ?? false,
        theme: "dark",
        promptSuggestions: true,
      },
    };
  }

  return config as AutohandConfig;
}

function isModernConfig(
  config: AutohandConfig | LegacyConfigShape,
): config is AutohandConfig {
  return (
    typeof (config as AutohandConfig).openrouter === "object" ||
    typeof (config as AutohandConfig).ollama === "object" ||
    typeof (config as AutohandConfig).llamacpp === "object" ||
    typeof (config as AutohandConfig).openai === "object" ||
    typeof (config as AutohandConfig).mlx === "object" ||
    typeof (config as AutohandConfig).azure === "object" ||
    typeof (config as AutohandConfig).zai === "object"
  );
}

function isLegacyConfig(
  config: AutohandConfig | LegacyConfigShape,
): config is LegacyConfigShape {
  return typeof (config as LegacyConfigShape).api_key === "string";
}

function validateConfig(config: AutohandConfig, configPath: string): void {
  if (config.workspace) {
    if (
      config.workspace.defaultRoot &&
      typeof config.workspace.defaultRoot !== "string"
    ) {
      throw new Error(
        `workspace.defaultRoot must be a string in ${configPath}`,
      );
    }
    if (
      config.workspace.allowDangerousOps !== undefined &&
      typeof config.workspace.allowDangerousOps !== "boolean"
    ) {
      throw new Error(
        `workspace.allowDangerousOps must be boolean in ${configPath}`,
      );
    }
  }

  if (config.ui) {
    if (config.ui.theme && typeof config.ui.theme !== "string") {
      throw new Error(`ui.theme must be a string in ${configPath}`);
    }
    // Theme validation is lenient — unknown themes fall back to dark at init time.
    // This avoids crashes when a Ghostty or custom theme was saved but is no longer available.
    if (
      config.ui.theme &&
      typeof config.ui.theme === "string" &&
      !themeExists(config.ui.theme)
    ) {
      console.warn(
        `Theme '${config.ui.theme}' not found — falling back to default.`,
      );
    }
    if (
      config.ui.autoConfirm !== undefined &&
      typeof config.ui.autoConfirm !== "boolean"
    ) {
      throw new Error(`ui.autoConfirm must be boolean in ${configPath}`);
    }
    if (
      config.ui.promptSuggestions !== undefined &&
      typeof config.ui.promptSuggestions !== "boolean"
    ) {
      throw new Error(`ui.promptSuggestions must be boolean in ${configPath}`);
    }
  }

  // Validate MCP config
  if (config.mcp) {
    if (
      config.mcp.enabled !== undefined &&
      typeof config.mcp.enabled !== "boolean"
    ) {
      throw new Error(`mcp.enabled must be boolean in ${configPath}`);
    }
    if (config.mcp.servers !== undefined) {
      if (!Array.isArray(config.mcp.servers)) {
        throw new Error(`mcp.servers must be an array in ${configPath}`);
      }
      for (const server of config.mcp.servers) {
        if (!server.name || typeof server.name !== "string") {
          throw new Error(
            `mcp.servers[].name must be a non-empty string in ${configPath}`,
          );
        }
        if (!["stdio", "sse", "http"].includes(server.transport)) {
          throw new Error(
            `mcp.servers[].transport must be 'stdio', 'sse', or 'http' in ${configPath}`,
          );
        }
        if (
          server.transport === "stdio" &&
          (!server.command || typeof server.command !== "string")
        ) {
          throw new Error(
            `mcp.servers[].command is required for stdio transport in ${configPath}`,
          );
        }
        if (
          (server.transport === "sse" || server.transport === "http") &&
          (!server.url || typeof server.url !== "string")
        ) {
          throw new Error(
            `mcp.servers[].url is required for ${server.transport} transport in ${configPath}`,
          );
        }
      }
    }
  }

  // Validate external agents config
  if (config.externalAgents) {
    if (
      config.externalAgents.enabled !== undefined &&
      typeof config.externalAgents.enabled !== "boolean"
    ) {
      throw new Error(
        `externalAgents.enabled must be boolean in ${configPath}`,
      );
    }
    if (config.externalAgents.paths !== undefined) {
      if (!Array.isArray(config.externalAgents.paths)) {
        throw new Error(
          `externalAgents.paths must be an array in ${configPath}`,
        );
      }
      for (const p of config.externalAgents.paths) {
        if (typeof p !== "string") {
          throw new Error(
            `externalAgents.paths must contain only strings in ${configPath}`,
          );
        }
      }
    }
  }
}

export function resolveWorkspaceRoot(
  config: LoadedConfig,
  requestedPath?: string,
): string {
  // Priority: 1. Explicit --path flag, 2. Current directory, 3. Config default
  const candidate =
    requestedPath ?? process.cwd() ?? config.workspace?.defaultRoot;
  return path.resolve(candidate);
}

export function getProviderConfig(
  config: AutohandConfig,
  provider?: ProviderName,
): ProviderSettings | null {
  const chosen = provider ?? config.provider ?? "openrouter";
  const configByProvider: Record<ProviderName, ProviderSettings | undefined> = {
    openrouter: config.openrouter,
    ollama: config.ollama,
    llamacpp: config.llamacpp,
    openai: config.openai,
    mlx: config.mlx,
    llmgateway: config.llmgateway,
    azure: config.azure,
    zai: config.zai,
  };

  const entry = configByProvider[chosen];
  if (!entry) {
    // Return null instead of throwing - let the caller handle unconfigured state
    return null;
  }

  if (chosen === "openai") {
    const openAIEntry = entry as OpenAISettings;
    if (!openAIEntry.model) {
      return null;
    }

    if (openAIEntry.authMode === "chatgpt") {
      if (
        !openAIEntry.chatgptAuth?.accessToken ||
        !openAIEntry.chatgptAuth?.accountId
      ) {
        return null;
      }
    } else {
      if (!openAIEntry.apiKey || openAIEntry.apiKey === "replace-me") {
        return null;
      }
    }
  } else if (
    chosen === "openrouter" ||
    chosen === "llmgateway" ||
    chosen === "zai"
  ) {
    const { apiKey, model } = entry as ProviderSettings;
    if (!apiKey || apiKey === "replace-me" || !model) {
      return null; // Incomplete config
    }
  } else {
    if (chosen === "llamacpp") {
      return {
        ...entry,
        model: entry.model ?? "local",
        baseUrl: entry.baseUrl ?? defaultBaseUrlFor(chosen, entry.port),
      };
    }

    // Validate other providers
    if (!entry.model) {
      return null; // Incomplete config
    }
  }

  return {
    ...entry,
    baseUrl: entry.baseUrl ?? defaultBaseUrlFor(chosen, entry.port),
  };
}

function defaultBaseUrlFor(
  provider: ProviderName,
  port?: number,
): string | undefined {
  if (provider === "openrouter") return DEFAULT_BASE_URL;
  if (provider === "llmgateway") return DEFAULT_LLMGATEWAY_URL;
  if (provider === "zai") return DEFAULT_ZAI_URL;
  const p = port ? port.toString() : undefined;
  switch (provider) {
    case "ollama":
      return p ? `http://localhost:${p}` : DEFAULT_OLLAMA_URL;
    case "llamacpp":
      return p ? `http://localhost:${p}` : DEFAULT_LLAMACPP_URL;
    case "openai":
      return DEFAULT_OPENAI_URL;
    case "mlx":
      return p ? `http://localhost:${p}` : DEFAULT_MLX_URL;
    default:
      return undefined;
  }
}

export async function saveConfig(config: LoadedConfig): Promise<void> {
  const { configPath, ...data } = config;

  if (isYamlFile(configPath)) {
    const yamlContent = YAML.stringify(data, { indent: 2 });
    await fs.writeFile(configPath, yamlContent, "utf8");
  } else {
    await fs.writeJson(configPath, data, { spaces: 2 });
  }
}
