/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

type Env = Record<string, string | undefined>;

/** iTerm2 sets TERM_PROGRAM directly and forwards LC_TERMINAL through tmux and ssh. */
export function isITerm2(env: Env = process.env): boolean {
  return env.TERM_PROGRAM === 'iTerm.app' || env.LC_TERMINAL === 'iTerm2';
}

/**
 * Click-to-position needs terminal mouse reporting, which takes the scroll
 * wheel away from native scrollback. iTerm2 also jolts the viewport when
 * reporting is switched around wheel events, so it stays off there unless the
 * user asks for it explicitly.
 */
export function resolveMouseComposerCursor(configured: boolean | undefined, env: Env = process.env): boolean {
  return configured ?? !isITerm2(env);
}
