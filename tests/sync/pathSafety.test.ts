/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import type { SyncManifest } from '../../src/sync/types.js';
import {
  resolveSafeSyncPath,
  validateSyncManifestPaths,
  validateSyncPath,
} from '../../src/sync/pathSafety.js';

const ENABLED_ROOTS = ['config.json', 'agents/', 'memory/'];

function manifestWithPaths(paths: string[]): SyncManifest {
  return {
    version: 1,
    userId: 'test-user',
    lastModified: new Date().toISOString(),
    files: paths.map((filePath) => ({
      path: filePath,
      hash: 'hash',
      size: 1,
      modifiedAt: new Date().toISOString(),
    })),
    checksum: 'checksum',
  };
}

describe('sync path safety', () => {
  const cleanupPaths = new Set<string>();

  afterEach(async () => {
    await Promise.all([...cleanupPaths].map((entry) => fs.remove(entry)));
    cleanupPaths.clear();
  });

  it.each([
    '',
    '.',
    '..',
    '../outside.json',
    'memory/../outside.json',
    'memory/./entry.json',
    'memory//entry.json',
    'memory/entry.json/',
    '/absolute.json',
    'C:/outside.json',
    'C:\\outside.json',
    '\\\\server\\share\\outside.json',
    'memory\\outside.json',
    'memory/file.txt:alternate-stream',
    'memory/CON',
    'memory/con.txt',
    'memory/trailing.',
    'memory/trailing ',
    'memory/file?.json',
    `memory/${String.fromCharCode(0)}outside.json`,
  ])('rejects unsafe protocol path %j', (unsafePath) => {
    expect(() => validateSyncPath(unsafePath)).toThrow(/unsafe sync path/i);
  });

  it('preserves valid nested POSIX paths unchanged', () => {
    expect(validateSyncPath('memory/templates/example.md')).toBe('memory/templates/example.md');
  });

  it('rejects paths outside the enabled sync roots and duplicate manifest keys', () => {
    expect(() => validateSyncManifestPaths(
      manifestWithPaths(['not-enabled/file.json']),
      ENABLED_ROOTS,
    )).toThrow(/enabled sync root/i);

    expect(() => validateSyncManifestPaths(
      manifestWithPaths(['memory/entry.json', 'memory/entry.json']),
      ENABLED_ROOTS,
    )).toThrow(/duplicate/i);
  });

  it('rejects an existing symlink ancestor that escapes its enabled root', async () => {
    const basePath = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-path-base-'));
    const outsidePath = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-path-outside-'));
    cleanupPaths.add(basePath);
    cleanupPaths.add(outsidePath);

    await fs.symlink(
      outsidePath,
      path.join(basePath, 'memory'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    await expect(resolveSafeSyncPath(
      basePath,
      'memory/escape.json',
      ENABLED_ROOTS,
    )).rejects.toThrow(/symlink|outside/i);
  });
});
