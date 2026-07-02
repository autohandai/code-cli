/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import os from 'node:os';
import path from 'node:path';

export type ChildProcessEnv = NodeJS.ProcessEnv;

function hasOwnEnvKey(env: NodeJS.ProcessEnv | Record<string, string | undefined>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(env, key);
}

function resolveAutohandHome(env: NodeJS.ProcessEnv): string {
  const configuredHome = env.AUTOHAND_HOME?.trim();
  return configuredHome && configuredHome.length > 0
    ? configuredHome
    : path.join(os.homedir(), '.autohand');
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
  baseEnv: NodeJS.ProcessEnv = process.env
): ChildProcessEnv {
  const env: ChildProcessEnv = {
    ...baseEnv,
    AUTOHAND_CLI: '1',
    ...overrides,
  };

  env.AUTOHAND_HOME = resolveAutohandHome(env);

  if (!hasOwnEnvKey(overrides, 'CODEX_HOME')) {
    env.CODEX_HOME = env.AUTOHAND_CODEX_COMPAT_HOME?.trim() || env.AUTOHAND_HOME;
  }

  return env;
}
