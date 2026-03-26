/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';

function getExecutableName(): string {
  return process.platform === 'win32' ? 'rg.exe' : 'rg';
}

export function getBundledRipgrepPath(): string | null {
  const executableName = getExecutableName();
  const candidates = [
    path.join(path.dirname(process.execPath), executableName),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // Ignore filesystem errors and keep searching.
    }
  }

  return null;
}

export function resolveRipgrepCommand(): string {
  return getBundledRipgrepPath() ?? 'rg';
}
