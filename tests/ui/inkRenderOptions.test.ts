/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE_ROOT = path.join(process.cwd(), 'src');
const UNSUPPORTED_INK_RENDER_OPTIONS = ['concurrent', 'alternateScreen'] as const;

async function collectSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async entry => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectSourceFiles(fullPath);
    }
    if (entry.isFile() && /\.(tsx?|jsx?)$/u.test(entry.name)) {
      return [fullPath];
    }
    return [];
  }));

  return files.flat();
}

describe('Ink 7 render options', () => {
  it('does not pass unsupported render options to Ink', async () => {
    const sourceFiles = await collectSourceFiles(SOURCE_ROOT);
    const violations: string[] = [];

    for (const file of sourceFiles) {
      const body = await readFile(file, 'utf8');
      for (const option of UNSUPPORTED_INK_RENDER_OPTIONS) {
        const optionPropertyPattern = new RegExp(`(?<![\\w$])${option}\\s*:`, 'u');
        if (optionPropertyPattern.test(body)) {
          violations.push(`${path.relative(process.cwd(), file)} uses ${option}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
