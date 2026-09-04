/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UndoStackEmptyError } from '../../src/actions/filesystem.js';
import { undo, type UndoCommandContext } from '../../src/commands/undo.js';

describe('/undo command', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-undo-'));
    execFileSync('git', ['init'], { cwd: workspaceRoot, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'tests@autohand.ai'], { cwd: workspaceRoot });
    execFileSync('git', ['config', 'user.name', 'Autohand Tests'], { cwd: workspaceRoot });
    await fs.writeFile(path.join(workspaceRoot, 'user-notes.txt'), 'committed\n');
    await fs.writeFile(path.join(workspaceRoot, 'agent-owned.txt'), 'before agent\n');
    execFileSync('git', ['add', '--', '.'], { cwd: workspaceRoot });
    execFileSync('git', ['commit', '-m', 'test fixture'], { cwd: workspaceRoot, stdio: 'ignore' });
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('reverts the agent-owned mutation without changing unrelated user work', async () => {
    await fs.writeFile(path.join(workspaceRoot, 'user-notes.txt'), 'uncommitted user edit\n');
    await fs.writeFile(path.join(workspaceRoot, 'untracked-user-notes.txt'), 'keep me\n');
    await fs.writeFile(path.join(workspaceRoot, 'agent-owned.txt'), 'changed by agent\n');

    const undoFileMutation = vi.fn(async () => {
      await fs.writeFile(path.join(workspaceRoot, 'agent-owned.txt'), 'before agent\n');
    });
    const removeLastTurn = vi.fn();
    const context: UndoCommandContext = {
      undoFileMutation,
      removeLastTurn,
    };

    await undo(context);

    await expect(fs.readFile(path.join(workspaceRoot, 'user-notes.txt'), 'utf8'))
      .resolves.toBe('uncommitted user edit\n');
    await expect(fs.readFile(path.join(workspaceRoot, 'untracked-user-notes.txt'), 'utf8'))
      .resolves.toBe('keep me\n');
    await expect(fs.readFile(path.join(workspaceRoot, 'agent-owned.txt'), 'utf8'))
      .resolves.toBe('before agent\n');
    expect(undoFileMutation).toHaveBeenCalledOnce();
    expect(removeLastTurn).toHaveBeenCalledOnce();
  });

  it('keeps the conversation turn when the mutation cannot be safely reverted', async () => {
    const conflictMessage = 'Cannot undo because the file changed after the agent mutation';
    const removeLastTurn = vi.fn();
    const context: UndoCommandContext = {
      undoFileMutation: vi.fn().mockRejectedValue(new Error(conflictMessage)),
      removeLastTurn,
    };

    await undo(context);

    expect(removeLastTurn).not.toHaveBeenCalled();
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain(conflictMessage);
  });

  it('removes the conversation turn when there is no file mutation to revert', async () => {
    const removeLastTurn = vi.fn();
    const context: UndoCommandContext = {
      undoFileMutation: vi.fn().mockRejectedValue(new UndoStackEmptyError()),
      removeLastTurn,
    };

    await undo(context);

    expect(removeLastTurn).toHaveBeenCalledOnce();
    expect(vi.mocked(console.log).mock.calls.flat().join('\n'))
      .toContain('Undo complete. Ready for new instructions.');
  });
});
