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
  BuiltInProviderName,
  LoadedConfig,
  ProviderName,
  ExtensionProviderId,
  ProviderSettings,
  AzureSettings,
  OpenAISettings,
  XAISettings,
  VertexAISettings,
  BedrockSettings,
  BedrockApiMode,
  BedrockAuthMode,
  AutohandAISettings,
  HookDefinition,
  HooksSettings,
  McpServerConfigEntry,
  McpSettings,
  WorkspaceOverlayObjectKey,
  WorkspaceOverlaySnapshot,
  WorkspaceTrustState,
} from "./types.js";
import { AUTOHAND_FILES, AUTOHAND_HOME, PROJECT_DIR_NAME } from "./constants.js";
import { KEYBINDING_PROFILE_IDS, isKeybindingProfileId } from "./keybindings/profiles.js";
import { hookIdentifier } from "./core/hookEvents.js";
import { normalizeHooksSettings } from "./core/legacyHookEvents.js";
import { isAutohandInferenceEnabled } from "./featureFlags.js";
import { autoInitTheme, configureThemeSources, getDefaultThemeName, themeExists } from "./ui/theme/index.js";
import { loadLocalProjectSettings, type LocalProjectSettings } from "./permissions/localProjectPermissions.js";
import {
  canonicalJson,
  computeWorkspaceTrustFingerprint,
  isWorkspaceTrusted,
  type WorkspaceTrustEntries,
} from "./permissions/workspaceTrust.js";
import { isAwsBedrockProviderEnabled } from "./features/featureRegistry.js";
import { getCustomProviderConfig, isCustomProviderName } from "./providers/customProviders.js";
import { getProviderDefaultModel, getProviderModelOptions, getProviderRuntimeDefaultModel, normalizeOpenRouterModelId } from "./providers/modelCatalog.js";
import { DEFAULT_MAX_CONCURRENT_THREADS_PER_SESSION, MAX_CONCURRENT_THREADS_PER_SESSION, isValidSessionThreadLimit } from "./core/agents/SessionThreadBudget.js";

const DEFAULT_CONFIG_PATH = AUTOHAND_FILES.configJson;
const TOML_CONFIG_PATH = AUTOHAND_FILES.configToml;
const YAML_CONFIG_PATH = AUTOHAND_FILES.configYaml;
const YML_CONFIG_PATH = AUTOHAND_FILES.configYml;
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_ANTHROPIC_URL = "https://api.anthropic.com";
const DEFAULT_OLLAMA_URL = "http://localhost:11434";
const DEFAULT_LLAMACPP_URL = "http://localhost:8080";
const DEFAULT_OPENAI_URL = "https://api.openai.com/v1";
const DEFAULT_MLX_URL = "http://localhost:8080";
const DEFAULT_LLMGATEWAY_URL = "https://api.llmgateway.io/v1";
const DEFAULT_ZAI_URL = "https://api.z.ai/api/paas/v4";
const DEFAULT_SAKANA_URL = "https://api.sakana.ai/v1";
const DEFAULT_DEEPSEEK_URL = "https://api.deepseek.com";
const DEFAULT_BEDROCK_REGION = "us-east-1";
const DEFAULT_AUTOHAND_AI_URL = "https://api.autohand.ai/v1";
const DEFAULT_CONTROL_PLANE_API_URL = "https://api.autohand.ai";

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

  if (provider === "blueprint-local") {
    return provider;
  }

  if (isCustomProviderName(provider)) {
    return provider;
  }

  if (typeof provider === "string" && /^extension:[a-z][a-z0-9-]*(?:[.-][a-z0-9-]+)*$/.test(provider)) {
    return provider as ProviderName;
  }

  const validProviders: readonly BuiltInProviderName[] = [
    "autohandai",
    "openrouter",
    "anthropic",
    "ollama",
    "llamacpp",
    "openai",
    "mlx",
    "llmgateway",
    "azure",
    "zai",
    "sakana",
    "vertexai",
    "xai",
    "cerebras",
    "nvidia",
    "deepseek",
    "bedrock",
  ];

  if (typeof provider === "string" && validProviders.includes(provider as BuiltInProviderName)) {
    return provider as ProviderName;
  }

  return undefined;
}

export function getDefaultConfigPath(): string {
  return DEFAULT_CONFIG_PATH;
}

export interface LoadConfigOptions {
  /**
   * Persist the safe default config when no file exists. Answer-only
   * inspection sets this to false so startup remains read-only.
   */
  createIfMissing?: boolean;
  /** Initialize terminal theme state after loading. */
  initializeTheme?: boolean;
  /** Where workspace trust decisions are stored. Defaults to the user's Autohand home. */
  workspaceTrustStorePath?: string;
}

function createDefaultConfig(): AutohandConfig {
  return {
    provider: "openrouter",
    openrouter: {
      apiKey: "",
      baseUrl: "https://openrouter.ai/api/v1",
      model: getProviderDefaultModel("openrouter", "openrouter/auto"),
    },
    workspace: {
      defaultRoot: process.cwd(),
      allowDangerousOps: false,
    },
    ui: {
      theme: getDefaultThemeName(),
      autoConfirm: false,
      silentToolOutput: false,
      taskListPosition: "above-composer",
      completionReportEnabled: true,
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
    features: {
      multi_agent_v2: {
        max_concurrent_threads_per_session: DEFAULT_MAX_CONCURRENT_THREADS_PER_SESSION,
      },
    },
  };
}

/**
 * Detect config file path - checks for TOML/YAML first, then JSON
 */
export async function detectConfigPath(customPath?: string): Promise<string> {
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

export async function loadConfig(
  customPath?: string,
  workspaceRoot?: string,
  options: LoadConfigOptions = {},
): Promise<LoadedConfig> {
  const configPath = await detectConfigPath(customPath);
  const createIfMissing = options.createIfMissing ?? true;
  const initializeTheme = options.initializeTheme ?? true;

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

  if (createIfMissing) {
    await fs.ensureDir(path.dirname(configPath));
  }

  let isNewConfig = false;
  let parsed: AutohandConfig | LegacyConfigShape;

  if (!(await fs.pathExists(configPath))) {
    const defaultConfig = createDefaultConfig();

    if (createIfMissing) {
      // Create config silently with safe defaults.
      await fs.writeJson(configPath, defaultConfig, { spaces: 2 });
    }
    isNewConfig = true;
    parsed = defaultConfig;
  } else {
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
  }
  const normalized = normalizeConfig(parsed);

  // Load workspace-specific overlays if workspaceRoot is provided. Two layers
  // apply, lowest precedence first:
  //   1. <workspace>/.autohand/config.{json,toml,yaml,yml} (shareable project config)
  //   2. <workspace>/.autohand/settings.local.json          (personal, gitignored)
  let projectConfig: LocalProjectSettings | null = null;
  let workspaceSettings: LocalProjectSettings | null = null;
  if (workspaceRoot) {
    projectConfig = await loadProjectConfigOverlay(workspaceRoot, configPath);
    workspaceSettings = await loadLocalProjectSettings(workspaceRoot);
  }

  // Project hooks and MCP servers run commands, and a cloned repository can
  // ship them. They only apply once the user trusts this exact content.
  let workspaceTrust: WorkspaceTrustState | undefined;
  if (workspaceRoot) {
    const entries = resolveWorkspaceTrustEntries([projectConfig, workspaceSettings]);
    if (entries.hooks.length > 0 || entries.mcpServers.length > 0) {
      const fingerprint = computeWorkspaceTrustFingerprint(entries);
      const trusted = await isWorkspaceTrusted(workspaceRoot, fingerprint, options.workspaceTrustStorePath);
      workspaceTrust = { workspaceRoot: path.resolve(workspaceRoot), fingerprint, trusted, ...entries };
      if (!trusted) {
        projectConfig = withoutExecutableSections(projectConfig);
        workspaceSettings = withoutExecutableSections(workspaceSettings);
      }
    }
  }

  const overlayLayers = [projectConfig, workspaceSettings]
    .filter((layer): layer is LocalProjectSettings => layer !== null);
  // Captured before merging so saveConfig can write back what the file held.
  const overlayBase = overlayLayers.length > 0 ? cloneOverlaySections(normalized) : null;

  // Merge workspace layers over the global config (later layers take precedence)
  const withWorkspace = mergeWorkspaceSettings(
    mergeWorkspaceSettings(normalized, projectConfig),
    workspaceSettings,
  );

  // Merge environment variables for API settings
  const withEnv = mergeEnvVariables(withWorkspace);
  const workspaceOverlay = overlayBase
    ? createWorkspaceOverlaySnapshot(overlayBase, withEnv, overlayLayers)
    : undefined;

  if (initializeTheme) {
    configureThemeSources({ inlineThemes: withEnv.ui?.customThemes });
  }

  validateConfig(withEnv, configPath);

  if (initializeTheme) {
    // Initialize theme from config.
    const themeName = withEnv.ui?.theme || getDefaultThemeName();
    autoInitTheme(themeName);
  }

  return {
    ...withEnv,
    configPath,
    isNewConfig,
    ...(workspaceRoot ? { overlayWorkspaceRoot: path.resolve(workspaceRoot) } : {}),
    ...(workspaceOverlay ? { workspaceOverlay } : {}),
    ...(workspaceTrust ? { workspaceTrust } : {}),
  };
}

/** Project hooks and MCP servers after layering, in the order they would apply. */
function resolveWorkspaceTrustEntries(layers: (LocalProjectSettings | null)[]): WorkspaceTrustEntries {
  let hooks: HookDefinition[] = [];
  let mcpServers: McpServerConfigEntry[] = [];
  for (const layer of layers) {
    if (!layer) continue;
    if (isPlainRecord(layer.hooks)) {
      hooks = mergeHooksSettings({ hooks }, layer.hooks).hooks ?? [];
    }
    if (isPlainRecord(layer.mcp)) {
      mcpServers = mergeMcpSettings({ servers: mcpServers }, layer.mcp).servers ?? [];
    }
  }
  return { hooks, mcpServers };
}

function withoutExecutableSections(layer: LocalProjectSettings | null): LocalProjectSettings | null {
  if (!layer) return layer;
  const rest: LocalProjectSettings = { ...layer };
  delete rest.hooks;
  delete rest.mcp;
  return rest;
}

/**
 * Apply the project hooks and MCP servers that loadConfig held back for an
 * untrusted workspace, after the user trusts it. Updates the config in place
 * and extends the overlay record so saving still leaves project entries out.
 */
export function applyTrustedWorkspaceEntries(config: LoadedConfig): LoadedConfig {
  const trust = config.workspaceTrust;
  if (!trust || trust.trusted) return config;

  const snapshot: WorkspaceOverlaySnapshot = config.workspaceOverlay ?? {};
  if (trust.hooks.length > 0) {
    const base = snapshot.hooks ? snapshot.hooks.base : structuredClone(config.hooks);
    config.hooks = mergeHooksSettings(config.hooks, { hooks: trust.hooks });
    const ids = trust.hooks.map(safeHookIdentifier).filter((id): id is string => id !== null);
    snapshot.hooks = {
      base,
      applied: structuredClone(config.hooks),
      overlayIds: [...new Set([...(snapshot.hooks?.overlayIds ?? []), ...ids])],
      enabledOverridden: snapshot.hooks?.enabledOverridden ?? false,
    };
  }
  if (trust.mcpServers.length > 0) {
    const base = snapshot.mcp ? snapshot.mcp.base : structuredClone(config.mcp);
    config.mcp = mergeMcpSettings(config.mcp, { servers: trust.mcpServers });
    const names = trust.mcpServers.map(mcpServerIdentifier).filter((id): id is string => id !== null);
    snapshot.mcp = {
      base,
      applied: structuredClone(config.mcp),
      overlayNames: [...new Set([...(snapshot.mcp?.overlayNames ?? []), ...names])],
      enabledOverridden: snapshot.mcp?.enabledOverridden ?? false,
    };
  }

  config.workspaceOverlay = snapshot;
  config.workspaceTrust = { ...trust, trusted: true };
  return config;
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
    if (provider && typeof provider === "string" && provider.startsWith("extension:")) {
      const extensionProvider = provider as ExtensionProviderId;
      const extensionConfig = merged.extensionProviders?.[extensionProvider];
      if (extensionConfig) {
        merged.extensionProviders = {
          ...merged.extensionProviders,
          [extensionProvider]: { ...extensionConfig, model: workspaceSettings.model },
        };
      }
    } else if (provider && isCustomProviderName(provider)) {
      const customProvider = getCustomProviderConfig(merged, provider);
      if (customProvider) {
        merged.customProviders = {
          ...merged.customProviders,
          [customProvider.id]: {
            ...customProvider,
            model: workspaceSettings.model,
          },
        };
      }
    } else if (provider === "blueprint-local" && merged.blueprintLocal) {
      merged.blueprintLocal = {
        ...merged.blueprintLocal,
        model: workspaceSettings.model,
      };
    } else if (provider && merged[provider as BuiltInProviderName]) {
      (merged[provider as BuiltInProviderName] as ProviderSettings).model = workspaceSettings.model;
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

  // Merge lifecycle hooks: project hooks are appended and override a global
  // hook with the same identity, so project-level hooks actually fire.
  if (isPlainRecord(workspaceSettings.hooks)) {
    merged.hooks = mergeHooksSettings(merged.hooks, workspaceSettings.hooks);
  }

  // Merge MCP servers: project servers are appended and override a global
  // server with the same name.
  if (isPlainRecord(workspaceSettings.mcp)) {
    merged.mcp = mergeMcpSettings(merged.mcp, workspaceSettings.mcp);
  }

  return merged;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Normalize a hooks section into array form, accepting the documented
 * event-keyed shape (`"hooks": { "pre-prompt": ["cmd"] }`). Returns undefined
 * for anything that is not a hooks object.
 */
function normalizeHooksSection(value: unknown): HooksSettings | undefined {
  if (!isPlainRecord(value)) return undefined;
  const section = value as HooksSettings;
  const safe = section.hooks === undefined || Array.isArray(section.hooks)
    ? section
    : { ...section, hooks: undefined };
  return normalizeHooksSettings(safe);
}

/** Hook identity, or null for an entry too malformed to identify. */
function safeHookIdentifier(hook: unknown): string | null {
  if (!isPlainRecord(hook) || typeof hook.command !== "string" || typeof hook.event !== "string") {
    return null;
  }
  return hookIdentifier(hook as unknown as HookDefinition);
}

function mcpServerIdentifier(server: unknown): string | null {
  return isPlainRecord(server) && typeof server.name === "string" ? server.name : null;
}

/** Valid hook definitions from an overlay section; malformed entries are dropped. */
function overlayHookEntries(section: unknown): HookDefinition[] {
  const hooks = normalizeHooksSection(section)?.hooks;
  return Array.isArray(hooks) ? hooks.filter((hook) => safeHookIdentifier(hook) !== null) : [];
}

/** Named MCP servers from an overlay section; unnamed entries are dropped. */
function overlayMcpServers(section: unknown): McpServerConfigEntry[] {
  return isPlainRecord(section) && Array.isArray(section.servers)
    ? (section.servers as McpServerConfigEntry[]).filter((server) => mcpServerIdentifier(server) !== null)
    : [];
}

function mergeHooksSettings(
  base: HooksSettings | undefined,
  overlay: HooksSettings,
): HooksSettings {
  const normalizedBase = normalizeHooksSection(base);
  const normalizedOverlay = normalizeHooksSection(overlay);
  const overlayHooks = overlayHookEntries(normalizedOverlay);
  const overlayIds = new Set(overlayHooks.map(safeHookIdentifier).filter((id): id is string => id !== null));
  const baseHooks = (Array.isArray(normalizedBase?.hooks) ? normalizedBase.hooks : [])
    .filter((hook) => {
      const id = safeHookIdentifier(hook);
      return id === null || !overlayIds.has(id);
    });
  return {
    ...normalizedBase,
    ...(normalizedOverlay?.enabled !== undefined ? { enabled: normalizedOverlay.enabled } : {}),
    hooks: [...baseHooks, ...overlayHooks],
  };
}

function mergeMcpSettings(
  base: McpSettings | undefined,
  overlay: McpSettings,
): McpSettings {
  const overlayServers = overlayMcpServers(overlay);
  const overlayNames = new Set(overlayServers.map(mcpServerIdentifier).filter((id): id is string => id !== null));
  const baseServers = (isPlainRecord(base) && Array.isArray(base.servers) ? base.servers : [])
    .filter((server) => {
      const id = mcpServerIdentifier(server);
      return id === null || !overlayNames.has(id);
    });
  const overlayEnabled = isPlainRecord(overlay) ? overlay.enabled : undefined;
  return {
    ...(isPlainRecord(base) ? base : {}),
    ...(typeof overlayEnabled === "boolean" ? { enabled: overlayEnabled } : {}),
    servers: [...baseServers, ...overlayServers],
  };
}

const WORKSPACE_OVERLAY_OBJECT_KEYS: readonly WorkspaceOverlayObjectKey[] = [
  "agent",
  "network",
  "telemetry",
  "permissions",
];

interface OverlaySections {
  hooks?: HooksSettings;
  mcp?: McpSettings;
  agent?: AutohandConfig["agent"];
  network?: AutohandConfig["network"];
  telemetry?: AutohandConfig["telemetry"];
  permissions?: AutohandConfig["permissions"];
}

function cloneOverlaySections(config: AutohandConfig): OverlaySections {
  return structuredClone({
    hooks: config.hooks,
    mcp: config.mcp,
    agent: config.agent,
    network: config.network,
    telemetry: config.telemetry,
    permissions: config.permissions,
  });
}

/**
 * Record what workspace overlays changed so `saveConfig` can keep project
 * hooks, MCP servers, and overridden fields out of the file it writes.
 */
function createWorkspaceOverlaySnapshot(
  base: OverlaySections,
  applied: AutohandConfig,
  layers: LocalProjectSettings[],
): WorkspaceOverlaySnapshot | undefined {
  const snapshot: WorkspaceOverlaySnapshot = {};

  const hookLayers = layers.map((layer) => layer.hooks).filter(isPlainRecord);
  if (hookLayers.length > 0) {
    const overlayIds = hookLayers
      .flatMap((section) => overlayHookEntries(section))
      .map(safeHookIdentifier)
      .filter((id): id is string => id !== null);
    snapshot.hooks = {
      base: base.hooks,
      applied: structuredClone(applied.hooks),
      overlayIds: [...new Set(overlayIds)],
      enabledOverridden: hookLayers.some((section) => section.enabled !== undefined),
    };
  }

  const mcpLayers = layers.map((layer) => layer.mcp).filter(isPlainRecord);
  if (mcpLayers.length > 0) {
    const overlayNames = mcpLayers
      .flatMap((section) => overlayMcpServers(section))
      .map(mcpServerIdentifier)
      .filter((id): id is string => id !== null);
    snapshot.mcp = {
      base: base.mcp,
      applied: structuredClone(applied.mcp),
      overlayNames: [...new Set(overlayNames)],
      enabledOverridden: mcpLayers.some((section) => section.enabled !== undefined),
    };
  }

  for (const key of WORKSPACE_OVERLAY_OBJECT_KEYS) {
    const fieldNames = new Set<string>();
    for (const layer of layers) {
      const section = layer[key];
      if (!isPlainRecord(section)) continue;
      for (const [field, value] of Object.entries(section)) {
        if (value !== undefined) fieldNames.add(field);
      }
    }
    if (fieldNames.size === 0) continue;
    const baseSection = isPlainRecord(base[key]) ? (base[key] as Record<string, unknown>) : undefined;
    const appliedSection = isPlainRecord(applied[key]) ? (applied[key] as Record<string, unknown>) : undefined;
    const values: Record<string, { base?: unknown; applied?: unknown }> = {};
    for (const field of fieldNames) {
      values[field] = {
        base: baseSection?.[field],
        applied: structuredClone(appliedSection?.[field]),
      };
    }
    snapshot.fields = { ...snapshot.fields, [key]: { baseMissing: baseSection === undefined, values } };
  }

  return snapshot.hooks || snapshot.mcp || snapshot.fields ? snapshot : undefined;
}

/** Compare two values the way they would be persisted as JSON. */
function sameJsonValue(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

/**
 * Rebuild a persisted list from the runtime list: entries owned by a workspace
 * overlay are dropped, the file's entries they shadowed come back in their
 * original positions, and runtime additions or edits are kept.
 */
function restoreOverlayList<T>(
  current: T[],
  base: T[],
  overlayIds: ReadonlySet<string>,
  identify: (entry: unknown) => string | null,
): T[] {
  const pending = new Map<string, number[]>();
  current.forEach((entry, index) => {
    const id = identify(entry);
    if (id === null || overlayIds.has(id)) return;
    pending.set(id, [...(pending.get(id) ?? []), index]);
  });

  const used = new Set<number>();
  const restored: T[] = [];
  for (const entry of base) {
    const id = identify(entry);
    if (id === null) continue;
    if (overlayIds.has(id)) {
      restored.push(structuredClone(entry));
      continue;
    }
    const index = pending.get(id)?.shift();
    if (index !== undefined) {
      used.add(index);
      restored.push(current[index]);
    }
  }
  current.forEach((entry, index) => {
    if (used.has(index)) return;
    const id = identify(entry);
    if (id !== null && overlayIds.has(id)) return;
    restored.push(entry);
  });
  return restored;
}

function restoreOverlayEnabled(
  result: { enabled?: boolean },
  current: { enabled?: boolean },
  applied: { enabled?: boolean } | undefined,
  base: { enabled?: boolean } | undefined,
): void {
  if (!sameJsonValue(current.enabled, applied?.enabled)) return;
  if (base?.enabled === undefined) delete result.enabled;
  else result.enabled = base.enabled;
}

/**
 * Remove workspace overlay contributions from a config about to be written.
 * Only replaces top-level sections on `data`; never mutates nested objects,
 * which are shared with the live runtime config.
 */
function stripWorkspaceOverlay(data: AutohandConfig, snapshot: WorkspaceOverlaySnapshot): void {
  if (snapshot.hooks) {
    const current = data.hooks;
    if (isPlainRecord(current)) {
      if (sameJsonValue(current, snapshot.hooks.applied)) {
        if (snapshot.hooks.base === undefined) delete data.hooks;
        else data.hooks = structuredClone(snapshot.hooks.base);
      } else {
        const base = normalizeHooksSection(snapshot.hooks.base);
        const restored: HooksSettings = { ...current };
        if (snapshot.hooks.enabledOverridden) {
          restoreOverlayEnabled(restored, current, snapshot.hooks.applied, base);
        }
        if (Array.isArray(current.hooks)) {
          restored.hooks = restoreOverlayList(
            current.hooks,
            Array.isArray(base?.hooks) ? base.hooks : [],
            new Set(snapshot.hooks.overlayIds),
            safeHookIdentifier,
          );
        }
        data.hooks = restored;
      }
    }
  }

  if (snapshot.mcp) {
    const current = data.mcp;
    if (isPlainRecord(current)) {
      if (sameJsonValue(current, snapshot.mcp.applied)) {
        if (snapshot.mcp.base === undefined) delete data.mcp;
        else data.mcp = structuredClone(snapshot.mcp.base);
      } else {
        const base = isPlainRecord(snapshot.mcp.base) ? snapshot.mcp.base : undefined;
        const restored: McpSettings = { ...current };
        if (snapshot.mcp.enabledOverridden) {
          restoreOverlayEnabled(restored, current, snapshot.mcp.applied, base);
        }
        if (Array.isArray(current.servers)) {
          restored.servers = restoreOverlayList(
            current.servers,
            Array.isArray(base?.servers) ? base.servers : [],
            new Set(snapshot.mcp.overlayNames),
            mcpServerIdentifier,
          );
        }
        data.mcp = restored;
      }
    }
  }

  for (const key of WORKSPACE_OVERLAY_OBJECT_KEYS) {
    const overlay = snapshot.fields?.[key];
    const current = data[key];
    if (!overlay || !isPlainRecord(current)) continue;
    const restored: Record<string, unknown> = { ...current };
    for (const [field, { base, applied }] of Object.entries(overlay.values)) {
      if (!sameJsonValue(restored[field], applied)) continue;
      if (base === undefined) delete restored[field];
      else restored[field] = structuredClone(base);
    }
    if (overlay.baseMissing && Object.keys(restored).length === 0) {
      delete data[key];
    } else {
      (data as Record<string, unknown>)[key] = restored;
    }
  }
}

/**
 * Keys of the shared project config file that act as overlays on the global
 * config. The file can be committed to a repository, so only lifecycle hooks
 * and MCP servers are lifted from it:
 * - `permissions` could switch a cloned repository to unrestricted mode.
 * - `telemetry` could redirect session sync to another endpoint.
 * - `provider`, credentials, UI, and workspace keys are also written as
 *   placeholder defaults by `autohand mcp add --scope project`.
 * Personal overrides for those sections belong in `settings.local.json`.
 */
const PROJECT_CONFIG_OVERLAY_KEYS = [
  "hooks",
  "mcp",
] as const satisfies readonly (keyof AutohandConfig & keyof LocalProjectSettings)[];

/**
 * Load `<workspace>/.autohand/config.{json,toml,yaml,yml}` as a workspace
 * overlay. Returns null when no project config exists or when the global
 * config path already points at the project file (the `--scope project` MCP
 * commands load the project file directly and must not overlay it on itself).
 */
async function loadProjectConfigOverlay(
  workspaceRoot: string,
  globalConfigPath: string,
): Promise<LocalProjectSettings | null> {
  const projectDir = path.join(workspaceRoot, PROJECT_DIR_NAME);
  // A workspace at the home directory would make the user config its own overlay.
  if (path.resolve(projectDir) === path.resolve(AUTOHAND_HOME)) {
    return null;
  }
  const configFiles = await checkConfigFilesExist(projectDir);
  if (configFiles.length === 0) {
    return null;
  }
  if (configFiles.length > 1) {
    throw new Error(
      `Multiple config files found in ${projectDir} (${configFiles.join(", ")}). ` +
        `Only one project config file is allowed. Please review and remove the duplicate.`,
    );
  }

  const projectConfigPath = path.join(projectDir, configFiles[0]);
  if (path.resolve(projectConfigPath) === path.resolve(globalConfigPath)) {
    return null;
  }

  let parsed: AutohandConfig | LegacyConfigShape;
  try {
    parsed = await parseConfigFile(projectConfigPath);
  } catch (error) {
    throw new Error(
      `Failed to parse project config at ${projectConfigPath}: ${(error as Error).message}`,
    );
  }
  if (parsed === null || typeof parsed !== "object") {
    return null;
  }

  const overlay: LocalProjectSettings = {};
  const source = parsed as Record<string, unknown>;
  for (const key of PROJECT_CONFIG_OVERLAY_KEYS) {
    const value = source[key];
    if (value !== undefined && value !== null && typeof value === "object") {
      (overlay as Record<string, unknown>)[key] = value;
    }
  }
  return overlay;
}

function normalizeSavedApiBaseUrl(baseUrl: string | undefined): string | undefined {
  const normalized = baseUrl?.trim();
  if (!normalized) {
    return undefined;
  }

  try {
    const hostname = new URL(normalized).hostname.toLowerCase();
    if (
      hostname === "autohand-web.pages.dev"
      || hostname.endsWith(".autohand-web.pages.dev")
    ) {
      return DEFAULT_CONTROL_PLANE_API_URL;
    }
  } catch {
    return normalized;
  }

  return normalized;
}

/**
 * Merge environment variables into config
 * Env vars take precedence over config file values
 */
function mergeEnvVariables(config: AutohandConfig): AutohandConfig {
  config = {
    ...config,
    api: {
      accountId: process.env.AUTOHAND_ACCOUNT_ID || config.api?.accountId,
      baseUrl:
        process.env.AUTOHAND_API_URL ||
        normalizeSavedApiBaseUrl(config.api?.baseUrl) ||
        DEFAULT_CONTROL_PLANE_API_URL,
      companySecret:
        process.env.AUTOHAND_SECRET || config.api?.companySecret || "",
    },
  };

  if (
    isAutohandInferenceEnabled(config) &&
    (
      process.env.AUTOHAND_AI_API_KEY ||
      process.env.AUTOHAND_AI_BASE_URL ||
      process.env.AUTOHAND_AI_PLAN
    )
  ) {
    const existing = config.autohandai ?? {
      plan: "cloud" as const,
      authMode: "api-key" as const,
      model: process.env.AUTOHAND_MODEL || "fantail",
      contextWindow: defaultAutohandAIContextWindow({ plan: "cloud", model: "fantail" }),
    };
    config = {
      ...config,
      autohandai: {
        ...existing,
        plan: process.env.AUTOHAND_AI_PLAN === "local" ? "local" : "cloud",
        ...(process.env.AUTOHAND_AI_API_KEY && {
          apiKey: process.env.AUTOHAND_AI_API_KEY,
          authMode: "api-key" as const,
        }),
        ...(process.env.AUTOHAND_AI_BASE_URL && {
          baseUrl: process.env.AUTOHAND_AI_BASE_URL,
        }),
      },
    };
  }

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

function defaultAutohandAIContextWindow(settings: AutohandAISettings): number {
  return getProviderModelOptions("autohandai")
    .find((model) => model.id === settings.model)?.contextWindow
    ?? settings.contextWindow
    ?? 128_000;
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
    return {
      ...config,
      provider,
      ...(config.openrouter
        ? {
            openrouter: {
              ...config.openrouter,
              model: normalizeOpenRouterModelId(config.openrouter.model),
            },
          }
        : {}),
    };
  }

  if (isLegacyConfig(config)) {
    return {
      provider: "openrouter",
      openrouter: {
        apiKey: config.api_key ?? "replace-me",
        baseUrl: config.base_url ?? DEFAULT_BASE_URL,
        model: getProviderDefaultModel("openrouter", "anthropic/claude-sonnet-5"),
      },
      workspace: {
        defaultRoot: process.cwd(),
        allowDangerousOps: false,
      },
      ui: {
        autoConfirm: config.dry_run ?? false,
        theme: getDefaultThemeName(),
        silentToolOutput: false,
        taskListPosition: "above-composer",
        completionReportEnabled: true,
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
    typeof (config as AutohandConfig).anthropic === "object" ||
    typeof (config as AutohandConfig).blueprintLocal === "object" ||
    typeof (config as AutohandConfig).autohandai === "object" ||
    typeof (config as AutohandConfig).ollama === "object" ||
    typeof (config as AutohandConfig).llamacpp === "object" ||
    typeof (config as AutohandConfig).openai === "object" ||
    typeof (config as AutohandConfig).mlx === "object" ||
    typeof (config as AutohandConfig).azure === "object" ||
    typeof (config as AutohandConfig).zai === "object" ||
    typeof (config as AutohandConfig).sakana === "object" ||
    typeof (config as AutohandConfig).vertexai === "object" ||
    typeof (config as AutohandConfig).xai === "object" ||
    typeof (config as AutohandConfig).cerebras === "object" ||
    typeof (config as AutohandConfig).nvidia === "object" ||
    typeof (config as AutohandConfig).deepseek === "object" ||
    typeof (config as AutohandConfig).bedrock === "object" ||
    typeof (config as AutohandConfig).customProviders === "object"
  );
}

function isLegacyConfig(
  config: AutohandConfig | LegacyConfigShape,
): config is LegacyConfigShape {
  return typeof (config as LegacyConfigShape).api_key === "string";
}

function validateConfig(config: AutohandConfig, configPath: string): void {
  const multiAgentConfig: unknown = config.features?.multi_agent_v2;
  if (multiAgentConfig !== undefined) {
    if (!isPlainObject(multiAgentConfig)) {
      throw new Error(`features.multi_agent_v2 must be an object in ${configPath}`);
    }
    const threadLimit = multiAgentConfig.max_concurrent_threads_per_session;
    if (threadLimit !== undefined && !isValidSessionThreadLimit(threadLimit)) {
      throw new Error(
        `features.multi_agent_v2.max_concurrent_threads_per_session must be an integer between 1 and ${MAX_CONCURRENT_THREADS_PER_SESSION} in ${configPath}`,
      );
    }
  }

  if (config.blueprintLocal !== undefined) {
    if (!isPlainObject(config.blueprintLocal)) {
      throw new Error(`blueprintLocal must be an object in ${configPath}`);
    }
    const allowedKeys = new Set(["model", "modelPath", "modelSha256"]);
    const unsupportedKey = Object.keys(config.blueprintLocal)
      .find((key) => !allowedKeys.has(key));
    if (unsupportedKey) {
      throw new Error(
        `blueprintLocal.${unsupportedKey} is not supported in ${configPath}`,
      );
    }
    if (
      typeof config.blueprintLocal.model !== "string" ||
      config.blueprintLocal.model.trim() === ""
    ) {
      throw new Error(`blueprintLocal.model must be a non-empty string in ${configPath}`);
    }
    if (
      typeof config.blueprintLocal.modelPath !== "string" ||
      config.blueprintLocal.modelPath.trim() === ""
    ) {
      throw new Error(`blueprintLocal.modelPath must be a non-empty string in ${configPath}`);
    }
    if (
      typeof config.blueprintLocal.modelSha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(config.blueprintLocal.modelSha256)
    ) {
      throw new Error(
        `blueprintLocal.modelSha256 must be a lowercase SHA-256 in ${configPath}`,
      );
    }
  }

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
    // Theme validation is lenient — unknown themes fall back to the default at init time.
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
      config.ui.mouseComposerCursor !== undefined &&
      typeof config.ui.mouseComposerCursor !== "boolean"
    ) {
      throw new Error(`ui.mouseComposerCursor must be boolean in ${configPath}`);
    }
    const taskListPosition: unknown = config.ui.taskListPosition;
    if (
      taskListPosition !== undefined &&
      taskListPosition !== "up" &&
      taskListPosition !== "above-composer"
    ) {
      throw new Error(`ui.taskListPosition must be up or above-composer in ${configPath}`);
    }
    if (
      config.ui.keybindingProfile !== undefined &&
      !isKeybindingProfileId(config.ui.keybindingProfile)
    ) {
      throw new Error(
        `ui.keybindingProfile must be one of ${KEYBINDING_PROFILE_IDS.join(", ")} in ${configPath}`,
      );
    }
    if (
      config.ui.completionReportEnabled !== undefined &&
      typeof config.ui.completionReportEnabled !== "boolean"
    ) {
      throw new Error(`ui.completionReportEnabled must be boolean in ${configPath}`);
    }
    if (
      config.ui.activityVerbsEnabled !== undefined &&
      typeof config.ui.activityVerbsEnabled !== "boolean"
    ) {
      throw new Error(`ui.activityVerbsEnabled must be boolean in ${configPath}`);
    }
  }

  if (config.auth?.apiKeyHelper !== undefined && typeof config.auth.apiKeyHelper !== "string") {
    throw new Error(`auth.apiKeyHelper must be a string in ${configPath}`);
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
        if (
          server.managedConnectorId !== undefined &&
          (typeof server.managedConnectorId !== "string" || server.managedConnectorId.length === 0)
        ) {
          throw new Error(
            `mcp.servers[].managedConnectorId must be a non-empty string in ${configPath}`,
          );
        }
        if (
          server.managedConnectorRevision !== undefined &&
          (!Number.isInteger(server.managedConnectorRevision) || server.managedConnectorRevision < 0)
        ) {
          throw new Error(
            `mcp.servers[].managedConnectorRevision must be a non-negative integer in ${configPath}`,
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

  if (config.customProviders !== undefined) {
    if (!isPlainObject(config.customProviders)) {
      throw new Error(`customProviders must be an object in ${configPath}`);
    }
    for (const [key, provider] of Object.entries(config.customProviders)) {
      if (!isPlainObject(provider)) {
        throw new Error(`customProviders.${key} must be an object in ${configPath}`);
      }
      if (provider.id !== key) {
        throw new Error(`customProviders.${key}.id must match its config key in ${configPath}`);
      }
      if (typeof provider.displayName !== "string" || provider.displayName.trim() === "") {
        throw new Error(`customProviders.${key}.displayName must be a non-empty string in ${configPath}`);
      }
      if (provider.apiFormat !== "openai-compatible") {
        throw new Error(`customProviders.${key}.apiFormat must be "openai-compatible" in ${configPath}`);
      }
      if (typeof provider.baseUrl !== "string" || provider.baseUrl.trim() === "") {
        throw new Error(`customProviders.${key}.baseUrl must be a non-empty string in ${configPath}`);
      }
      if (typeof provider.model !== "string" || provider.model.trim() === "") {
        throw new Error(`customProviders.${key}.model must be a non-empty string in ${configPath}`);
      }
      if (
        provider.apiKeyRequired !== undefined &&
        typeof provider.apiKeyRequired !== "boolean"
      ) {
        throw new Error(`customProviders.${key}.apiKeyRequired must be boolean in ${configPath}`);
      }
      if (
        provider.contextWindow !== undefined &&
        (typeof provider.contextWindow !== "number" || provider.contextWindow <= 0)
      ) {
        throw new Error(`customProviders.${key}.contextWindow must be a positive number in ${configPath}`);
      }
    }
  }

  const extensionProviders = (config as AutohandConfig & {
    extensionProviders?: Record<string, Record<string, unknown>>;
  }).extensionProviders;
  if (extensionProviders !== undefined) {
    if (!isPlainObject(extensionProviders)) {
      throw new Error(`extensionProviders must be an object in ${configPath}`);
    }
    for (const [key, provider] of Object.entries(extensionProviders)) {
      if (!key.startsWith("extension:") || !isPlainObject(provider)) {
        throw new Error(`extensionProviders.${key} must be an object under an extension: provider id in ${configPath}`);
      }
      if (typeof provider.model !== "string" || provider.model.trim() === "") {
        throw new Error(`extensionProviders.${key}.model must be a non-empty string in ${configPath}`);
      }
    }
  }
}

/**
 * Workspace an invocation targets before any config is loaded: the explicit
 * `--path`, else the current directory. Pass it to `loadConfig` so project
 * overlays (`.autohand/config.*`, `.autohand/settings.local.json`) come from
 * that workspace rather than from wherever the process started.
 */
export function resolveRequestedWorkspaceRoot(requestedPath: string | undefined): string {
  return path.resolve(requestedPath ?? process.cwd());
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
  if (chosen === "blueprint-local") {
    return null;
  }
  if (typeof chosen === "string" && chosen.startsWith("extension:")) {
    const entry = config.extensionProviders?.[chosen as ExtensionProviderId];
    if (!entry?.model?.trim()) {
      return null;
    }
    return { ...entry, model: entry.model.trim() };
  }
  if (isCustomProviderName(chosen)) {
    const entry = getCustomProviderConfig(config, chosen);
    if (!entry || entry.apiFormat !== "openai-compatible") {
      return null;
    }
    const model = entry.model?.trim();
    const baseUrl = entry.baseUrl?.trim();
    const requiresApiKey = entry.apiKeyRequired !== false;
    if (!model || !baseUrl) {
      return null;
    }
    if (requiresApiKey && (!entry.apiKey || entry.apiKey === "replace-me")) {
      return null;
    }
    return {
      ...entry,
      model,
      baseUrl,
    };
  }

  if (chosen === "autohandai" && !isAutohandInferenceEnabled(config)) {
    return null;
  }

  if (chosen === "bedrock" && !isAwsBedrockProviderEnabled(config)) {
    return null;
  }

  const builtInProvider = chosen as BuiltInProviderName;
  const configByProvider: Record<BuiltInProviderName, ProviderSettings | undefined> = {
    autohandai: config.autohandai,
    openrouter: config.openrouter,
    anthropic: config.anthropic,
    ollama: config.ollama,
    llamacpp: config.llamacpp,
    openai: config.openai,
    mlx: config.mlx,
    llmgateway: config.llmgateway,
    azure: config.azure,
    zai: config.zai,
    sakana: config.sakana,
    vertexai: config.vertexai,
    xai: config.xai,
    cerebras: config.cerebras,
    nvidia: config.nvidia,
    deepseek: config.deepseek,
    bedrock: config.bedrock,
  };

  const entry = configByProvider[builtInProvider];
  if (!entry) {
    // Return null instead of throwing - let the caller handle unconfigured state
    return null;
  }

  if (chosen === "autohandai") {
    const autohandEntry = entry as AutohandAISettings;
    const plan = autohandEntry.plan ?? "cloud";
    if (!autohandEntry.model) {
      return null;
    }
    if (plan === "cloud") {
      const authMode = autohandEntry.authMode ?? "api-key";
      if (authMode === "account") {
        if (!autohandEntry.accountToken && !config.auth?.token) {
          return null;
        }
      } else if (!autohandEntry.apiKey || autohandEntry.apiKey === "replace-me") {
        return null;
      }
    }
  } else if (chosen === "openai") {
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
  } else if (builtInProvider === "xai") {
    const xaiEntry = entry as XAISettings;
    if (!xaiEntry.model) {
      return null;
    }
    if (xaiEntry.authMode === "oauth") {
      if (!xaiEntry.oauthAuth?.accessToken) {
        return null;
      }
    } else if (!xaiEntry.apiKey || xaiEntry.apiKey === "replace-me") {
      return null;
    }
  } else if (
    builtInProvider === "openrouter" ||
    builtInProvider === "anthropic" ||
    builtInProvider === "llmgateway" ||
    builtInProvider === "zai" ||
    builtInProvider === "sakana" ||
    builtInProvider === "nvidia" ||
    builtInProvider === "deepseek"
  ) {
    const { apiKey, model } = entry as ProviderSettings;
    if (!apiKey || apiKey === "replace-me" || !model) {
      return null; // Incomplete config
    }
  } else if (builtInProvider === "vertexai") {
    const { authToken, projectId, model } = entry as VertexAISettings;
    if (!authToken || !projectId || !model) {
      return null; // Incomplete config
    }
  } else if (builtInProvider === "bedrock") {
    return normalizeBedrockProviderConfig(entry as BedrockSettings);
  } else {
    if (builtInProvider === "llamacpp") {
      return {
        ...entry,
        model: entry.model ?? getProviderRuntimeDefaultModel("llamacpp", "local"),
        baseUrl: entry.baseUrl ?? defaultBaseUrlFor(builtInProvider, entry.port),
      };
    }

    // Validate other providers
    if (!entry.model) {
      return null; // Incomplete config
    }
  }

  return {
    ...entry,
    baseUrl: entry.baseUrl ?? defaultBaseUrlFor(builtInProvider, entry.port),
    ...(chosen === "autohandai" && {
      contextWindow: (entry as AutohandAISettings).plan === "local"
        ? entry.contextWindow ?? defaultAutohandAIContextWindow(entry as AutohandAISettings)
        : defaultAutohandAIContextWindow(entry as AutohandAISettings),
    }),
  };
}

function defaultBaseUrlFor(
  provider: BuiltInProviderName,
  port?: number,
): string | undefined {
  if (provider === "openrouter") return DEFAULT_BASE_URL;
  if (provider === "anthropic") return DEFAULT_ANTHROPIC_URL;
  if (provider === "autohandai") return DEFAULT_AUTOHAND_AI_URL;
  if (provider === "llmgateway") return DEFAULT_LLMGATEWAY_URL;
  if (provider === "zai") return DEFAULT_ZAI_URL;
  if (provider === "sakana") return DEFAULT_SAKANA_URL;
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
    case "xai":
      return "https://api.x.ai/v1";
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

export interface SaveConfigOptions {
  /**
   * Write the in-memory `auth` block. Defaults to false, which keeps whatever
   * credential is already on disk.
   *
   * The config file is shared by every terminal tab, and a long-lived tab still
   * holds the credential it loaded at startup. Without this, an incidental save
   * — a model switch, a settings change — rewrites the file with that stale
   * credential and signs the newer tab out. Only sign-in, sign-out, and startup
   * validation actually mean to change auth, so only they pass `writeAuth`.
   */
  writeAuth?: boolean;
}

/** Read just the persisted `auth` block, tolerating a missing or corrupt file. */
async function readPersistedAuth(
  configPath: string,
): Promise<{ present: boolean; auth?: LoadedConfig["auth"] }> {
  try {
    const parsed = await parseConfigFile(configPath);
    if (parsed && typeof parsed === "object" && "auth" in parsed) {
      return { present: true, auth: (parsed as AutohandConfig).auth };
    }
    return { present: false };
  } catch {
    return { present: false };
  }
}

export async function saveConfig(
  config: LoadedConfig,
  options: SaveConfigOptions = {},
): Promise<void> {
  const { configPath, workspaceOverlay, ...data } = config;
  delete (data as Partial<LoadedConfig>).isNewConfig;
  delete (data as Partial<LoadedConfig>).workspaceTrust;
  delete (data as Partial<LoadedConfig>).overlayWorkspaceRoot;
  if (workspaceOverlay) {
    stripWorkspaceOverlay(data, workspaceOverlay);
  }

  if (!options.writeAuth) {
    const persisted = await readPersistedAuth(configPath);
    if (persisted.present) {
      if (persisted.auth) {
        (data as AutohandConfig).auth = persisted.auth;
      } else {
        delete (data as Partial<AutohandConfig>).auth;
      }
    }
  }

  await fs.ensureDir(path.dirname(configPath));

  if (isYamlFile(configPath)) {
    const yamlContent = YAML.stringify(data, { indent: 2 });
    await fs.writeFile(configPath, yamlContent, "utf8");
  } else if (isTomlFile(configPath)) {
    await fs.writeFile(configPath, stringifyTomlObject(data as Record<string, unknown>), "utf8");
  } else {
    await fs.writeJson(configPath, data, { spaces: 2 });
  }

  // A signed-in client synchronizes its account-managed MCP connectors and the
  // safe settings snapshot after user-level configuration changes. The import is
  // intentionally deferred so config loading remains usable in bare and test
  // contexts that do not initialize the background sync runtime.
  if (configPath.startsWith(path.join(AUTOHAND_HOME, path.sep))) {
    void import('./sync/runtimeSyncService.js')
      .then(({ scheduleBackgroundSync }) => scheduleBackgroundSync())
      .catch(() => {});
  }
}
