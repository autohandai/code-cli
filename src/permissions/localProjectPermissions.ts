/**
 * Local Project Permissions
 * Handles per-project permission settings stored in .autohand/settings.local.json
 * @license Apache-2.0
 */
import fs from 'fs-extra';
import path from 'node:path';
import { PROJECT_DIR_NAME } from '../constants.js';
import type { PermissionSettings } from './types.js';

const LOCAL_SETTINGS_FILE = 'settings.local.json';

export interface LocalProjectSettings {
  permissions?: PermissionSettings;
  /** Version for future migrations */
  version?: number;
}

/**
 * Get the path to the local project settings file
 */
export function getLocalSettingsPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, PROJECT_DIR_NAME, LOCAL_SETTINGS_FILE);
}

/**
 * Load local project permissions from .autohand/settings.local.json
 * Returns null if file doesn't exist
 */
export async function loadLocalProjectSettings(workspaceRoot: string): Promise<LocalProjectSettings | null> {
  const settingsPath = getLocalSettingsPath(workspaceRoot);

  try {
    if (await fs.pathExists(settingsPath)) {
      const content = await fs.readFile(settingsPath, 'utf8');
      return JSON.parse(content) as LocalProjectSettings;
    }
  } catch (error) {
    // Log but don't throw - invalid settings file shouldn't break the app
    console.error(`Warning: Failed to parse local settings at ${settingsPath}:`, (error as Error).message);
  }

  return null;
}

/**
 * Save local project permissions to .autohand/settings.local.json
 */
export async function saveLocalProjectSettings(
  workspaceRoot: string,
  settings: LocalProjectSettings
): Promise<void> {
  const settingsPath = getLocalSettingsPath(workspaceRoot);
  const dir = path.dirname(settingsPath);

  // Ensure .autohand directory exists
  await fs.ensureDir(dir);

  // Add version for future migrations
  const toSave: LocalProjectSettings = {
    ...settings,
    version: 1
  };

  await fs.writeJson(settingsPath, toSave, { spaces: 2 });
}

/**
 * Add a pattern to the local project whitelist
 */
export async function addToLocalWhitelist(
  workspaceRoot: string,
  pattern: string
): Promise<void> {
  const current = await loadLocalProjectSettings(workspaceRoot) || {};
  const permissions = current.permissions || {};
  const whitelist = permissions.whitelist || [];

  if (!whitelist.includes(pattern)) {
    whitelist.push(pattern);
    await saveLocalProjectSettings(workspaceRoot, {
      ...current,
      permissions: {
        ...permissions,
        whitelist
      }
    });
  }
}

/**
 * Add a pattern to the local project blacklist
 */
export async function addToLocalBlacklist(
  workspaceRoot: string,
  pattern: string
): Promise<void> {
  const current = await loadLocalProjectSettings(workspaceRoot) || {};
  const permissions = current.permissions || {};
  const blacklist = permissions.blacklist || [];

  if (!blacklist.includes(pattern)) {
    blacklist.push(pattern);
    await saveLocalProjectSettings(workspaceRoot, {
      ...current,
      permissions: {
        ...permissions,
        blacklist
      }
    });
  }
}

/**
 * Get merged permissions (global + local project)
 * Local project settings take precedence
 */
export function mergePermissions(
  globalSettings: PermissionSettings,
  localSettings: PermissionSettings | undefined
): PermissionSettings {
  if (!localSettings) {
    return globalSettings;
  }

  return {
    // Global settings as base
    ...globalSettings,
    // Local mode overrides global if set
    mode: localSettings.mode || globalSettings.mode,
    // Merge whitelists (deduplicated)
    whitelist: [
      ...(globalSettings.whitelist || []),
      ...(localSettings.whitelist || [])
    ].filter((v, i, a) => a.indexOf(v) === i),
    // Merge blacklists (deduplicated)
    blacklist: [
      ...(globalSettings.blacklist || []),
      ...(localSettings.blacklist || [])
    ].filter((v, i, a) => a.indexOf(v) === i),
    // Merge rules (local rules checked first)
    rules: [
      ...(localSettings.rules || []),
      ...(globalSettings.rules || [])
    ],
    // Use local rememberSession if set, otherwise global
    rememberSession: localSettings.rememberSession ?? globalSettings.rememberSession
  };
}
