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
    const t2 = tm.createTask({ subject: 'B', description: '', blockedBy: [t1.id] });
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

  it('should serialize and deserialize state', () => {
    tm.createTask({ subject: 'A', description: 'desc' });
    const json = tm.serialize();
    const tm2 = TaskManager.deserialize(json);
    expect(tm2.listTasks()).toHaveLength(1);
    expect(tm2.listTasks()[0].subject).toBe('A');
  });
});
