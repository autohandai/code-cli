/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileActionManager } from '../../src/actions/filesystem.js';

describe('FileActionManager home paths', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('expands ~/ paths before creating directories', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-fs-workspace-'));
    const homeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-fs-home-'));
    vi.spyOn(os, 'homedir').mockReturnValue(homeRoot);

    try {
      const files = new FileActionManager(workspaceRoot, [homeRoot]);

      await files.createDirectory('~/Documents/competitors/findings');

      expect(existsSync(path.join(homeRoot, 'Documents', 'competitors', 'findings'))).toBe(true);
      expect(existsSync(path.join(workspaceRoot, '~'))).toBe(false);
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
      await fs.rm(homeRoot, { recursive: true, force: true });
    }
  });
});
