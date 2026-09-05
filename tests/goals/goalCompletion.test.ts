/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoalManager } from '../../src/goals/GoalManager.js';

describe('goal completion evidence', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-goal-evidence-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.remove(workspaceRoot);
  });

  it('requires evidence for approved criteria even after the spending floor is met', async () => {
    const manager = new GoalManager(workspaceRoot);
    await manager.createGoal({ objective: 'verified work', acceptanceCriteria: ['Tests pass'], minTokensBeforeWrapUp: 10 });
    await manager.recordTurnUsage({ tokensUsed: 10 });

    const result = await manager.updateGoal({ status: 'complete' });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('completion evidence');
    expect((await manager.getSessionSnapshot()).goal?.status).toBe('active');
  });

  it.each([
    { acceptanceCriteria: [] },
    { acceptanceCriteria: [' '] },
    { acceptanceCriteria: ['Tests pass', 'Tests pass'] },
  ])('rejects invalid acceptance criteria without creating a goal: $acceptanceCriteria', async ({ acceptanceCriteria }) => {
    const manager = new GoalManager(workspaceRoot);

    expect((await manager.createGoal({ objective: 'approved goal', acceptanceCriteria })).ok).toBe(false);
    expect((await manager.getSnapshot()).goals).toEqual({});
  });

  it.each(['failed', 'notRun'] as const)('does not accept a %s check as proof of completion', async (status) => {
    const manager = new GoalManager(workspaceRoot);
    await manager.createGoal({ objective: 'verified work', acceptanceCriteria: ['Tests pass'] });

    const result = await manager.updateGoal({ status: 'complete', completionEvidence: {
      summary: 'The check did not pass', checks: [{ criterion: 'Tests pass', status, evidence: 'test log' }],
    } });

    expect(result.ok).toBe(false);
    expect((await manager.getSessionSnapshot()).goal?.status).toBe('active');
  });

  it('persists reported evidence and approved criteria through queue advancement and reloads', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const manager = new GoalManager(workspaceRoot, { sessionId: 'evidence-owner' });
    await manager.createGoal({ objective: 'first approved goal', acceptanceCriteria: ['Tests pass'] });
    await manager.createOrQueueGoal({ objective: 'second approved goal', acceptanceCriteria: ['Build passes'], source: 'tool' });
    const completionEvidence = {
      summary: 'Verified the requested behavior',
      checks: [{ criterion: 'Tests pass', status: 'passed' as const, evidence: 'test log: 12 passed; artifacts/tests.log' }],
    };

    const result = await manager.updateGoal({ status: 'complete', completionEvidence });

    expect(result.ok).toBe(true);
    expect(result.completed?.completionReceipt).toMatchObject({
      ...completionEvidence, recordedAt: 1_800_000_000_000, provenance: 'reported',
    });
    const reloaded = await new GoalManager(workspaceRoot, { sessionId: 'evidence-owner' }).getSessionSnapshot();
    expect(reloaded.goal?.acceptanceCriteria).toEqual(['Build passes']);
    expect(reloaded.completed[0]).toMatchObject({
      acceptanceCriteria: ['Tests pass'], completionReceipt: result.completed?.completionReceipt,
    });
  });

  it('keeps legacy goals completable without adding a new evidence requirement', async () => {
    const manager = new GoalManager(workspaceRoot);
    await manager.createGoal({ objective: 'legacy completion contract' });

    expect((await manager.updateGoal({ status: 'complete' })).ok).toBe(true);
  });

  it.each([
    { checks: [] },
    { checks: [{ criterion: 'Something else', status: 'passed', evidence: 'log' }] },
    { checks: [{ criterion: 'Tests pass', status: 'passed', evidence: ' ' }] },
    { checks: [{ criterion: 'Tests pass', status: 'unknown', evidence: 'log' }] },
    { checks: Array.from({ length: 2 }, () => ({ criterion: 'Tests pass', status: 'passed', evidence: 'log' })) },
  ])('rejects incomplete or invalid runtime evidence: $checks', async ({ checks }) => {
    const manager = new GoalManager(workspaceRoot);
    await manager.createGoal({ objective: 'verified work', acceptanceCriteria: ['Tests pass'] });
    const completionEvidence = JSON.parse(JSON.stringify({ summary: 'Checked', checks }));

    expect((await manager.updateGoal({ status: 'complete', completionEvidence })).ok).toBe(false);
    expect((await manager.getSessionSnapshot()).goal?.status).toBe('active');
  });

  it('requires new evidence after reopening and keeps only the latest completion receipt', async () => {
    const manager = new GoalManager(workspaceRoot);
    const created = await manager.createGoal({ objective: 'verified work', acceptanceCriteria: ['Tests pass'] });
    const completionEvidence = { summary: 'First verification', checks: [{ criterion: 'Tests pass', status: 'passed' as const, evidence: 'log' }] };
    await manager.updateGoal({ status: 'complete', completionEvidence });
    expect((await manager.editGoalObjective(created.goal!.goalId, 'Changed scope')).ok).toBe(false);
    await manager.updateGoal({ status: 'active' });
    expect((await manager.getSessionSnapshot()).goal?.completionReceipt).toBeUndefined();
    expect((await manager.updateGoal({ status: 'complete' })).ok).toBe(false);

    await manager.updateGoal({ status: 'complete', completionEvidence: { ...completionEvidence, summary: 'Second verification' } });

    const snapshot = await manager.getSessionSnapshot();
    expect(snapshot.completed).toHaveLength(1);
    expect(snapshot.completed[0].completionReceipt?.summary).toBe('Second verification');
  });
});
