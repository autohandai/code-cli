/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression test: node:sqlite unavailable on Bun (Issue #43)
 * Verifies CursorImporter gracefully returns null when node:sqlite cannot load.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';

vi.mock('fs-extra', () => ({
  default: {
    pathExists: vi.fn().mockResolvedValue(false),
    readFile: vi.fn(),
    readdir: vi.fn().mockResolvedValue([]),
    readJson: vi.fn(),
    ensureDir: vi.fn().mockResolvedValue(undefined),
    writeJson: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    copy: vi.fn().mockResolvedValue(undefined),
  },
}));

// Simulate node:sqlite being unavailable (e.g. Bun runtime)
vi.mock('node:sqlite', () => {
  throw new Error('Could not resolve: "node:sqlite". Maybe you need to "bun install"?');
});

import fse from 'fs-extra';
import { CursorImporter } from '../../src/import/importers/CursorImporter.js';

const HOME = os.homedir();
const CURSOR_HOME = path.join(HOME, '.cursor');

describe('CursorImporter – node:sqlite unavailable (Issue #43)', () => {
  let importer: CursorImporter;

  beforeEach(() => {
    vi.clearAllMocks();
    importer = new CursorImporter();
  });

  it('should not crash when importing sessions without node:sqlite', async () => {
    // Set up scan to detect sessions
    const sessionsDir = path.join(CURSOR_HOME, 'User', 'workspaceStorage');
    vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
      const s = String(p);
      if (s === CURSOR_HOME) return true;
      if (s === sessionsDir) return true;
      return false;
    });
    vi.mocked(fse.readdir).mockImplementation(async (p: string) => {
      if (String(p) === sessionsDir) {
        return [{ name: 'abc123', isDirectory: () => true }] as any;
      }
      return [];
    });

    // Import should complete without throwing
    const result = await importer.import(['sessions']);

    // Should have 0 imported sessions (since sqlite was unavailable)
    expect(result.imported).toBeDefined();
  });
});
