/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AutohandConfig, LoadedConfig, ProviderName, ProviderSettings } from './types.js';

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), '.autohand-cli', 'config.json');
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
const DEFAULT_LLAMACPP_URL = 'http://localhost:8080';
const DEFAULT_OPENAI_URL = 'https://api.openai.com/v1';

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

export async function loadConfig(customPath?: string): Promise<LoadedConfig> {
  const envPath = process.env.AUTOHAND_CONFIG;
  const configPath = path.resolve(customPath ?? envPath ?? DEFAULT_CONFIG_PATH);
  await fs.ensureDir(path.dirname(configPath));

  if (!(await fs.pathExists(configPath))) {
    const defaultConfig: AutohandConfig = {
      provider: 'openrouter',
      openrouter: {
        apiKey: 'replace-me',
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'anthropic/claude-3.5-sonnet'
      },
      workspace: {
        defaultRoot: process.cwd(),
        allowDangerousOps: false
      },
      ui: {
        theme: 'dark',
        autoConfirm: false
      }
    };

    await fs.writeJson(configPath, defaultConfig, { spaces: 2 });
    throw new Error(
      `Created default config at ${configPath}. Please update it with your OpenRouter credentials before rerunning.`
    );
  }

  let parsed: AutohandConfig | LegacyConfigShape;
  try {
    parsed = (await fs.readJSON(configPath)) as AutohandConfig | LegacyConfigShape;
  } catch (error) {
    throw new Error(`Failed to parse config at ${configPath}: ${(error as Error).message}`);
  }
  const normalized = normalizeConfig(parsed);
  validateConfig(normalized, configPath);
  return { ...normalized, configPath };
}

function normalizeConfig(config: AutohandConfig | LegacyConfigShape): AutohandConfig {
  if (isModernConfig(config)) {
    const provider = config.provider ?? 'openrouter';
    return { provider, ...config };
  }

  if (isLegacyConfig(config)) {
    return {
      provider: 'openrouter',
      openrouter: {
        apiKey: config.api_key ?? 'replace-me',
        baseUrl: config.base_url ?? DEFAULT_BASE_URL,
        model: config.model ?? 'anthropic/claude-3.5-sonnet'
      },
      workspace: {
        defaultRoot: process.cwd(),
        allowDangerousOps: false
      },
      ui: {
        autoConfirm: config.dry_run ?? false,
        theme: 'dark'
      }
    };
  }

  return config as AutohandConfig;
}

function isModernConfig(config: AutohandConfig | LegacyConfigShape): config is AutohandConfig {
  return typeof (config as AutohandConfig).openrouter === 'object' ||
    typeof (config as AutohandConfig).ollama === 'object' ||
    typeof (config as AutohandConfig).llamacpp === 'object' ||
    typeof (config as AutohandConfig).openai === 'object';
}

function isLegacyConfig(config: AutohandConfig | LegacyConfigShape): config is LegacyConfigShape {
  return typeof (config as LegacyConfigShape).api_key === 'string';
}

function validateConfig(config: AutohandConfig, configPath: string): void {
  const provider = config.provider ?? 'openrouter';
  const providerConfig = getProviderConfig(config, provider);

  if (config.workspace) {
    if (config.workspace.defaultRoot && typeof config.workspace.defaultRoot !== 'string') {
      throw new Error(`workspace.defaultRoot must be a string in ${configPath}`);
    }
    if (
      config.workspace.allowDangerousOps !== undefined &&
      typeof config.workspace.allowDangerousOps !== 'boolean'
    ) {
      throw new Error(`workspace.allowDangerousOps must be boolean in ${configPath}`);
    }
  }

  if (config.ui) {
    if (config.ui.theme && config.ui.theme !== 'dark' && config.ui.theme !== 'light') {
      throw new Error(`ui.theme must be 'dark' or 'light' in ${configPath}`);
    }
    if (config.ui.autoConfirm !== undefined && typeof config.ui.autoConfirm !== 'boolean') {
      throw new Error(`ui.autoConfirm must be boolean in ${configPath}`);
    }
  }
}

export function resolveWorkspaceRoot(config: LoadedConfig, requestedPath?: string): string {
  // Priority: 1. Explicit --path flag, 2. Current directory, 3. Config default
  const candidate = requestedPath ?? process.cwd() ?? config.workspace?.defaultRoot;
  return path.resolve(candidate);
}

export function getProviderConfig(config: AutohandConfig, provider?: ProviderName): ProviderSettings {
  const chosen = provider ?? config.provider ?? 'openrouter';
  const configByProvider: Record<ProviderName, ProviderSettings | undefined> = {
    openrouter: config.openrouter,
    ollama: config.ollama,
    llamacpp: config.llamacpp,
    openai: config.openai
  };

  const entry = configByProvider[chosen];
  if (!entry) {
    throw new Error(`Provider ${chosen} is not configured. Update ~/.autohand-cli/config.json.`);
  }

  if (chosen === 'openrouter') {
    const { apiKey, baseUrl, model } = entry as ProviderSettings;
    if (typeof apiKey !== 'string' || !apiKey || apiKey === 'replace-me') {
      throw new Error('Set a valid openrouter.apiKey in ~/.autohand-cli/config.json');
    }
    if (typeof model !== 'string' || !model) {
      throw new Error('Set openrouter.model in ~/.autohand-cli/config.json');
    }
    if (baseUrl !== undefined && typeof baseUrl !== 'string') {
      throw new Error('openrouter.baseUrl must be a string');
    }
  } else {
    if (entry.model === undefined || typeof entry.model !== 'string' || !entry.model) {
      throw new Error(`Set ${chosen}.model in ~/.autohand-cli/config.json`);
    }
  }

  return {
    ...entry,
    baseUrl: entry.baseUrl ?? defaultBaseUrlFor(chosen, entry.port)
  };
}

function defaultBaseUrlFor(provider: ProviderName, port?: number): string | undefined {
  if (provider === 'openrouter') return DEFAULT_BASE_URL;
  const p = port ? port.toString() : undefined;
  switch (provider) {
    case 'ollama':
      return p ? `http://localhost:${p}` : DEFAULT_OLLAMA_URL;
    case 'llamacpp':
      return p ? `http://localhost:${p}` : DEFAULT_LLAMACPP_URL;
    case 'openai':
      return DEFAULT_OPENAI_URL;
    default:
      return undefined;
  }
}

export async function saveConfig(config: LoadedConfig): Promise<void> {
  const { configPath, ...data } = config;
  await fs.writeJson(configPath, data, { spaces: 2 });
}
