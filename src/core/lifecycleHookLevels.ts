/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import path from 'node:path';
import YAML from 'yaml';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { loadConfig } from '../config.js';
import { PROJECT_DIR_NAME } from '../constants.js';
import { trustWorkspace } from '../permissions/workspaceTrust.js';
import { atomicWriteFile, withFileLock } from '../utils/atomicFile.js';
import type { HookDefinition, HooksSettings, LoadedConfig } from '../types.js';
import { hookIdentifier } from './hookEvents.js';
import { normalizeHooksSettings } from './legacyHookEvents.js';
import type { HookManager } from './HookManager.js';

/**
 * Where a lifecycle hook lives:
 * - `project`: `<workspace>/.autohand/config.*`, shared with the repository
 * - `local`: `<workspace>/.autohand/settings.local.json`, this machine only
 * - `user`: the active config file under the Autohand home, every workspace
 */
export const LIFECYCLE_HOOK_LEVELS = ['project', 'local', 'user'] as const;
export type LifecycleHookLevel = (typeof LIFECYCLE_HOOK_LEVELS)[number];

const PROJECT_CONFIG_CANDIDATES = ['config.toml', 'config.yaml', 'config.yml', 'config.json'];

export function normalizeLifecycleHookLevel(input: string | undefined): LifecycleHookLevel {
  const level = input?.trim().toLowerCase();
  if (!level) return 'project';
  if (level === 'global') return 'user';
  if ((LIFECYCLE_HOOK_LEVELS as readonly string[]).includes(level)) return level as LifecycleHookLevel;
  throw new Error(`Unknown hook level "${input}". Use project, local, or user.`);
}

export interface LifecycleHookLevelTarget {
  level: LifecycleHookLevel;
  workspaceRoot: string;
  /** The active config file; user-level hooks are written here. */
  configPath: string;
}

export async function resolveLifecycleHookLevelPath(target: LifecycleHookLevelTarget): Promise<string> {
  const projectDir = path.join(target.workspaceRoot, PROJECT_DIR_NAME);
  switch (target.level) {
    case 'user':
      return target.configPath;
    case 'local':
      return path.join(projectDir, 'settings.local.json');
    case 'project': {
      for (const candidate of PROJECT_CONFIG_CANDIDATES) {
        const candidatePath = path.join(projectDir, candidate);
        if (await fs.pathExists(candidatePath)) return candidatePath;
      }
      return path.join(projectDir, 'config.json');
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseConfigText(filePath: string, raw: string): Record<string, unknown> {
  const ext = path.extname(filePath);
  const parsed: unknown = ext === '.toml'
    ? parseToml(raw)
    : /\.ya?ml$/.test(ext)
      ? (YAML.parse(raw) ?? {})
      : JSON.parse(raw || '{}');
  if (!isRecord(parsed)) throw new Error(`${filePath} does not contain a configuration object`);
  return parsed;
}

function serializeConfig(filePath: string, data: Record<string, unknown>): string {
  const ext = path.extname(filePath);
  if (ext === '.toml') return stringifyToml(data);
  if (/\.ya?ml$/.test(ext)) return YAML.stringify(data);
  return `${JSON.stringify(data, null, 2)}\n`;
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T;
}

export interface UpsertLifecycleHookResult {
  path: string;
  replaced: boolean;
}

/**
 * Adds a hook to the file for its level, or replaces the hook there that
 * shares its identity (event plus description, or event plus command). The
 * other levels are never touched, so a project hook cannot leak into the
 * user config and the user config cannot swallow a project hook.
 */
export async function upsertLifecycleHookAtLevel(
  target: LifecycleHookLevelTarget & { hook: HookDefinition },
): Promise<UpsertLifecycleHookResult> {
  const filePath = await resolveLifecycleHookLevelPath(target);
  const hook = stripUndefined({ ...target.hook, enabled: target.hook.enabled !== false });
  await fs.ensureDir(path.dirname(filePath));
  let replaced = false;
  await withFileLock(`${filePath}.lock`, async () => {
    const raw = (await fs.pathExists(filePath)) ? await fs.readFile(filePath, 'utf8') : '';
    const data = raw.trim() ? parseConfigText(filePath, raw) : {};
    if (data.hooks !== undefined && !isRecord(data.hooks)) {
      throw new Error(`${filePath} has an invalid hooks section`);
    }
    const settings = normalizeHooksSettings((data.hooks ?? {}) as HooksSettings) ?? {};
    const existing = settings.hooks ?? [];
    const identity = hookIdentifier(hook);
    const index = existing.findIndex((candidate) => hookIdentifier(candidate) === identity);
    replaced = index !== -1;
    const hooks = replaced
      ? existing.map((candidate, position) => (position === index ? hook : candidate))
      : [...existing, hook];
    data.hooks = { ...settings, hooks };
    if (target.level === 'local' && data.version === undefined) data.version = 1;
    await atomicWriteFile(filePath, serializeConfig(filePath, data));
  });
  return { path: filePath, replaced };
}

export interface LifecycleHookRuntime {
  config: LoadedConfig;
  workspaceRoot: string;
}

export interface ReloadLifecycleHooksOptions {
  /**
   * Re-trust the workspace for the entries it now declares. Only right after
   * the user approved the change that altered them; never for files that
   * changed on their own.
   */
  extendTrust?: boolean;
  trustStorePath?: string;
}

export interface ReloadLifecycleHooksResult {
  trusted: boolean;
}

/**
 * Re-reads every hook level and hands the merged result to the running
 * manager, so a hook written moments ago fires in this session and a later
 * save of the user config still knows which hooks belong to the workspace.
 */
export async function reloadLifecycleHooks(
  runtime: LifecycleHookRuntime,
  manager: Pick<HookManager, 'replaceSettings'>,
  options: ReloadLifecycleHooksOptions = {},
): Promise<ReloadLifecycleHooksResult> {
  const load = () => loadConfig(runtime.config.configPath, runtime.workspaceRoot, {
    createIfMissing: false,
    initializeTheme: false,
    workspaceTrustStorePath: options.trustStorePath,
  });
  let fresh = await load();
  if (options.extendTrust && fresh.workspaceTrust && !fresh.workspaceTrust.trusted) {
    await trustWorkspace(runtime.workspaceRoot, fresh.workspaceTrust.fingerprint, options.trustStorePath);
    fresh = await load();
  }
  runtime.config.hooks = fresh.hooks;
  runtime.config.workspaceOverlay = fresh.workspaceOverlay;
  runtime.config.overlayWorkspaceRoot = fresh.overlayWorkspaceRoot;
  runtime.config.workspaceTrust = fresh.workspaceTrust;
  manager.replaceSettings(fresh.hooks ?? {});
  return { trusted: fresh.workspaceTrust?.trusted ?? true };
}
