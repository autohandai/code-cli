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
  VertexAISettings,
  BedrockSettings,
  BedrockApiMode,
  BedrockAuthMode,
} from "./types.js";
import { AUTOHAND_FILES } from "./constants.js";
import { autoInitTheme, configureThemeSources, themeExists } from "./ui/theme/index.js";
import { loadLocalProjectSettings, type LocalProjectSettings } from "./permissions/localProjectPermissions.js";
import { isAwsBedrockProviderEnabled } from "./features/featureRegistry.js";

const DEFAULT_CONFIG_PATH = AUTOHAND_FILES.configJson;
const TOML_CONFIG_PATH = AUTOHAND_FILES.configToml;
const YAML_CONFIG_PATH = AUTOHAND_FILES.configYaml;
const YML_CONFIG_PATH = AUTOHAND_FILES.configYml;
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OLLAMA_URL = "http://localhost:11434";
const DEFAULT_LLAMACPP_URL = "http://localhost:8080";
const DEFAULT_OPENAI_URL = "https://api.openai.com/v1";
const DEFAULT_MLX_URL = "http://localhost:8080";
const DEFAULT_LLMGATEWAY_URL = "https://api.llmgateway.io/v1";
const DEFAULT_ZAI_URL = "https://api.z.ai/api/paas/v4";
const DEFAULT_DEEPSEEK_URL = "https://api.deepseek.com";
const DEFAULT_BEDROCK_REGION = "us-east-1";

interface LegacyConfigShape {
  api_key?: string;
  base_url?: string;
  model?: string;
  max_tokens?: number;
  dry_run?: boolean;
  log_level?: string;
  [key: string]: unknown;
}

type TomlPrimitive = string | number | boolean;
type TomlValue = TomlPrimitive | TomlPrimitive[] | TomlObject | TomlObject[];
type TomlObject = { [key: string]: TomlValue };

function normalizeProviderName(provider: unknown): ProviderName | undefined {
  if (provider === undefined) {
    return undefined;
  }

  if (provider === "vertex") {
    return "vertexai";
  }

  const validProviders: readonly ProviderName[] = [
    "openrouter",
    "ollama",
    "llamacpp",
    "openai",
    "mlx",
    "llmgateway",
    "azure",
    "zai",
    "vertexai",
    "xai",
    "cerebras",
    "nvidia",
    "deepseek",
    "bedrock",
  ];

  if (typeof provider === "string" && validProviders.includes(provider as ProviderName)) {
    return provider as ProviderName;
  }

  return undefined;
}

export function getDefaultConfigPath(): string {
  return DEFAULT_CONFIG_PATH;
}

/**
 * Detect config file path - checks for TOML/YAML first, then JSON
 */
async function detectConfigPath(customPath?: string): Promise<string> {
  if (customPath) {
    return path.resolve(customPath);
  }

  const envPath = process.env.AUTOHAND_CONFIG;
  if (envPath) {
    return path.resolve(envPath);
  }

  // Check for human-editable configs first (user preference)
  if (await fs.pathExists(TOML_CONFIG_PATH)) {
    return TOML_CONFIG_PATH;
  }
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
  for (const filename of ["config.json", "config.toml", "config.yaml", "config.yml"]) {
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

function isTomlFile(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === ".toml";
}

function stripTomlComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inDouble && char === "\\") {
      escaped = true;
      continue;
    }
    if (!inDouble && char === "'") {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && char === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && char === "#") {
      return line.slice(0, i).trim();
    }
  }

  return line.trim();
}

function splitTomlPath(input: string): string[] {
  return input
    .split(".")
    .map((part) => part.trim().replace(/^"(.*)"$/, "$1"))
    .filter(Boolean);
}

function parseTomlValue(raw: string): TomlValue {
  const value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    if (value.startsWith('"')) {
      try {
        return JSON.parse(value) as string;
      } catch {
        return value.slice(1, -1);
      }
    }
    return value.slice(1, -1);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner
      .split(",")
      .map((entry) => parseTomlValue(entry.trim()))
      .filter((entry): entry is TomlPrimitive => typeof entry !== "object");
  }
  return value;
}

function getOrCreateTomlSection(root: TomlObject, pathParts: string[]): TomlObject {
  let current = root;
  for (const part of pathParts) {
    const existing = current[part];
    if (Array.isArray(existing)) {
      const last = existing[existing.length - 1];
      if (last && typeof last === "object" && !Array.isArray(last)) {
        current = last;
        continue;
      }
    }
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      current[part] = {};
    }
    current = current[part] as TomlObject;
  }
  return current;
}

function getOrCreateTomlArraySection(root: TomlObject, pathParts: string[]): TomlObject {
  const parent = getOrCreateTomlSection(root, pathParts.slice(0, -1));
  const key = pathParts[pathParts.length - 1];
  const existing = parent[key];
  if (!Array.isArray(existing)) {
    parent[key] = [];
  }
  const section: TomlObject = {};
  (parent[key] as TomlObject[]).push(section);
  return section;
}

function parseTomlConfig(content: string): AutohandConfig | LegacyConfigShape {
  const root: TomlObject = {};
  let current = root;
  let hasData = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine);
    if (!line) continue;

    const arraySection = line.match(/^\[\[([^\]]+)]]$/);
    if (arraySection) {
      current = getOrCreateTomlArraySection(root, splitTomlPath(arraySection[1]));
      hasData = true;
      continue;
    }

    const section = line.match(/^\[([^\]]+)]$/);
    if (section) {
      current = getOrCreateTomlSection(root, splitTomlPath(section[1]));
      hasData = true;
      continue;
    }

    const kv = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!kv) {
      throw new Error(`Invalid TOML line: ${rawLine.trim()}`);
    }
    current[kv[1]] = parseTomlValue(kv[2]);
    hasData = true;
  }

  if (!hasData) {
    throw new Error(
      `Config file is empty or contains no valid data. ` +
        `You can fix this by editing the file, or delete it and run 'autohand --setup' to recreate.`,
    );
  }

  return root as AutohandConfig | LegacyConfigShape;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatTomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
}

function formatTomlValue(value: unknown): string | null {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value) && value.every((entry) => !isPlainObject(entry) && !Array.isArray(entry))) {
    return `[${value.map((entry) => formatTomlValue(entry)).filter((entry): entry is string => entry !== null).join(", ")}]`;
  }
  return null;
}

function stringifyTomlObject(data: Record<string, unknown>): string {
  const lines: string[] = [];

  const writeSection = (sectionPath: string[], section: Record<string, unknown>): void => {
    const scalarEntries = Object.entries(section).filter(([, value]) => formatTomlValue(value) !== null);
    if (sectionPath.length > 0) {
      if (lines.length > 0) lines.push("");
      lines.push(`[${sectionPath.map(formatTomlKey).join(".")}]`);
    }
    for (const [key, value] of scalarEntries) {
      const formatted = formatTomlValue(value);
      if (formatted !== null) {
        lines.push(`${formatTomlKey(key)} = ${formatted}`);
      }
    }

    for (const [key, value] of Object.entries(section)) {
      if (isPlainObject(value)) {
        writeSection([...sectionPath, key], value);
      } else if (Array.isArray(value) && value.every(isPlainObject)) {
        for (const item of value) {
          if (lines.length > 0) lines.push("");
          const childPath = [...sectionPath, key];
          lines.push(`[[${childPath.map(formatTomlKey).join(".")}]]`);
          for (const [childKey, childValue] of Object.entries(item)) {
            const formatted = formatTomlValue(childValue);
            if (formatted !== null) {
              lines.push(`${formatTomlKey(childKey)} = ${formatted}`);
            }
          }
          for (const [childKey, childValue] of Object.entries(item)) {
            if (isPlainObject(childValue)) {
              writeSection([...childPath, childKey], childValue);
            }
          }
        }
      }
    }
  };

  writeSection([], data);
  return `${lines.join("\n")}\n`;
}

/**
 * Parse config file based on extension
 */
async function parseConfigFile(
  configPath: string,
): Promise<AutohandConfig | LegacyConfigShape> {
  const rawContent = await fs.readFile(configPath, "utf8");
  const content = rawContent.charCodeAt(0) === 0xfeff
    ? rawContent.slice(1)
    : rawContent;

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

  if (isTomlFile(configPath)) {
    return parseTomlConfig(content);
  }

  return JSON.parse(content) as AutohandConfig | LegacyConfigShape;
}

export async function loadConfig(customPath?: string, workspaceRoot?: string): Promise<LoadedConfig> {
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
        model: "openrouter/auto",
      },
      workspace: {
        defaultRoot: process.cwd(),
        allowDangerousOps: false,
      },
      ui: {
        theme: "dark",
        autoConfirm: false,
        silentToolOutput: false,
        activityVerbsEnabled: true,
        promptSuggestions: true,
      },
      telemetry: {
        enabled: false,
      },
      autoReport: {
        enabled: true,
      },
      agent: {
        toolSelectionCache: true,
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

  // Load workspace-specific settings if workspaceRoot is provided
  let workspaceSettings: LocalProjectSettings | null = null;
  if (workspaceRoot) {
    workspaceSettings = await loadLocalProjectSettings(workspaceRoot);
  }

  // Merge workspace settings with global config (workspace takes precedence)
  const withWorkspace = mergeWorkspaceSettings(normalized, workspaceSettings);

  // Merge environment variables for API settings
  const withEnv = mergeEnvVariables(withWorkspace);

  configureThemeSources({ inlineThemes: withEnv.ui?.customThemes });

  validateConfig(withEnv, configPath);

  // Initialize theme from config
  const themeName = withEnv.ui?.theme || "dark";
  autoInitTheme(themeName);

  return { ...withEnv, configPath, isNewConfig };
}

/**
 * Merge workspace settings with global config
 * Workspace settings take precedence over global settings
 */
function mergeWorkspaceSettings(
  globalConfig: AutohandConfig,
  workspaceSettings: LocalProjectSettings | null
): AutohandConfig {
  if (!workspaceSettings) {
    return globalConfig;
  }

  // Deep merge where workspace settings override global settings
  const merged: AutohandConfig = { ...globalConfig };

  // Override provider if set in workspace
  if (workspaceSettings.provider !== undefined) {
    merged.provider = workspaceSettings.provider;
  }

  // Override model if set in workspace
  if (workspaceSettings.model !== undefined) {
    // Update the model in the provider-specific config
    const provider = workspaceSettings.provider || merged.provider;
    if (provider && merged[provider]) {
      (merged[provider] as ProviderSettings).model = workspaceSettings.model;
    }
  }

  // Merge agent settings
  if (workspaceSettings.agent) {
    merged.agent = {
      ...merged.agent,
      ...workspaceSettings.agent,
    };
  }

  // Merge network settings
  if (workspaceSettings.network) {
    merged.network = {
      ...merged.network,
      ...workspaceSettings.network,
    };
  }

  // Merge telemetry settings
  if (workspaceSettings.telemetry) {
    merged.telemetry = {
      ...merged.telemetry,
      ...workspaceSettings.telemetry,
    };
  }

  // Merge permissions settings
  if (workspaceSettings.permissions) {
    merged.permissions = {
      ...merged.permissions,
      ...workspaceSettings.permissions,
    };
  }

  return merged;
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

  const envRegion = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (envRegion && config.bedrock) {
    config = {
      ...config,
      bedrock: {
        ...config.bedrock,
        region: config.bedrock.region || envRegion,
      },
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
    const provider = normalizeProviderName(config.provider) ?? "openrouter";
    return { ...config, provider };
  }

  if (isLegacyConfig(config)) {
    return {
      provider: "openrouter",
      openrouter: {
        apiKey: config.api_key ?? "replace-me",
        baseUrl: config.base_url ?? DEFAULT_BASE_URL,
        model: "anthropic/claude-4-sonnet",
      },
      workspace: {
        defaultRoot: process.cwd(),
        allowDangerousOps: false,
      },
      ui: {
        autoConfirm: config.dry_run ?? false,
        theme: "dark",
        silentToolOutput: false,
        activityVerbsEnabled: true,
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
    typeof (config as AutohandConfig).zai === "object" ||
    typeof (config as AutohandConfig).vertexai === "object" ||
    typeof (config as AutohandConfig).xai === "object" ||
    typeof (config as AutohandConfig).cerebras === "object" ||
    typeof (config as AutohandConfig).nvidia === "object" ||
    typeof (config as AutohandConfig).deepseek === "object" ||
    typeof (config as AutohandConfig).bedrock === "object"
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
    if (
      config.ui.activityVerbsEnabled !== undefined &&
      typeof config.ui.activityVerbsEnabled !== "boolean"
    ) {
      throw new Error(`ui.activityVerbsEnabled must be boolean in ${configPath}`);
    }
  }

  // Validate agent config
  if (config.agent) {
    if (
      config.agent.toolSelectionCache !== undefined &&
      typeof config.agent.toolSelectionCache !== "boolean"
    ) {
      throw new Error(`agent.toolSelectionCache must be boolean in ${configPath}`);
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
  if (chosen === "bedrock" && !isAwsBedrockProviderEnabled(config)) {
    return null;
  }

  const configByProvider: Record<ProviderName, ProviderSettings | undefined> = {
    openrouter: config.openrouter,
    ollama: config.ollama,
    llamacpp: config.llamacpp,
    openai: config.openai,
    mlx: config.mlx,
    llmgateway: config.llmgateway,
    azure: config.azure,
    zai: config.zai,
    vertexai: config.vertexai,
    xai: config.xai,
    cerebras: config.cerebras,
    nvidia: config.nvidia,
    deepseek: config.deepseek,
    bedrock: config.bedrock,
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
    chosen === "zai" ||
    chosen === "nvidia" ||
    chosen === "deepseek"
  ) {
    const { apiKey, model } = entry as ProviderSettings;
    if (!apiKey || apiKey === "replace-me" || !model) {
      return null; // Incomplete config
    }
  } else if (chosen === "vertexai") {
    const { authToken, projectId, model } = entry as VertexAISettings;
    if (!authToken || !projectId || !model) {
      return null; // Incomplete config
    }
  } else if (chosen === "bedrock") {
    return normalizeBedrockProviderConfig(entry as BedrockSettings);
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
  if (provider === "deepseek") return DEFAULT_DEEPSEEK_URL;
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
    case "nvidia":
      return "https://integrate.api.nvidia.com/v1";
    case "bedrock":
      return `https://bedrock-runtime.${DEFAULT_BEDROCK_REGION}.amazonaws.com`;
    default:
      return undefined;
  }
}

function normalizeBedrockProviderConfig(
  entry: BedrockSettings,
): BedrockSettings | null {
  const model = entry.model?.trim();
  const region =
    entry.region?.trim() ||
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    DEFAULT_BEDROCK_REGION;
  const apiMode: BedrockApiMode = entry.apiMode ?? "converse";
  const authMode: BedrockAuthMode =
    entry.authMode ?? (apiMode === "converse" ? "aws-credentials" : "bedrock-api-key");
  const endpoint =
    entry.endpoint?.replace(/\/+$/, "") ??
    (apiMode === "converse"
      ? `https://bedrock-runtime.${region}.amazonaws.com`
      : `https://bedrock-runtime.${region}.amazonaws.com/openai/v1`);

  if (!model || !region) {
    return null;
  }

  if (authMode === "bedrock-api-key" && (!entry.apiKey || entry.apiKey === "replace-me")) {
    return null;
  }

  return {
    ...entry,
    model,
    region,
    apiMode,
    authMode,
    endpoint,
  };
}

export async function saveConfig(config: LoadedConfig): Promise<void> {
  const { configPath, ...data } = config;
  delete (data as Partial<LoadedConfig>).isNewConfig;

  if (isYamlFile(configPath)) {
    const yamlContent = YAML.stringify(data, { indent: 2 });
    await fs.writeFile(configPath, yamlContent, "utf8");
  } else if (isTomlFile(configPath)) {
    await fs.writeFile(configPath, stringifyTomlObject(data as Record<string, unknown>), "utf8");
  } else {
    await fs.writeJson(configPath, data, { spaces: 2 });
  }
}
