/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GoalManager } from '../../src/goals/GoalManager.js';

describe('goal storage recovery', () => {
  let workspaceRoot: string;
  let statePath: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-goal-storage-'));
    statePath = path.join(workspaceRoot, '.autohand', 'goals.local.json');
  });

  afterEach(async () => {
    await fs.remove(workspaceRoot);
  });

  it.each([
    '{invalid',
    'null',
    '{}',
    JSON.stringify({ version: 2, goals: {} }),
    JSON.stringify({ version: 2, goals: { owner: { objective: 'must not disappear' } }, queue: [], completed: [] }),
    JSON.stringify({ version: 2, goals: {}, queue: [{ objective: 'must not disappear' }], completed: [] }),
  ])('refuses malformed storage without overwriting it: %s', async (contents) => {
    await fs.outputFile(statePath, contents);
    const manager = new GoalManager(workspaceRoot);

    await expect(manager.getSnapshot()).rejects.toThrow('Goal storage');
    await expect(manager.createGoal({ objective: 'new goal' })).rejects.toThrow('Goal storage');

    expect(await fs.readFile(statePath, 'utf8')).toBe(contents);
  });

  it('refuses future schema versions without silently downgrading them', async () => {
    const contents = JSON.stringify({ version: 99, goals: {}, queue: [], completed: [] });
    await fs.outputFile(statePath, contents);

    await expect(new GoalManager(workspaceRoot).clearGoal()).rejects.toThrow('version 99');
    expect(await fs.readFile(statePath, 'utf8')).toBe(contents);
  });

  it('distinguishes an unreadable storage path from an absent snapshot', async () => {
    await fs.ensureDir(statePath);

    await expect(new GoalManager(workspaceRoot).getSnapshot()).rejects.toThrow('Goal storage');
    expect((await fs.stat(statePath)).isDirectory()).toBe(true);
  });

  it('restores a validated backup only on request and preserves the damaged bytes', async () => {
    const manager = new GoalManager(workspaceRoot);
    const created = await manager.createGoal({ objective: 'recover valuable work' });
    await manager.enqueueGoal({ objective: 'keep the queue', source: 'tool' });
    await manager.recordTurnUsage({ tokensUsed: 42 });
    expect(await fs.pathExists(`${statePath}.backup`)).toBe(true);
    await fs.writeFile(statePath, '{damaged snapshot');

    await expect(manager.getSnapshot()).rejects.toThrow('Goal storage');
    const repair = await manager.repairSnapshot();

    expect(repair.ok).toBe(true);
    const snapshot = await manager.getSessionSnapshot();
    expect(snapshot.goal).toMatchObject({ goalId: created.goal?.goalId, status: 'paused', tokensUsed: 42 });
    expect(snapshot.queue[0]?.objective).toBe('keep the queue');
    expect(repair.recovery?.backupPath).toBe(`${statePath}.backup`);
    const preservedPath = repair.recovery?.preservedPath;
    if (!preservedPath) throw new Error('Expected a preserved damaged snapshot');
    expect(await fs.readFile(preservedPath, 'utf8')).toBe('{damaged snapshot');
    if (process.platform !== 'win32') expect((await fs.stat(preservedPath)).mode & 0o077).toBe(0);
  });

  it('does not reset a missing primary file when a valid backup exists', async () => {
    const manager = new GoalManager(workspaceRoot);
    await manager.createGoal({ objective: 'recover missing primary' });
    await fs.move(statePath, `${statePath}.removed-for-test`);

    await expect(manager.createGoal({ objective: 'must not overwrite backup' })).rejects.toThrow('backup exists');
    expect((await manager.repairSnapshot()).goal?.objective).toBe('recover missing primary');
  });

  it('preserves damaged primary and backup files when recovery is unavailable', async () => {
    const manager = new GoalManager(workspaceRoot);
    await fs.outputFile(statePath, '{damaged primary');

    await expect(manager.repairSnapshot()).rejects.toThrow('no saved backup');
    await fs.outputFile(`${statePath}.backup`, '{damaged backup');
    await expect(manager.repairSnapshot()).rejects.toThrow('Goal storage');

    expect(await fs.readFile(statePath, 'utf8')).toBe('{damaged primary');
    expect(await fs.readFile(`${statePath}.backup`, 'utf8')).toBe('{damaged backup');
  });

  it('does not roll back future schema versions or another live session', async () => {
    const owner = new GoalManager(workspaceRoot, { sessionId: 'live-owner' });
    await owner.createGoal({ objective: 'live work' });
    const future = JSON.stringify({ version: 99, goals: {}, queue: [], completed: [] });
    await fs.writeFile(statePath, future);
    await expect(owner.repairSnapshot()).rejects.toThrow('version 99');
    expect(await fs.readFile(statePath, 'utf8')).toBe(future);

    await fs.writeFile(statePath, '{damaged live state');
    const other = new GoalManager(workspaceRoot, { sessionId: 'other', isSessionAlive: async () => true });
    await expect(other.repairSnapshot()).rejects.toThrow('stop other workspace sessions');
    expect(await fs.readFile(statePath, 'utf8')).toBe('{damaged live state');
  });

  it('reports backup failure without claiming the saved goal failed', async () => {
    const manager = new GoalManager(workspaceRoot);
    await manager.createGoal({ objective: 'initial saved goal' });
    await fs.move(`${statePath}.backup`, `${statePath}.backup-saved-for-test`);
    await fs.ensureDir(`${statePath}.backup`);

    const result = await manager.updateGoal({ objective: 'saved despite unavailable backup' });

    expect(result.ok).toBe(true);
    expect(result.storageWarning).toContain('backup could not be refreshed');
    expect((await manager.getSessionSnapshot()).goal?.objective).toBe('saved despite unavailable backup');
  });

  it('does not overwrite a primary snapshot repaired by another writer during recovery checks', async () => {
    const owner = new GoalManager(workspaceRoot, { sessionId: 'owner' });
    await owner.createGoal({ objective: 'original goal' });
    const refreshed = await owner.getSnapshot();
    refreshed.goals.owner.objective = 'newer repaired goal';
    await fs.writeFile(statePath, '{damaged');
    const recovering = new GoalManager(workspaceRoot, {
      sessionId: 'other',
      isSessionAlive: async () => {
        await fs.writeJson(statePath, refreshed);
        return false;
      },
    });

    await expect(recovering.repairSnapshot()).rejects.toThrow('changed during recovery');
    expect((await owner.getSessionSnapshot()).goal?.objective).toBe('newer repaired goal');
  });
});
