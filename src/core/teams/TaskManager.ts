/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TeamTask } from './types.js';

interface CreateTaskInput {
  subject: string;
  description: string;
  blockedBy?: string[];
}

export class TaskManager {
  private tasks: Map<string, TeamTask> = new Map();
  private counter = 0;

  createTask(input: CreateTaskInput): TeamTask {
    const id = `task-${++this.counter}`;
    const task: TeamTask = {
      id,
      subject: input.subject,
      description: input.description,
      status: 'pending',
      blockedBy: input.blockedBy ?? [],
      createdAt: new Date().toISOString(),
    };
    this.tasks.set(id, task);
    return task;
  }

  getTask(id: string): TeamTask | undefined {
    return this.tasks.get(id);
  }

  listTasks(): TeamTask[] {
    return [...this.tasks.values()];
  }

  getAvailableTasks(): TeamTask[] {
    return this.listTasks().filter((t) => {
      if (t.status !== 'pending') return false;
      return t.blockedBy.every((depId) => {
        const dep = this.tasks.get(depId);
        return dep?.status === 'completed';
      });
    });
  }

  assignTask(id: string, owner: string): void {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task ${id} not found`);
    task.owner = owner;
    task.status = 'in_progress';
  }

  completeTask(id: string): void {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task ${id} not found`);
    task.status = 'completed';
    task.completedAt = new Date().toISOString();
  }

  releaseTask(id: string): void {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task ${id} not found`);
    task.status = 'pending';
    task.owner = undefined;
  }

  serialize(): string {
    return JSON.stringify({
      tasks: this.listTasks(),
      counter: this.counter,
    });
  }

  static deserialize(json: string): TaskManager {
    const data = JSON.parse(json);
    const tm = new TaskManager();
    tm.counter = data.counter;
    for (const task of data.tasks) {
      tm.tasks.set(task.id, task);
    }
    return tm;
  }
}
