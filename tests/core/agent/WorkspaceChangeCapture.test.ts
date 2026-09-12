/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { WorkspaceChangeCapture } from '../../../src/core/agent/WorkspaceChangeCapture.js';

const execFileAsync = promisify(execFile);
const tempRoots: string[] = [];

async function createGitWorkspace(): Promise<string> {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-workspace-capture-'));
  tempRoots.push(workspaceRoot);
  await execFileAsync('git', ['init'], { cwd: workspaceRoot });
  return workspaceRoot;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.remove(root)));
});

describe('WorkspaceChangeCapture', () => {
  it('reports only changes made after the checkpoint in an already-dirty workspace', async () => {
    const workspaceRoot = await createGitWorkspace();
    await fs.outputFile(path.join(workspaceRoot, 'src/existing.ts'), 'const value = "preexisting";\n');
    await fs.outputFile(path.join(workspaceRoot, 'src/deleted.ts'), 'export const removed = true;\n');

    const capture = await WorkspaceChangeCapture.create(workspaceRoot);
    try {
      const checkpoint = await capture.begin();

      await fs.outputFile(path.join(workspaceRoot, 'src/existing.ts'), 'const value = "tool-change";\n');
      await fs.outputFile(path.join(workspaceRoot, 'src/added.ts'), 'export const added = true;\n');
      await fs.remove(path.join(workspaceRoot, 'src/deleted.ts'));

      const result = await capture.finish(checkpoint);

      expect(result.files.map((file) => [file.kind, file.path])).toEqual([
        ['added', 'src/added.ts'],
        ['deleted', 'src/deleted.ts'],
        ['modified', 'src/existing.ts'],
      ]);
      const edited = result.files.find((file) => file.path === 'src/existing.ts');
      expect(edited).toMatchObject({ additions: 1, deletions: 1 });
      expect(edited?.patch).toContain('-const value = "preexisting";');
      expect(edited?.patch).toContain('+const value = "tool-change";');
    } finally {
      await capture.dispose();
    }
  });

  it('refreshes the baseline before each tool batch', async () => {
    const workspaceRoot = await createGitWorkspace();
    const filePath = path.join(workspaceRoot, 'state.txt');
    await fs.outputFile(filePath, 'initial\n');

    const capture = await WorkspaceChangeCapture.create(workspaceRoot);
    try {
      const firstCheckpoint = await capture.begin();
      await fs.outputFile(filePath, 'first tool\n');
      await capture.finish(firstCheckpoint);

      await fs.outputFile(filePath, 'external edit\n');
      const secondCheckpoint = await capture.begin();
      await fs.outputFile(filePath, 'second tool\n');
      const result = await capture.finish(secondCheckpoint);

      expect(result.files).toHaveLength(1);
      expect(result.files[0]?.patch).toContain('-external edit');
      expect(result.files[0]?.patch).toContain('+second tool');
      expect(result.files[0]?.patch).not.toContain('first tool');
    } finally {
      await capture.dispose();
    }
  });

  it('falls back to an ignore-aware filesystem snapshot outside a Git repository', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-workspace-capture-plain-'));
    tempRoots.push(workspaceRoot);
    await fs.outputFile(path.join(workspaceRoot, '.gitignore'), 'ignored.txt\n');

    const capture = await WorkspaceChangeCapture.create(workspaceRoot);
    try {
      const checkpoint = await capture.begin();
      await fs.outputFile(path.join(workspaceRoot, 'created.txt'), 'created outside git\n');
      await fs.outputFile(path.join(workspaceRoot, 'ignored.txt'), 'do not render\n');
      const result = await capture.finish(checkpoint);

      expect(result.files.map((file) => file.path)).toEqual(['created.txt']);
      expect(result.files[0]).toMatchObject({ kind: 'added', additions: 1, deletions: 0 });
    } finally {
      await capture.dispose();
    }
  });

  it('reports paths relative to a workspace nested inside a Git repository', async () => {
    const repositoryRoot = await createGitWorkspace();
    const workspaceRoot = path.join(repositoryRoot, 'packages/app');
    await fs.outputFile(path.join(workspaceRoot, 'src/index.ts'), 'export const value = 1;\n');

    const capture = await WorkspaceChangeCapture.create(workspaceRoot);
    try {
      const checkpoint = await capture.begin();
      await fs.outputFile(path.join(workspaceRoot, 'src/index.ts'), 'export const value = 2;\n');
      const result = await capture.finish(checkpoint);

      expect(result.files.map((file) => file.path)).toEqual(['src/index.ts']);
    } finally {
      await capture.dispose();
    }
  });
});

describe('workspace change capture budget', () => {
  it('turns a process that outlives its budget into a budget error', async () => {
    const { runProcess, WorkspaceChangeCaptureBudgetError } = await import('../../../src/core/agent/WorkspaceChangeCapture.js');
    await expect(runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { cwd: os.tmpdir(), timeoutMs: 50 }))
      .rejects.toBeInstanceOf(WorkspaceChangeCaptureBudgetError);
    await expect(runProcess(process.execPath, ['-e', 'process.stdout.write("ok")'], { cwd: os.tmpdir(), timeoutMs: 5_000 })).resolves.toBe('ok');
  });

  it('stops capturing after a snapshot exceeds the budget and reports it', async () => {
    const { WorkspaceChangeCapture, WorkspaceChangeCaptureBudgetError } = await import('../../../src/core/agent/WorkspaceChangeCapture.js');
    let calls = 0;
    const backend = {
      snapshot: async () => {
        calls += 1;
        throw new WorkspaceChangeCaptureBudgetError('git add -A', 1);
      },
      diff: async () => ({ files: [], omittedFiles: 0 }),
      dispose: async () => {},
    };
    const capture = WorkspaceChangeCapture.withBackend(backend as never);
    const first = await capture.begin();
    expect(capture.hasExceededBudget()).toBe(true);
    expect(await capture.finish(first)).toEqual({ files: [], omittedFiles: 0 });
    await capture.begin();
    expect(calls).toBe(1);
  });
});
