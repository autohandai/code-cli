/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';

import { FILE_LIMITS, FileActionManager } from '../../src/actions/filesystem.js';

type SymlinkType = 'file' | 'dir';

function isWindowsSymlinkPrivilegeError(error: unknown): boolean {
  if (process.platform !== 'win32' || !(error instanceof Error)) {
    return false;
  }

  const code = (error as NodeJS.ErrnoException).code;
  return code === 'EPERM' || code === 'EACCES';
}

async function createSymlinkIfPermitted(
  target: string,
  linkPath: string,
  type: SymlinkType
): Promise<boolean> {
  try {
    await fs.symlink(target, linkPath, type);
    return true;
  } catch (error) {
    if (isWindowsSymlinkPrivilegeError(error)) {
      return false;
    }
    throw error;
  }
}

function semanticFiles(manager: FileActionManager, query: string, relativePath = 'search'): string[] {
  return manager.semanticSearch(query, { limit: 20, relativePath }).map((result) => result.file);
}

function fallbackFiles(manager: FileActionManager, query: string, relativePath = 'search'): string[] {
  return manager.search(query, relativePath).map((result) => result.file);
}

function expectContainedDisplayPaths(files: string[]): void {
  for (const file of files) {
    expect(path.isAbsolute(file)).toBe(false);
    expect(file.split(/[\\/]+/)).not.toContain('..');
  }
}

describe('filesystem search symlink containment', () => {
  let tempRoot: string;
  let workspaceRoot: string;
  let searchRoot: string;
  let targetRoot: string;
  let outsideRoot: string;
  let additionalRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-search-symlinks-'));
    workspaceRoot = path.join(tempRoot, 'workspace');
    searchRoot = path.join(workspaceRoot, 'search');
    targetRoot = path.join(workspaceRoot, 'targets');
    outsideRoot = path.join(tempRoot, 'outside');
    additionalRoot = path.join(tempRoot, 'additional');

    await Promise.all([
      fs.ensureDir(searchRoot),
      fs.ensureDir(targetRoot),
      fs.ensureDir(outsideRoot),
      fs.ensureDir(additionalRoot),
    ]);
  });

  afterEach(async () => {
    await fs.remove(tempRoot);
  });

  function createManager(additionalDirs: string[] = []): FileActionManager {
    return new FileActionManager(
      workspaceRoot,
      additionalDirs,
      () => '__missing_rg_for_filesystem_symlink_test__'
    );
  }

  it('treats a leading-dash query as a literal native ripgrep pattern', async () => {
    await fs.writeFile(path.join(searchRoot, 'leading-dash.txt'), '--files\n');
    const manager = new FileActionManager(workspaceRoot);

    expect(manager.search('--files', 'search')).toEqual([
      {
        file: path.join('search', 'leading-dash.txt'),
        line: 1,
        text: '--files',
      },
    ]);
  });

  it('places all leading-dash queries after the native ripgrep option terminator', async () => {
    const capturePath = path.join(tempRoot, 'ripgrep-arguments.json');
    const scriptPath = path.join(tempRoot, 'capture-ripgrep-arguments.mjs');
    const commandPath = process.platform === 'win32'
      ? path.join(tempRoot, 'capture-ripgrep-arguments.cmd')
      : scriptPath;
    const script = [
      process.platform === 'win32' ? '' : `#!${process.execPath}`,
      "import fs from 'node:fs';",
      `fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify(process.argv.slice(2)));`,
    ].filter(Boolean).join('\n');
    await fs.writeFile(scriptPath, script);
    if (process.platform === 'win32') {
      await fs.writeFile(
        commandPath,
        `@\"${process.execPath}\" \"${scriptPath}\" %*\r\n`,
      );
    } else {
      await fs.chmod(scriptPath, 0o700);
    }
    const manager = new FileActionManager(workspaceRoot, [], () => commandPath);
    const leadingDashQueries = [
      '--files',
      `--pre=${path.join(tempRoot, 'untrusted-preprocessor')}`,
    ];

    for (const query of leadingDashQueries) {
      manager.search(query, 'search');
      const capturedArguments = await fs.readJson(capturePath) as string[];
      expect(capturedArguments.slice(-3)).toEqual(['--', query, '.']);
    }
  });

  it('blocks outside file symlinks in semantic and forced fallback search', async () => {
    const sentinel = 'OUTSIDE_FILE_SENTINEL';
    const outsideFile = path.join(outsideRoot, 'outside-file.txt');
    await fs.writeFile(outsideFile, sentinel);
    if (!await createSymlinkIfPermitted(
      outsideFile,
      path.join(searchRoot, 'outside-file.txt'),
      'file'
    )) {
      return;
    }

    const manager = createManager();

    expect({
      semantic: manager.semanticSearch(sentinel, { limit: 20, relativePath: 'search' }),
      fallback: manager.search(sentinel, 'search'),
    }).toEqual({ semantic: [], fallback: [] });
  });

  it('blocks outside directory symlinks in semantic and forced fallback search', async () => {
    const sentinel = 'OUTSIDE_DIRECTORY_SENTINEL';
    await fs.writeFile(path.join(outsideRoot, 'outside-directory-file.txt'), sentinel);
    if (!await createSymlinkIfPermitted(
      outsideRoot,
      path.join(searchRoot, 'outside-directory'),
      'dir'
    )) {
      return;
    }

    const manager = createManager();

    expect({
      semantic: manager.semanticSearch(sentinel, { limit: 20, relativePath: 'search' }),
      fallback: manager.search(sentinel, 'search'),
    }).toEqual({ semantic: [], fallback: [] });
  });

  it('searches a contained directory symlink once with its logical workspace path', async () => {
    const sentinel = 'CONTAINED_SYMLINK_SENTINEL';
    const targetDirectory = path.join(targetRoot, 'contained');
    await fs.ensureDir(targetDirectory);
    await fs.writeFile(path.join(targetDirectory, 'contained.txt'), sentinel);
    if (!await createSymlinkIfPermitted(
      targetDirectory,
      path.join(searchRoot, 'contained-link'),
      'dir'
    )) {
      return;
    }

    const manager = createManager();
    const semantic = semanticFiles(manager, sentinel);
    const fallback = fallbackFiles(manager, sentinel);

    expect(semantic).toEqual([path.join('search', 'contained-link', 'contained.txt')]);
    expect(fallback).toEqual([path.join('search', 'contained-link', 'contained.txt')]);
    expectContainedDisplayPaths([...semantic, ...fallback]);
  });

  it('searches an additional-root directory symlink once with its logical workspace path', async () => {
    const sentinel = 'ADDITIONAL_ROOT_SYMLINK_SENTINEL';
    await fs.writeFile(path.join(additionalRoot, 'additional.txt'), sentinel);
    if (!await createSymlinkIfPermitted(
      additionalRoot,
      path.join(searchRoot, 'additional-link'),
      'dir'
    )) {
      return;
    }

    const manager = createManager([additionalRoot]);
    const semantic = semanticFiles(manager, sentinel);
    const fallback = fallbackFiles(manager, sentinel);

    expect(semantic).toEqual([path.join('search', 'additional-link', 'additional.txt')]);
    expect(fallback).toEqual([path.join('search', 'additional-link', 'additional.txt')]);
    expectContainedDisplayPaths([...semantic, ...fallback]);
  });

  it('terminates symlink cycles and deduplicates files by real path', async () => {
    const sentinel = 'SYMLINK_CYCLE_SENTINEL';
    const cycleRoot = path.join(searchRoot, 'cycle');
    await fs.ensureDir(cycleRoot);
    await fs.writeFile(path.join(cycleRoot, 'cycle.txt'), sentinel);
    if (!await createSymlinkIfPermitted(cycleRoot, path.join(cycleRoot, 'loop'), 'dir')) {
      return;
    }

    const manager = createManager();
    const startedAt = performance.now();
    const semantic = semanticFiles(manager, sentinel);
    const fallback = fallbackFiles(manager, sentinel);

    expect(performance.now() - startedAt).toBeLessThan(1_000);
    expect(semantic).toEqual([path.join('search', 'cycle', 'cycle.txt')]);
    expect(fallback).toEqual([path.join('search', 'cycle', 'cycle.txt')]);
  }, 5_000);

  it('skips broken symlinks without failing either walker', async () => {
    const brokenTarget = path.join(targetRoot, 'missing.txt');
    if (!await createSymlinkIfPermitted(
      brokenTarget,
      path.join(searchRoot, 'broken-link.txt'),
      'file'
    )) {
      return;
    }

    const manager = createManager();

    expect(() => manager.semanticSearch('missing', { limit: 20, relativePath: 'search' })).not.toThrow();
    expect(() => manager.search('missing', 'search')).not.toThrow();
    expect(semanticFiles(manager, 'missing')).toEqual([]);
    expect(fallbackFiles(manager, 'missing')).toEqual([]);
  });

  it('uses additional-root-relative display paths without an escaping segment', async () => {
    const sentinel = 'ADDITIONAL_ROOT_DISPLAY_SENTINEL';
    await fs.writeFile(path.join(additionalRoot, 'display.txt'), sentinel);
    const manager = createManager([additionalRoot]);

    const semantic = semanticFiles(manager, sentinel, additionalRoot);
    const fallback = fallbackFiles(manager, sentinel, additionalRoot);

    expect(semantic).toEqual(['display.txt']);
    expect(fallback).toEqual(['display.txt']);
    expectContainedDisplayPaths([...semantic, ...fallback]);
  });

  it('skips oversized files reached through contained symlinks before reading', async () => {
    const sentinel = 'OVERSIZED_SYMLINK_SENTINEL';
    const oversizedFile = path.join(targetRoot, 'oversized.txt');
    await fs.writeFile(oversizedFile, sentinel);
    await fs.truncate(oversizedFile, FILE_LIMITS.MAX_READ_SIZE + 1);
    if (!await createSymlinkIfPermitted(
      oversizedFile,
      path.join(searchRoot, 'oversized-link.txt'),
      'file'
    )) {
      return;
    }

    const manager = createManager();

    expect(manager.semanticSearch(sentinel, { limit: 20, relativePath: 'search' })).toEqual([]);
    expect(manager.search(sentinel, 'search')).toEqual([]);
  });

  it('does not let contained symlinks alias hidden, ignored, or built-in excluded targets', async () => {
    const hiddenSentinel = 'HIDDEN_ALIAS_SENTINEL';
    const ignoredSentinel = 'IGNORED_ALIAS_SENTINEL';
    const dependencySentinel = 'DEPENDENCY_ALIAS_SENTINEL';
    const ignoredDir = path.join(workspaceRoot, 'private');
    const dependencyDir = path.join(workspaceRoot, 'node_modules', 'package');
    await fs.ensureDir(ignoredDir);
    await fs.ensureDir(dependencyDir);
    const hiddenFile = path.join(workspaceRoot, '.hidden-secret.txt');
    const ignoredFile = path.join(ignoredDir, 'ignored-secret.txt');
    const dependencyFile = path.join(dependencyDir, 'dependency-secret.txt');
    await fs.writeFile(hiddenFile, hiddenSentinel);
    await fs.writeFile(ignoredFile, ignoredSentinel);
    await fs.writeFile(dependencyFile, dependencySentinel);
    await fs.writeFile(path.join(workspaceRoot, '.gitignore'), 'private/\n');

    const links = [
      [hiddenFile, path.join(searchRoot, 'hidden-alias.txt')],
      [ignoredFile, path.join(searchRoot, 'ignored-alias.txt')],
      [dependencyFile, path.join(searchRoot, 'dependency-alias.txt')],
    ] as const;
    for (const [target, linkPath] of links) {
      if (!await createSymlinkIfPermitted(target, linkPath, 'file')) {
        return;
      }
    }

    const manager = createManager();
    for (const sentinel of [hiddenSentinel, ignoredSentinel, dependencySentinel]) {
      expect(manager.semanticSearch(sentinel, { limit: 20, relativePath: 'search' })).toEqual([]);
      expect(manager.search(sentinel, 'search')).toEqual([]);
    }
  });
});
