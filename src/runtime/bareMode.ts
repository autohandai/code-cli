/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import path from 'node:path';
import type { CLIOptions, LoadedConfig } from '../types.js';
import { looksLikeInlineAgents } from '../core/agents/AgentRegistry.js';

export interface BareLoadedConfig extends LoadedConfig {
  pluginDir?: string;
}

export const BARE_SLASH_COMMANDS_DISABLED_MESSAGE = 'Slash commands are disabled in bare mode.';

export function applyBareModeConfig(config: LoadedConfig, options: CLIOptions): BareLoadedConfig {
  const bareConfig: BareLoadedConfig = {
    ...config,
    ui: {
      ...config.ui,
      promptSuggestions: false,
      checkForUpdates: false,
      notifications: false,
    },
    telemetry: {
      ...config.telemetry,
      enabled: false,
      enableSessionSync: false,
    },
    autoReport: {
      ...config.autoReport,
      enabled: false,
    },
    communitySkills: {
      ...config.communitySkills,
      enabled: false,
      showSuggestionsOnStartup: false,
      autoBackup: false,
    },
    hooks: {
      ...config.hooks,
      enabled: false,
      hooks: [],
    },
    mcp: options.mcpConfig
      ? config.mcp
      : {
          ...config.mcp,
          enabled: false,
          servers: [],
        },
    sync: {
      ...config.sync,
      enabled: false,
    },
    externalAgents: options.agents && !looksLikeInlineAgents(options.agents)
      ? { enabled: true, paths: [path.resolve(options.agents)] }
      : { enabled: false, paths: [] },
  };

  if (options.pluginDir) {
    bareConfig.pluginDir = path.resolve(options.pluginDir);
  }

  return bareConfig;
}

export async function applyExplicitBareFiles(
  config: LoadedConfig,
  options: CLIOptions
): Promise<LoadedConfig> {
  if (!options.mcpConfig) {
    return config;
  }

  const mcpConfigPath = path.resolve(options.mcpConfig);
  const mcpConfig = await fs.readJson(mcpConfigPath);
  return {
    ...config,
    mcp: Array.isArray(mcpConfig?.servers)
      ? { enabled: true, servers: mcpConfig.servers }
      : mcpConfig,
  };
}

export async function prepareBareModeConfig(
  config: LoadedConfig,
  options: CLIOptions
): Promise<LoadedConfig> {
  if (!options.bare) {
    return config;
  }

  process.env.AUTOHAND_CODE_SIMPLE = '1';
  return applyExplicitBareFiles(applyBareModeConfig(config, options), options);
}
