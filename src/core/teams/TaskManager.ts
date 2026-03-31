/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskStatus, TeamTask } from './types.js';

interface CreateTaskInput {
  subject: string;
  description: string;
  blockedBy?: string[];
}

interface UpdateTaskInput {
  subject?: string;
  description?: string;
  blockedBy?: string[];
  status?: TaskStatus;
  output?: string;
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
    task.completedAt = undefined;
  }

  updateTask(id: string, updates: UpdateTaskInput): TeamTask {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task ${id} not found`);

    if (updates.subject !== undefined) {
      task.subject = updates.subject;
    }
    if (updates.description !== undefined) {
      task.description = updates.description;
    }
    if (updates.blockedBy !== undefined) {
      task.blockedBy = [...updates.blockedBy];
    }
    if (updates.output !== undefined) {
      task.output = updates.output;
    }

    if (updates.status === 'completed') {
      task.status = 'completed';
      task.completedAt = new Date().toISOString();
    } else if (updates.status === 'pending') {
      task.status = 'pending';
      task.owner = undefined;
      task.completedAt = undefined;
    } else if (updates.status === 'in_progress') {
      task.status = 'in_progress';
      task.completedAt = undefined;
    }

    return task;
  }

  stopTask(id: string): TeamTask {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task ${id} not found`);
    this.releaseTask(id);
    return this.tasks.get(id)!;
  }

  setTaskOutput(id: string, output: string): TeamTask {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task ${id} not found`);
    task.output = output;
    return task;
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
