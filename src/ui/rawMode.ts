/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type RawModeInput = NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void };

/**
 * Best-effort raw mode toggle that never throws.
 * Some terminals can throw transient I/O errors during shutdown.
 */
export function safeSetRawMode(input: RawModeInput | undefined, mode: boolean): boolean {
  if (!input?.isTTY || typeof input.setRawMode !== 'function') {
    return false;
  }

  try {
    input.setRawMode(mode);
    return true;
  } catch {
    return false;
  }
}

