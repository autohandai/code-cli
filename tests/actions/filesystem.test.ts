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

describe('FileActionManager undo', () => {
  it('removes a file created by the last agent mutation', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-fs-undo-'));

    try {
      const files = new FileActionManager(workspaceRoot);
      const createdPath = path.join(workspaceRoot, 'created-by-agent.txt');

      await files.writeFile('created-by-agent.txt', 'agent output\n');
      await files.undoLast();

      expect(existsSync(createdPath)).toBe(false);
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('refuses to overwrite user edits made after the agent mutation', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-fs-undo-'));

    try {
      const files = new FileActionManager(workspaceRoot);
      const createdPath = path.join(workspaceRoot, 'created-by-agent.txt');

      await files.writeFile('created-by-agent.txt', 'agent output\n');
      await fs.writeFile(createdPath, 'newer user edit\n');

      await expect(files.undoLast()).rejects.toThrow('changed after the agent mutation');
      await expect(fs.readFile(createdPath, 'utf8')).resolves.toBe('newer user edit\n');
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('refuses to restore an existing file over a newer user edit', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-fs-undo-'));

    try {
      const files = new FileActionManager(workspaceRoot);
      const editedPath = path.join(workspaceRoot, 'shared.txt');
      await fs.writeFile(editedPath, 'before agent\n');

      await files.writeFile('shared.txt', 'agent output\n');
      await fs.writeFile(editedPath, 'newer user edit\n');

      await expect(files.undoLast()).rejects.toThrow('changed after the agent mutation');
      await expect(fs.readFile(editedPath, 'utf8')).resolves.toBe('newer user edit\n');
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('restores a file deleted by the last agent mutation', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-fs-undo-'));

    try {
      const files = new FileActionManager(workspaceRoot);
      const deletedPath = path.join(workspaceRoot, 'deleted-by-agent.txt');
      await fs.writeFile(deletedPath, 'restore me\n');

      await files.deletePath('deleted-by-agent.txt');
      await files.undoLast();

      await expect(fs.readFile(deletedPath, 'utf8')).resolves.toBe('restore me\n');
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('refuses to fabricate a restoration for a deleted directory', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-fs-undo-'));

    try {
      const files = new FileActionManager(workspaceRoot);
      const deletedDirectory = path.join(workspaceRoot, 'deleted-directory');
      await fs.mkdir(deletedDirectory);
      await fs.writeFile(path.join(deletedDirectory, 'nested.txt'), 'nested contents\n');

      await files.deletePath('deleted-directory');

      await expect(files.undoLast()).rejects.toThrow('directory deletion');
      expect(existsSync(deletedDirectory)).toBe(false);
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
