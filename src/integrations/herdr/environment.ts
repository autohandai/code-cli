/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** The Herdr pane that owns this process, read from the environment Herdr injects. */
export interface HerdrEnvironment {
  binPath: string;
  paneId: string;
}

/**
 * Herdr sets `HERDR_ENV=1` plus the pane id and the path of the Herdr binary
 * that owns the pane. Anything less means we are not inside a Herdr pane and
 * the integration must stay silent.
 */
export function resolveHerdrEnvironment(env: NodeJS.ProcessEnv): HerdrEnvironment | null {
  if (env.HERDR_ENV !== '1') return null;
  const binPath = env.HERDR_BIN_PATH?.trim();
  const paneId = env.HERDR_PANE_ID?.trim();
  if (!binPath || !paneId) return null;
  return { binPath, paneId };
}
