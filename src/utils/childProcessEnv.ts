/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { minimatch } from 'minimatch';
import { resolveAutohandHome } from '../constants.js';

export type ChildProcessEnv = NodeJS.ProcessEnv;

export type ChildProcessEnvInheritance = 'all' | 'essential' | 'none';

/**
 * What Autohand-launched shell commands inherit from the parent environment.
 * `inherit` picks the base set, `include` adds keys back (glob on the name),
 * `exclude` removes keys, and `set` pins values. Variables Autohand needs to
 * run its own tooling are always present.
 */
export interface ChildProcessEnvPolicy {
  inherit?: ChildProcessEnvInheritance;
  include?: string[];
  exclude?: string[];
  set?: Record<string, string>;
}

/** Variables a shell needs to behave normally when inheritance is `essential`. */
export const ESSENTIAL_CHILD_ENV_KEYS: readonly string[] = [
  'PATH', 'HOME', 'USER', 'USERNAME', 'LOGNAME', 'SHELL', 'PWD',
  'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LANGUAGE', 'LC_ALL', 'LC_CTYPE',
  'TERM', 'TERM_PROGRAM', 'COLORTERM', 'SSH_AUTH_SOCK',
  // Windows needs these to locate system binaries and profiles.
  'SystemRoot', 'SYSTEMROOT', 'ComSpec', 'COMSPEC', 'PATHEXT', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ProgramData',
];

const ALWAYS_PRESENT_PREFIX = 'AUTOHAND_';
const ESSENTIAL_KEYS_UPPER = new Set(ESSENTIAL_CHILD_ENV_KEYS.map((key) => key.toUpperCase()));

/** Windows environment keys are case-insensitive (`Path`, `PATH`). */
function isEssentialKey(key: string): boolean {
  return process.platform === 'win32' ? ESSENTIAL_KEYS_UPPER.has(key.toUpperCase()) : ESSENTIAL_CHILD_ENV_KEYS.includes(key);
}

function hasOwnEnvKey(env: NodeJS.ProcessEnv | Record<string, string | undefined>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(env, key);
}

function matchesAny(key: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => pattern === key || minimatch(key, pattern, { nocase: process.platform === 'win32' }));
}

/** Pure: the inherited slice of `baseEnv` under `policy`. */
export function applyChildProcessEnvPolicy(baseEnv: NodeJS.ProcessEnv, policy: ChildProcessEnvPolicy | undefined): ChildProcessEnv {
  const inherit = policy?.inherit ?? 'all';
  const include = policy?.include ?? [];
  const exclude = policy?.exclude ?? [];
  const env: ChildProcessEnv = {};

  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue;
    const essential = isEssentialKey(key) || key.startsWith(ALWAYS_PRESENT_PREFIX);
    const inherited = inherit === 'all' || (inherit === 'essential' && essential) || key.startsWith(ALWAYS_PRESENT_PREFIX);
    if (!inherited && !matchesAny(key, include)) continue;
    if (matchesAny(key, exclude) && !key.startsWith(ALWAYS_PRESENT_PREFIX)) continue;
    env[key] = value;
  }

  for (const [key, value] of Object.entries(policy?.set ?? {})) {
    env[key] = value;
  }
  return env;
}

let activePolicy: ChildProcessEnvPolicy | undefined;

/** Installs the policy from `shell.env` for every later child process. */
export function configureChildProcessEnvPolicy(policy: ChildProcessEnvPolicy | undefined): void {
  activePolicy = policy;
}

export function getChildProcessEnvPolicy(): ChildProcessEnvPolicy | undefined {
  return activePolicy;
}

/**
 * Build the environment inherited by Autohand-launched shell commands.
 *
 * Autohand can load Codex skills for compatibility. Those skills often call
 * helper scripts that use CODEX_HOME as their destination root. Inside
 * Autohand, CODEX_HOME should resolve to AUTOHAND_HOME unless a specific
 * command explicitly overrides it.
 */
export function buildAutohandChildProcessEnv(
  overrides: Record<string, string | undefined> = {},
  baseEnv: NodeJS.ProcessEnv = process.env,
  /** `undefined` uses the installed policy; `null` inherits everything. */
  policy?: ChildProcessEnvPolicy | null,
): ChildProcessEnv {
  const effectivePolicy = policy === undefined ? activePolicy : policy ?? undefined;
  const env: ChildProcessEnv = {
    ...applyChildProcessEnvPolicy(baseEnv, effectivePolicy),
    AUTOHAND_CLI: '1',
    ...overrides,
  };

  env.AUTOHAND_HOME = resolveAutohandHome({ environment: env });

  if (!hasOwnEnvKey(overrides, 'CODEX_HOME')) {
    env.CODEX_HOME = env.AUTOHAND_CODEX_COMPAT_HOME?.trim() || env.AUTOHAND_HOME;
  }

  return env;
}
