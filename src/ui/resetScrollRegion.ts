/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared utility: reset ANSI scroll region before Ink mounts.
 *
 * Terminal regions (split scroll/fixed areas for persistent input)
 * prevent Ink from moving the cursor back up to overwrite previous
 * renders, causing duplicated output on re-renders (e.g., arrow key
 * navigation). Writing ESC[r resets the scroll region to the full
 * terminal so Ink can render correctly.
 *
 * CONTRACT: After showing any Ink-based modal/component, the caller
 * must ensure terminal regions are re-enabled (PersistentInput.resume()
 * calls regions.enable() which re-sets the scroll region).
 */

/**
 * Reset ANSI scroll region to full terminal before Ink mounts.
 * Must be called before every Ink `render()` call that runs while
 * terminal regions may be active (i.e., during an interactive session).
 */
export function resetScrollRegion(): void {
  if (process.stdout.isTTY) {
    process.stdout.write('\x1B[r');
  }
}
