/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { TASK_LIFECYCLE, TaskManager } from '../../../src/core/teams/TaskManager.js';
import {
  InvalidTransitionError,
  reachableStates,
  StateMachine,
  terminalStates,
} from '../../../src/utils/stateMachine.js';
import { randomEventWalk } from '../../helpers/stateMachineProperties.js';

describe('TASK_LIFECYCLE', () => {
  const events = ['claim', 'complete', 'fail', 'cancel', 'release'] as const;

  it('declares the allowed team task edges', () => {
    expect(TASK_LIFECYCLE.initial).toBe('pending');
    expect(TASK_LIFECYCLE.transitions).toEqual({
      pending: { claim: 'in_progress', complete: 'completed', fail: 'failed', cancel: 'cancelled' },
      in_progress: { complete: 'completed', fail: 'failed', cancel: 'cancelled', release: 'pending' },
      completed: { release: 'pending' },
      failed: { release: 'pending' },
      cancelled: { release: 'pending' },
    });
  });

  it('has no dead ends and every status is reachable', () => {
    expect(terminalStates(TASK_LIFECYCLE)).toEqual([]);
    expect(reachableStates(TASK_LIFECYCLE)).toEqual(new Set(Object.keys(TASK_LIFECYCLE.transitions)));
  });

  it.each([
    ['in_progress', 'claim'],
    ['completed', 'claim'],
    ['failed', 'claim'],
    ['cancelled', 'claim'],
    ['completed', 'fail'],
    ['failed', 'complete'],
    ['cancelled', 'complete'],
    ['pending', 'release'],
  ] as const)('rejects %s --%s', (from, event) => {
    const machine = new StateMachine(TASK_LIFECYCLE, { initial: from });
    expect(machine.trySend(event)).toBe(false);
    expect(machine.state).toBe(from);
  });

  it('accepts exactly the declared edges on seeded random walks', () => {
    randomEventWalk(TASK_LIFECYCLE, events, { seeds: 25, steps: 60 });
  });
});

describe('TaskManager lifecycle guards', () => {
  let tm: TaskManager;

  beforeEach(() => {
    tm = new TaskManager();
  });

  it('refuses a second teammate claiming a task that is already in progress', () => {
    const task = tm.createTask({ subject: 'A', description: '' });
    tm.assignTask(task.id, 'alice', 'run-a');

    expect(() => tm.assignTask(task.id, 'bob', 'run-b')).toThrow(InvalidTransitionError);
    expect(tm.getTask(task.id)).toMatchObject({ status: 'in_progress', owner: 'alice', runId: 'run-a' });
  });

  it.each(['completed', 'failed', 'cancelled'] as const)('refuses to re-claim a %s task without an explicit retry', (status) => {
    const task = tm.createTask({ subject: 'A', description: '' });
    tm.assignTask(task.id, 'alice', 'run-a');
    tm.updateTask(task.id, { status, output: 'done' });

    expect(() => tm.assignTask(task.id, 'bob', 'run-b')).toThrow(InvalidTransitionError);
    expect(tm.getTask(task.id)).toMatchObject({ status, owner: 'alice', output: 'done' });

    tm.releaseTask(task.id);
    tm.assignTask(task.id, 'bob', 'run-b');
    expect(tm.getTask(task.id)).toMatchObject({ status: 'in_progress', owner: 'bob', runId: 'run-b' });
  });

  it('refuses to claim a task whose dependencies have not completed', () => {
    const first = tm.createTask({ subject: 'A', description: '' });
    const second = tm.createTask({ subject: 'B', description: '', blockedBy: [first.id] });

    expect(() => tm.assignTask(second.id, 'bob')).toThrow(/blocked/);
    expect(tm.getTask(second.id)?.status).toBe('pending');
    expect(tm.getTask(second.id)?.owner).toBeUndefined();

    tm.assignTask(first.id, 'alice');
    tm.completeTask(first.id);
    tm.assignTask(second.id, 'bob');
    expect(tm.getTask(second.id)?.status).toBe('in_progress');
  });

  it('never leaves an ownerless task in progress where no teammate would run or report it', () => {
    const task = tm.createTask({ subject: 'A', description: 'old' });

    expect(() => tm.updateTask(task.id, { status: 'in_progress', description: 'new' })).toThrow(/claim/);
    expect(tm.getTask(task.id)).toMatchObject({ status: 'pending', description: 'old' });
    expect(tm.getAvailableTasks().map(({ id }) => id)).toEqual([task.id]);
  });

  it('keeps a finished outcome instead of overwriting it with a different one', () => {
    const task = tm.createTask({ subject: 'A', description: '' });
    tm.assignTask(task.id, 'alice');
    tm.completeTask(task.id);
    const completedAt = tm.getTask(task.id)?.completedAt;

    expect(() => tm.updateTask(task.id, { status: 'failed', error: 'late failure' })).toThrow(InvalidTransitionError);
    expect(() => tm.stopTask(task.id)).toThrow(InvalidTransitionError);
    expect(tm.getTask(task.id)).toMatchObject({ status: 'completed', completedAt, error: undefined });
  });

  it('treats repeating the current status as a field-only update', () => {
    const task = tm.createTask({ subject: 'A', description: '' });
    tm.assignTask(task.id, 'alice');
    tm.completeTask(task.id);
    const completedAt = tm.getTask(task.id)?.completedAt;

    const updated = tm.updateTask(task.id, { status: 'completed', subject: 'Renamed' });

    expect(updated).toMatchObject({ status: 'completed', subject: 'Renamed', completedAt });
  });

  it('starts a fresh claim without a cancellation left over from before', () => {
    const task = tm.createTask({ subject: 'A', description: '' });
    tm.updateTask(task.id, { cancelRequested: true });

    tm.assignTask(task.id, 'alice', 'run-a');

    expect(tm.getTask(task.id)?.cancelRequested).toBeUndefined();
  });

  it('lets the lead resolve, cancel or retry work directly', () => {
    const resolved = tm.createTask({ subject: 'Resolved', description: '' });
    const queued = tm.createTask({ subject: 'Queued', description: '' });

    expect(tm.updateTask(resolved.id, { status: 'completed' }).status).toBe('completed');
    expect(tm.stopTask(queued.id).status).toBe('cancelled');
    expect(tm.updateTask(queued.id, { status: 'pending' })).toMatchObject({ status: 'pending', completedAt: undefined });
  });
});
