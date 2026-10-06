/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** How long a finished one-shot run may take to drain before it exits regardless. */
export const PROMPT_EXIT_GRACE_MS = 1_000;

/**
 * Called once a one-shot (-p) run has printed its answer and awaited all of
 * its cleanup. Normally the event loop then drains and the process exits on
 * its own; a leaked handle (an open socket, a timer, a child's pipe) would
 * keep it alive indefinitely. The timer is unreferenced, so it only fires in
 * that case.
 */
export function armPromptExitBackstop(
  graceMs: number = PROMPT_EXIT_GRACE_MS,
  exit: () => void = () => process.exit(),
): ReturnType<typeof setTimeout> {
  const timer = setTimeout(exit, graceMs);
  timer.unref?.();
  return timer;
}
