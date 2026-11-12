/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('FileActionManager patch application', () => {
  let workspaceRoot: string;
  let files: FileActionManager;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-fs-patch-'));
    files = new FileActionManager(workspaceRoot);
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it.each([
    ['anchored', '@@\n import AppKit\n+import Combine\n'],
    ['enveloped', '*** Begin Patch\n*** Update File: A.swift\n@@\n import AppKit\n+import Combine\n*** End Patch\n'],
    ['headered anchored', '--- a/A.swift\n+++ b/A.swift\n@@\n import AppKit\n+import Combine\n'],
    ['offset numbered', '@@ -13,1 +13,2 @@\n import AppKit\n+import Combine\n'],
  ])('applies %s hunks instead of reporting an unchanged file', async (_format, patch) => {
    await fs.writeFile(path.join(workspaceRoot, 'A.swift'), 'import AppKit\n\nfinal class A {}\n');

    await files.applyPatch('A.swift', patch);

    await expect(fs.readFile(path.join(workspaceRoot, 'A.swift'), 'utf8'))
      .resolves.toBe('import AppKit\nimport Combine\n\nfinal class A {}\n');
  });

  it('applies multiple context-anchored hunks in order', async () => {
    await fs.writeFile(path.join(workspaceRoot, 'A.swift'), 'import AppKit\n\nvar x = 1\n\nfunc f() {}\n');

    await files.applyPatch('A.swift', '@@\n import AppKit\n+import Combine\n@@\n-var x = 1\n+var x = 2\n');

    await expect(fs.readFile(path.join(workspaceRoot, 'A.swift'), 'utf8'))
      .resolves.toBe('import AppKit\nimport Combine\n\nvar x = 2\n\nfunc f() {}\n');
  });

  it.each(['@@', '@@ -1,2 +1,3 @@'])('tolerates indentation and trailing whitespace in %s context while preserving actual context', async (header) => {
    await fs.writeFile(path.join(workspaceRoot, 'A.swift'), '    func f() {  \n        print(1)\n    }\n');

    await files.applyPatch('A.swift', `${header}\n   func f() {\n+        print(0)\n         print(1)\n`);

    await expect(fs.readFile(path.join(workspaceRoot, 'A.swift'), 'utf8'))
      .resolves.toBe('    func f() {  \n        print(0)\n        print(1)\n    }\n');
  });

  it.each([
    ['', /no hunks/i],
    ['--- a/A.swift\n+++ b/A.swift\n', /no hunks/i],
    ['not a patch', /no hunks/i],
    ['@@\n import AppKit\n', /no changes|no additions or deletions/i],
    ['@@ -1 +1 @@\n-import AppKit\n+import AppKit\n', /no changes|unchanged/i],
  ])('rejects a patch that cannot change the file: %j', async (patch, error) => {
    const target = path.join(workspaceRoot, 'A.swift');
    await fs.writeFile(target, 'import AppKit\n');

    await expect(files.applyPatch('A.swift', patch)).rejects.toThrow(error);

    await expect(fs.readFile(target, 'utf8')).resolves.toBe('import AppKit\n');
  });

  it('rejects ambiguous anchored context without modifying either occurrence', async () => {
    const current = 'var x = 1\n\nvar x = 1\n';
    await fs.writeFile(path.join(workspaceRoot, 'A.swift'), current);

    await expect(files.applyPatch('A.swift', '@@\n-var x = 1\n+var x = 2\n'))
      .rejects.toThrow(/hunk 1.*ambiguous/i);

    await expect(fs.readFile(path.join(workspaceRoot, 'A.swift'), 'utf8')).resolves.toBe(current);
  });

  it('rejects labeled unnumbered headers instead of editing a different function', async () => {
    const current = 'function earlier() {\n  old();\n}\nfunction target() {\n  unrelated();\n}\n';
    const target = path.join(workspaceRoot, 'example.ts');
    await fs.writeFile(target, current);

    await expect(files.applyPatch('example.ts', '@@ function target() {\n-  old();\n+  replacement();\n'))
      .rejects.toThrow(/hunk 1.*invalid header.*Use @@/i);

    await expect(fs.readFile(target, 'utf8')).resolves.toBe(current);
  });

  it('does not tolerate a different removal line even when context whitespace may vary', async () => {
    const current = 'func f() {\n  print(1)\n}\n';
    await fs.writeFile(path.join(workspaceRoot, 'A.swift'), current);

    await expect(files.applyPatch('A.swift', '@@\n func f() {\n-    print(1)\n+    print(2)\n }\n'))
      .rejects.toThrow(/hunk 1/i);

    await expect(fs.readFile(path.join(workspaceRoot, 'A.swift'), 'utf8')).resolves.toBe(current);
  });

  it('reports the failed hunk with nearby numbered source lines and applies no earlier hunks', async () => {
    const current = 'import AppKit\n\nvar x = 1\n';
    await fs.writeFile(path.join(workspaceRoot, 'A.swift'), current);

    await expect(files.applyPatch('A.swift', '@@\n import AppKit\n+import Combine\n@@\n-var x = 9\n+var x = 2\n'))
      .rejects.toThrow(/hunk 2[\s\S]*var x = 9[\s\S]*3: var x = 1/i);

    await expect(fs.readFile(path.join(workspaceRoot, 'A.swift'), 'utf8')).resolves.toBe(current);
  });

  it('rejects an envelope targeting a different file', async () => {
    await fs.writeFile(path.join(workspaceRoot, 'A.swift'), 'import AppKit\n');

    await expect(files.applyPatch('A.swift', '*** Begin Patch\n*** Update File: B.swift\n@@\n import AppKit\n+import Combine\n*** End Patch\n'))
      .rejects.toThrow(/target.*does not match/i);

    await expect(fs.readFile(path.join(workspaceRoot, 'A.swift'), 'utf8')).resolves.toBe('import AppKit\n');
  });

  it('accepts different path spellings that resolve to the same envelope target', async () => {
    await fs.writeFile(path.join(workspaceRoot, 'A.swift'), 'import AppKit\n');
    const alias = path.join(workspaceRoot, 'alias');
    await fs.symlink(workspaceRoot, alias, process.platform === 'win32' ? 'junction' : 'dir');

    await files.applyPatch(path.join(alias, 'A.swift'), '*** Begin Patch\n*** Update File: A.swift\n@@\n import AppKit\n+import Combine\n*** End Patch');

    await expect(fs.readFile(path.join(workspaceRoot, 'A.swift'), 'utf8')).resolves.toBe('import AppKit\nimport Combine\n');
  });

  it('rejects multiple file updates instead of silently applying only one', async () => {
    await fs.writeFile(path.join(workspaceRoot, 'A.swift'), 'import AppKit\n');

    await expect(files.applyPatch('A.swift', '*** Begin Patch\n*** Update File: A.swift\n@@\n import AppKit\n+import Combine\n*** Update File: B.swift\n@@\n-old\n+new\n*** End Patch\n'))
      .rejects.toThrow(/single.file|one file/i);

    await expect(fs.readFile(path.join(workspaceRoot, 'A.swift'), 'utf8')).resolves.toBe('import AppKit\n');
  });
});
