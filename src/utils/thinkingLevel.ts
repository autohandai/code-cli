/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ThinkingLevel } from '../types.js';

/**
 * Parse the --thinking CLI flag value into a ThinkingLevel.
 *
 * Mapping:
 *   undefined        -> 'normal'   (flag not passed)
 *   true / 'true'    -> 'extended' (--thinking passed without value)
 *   false / 'false'  -> 'none'
 *   'extended'|'normal'|'none' -> pass through as-is
 */
export function parseThinkingLevel(
  value: string | boolean | undefined,
): ThinkingLevel {
  if (value === undefined) {
    return 'normal';
  }

  if (value === true || value === 'true') {
    return 'extended';
  }

  if (value === false || value === 'false') {
    return 'none';
  }

  // Pass through valid ThinkingLevel values as-is
  if (value === 'extended' || value === 'normal' || value === 'none') {
    return value;
  }

  // Fallback for unrecognised strings
  return 'normal';
}
