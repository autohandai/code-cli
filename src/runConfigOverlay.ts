/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Run-only configuration: a named profile from `profiles.<name>` and
 * `--set key=value` overrides. Both are layered on top of the loaded config
 * for this process and recorded so `saveConfig` writes the file without them.
 */
import type { AutohandConfig, RunConfigOverlayEntry, RunConfigOverlaySnapshot } from './types.js';

export interface RunConfigOverlaySelection {
  profile?: string;
  sets?: string[];
  /** Typed settings supplied by an SDK for this process only. */
  sdkSettings?: Record<string, unknown>;
}

/** Keys a profile or override may never touch. */
const PROTECTED_TOP_LEVEL_KEYS = new Set(['profiles', 'auth', 'configPath', 'isNewConfig', 'workspaceOverlay', 'workspaceTrust', 'overlayWorkspaceRoot', 'runOverlay']);

let selection: RunConfigOverlaySelection | undefined;

/** Installs the CLI's profile and overrides for every config load in this process. */
export function configureRunConfigOverlay(
  next: RunConfigOverlaySelection | undefined,
  sdkSettingsJson?: string,
): void {
  const profile = next?.profile?.trim();
  const sets = (next?.sets ?? []).filter((entry) => entry.trim());
  const sdkSettings = sdkSettingsJson === undefined ? next?.sdkSettings : parseSdkRunSettings(sdkSettingsJson);
  if (sdkSettings) validateSdkSettings(sdkSettings);
  selection = profile || sets.length > 0 || sdkSettings !== undefined
    ? { ...(profile ? { profile } : {}), sets, ...(sdkSettings ? { sdkSettings } : {}) }
    : undefined;
}

export function getRunConfigOverlaySelection(): RunConfigOverlaySelection | undefined {
  return selection;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Consume the private SDK envelope once so tool children cannot inherit it. */
export function consumeSdkRunSettings(
  version: string | undefined,
  environment: Record<string, string | undefined> = process.env,
  restrictedProfile = false,
): Record<string, unknown> | undefined {
  const input = environment.AUTOHAND_RUN_SETTINGS;
  delete environment.AUTOHAND_RUN_SETTINGS;
  if (input === undefined && version === undefined) return undefined;
  if (restrictedProfile) throw new Error('SDK run settings are unavailable in restricted RPC profiles.');
  if (version !== '1' || input === undefined) {
    throw new Error('SDK run settings require --sdk-settings-version 1 and AUTOHAND_RUN_SETTINGS.');
  }
  return parseSdkRunSettings(input);
}

const UNSAFE_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
const SDK_SETTINGS_SECTIONS = new Set([
  'autohandai', 'openrouter', 'anthropic', 'ollama', 'llamacpp', 'openai', 'mlx',
  'llmgateway', 'azure', 'zai', 'sakana', 'vertexai', 'xai', 'cerebras', 'nvidia',
  'deepseek', 'bedrock', 'customProviders', 'extensionProviders', 'features', 'sessions',
]);

function validateOverlayPath(path: readonly string[]): void {
  if (path.length === 0 || path.some((segment) => !segment || UNSAFE_PATH_SEGMENTS.has(segment))) {
    throw new Error('Configuration overlay contains an unsafe setting path.');
  }
  if (PROTECTED_TOP_LEVEL_KEYS.has(path[0]!)) {
    throw new Error(`Configuration overlay cannot change "${path[0]}".`);
  }
}

function validateSdkSettings(settings: Record<string, unknown>): void {
  if (isRecord(settings.sessions) && Object.hasOwn(settings.sessions, 'awareness')
    && !['passive', 'warn', 'coordinate'].includes(String(settings.sessions.awareness))) {
    throw new Error('AUTOHAND_RUN_SETTINGS sessions.awareness must be passive, warn or coordinate.');
  }
  for (const section of Object.keys(settings)) {
    if (!SDK_SETTINGS_SECTIONS.has(section) || !isRecord(settings[section])) {
      throw new Error('AUTOHAND_RUN_SETTINGS must contain only provider, feature and session settings objects.');
    }
  }
  for (const leaf of profileLeaves(settings)) {
    validateOverlayPath(leaf.path);
    if (leaf.path[0] === 'sessions' && leaf.path[1] !== 'awareness') {
      throw new Error('AUTOHAND_RUN_SETTINGS supports only sessions.awareness.');
    }
  }
}

/** Parse without including credential values or JSON input in error messages. */
export function parseSdkRunSettings(input: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(input); }
  catch { throw new Error('AUTOHAND_RUN_SETTINGS must be a valid JSON settings object.'); }
  if (!isRecord(value)) throw new Error('AUTOHAND_RUN_SETTINGS must be a JSON settings object.');
  validateSdkSettings(value);
  return value;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function readPath(root: unknown, path: readonly string[]): { present: boolean; value: unknown } {
  let current: unknown = root;
  for (const segment of path) {
    if (!isRecord(current) || !(segment in current)) return { present: false, value: undefined };
    current = current[segment];
  }
  return { present: true, value: current };
}

function writePath(root: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let current = root;
  for (const segment of path.slice(0, -1)) {
    const next = current[segment];
    if (!isRecord(next)) current[segment] = {};
    current = current[segment] as Record<string, unknown>;
  }
  current[path[path.length - 1]!] = value;
}

function deletePath(root: Record<string, unknown>, path: readonly string[]): void {
  let current: Record<string, unknown> | undefined = root;
  for (const segment of path.slice(0, -1)) {
    const next: unknown = current?.[segment];
    if (!isRecord(next)) return;
    current = next;
  }
  if (current) delete current[path[path.length - 1]!];
}

/** `key.path=value`; the value is JSON when it parses, otherwise the literal text. */
export function parseRunConfigSet(input: string): { path: string[]; value: unknown } {
  const separator = input.indexOf('=');
  if (separator <= 0) throw new Error('--set expects key=value.');
  const key = input.slice(0, separator).trim();
  const raw = input.slice(separator + 1).trim();
  const path = key.split('.').map((segment) => segment.trim());
  if (path.some((segment) => !segment || !/^[A-Za-z0-9_-]+$/.test(segment))) {
    throw new Error(`--set key "${key}" must be a dotted path of setting names.`);
  }
  validateOverlayPath(path);
  let value: unknown = raw;
  if (raw !== '') {
    try { value = JSON.parse(raw); } catch { value = raw; }
  }
  return { path, value };
}

/** Leaves of a profile object as dotted paths; arrays and scalars are leaves. */
function profileLeaves(section: Record<string, unknown>, prefix: string[] = []): Array<{ path: string[]; value: unknown }> {
  const leaves: Array<{ path: string[]; value: unknown }> = [];
  for (const [key, value] of Object.entries(section)) {
    const path = [...prefix, key];
    if (isRecord(value) && Object.keys(value).length > 0) leaves.push(...profileLeaves(value, path));
    else leaves.push({ path, value });
  }
  return leaves;
}

/**
 * Layers the selected profile, then the `--set` overrides, onto `config`.
 * Returns the layered config and a snapshot of every changed path with the
 * value it replaced, so the file can be written without them later.
 */
export function applyRunConfigOverlay(
  config: AutohandConfig,
  active: RunConfigOverlaySelection | undefined = selection,
): { config: AutohandConfig; snapshot?: RunConfigOverlaySnapshot } {
  if (!active) return { config };
  const layered = structuredClone(config) as unknown as Record<string, unknown>;
  const entries: RunConfigOverlayEntry[] = [];
  const apply = (path: string[], value: unknown) => {
    validateOverlayPath(path);
    const base = readPath(layered, path);
    const applied = structuredClone(value);
    writePath(layered, path, applied);
    entries.push({ path, applied: structuredClone(applied), hadBase: base.present, base: base.present ? structuredClone(base.value) : undefined });
  };

  if (active.sdkSettings) {
    validateSdkSettings(active.sdkSettings);
    for (const leaf of profileLeaves(active.sdkSettings)) apply(leaf.path, leaf.value);
  }

  if (active.profile) {
    const profiles = isRecord(config.profiles) ? config.profiles : {};
    const profile = profiles[active.profile];
    if (!isRecord(profile)) {
      const names = Object.keys(profiles);
      throw new Error(`Profile "${active.profile}" is not defined in the config.${names.length ? ` Available profiles: ${names.join(', ')}.` : ' Add it under "profiles".'}`);
    }
    for (const leaf of profileLeaves(profile)) {
      if (PROTECTED_TOP_LEVEL_KEYS.has(leaf.path[0]!)) throw new Error(`Profile "${active.profile}" cannot change "${leaf.path[0]}".`);
      apply(leaf.path, leaf.value);
    }
  }
  for (const entry of active.sets ?? []) {
    const parsed = parseRunConfigSet(entry);
    apply(parsed.path, parsed.value);
  }
  return { config: layered as unknown as AutohandConfig, snapshot: { ...(active.profile ? { profile: active.profile } : {}), entries } };
}

/**
 * Puts the file's own values back before a save. A path the user changed
 * during the run (for example with /model) keeps the user's value.
 */
export function restoreRunConfigOverlay(data: Record<string, unknown>, snapshot: RunConfigOverlaySnapshot): void {
  for (const entry of [...snapshot.entries].reverse()) {
    const current = readPath(data, entry.path);
    if (!current.present || !sameValue(current.value, entry.applied)) continue;
    if (entry.hadBase) writePath(data, entry.path, structuredClone(entry.base));
    else deletePath(data, entry.path);
  }
}
