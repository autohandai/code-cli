/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AutohandConfig, LoadedConfig } from './types.js';

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), '.autohand-cli', 'config.json');
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

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
    return config;
  }

  if (isLegacyConfig(config)) {
    return {
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
  return typeof (config as AutohandConfig).openrouter === 'object' &&
    (config as AutohandConfig).openrouter !== null;
}

function isLegacyConfig(config: AutohandConfig | LegacyConfigShape): config is LegacyConfigShape {
  return typeof (config as LegacyConfigShape).api_key === 'string';
}

function validateConfig(config: AutohandConfig, configPath: string): void {
  if (!config.openrouter || typeof config.openrouter !== 'object') {
    throw new Error(`Missing openrouter configuration in ${configPath}`);
  }

  const { apiKey, baseUrl, model } = config.openrouter;
  if (typeof apiKey !== 'string' || !apiKey || apiKey === 'replace-me') {
    throw new Error(`Set a valid openrouter.apiKey in ${configPath}`);
  }
  if (baseUrl !== undefined && typeof baseUrl !== 'string') {
    throw new Error(`openrouter.baseUrl must be a string in ${configPath}`);
  }
  if (typeof model !== 'string' || !model) {
    throw new Error(`Set a default OpenRouter model in ${configPath}`);
  }

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
  const candidate = requestedPath ?? config.workspace?.defaultRoot ?? process.cwd();
  return path.resolve(candidate);
}

export async function saveConfig(config: LoadedConfig): Promise<void> {
  const { configPath, ...data } = config;
  await fs.writeJson(configPath, data, { spaces: 2 });
}
