/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { TaskManager } from '../../../src/core/teams/TaskManager.js';

describe('TaskManager', () => {
  let tm: TaskManager;

  beforeEach(() => {
    tm = new TaskManager();
  });

  it('should create a task with auto-generated ID', () => {
    const task = tm.createTask({ subject: 'Fix bug', description: 'Fix the bug' });
    expect(task.id).toMatch(/^task-\d+$/);
    expect(task.status).toBe('pending');
    expect(task.blockedBy).toEqual([]);
  });

  it('should list all tasks', () => {
    tm.createTask({ subject: 'A', description: '' });
    tm.createTask({ subject: 'B', description: '' });
    expect(tm.listTasks()).toHaveLength(2);
  });

  it('should get a task by ID', () => {
    const task = tm.createTask({ subject: 'A', description: '' });
    expect(tm.getTask(task.id)?.subject).toBe('A');
  });

  it('should assign a task to an owner', () => {
    const task = tm.createTask({ subject: 'A', description: '' });
    tm.assignTask(task.id, 'researcher');
    expect(tm.getTask(task.id)?.owner).toBe('researcher');
    expect(tm.getTask(task.id)?.status).toBe('in_progress');
  });

  it('should complete a task', () => {
    const task = tm.createTask({ subject: 'A', description: '' });
    tm.assignTask(task.id, 'researcher');
    tm.completeTask(task.id);
    const updated = tm.getTask(task.id);
    expect(updated?.status).toBe('completed');
    expect(updated?.completedAt).toBeDefined();
  });

  it('should track blocked tasks', () => {
    const t1 = tm.createTask({ subject: 'A', description: '' });
    tm.createTask({ subject: 'B', description: '', blockedBy: [t1.id] });
    expect(tm.getAvailableTasks()).toHaveLength(1);
    expect(tm.getAvailableTasks()[0].id).toBe(t1.id);
  });

  it('should unblock tasks when dependency completes', () => {
    const t1 = tm.createTask({ subject: 'A', description: '' });
    const t2 = tm.createTask({ subject: 'B', description: '', blockedBy: [t1.id] });
    tm.assignTask(t1.id, 'worker');
    tm.completeTask(t1.id);
    expect(tm.getAvailableTasks()).toHaveLength(1);
    expect(tm.getAvailableTasks()[0].id).toBe(t2.id);
  });

  it('should release task back to pending on owner crash', () => {
    const task = tm.createTask({ subject: 'A', description: '' });
    tm.assignTask(task.id, 'worker');
    tm.releaseTask(task.id);
    expect(tm.getTask(task.id)?.status).toBe('pending');
    expect(tm.getTask(task.id)?.owner).toBeUndefined();
  });

  it('should update task fields without changing task identity', () => {
    const task = tm.createTask({ subject: 'A', description: 'old' });
    const updated = tm.updateTask(task.id, {
      subject: 'B',
      description: 'new',
      blockedBy: ['task-99'],
    });

    expect(updated.id).toBe(task.id);
    expect(updated.subject).toBe('B');
    expect(updated.description).toBe('new');
    expect(updated.blockedBy).toEqual(['task-99']);
    expect(updated.status).toBe('pending');
  });

  it('should mark a task completed when updateTask sets completed status', () => {
    const task = tm.createTask({ subject: 'A', description: '' });
    tm.assignTask(task.id, 'worker');

    const updated = tm.updateTask(task.id, { status: 'completed' });

    expect(updated.status).toBe('completed');
    expect(updated.completedAt).toBeDefined();
  });

  it('should stop an in-progress task and return it to pending', () => {
    const task = tm.createTask({ subject: 'A', description: '' });
    tm.assignTask(task.id, 'worker');

    const stopped = tm.stopTask(task.id);

    expect(stopped.status).toBe('pending');
    expect(stopped.owner).toBeUndefined();
    expect(stopped.completedAt).toBeUndefined();
  });

  it('should store task output without changing task status', () => {
    const task = tm.createTask({ subject: 'A', description: '' });
    tm.assignTask(task.id, 'worker');

    const updated = tm.setTaskOutput(task.id, 'Step 1 complete');

    expect(updated.output).toBe('Step 1 complete');
    expect(updated.status).toBe('in_progress');
    expect(updated.owner).toBe('worker');
  });

  it('should serialize and deserialize state', () => {
    tm.createTask({ subject: 'A', description: 'desc' });
    const json = tm.serialize();
    const tm2 = TaskManager.deserialize(json);
    expect(tm2.listTasks()).toHaveLength(1);
    expect(tm2.listTasks()[0].subject).toBe('A');
  });
});
