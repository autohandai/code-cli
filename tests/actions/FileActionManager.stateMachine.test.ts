/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FILE_PREVIEW_MODE, FileActionManager } from '../../src/actions/filesystem.js';
import { reachableStates, StateMachine, terminalStates } from '../../src/utils/stateMachine.js';
import { randomEventWalk } from '../helpers/stateMachineProperties.js';

describe('FILE_PREVIEW_MODE transition table', () => {
  const events = ['enterPreview', 'exitPreview'] as const;

  it('declares the preview edges', () => {
    expect(FILE_PREVIEW_MODE.initial).toBe('direct');
    expect(FILE_PREVIEW_MODE.transitions).toEqual({
      direct: { enterPreview: 'preview' },
      preview: { enterPreview: 'preview', exitPreview: 'direct' },
    });
  });

  it('rejects leaving preview when it was never entered', () => {
    expect(new StateMachine(FILE_PREVIEW_MODE).can('exitPreview')).toBe(false);
  });

  it('has no terminal state and reaches every state', () => {
    expect(terminalStates(FILE_PREVIEW_MODE)).toEqual([]);
    expect(reachableStates(FILE_PREVIEW_MODE)).toEqual(new Set(['direct', 'preview']));
  });

  it('accepts exactly the declared edges under random event walks', () => {
    randomEventWalk(FILE_PREVIEW_MODE, events, { seeds: 50, steps: 40 });
  });
});

describe('FileActionManager preview mode while applying', () => {
  let workspaceRoot: string;
  let files: FileActionManager;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-preview-sm-'));
    files = new FileActionManager(workspaceRoot);
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  async function previewWrite(name: string, contents: string): Promise<void> {
    await files.writeFile(name, contents);
  }

  it('stays in preview with a consistent batch id while changes are being applied', async () => {
    files.enterPreviewMode('batch-1');
    await previewWrite('a.txt', 'a');
    const applying = files.applyPendingChanges();
    expect(files.isInPreviewMode()).toBe(true);
    expect(files.getBatchId()).toBe('batch-1');
    await applying;
    expect(files.isInPreviewMode()).toBe(true);
  });

  it('does not re-enter preview when the caller exits while an apply is in flight', async () => {
    files.enterPreviewMode('batch-1');
    await previewWrite('a.txt', 'a');
    const applying = files.applyPendingChanges();
    files.exitPreviewMode();
    await applying;
    expect(files.isInPreviewMode()).toBe(false);
    expect(files.getBatchId()).toBeNull();
    await files.writeFile('after.txt', 'direct');
    expect(await fs.readFile(path.join(workspaceRoot, 'after.txt'), 'utf8')).toBe('direct');
  });

  it('keeps preview on when overlapping applies finish in reverse order', async () => {
    files.enterPreviewMode('batch-1');
    await previewWrite('a.txt', 'a');
    const first = files.applyPendingChanges();
    const second = files.applyPendingChanges();
    await Promise.all([second, first]);
    expect(files.isInPreviewMode()).toBe(true);
  });

  it('batches a concurrent tool write instead of bypassing review during an apply', async () => {
    files.enterPreviewMode('batch-1');
    await previewWrite('a.txt', 'a');
    const applying = files.applyPendingChanges();
    await files.writeFile('concurrent.txt', 'unreviewed');
    await applying;
    await expect(fs.readFile(path.join(workspaceRoot, 'concurrent.txt'), 'utf8')).rejects.toThrow();
    expect(files.getPendingChanges().map(change => change.filePath)).toEqual(['concurrent.txt']);
  });

  it('applies each pending change exactly once across overlapping applies', async () => {
    files.enterPreviewMode('batch-1');
    await previewWrite('a.txt', 'a');
    await previewWrite('b.txt', 'b');
    const [first, second] = await Promise.all([files.applyPendingChanges(), files.applyPendingChanges()]);
    expect([...first.applied, ...second.applied].sort()).toEqual(['change_batch-1_1', 'change_batch-1_2']);
    expect([...first.errors, ...second.errors]).toEqual([]);
    expect(files.getPendingChanges()).toEqual([]);
    await files.undoLast();
    await files.undoLast();
    await expect(files.undoLast()).rejects.toThrow();
  });

  it('keeps a change from a new batch with a reused id pending after an older apply settles', async () => {
    files.enterPreviewMode('batch');
    await previewWrite('a.txt', 'a');
    const applying = files.applyPendingChanges();
    files.enterPreviewMode('batch');
    await previewWrite('b.txt', 'b');
    await applying;
    expect(files.getPendingChanges().map(change => change.filePath)).toEqual(['b.txt']);
  });
});
