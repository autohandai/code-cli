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

function normalizePermissionSettings(settings: PermissionSettings | undefined): PermissionSettings | undefined {
  if (!settings) {
    return settings;
  }

  const allowList = settings.allowList ?? settings.whitelist ?? [];
  const denyList = settings.denyList ?? settings.blacklist ?? [];

  return {
    ...settings,
    allowList,
    denyList,
    whitelist: undefined,
    blacklist: undefined,
  };
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
      const parsed = JSON.parse(content) as LocalProjectSettings;
      return {
        ...parsed,
        permissions: normalizePermissionSettings(parsed.permissions),
      };
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
export async function addToLocalAllowList(
  workspaceRoot: string,
  pattern: string
): Promise<void> {
  const current = await loadLocalProjectSettings(workspaceRoot) || {};
  const permissions = normalizePermissionSettings(current.permissions) || {};
  const allowList = permissions.allowList || [];

  if (!allowList.includes(pattern)) {
    allowList.push(pattern);
    await saveLocalProjectSettings(workspaceRoot, {
      ...current,
      permissions: {
        ...permissions,
        allowList
      }
    });
  }
}

/**
 * Add a pattern to the local project denyList
 */
export async function addToLocalDenyList(
  workspaceRoot: string,
  pattern: string
): Promise<void> {
  const current = await loadLocalProjectSettings(workspaceRoot) || {};
  const permissions = normalizePermissionSettings(current.permissions) || {};
  const denyList = permissions.denyList || [];

  if (!denyList.includes(pattern)) {
    denyList.push(pattern);
    await saveLocalProjectSettings(workspaceRoot, {
      ...current,
      permissions: {
        ...permissions,
        denyList
      }
    });
  }
}

export async function addToLocalWhitelist(workspaceRoot: string, pattern: string): Promise<void> {
  await addToLocalAllowList(workspaceRoot, pattern);
}

export async function addToLocalBlacklist(workspaceRoot: string, pattern: string): Promise<void> {
  await addToLocalDenyList(workspaceRoot, pattern);
}

/**
 * Get merged permissions (global + local project)
 * Local project settings take precedence
 */
export function mergePermissions(
  globalSettings: PermissionSettings,
  localSettings: PermissionSettings | undefined
): PermissionSettings {
  const normalizedGlobal = normalizePermissionSettings(globalSettings) ?? {};
  const normalizedLocal = normalizePermissionSettings(localSettings);

  if (!normalizedLocal) {
    return normalizedGlobal;
  }

  return {
    // Global settings as base
    ...normalizedGlobal,
    // Local mode overrides global if set
    mode: normalizedLocal.mode || normalizedGlobal.mode,
    allowList: [
      ...(normalizedGlobal.allowList || []),
      ...(normalizedLocal.allowList || [])
    ].filter((v, i, a) => a.indexOf(v) === i),
    denyList: [
      ...(normalizedGlobal.denyList || []),
      ...(normalizedLocal.denyList || [])
    ].filter((v, i, a) => a.indexOf(v) === i),
    // Merge rules (local rules checked first)
    rules: [
      ...(normalizedLocal.rules || []),
      ...(normalizedGlobal.rules || [])
    ],
    // Use local rememberSession if set, otherwise global
    rememberSession: normalizedLocal.rememberSession ?? normalizedGlobal.rememberSession,
    allowPatterns: [
      ...(normalizedGlobal.allowPatterns || []),
      ...(normalizedLocal.allowPatterns || [])
    ],
    denyPatterns: [
      ...(normalizedGlobal.denyPatterns || []),
      ...(normalizedLocal.denyPatterns || [])
    ],
    availableTools: [
      ...(normalizedGlobal.availableTools || []),
      ...(normalizedLocal.availableTools || [])
    ],
    excludedTools: [
      ...(normalizedGlobal.excludedTools || []),
      ...(normalizedLocal.excludedTools || [])
    ],
    allPathsAllowed: normalizedLocal.allPathsAllowed ?? normalizedGlobal.allPathsAllowed,
    allUrlsAllowed: normalizedLocal.allUrlsAllowed ?? normalizedGlobal.allUrlsAllowed,
  };
}
