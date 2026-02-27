/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { t } from '../i18n/index.js';
import { showModal, showInput, showConfirm, showPassword, type ModalOption } from '../ui/ink/components/Modal.js';
import { saveConfig } from '../config.js';
import type { LoadedConfig } from '../types.js';

// ── Types ──────────────────────────────────────────────────────────────

export type SettingType = 'boolean' | 'string' | 'number' | 'enum' | 'password';

export type SettingCategory = 'ui' | 'agent' | 'permissions' | 'network' | 'telemetry' | 'automode' | 'teams' | 'search';

export interface SettingDef {
  key: string;
  labelKey: string;
  descriptionKey?: string;
  category: SettingCategory;
  type: SettingType;
  enumValues?: string[];
  validate?: (v: string) => boolean | string;
  defaultValue?: unknown;
  redirect?: string;
}

export interface CategoryDef {
  id: SettingCategory;
  labelKey: string;
}

export interface SettingsCommandContext {
  config: LoadedConfig;
}

// ── Category Definitions ───────────────────────────────────────────────

export const SETTING_CATEGORIES: CategoryDef[] = [
  { id: 'ui', labelKey: 'commands.settings.categories.ui' },
  { id: 'agent', labelKey: 'commands.settings.categories.agent' },
  { id: 'permissions', labelKey: 'commands.settings.categories.permissions' },
  { id: 'network', labelKey: 'commands.settings.categories.network' },
  { id: 'telemetry', labelKey: 'commands.settings.categories.telemetry' },
  { id: 'automode', labelKey: 'commands.settings.categories.automode' },
  { id: 'teams', labelKey: 'commands.settings.categories.teams' },
  { id: 'search', labelKey: 'commands.settings.categories.search' },
];

// ── Settings Registry ──────────────────────────────────────────────────

export const SETTINGS_REGISTRY: SettingDef[] = [
  // UI & Display
  { key: 'ui.theme', labelKey: 'commands.settings.ui.theme', category: 'ui', type: 'string', redirect: '/theme' },
  { key: 'ui.locale', labelKey: 'commands.settings.ui.locale', category: 'ui', type: 'string', redirect: '/language' },
  { key: 'ui.autoConfirm', labelKey: 'commands.settings.ui.autoConfirm', descriptionKey: 'commands.settings.ui.autoConfirmDesc', category: 'ui', type: 'boolean', defaultValue: false },
  { key: 'ui.showThinking', labelKey: 'commands.settings.ui.showThinking', descriptionKey: 'commands.settings.ui.showThinkingDesc', category: 'ui', type: 'boolean', defaultValue: true },
  { key: 'ui.terminalBell', labelKey: 'commands.settings.ui.terminalBell', descriptionKey: 'commands.settings.ui.terminalBellDesc', category: 'ui', type: 'boolean', defaultValue: true },
  { key: 'ui.checkForUpdates', labelKey: 'commands.settings.ui.checkForUpdates', descriptionKey: 'commands.settings.ui.checkForUpdatesDesc', category: 'ui', type: 'boolean', defaultValue: true },
  { key: 'ui.showCompletionNotification', labelKey: 'commands.settings.ui.showCompletionNotification', descriptionKey: 'commands.settings.ui.showCompletionNotificationDesc', category: 'ui', type: 'boolean', defaultValue: true },
  { key: 'ui.promptSuggestions', labelKey: 'commands.settings.ui.promptSuggestions', descriptionKey: 'commands.settings.ui.promptSuggestionsDesc', category: 'ui', type: 'boolean', defaultValue: true },
  { key: 'ui.activitySymbol', labelKey: 'commands.settings.ui.activitySymbol', descriptionKey: 'commands.settings.ui.activitySymbolDesc', category: 'ui', type: 'string', defaultValue: '\u2733' },
  { key: 'ui.updateCheckInterval', labelKey: 'commands.settings.ui.updateCheckInterval', descriptionKey: 'commands.settings.ui.updateCheckIntervalDesc', category: 'ui', type: 'number', defaultValue: 24 },

  // Agent Behavior
  { key: 'agent.maxIterations', labelKey: 'commands.settings.agent.maxIterations', descriptionKey: 'commands.settings.agent.maxIterationsDesc', category: 'agent', type: 'number', defaultValue: 100 },
  { key: 'agent.enableRequestQueue', labelKey: 'commands.settings.agent.enableRequestQueue', descriptionKey: 'commands.settings.agent.enableRequestQueueDesc', category: 'agent', type: 'boolean', defaultValue: true },
  { key: 'agent.sessionRetryLimit', labelKey: 'commands.settings.agent.sessionRetryLimit', descriptionKey: 'commands.settings.agent.sessionRetryLimitDesc', category: 'agent', type: 'number', defaultValue: 3 },
  { key: 'agent.sessionRetryDelay', labelKey: 'commands.settings.agent.sessionRetryDelay', descriptionKey: 'commands.settings.agent.sessionRetryDelayDesc', category: 'agent', type: 'number', defaultValue: 1000 },
  { key: 'agent.debug', labelKey: 'commands.settings.agent.debug', descriptionKey: 'commands.settings.agent.debugDesc', category: 'agent', type: 'boolean', defaultValue: false },

  // Permissions
  { key: 'permissions.mode', labelKey: 'commands.settings.permissions.mode', descriptionKey: 'commands.settings.permissions.modeDesc', category: 'permissions', type: 'enum', enumValues: ['interactive', 'unrestricted', 'restricted'], defaultValue: 'interactive' },
  { key: 'permissions.rememberSession', labelKey: 'commands.settings.permissions.rememberSession', descriptionKey: 'commands.settings.permissions.rememberSessionDesc', category: 'permissions', type: 'boolean', defaultValue: true },

  // Network
  { key: 'network.maxRetries', labelKey: 'commands.settings.network.maxRetries', descriptionKey: 'commands.settings.network.maxRetriesDesc', category: 'network', type: 'number', defaultValue: 3 },
  { key: 'network.timeout', labelKey: 'commands.settings.network.timeout', descriptionKey: 'commands.settings.network.timeoutDesc', category: 'network', type: 'number', defaultValue: 30000 },
  { key: 'network.retryDelay', labelKey: 'commands.settings.network.retryDelay', descriptionKey: 'commands.settings.network.retryDelayDesc', category: 'network', type: 'number', defaultValue: 1000 },

  // Telemetry & Reporting
  { key: 'telemetry.enabled', labelKey: 'commands.settings.telemetry.enabled', descriptionKey: 'commands.settings.telemetry.enabledDesc', category: 'telemetry', type: 'boolean', defaultValue: false },
  { key: 'autoReport.enabled', labelKey: 'commands.settings.telemetry.autoReportEnabled', descriptionKey: 'commands.settings.telemetry.autoReportEnabledDesc', category: 'telemetry', type: 'boolean', defaultValue: true },

  // Auto-mode
  { key: 'automode.maxIterations', labelKey: 'commands.settings.automode.maxIterations', descriptionKey: 'commands.settings.automode.maxIterationsDesc', category: 'automode', type: 'number', defaultValue: 50 },
  { key: 'automode.maxRuntime', labelKey: 'commands.settings.automode.maxRuntime', descriptionKey: 'commands.settings.automode.maxRuntimeDesc', category: 'automode', type: 'number', defaultValue: 120 },
  { key: 'automode.maxCost', labelKey: 'commands.settings.automode.maxCost', descriptionKey: 'commands.settings.automode.maxCostDesc', category: 'automode', type: 'number', defaultValue: 10 },
  { key: 'automode.checkpointInterval', labelKey: 'commands.settings.automode.checkpointInterval', descriptionKey: 'commands.settings.automode.checkpointIntervalDesc', category: 'automode', type: 'number', defaultValue: 5 },
  { key: 'automode.useWorktree', labelKey: 'commands.settings.automode.useWorktree', descriptionKey: 'commands.settings.automode.useWorktreeDesc', category: 'automode', type: 'boolean', defaultValue: true },

  // Teams
  { key: 'teams.enabled', labelKey: 'commands.settings.teams.enabled', descriptionKey: 'commands.settings.teams.enabledDesc', category: 'teams', type: 'boolean', defaultValue: true },
  { key: 'teams.teammateMode', labelKey: 'commands.settings.teams.teammateMode', descriptionKey: 'commands.settings.teams.teammateModeDesc', category: 'teams', type: 'enum', enumValues: ['auto', 'in-process', 'tmux'], defaultValue: 'auto' },
  { key: 'teams.maxTeammates', labelKey: 'commands.settings.teams.maxTeammates', descriptionKey: 'commands.settings.teams.maxTeammatesDesc', category: 'teams', type: 'number', defaultValue: 5 },

  // Search
  { key: 'search.provider', labelKey: 'commands.settings.search.provider', descriptionKey: 'commands.settings.search.providerDesc', category: 'search', type: 'enum', enumValues: ['google', 'brave', 'duckduckgo', 'parallel'], defaultValue: 'google' },
  { key: 'search.braveApiKey', labelKey: 'commands.settings.search.braveApiKey', descriptionKey: 'commands.settings.search.braveApiKeyDesc', category: 'search', type: 'password' },
  { key: 'search.parallelApiKey', labelKey: 'commands.settings.search.parallelApiKey', descriptionKey: 'commands.settings.search.parallelApiKeyDesc', category: 'search', type: 'password' },
];

// ── Utility Functions ──────────────────────────────────────────────────

export function getNestedValue(obj: Record<string, any>, path: string): unknown {
  const parts = path.split('.');
  let current: any = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

export function setNestedValue(obj: Record<string, any>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current[parts[i]] == null || typeof current[parts[i]] !== 'object') {
      current[parts[i]] = {};
    }
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
}

export function getSettingsForCategory(category: SettingCategory): SettingDef[] {
  return SETTINGS_REGISTRY.filter(s => s.category === category);
}

export function formatSettingValue(value: unknown, type: SettingType): string {
  if (value == null || value === undefined) {
    if (type === 'password') return chalk.gray('(not set)');
    return chalk.gray('(default)');
  }

  switch (type) {
    case 'boolean':
      return value ? chalk.green(t('commands.settings.on')) : chalk.red(t('commands.settings.off'));
    case 'password':
      return typeof value === 'string' && value.length > 0 ? chalk.gray('****') : chalk.gray('(not set)');
    case 'number':
      return chalk.cyan(String(value));
    case 'enum':
    case 'string':
      return chalk.cyan(String(value));
    default:
      return String(value);
  }
}

// ── Command Logic ──────────────────────────────────────────────────────

export async function editSetting(setting: SettingDef, config: LoadedConfig): Promise<boolean> {
  const currentValue = getNestedValue(config, setting.key);

  switch (setting.type) {
    case 'boolean': {
      const current = currentValue ?? setting.defaultValue ?? false;
      const newValue = await showConfirm({
        title: t(setting.labelKey),
        defaultValue: current as boolean,
      });
      if (newValue !== current) {
        setNestedValue(config, setting.key, newValue);
        return true;
      }
      return false;
    }

    case 'enum': {
      const options: ModalOption[] = (setting.enumValues ?? []).map(v => ({
        label: v === String(currentValue) ? `${v} (current)` : v,
        value: v,
      }));
      const result = await showModal({
        title: t(setting.labelKey),
        options,
        initialIndex: setting.enumValues?.indexOf(String(currentValue ?? setting.defaultValue)) ?? 0,
      });
      if (result && result.value !== String(currentValue)) {
        setNestedValue(config, setting.key, result.value);
        return true;
      }
      return false;
    }

    case 'string': {
      const result = await showInput({
        title: t(setting.labelKey),
        defaultValue: String(currentValue ?? setting.defaultValue ?? ''),
      });
      if (result !== null && result !== String(currentValue)) {
        setNestedValue(config, setting.key, result);
        return true;
      }
      return false;
    }

    case 'number': {
      const result = await showInput({
        title: t(setting.labelKey),
        defaultValue: String(currentValue ?? setting.defaultValue ?? ''),
        validate: (v: string) => {
          const n = Number(v);
          if (isNaN(n) || !Number.isFinite(n)) return 'Must be a number';
          return true;
        },
      });
      if (result !== null) {
        const numValue = Number(result);
        if (numValue !== currentValue) {
          setNestedValue(config, setting.key, numValue);
          return true;
        }
      }
      return false;
    }

    case 'password': {
      const result = await showPassword({
        title: t(setting.labelKey),
      });
      if (result !== null && result !== String(currentValue ?? '')) {
        setNestedValue(config, setting.key, result);
        return true;
      }
      return false;
    }

    default:
      return false;
  }
}

async function showCategorySettings(category: SettingCategory, config: LoadedConfig): Promise<void> {
  while (true) {
    const settings = getSettingsForCategory(category);

    const options: ModalOption[] = settings.map(s => {
      const value = getNestedValue(config, s.key);
      const display = formatSettingValue(value, s.type);
      const label = s.redirect
        ? `${t(s.labelKey)}: ${display} (${s.redirect})`
        : `${t(s.labelKey)}: ${display}`;
      return {
        label,
        value: s.key,
        description: s.descriptionKey ? t(s.descriptionKey) : undefined,
      };
    });

    // Add back option
    options.push({ label: t('commands.settings.back'), value: '__back__' });

    const result = await showModal({
      title: t('commands.settings.selectSetting'),
      options,
    });

    if (!result || result.value === '__back__') return;

    const setting = SETTINGS_REGISTRY.find(s => s.key === result.value);
    if (!setting) return;

    if (setting.redirect) {
      console.log(chalk.gray(`\n${t('commands.settings.redirect', { command: chalk.cyan(setting.redirect) })}\n`));
      continue;
    }

    const changed = await editSetting(setting, config);
    if (changed) {
      await saveConfig(config);
      console.log(chalk.green(`\n${t('commands.settings.saved')}\n`));
    }
  }
}

export async function settings(ctx: SettingsCommandContext): Promise<string | null> {
  console.log(chalk.cyan(`\n${t('commands.settings.title')}\n`));

  while (true) {
    const options: ModalOption[] = SETTING_CATEGORIES.map(cat => ({
      label: t(cat.labelKey),
      value: cat.id,
    }));

    const result = await showModal({
      title: t('commands.settings.selectCategory'),
      options,
    });

    if (!result) return null;

    await showCategorySettings(result.value as SettingCategory, ctx.config);
  }
}

export const metadata = {
  command: '/settings',
  description: 'configure autohand settings',
  implemented: true,
};
