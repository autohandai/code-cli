/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskStatus, TeamTask } from './types.js';
import { defineStateMachine, InvalidTransitionError, StateMachine } from '../../utils/stateMachine.js';

type TaskEvent = 'claim' | 'complete' | 'fail' | 'cancel' | 'release';

/**
 * A task is claimed only by the scheduler (`assignTask`); the lead may resolve,
 * cancel or retry it, but a finished outcome is only replaced through a retry.
 */
export const TASK_LIFECYCLE = defineStateMachine<TaskStatus, TaskEvent>({
  name: 'TeamTask',
  initial: 'pending',
  transitions: {
    pending: { claim: 'in_progress', complete: 'completed', fail: 'failed', cancel: 'cancelled' },
    in_progress: { complete: 'completed', fail: 'failed', cancel: 'cancelled', release: 'pending' },
    completed: { release: 'pending' },
    failed: { release: 'pending' },
    cancelled: { release: 'pending' },
  },
});

const STATUS_EVENT: Record<Exclude<TaskStatus, 'in_progress'>, TaskEvent> = {
  pending: 'release',
  completed: 'complete',
  failed: 'fail',
  cancelled: 'cancel',
};

interface CreateTaskInput {
  subject: string;
  description: string;
  userRequest?: string;
  workspaceRoot?: string;
  blockedBy?: string[];
}

export interface UpdateTaskInput {
  subject?: string;
  description?: string;
  blockedBy?: string[];
  status?: TaskStatus;
  output?: string;
  error?: string;
  cancelRequested?: boolean;
}

export class TaskManager {
  private tasks: Map<string, TeamTask> = new Map();
  private counter = 0;

  constructor(private readonly onChange?: () => void) {}

  private notifyChange(): void {
    this.onChange?.();
  }

  private requireTask(id: string): TeamTask {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task ${id} not found`);
    return task;
  }

  private nextStatus(task: TeamTask, event: TaskEvent): TaskStatus {
    const machine = new StateMachine(TASK_LIFECYCLE, { initial: task.status });
    if (!machine.trySend(event)) throw new InvalidTransitionError(`Task ${task.id}`, task.status, event);
    return machine.state;
  }

  private isUnblocked(task: TeamTask): boolean {
    return task.blockedBy.every((depId) => this.tasks.get(depId)?.status === 'completed');
  }

  createTask(input: CreateTaskInput): TeamTask {
    const id = `task-${++this.counter}`;
    const task: TeamTask = {
      id,
      subject: input.subject,
      description: input.description,
      ...(input.userRequest !== undefined ? { userRequest: input.userRequest } : {}),
      ...(input.workspaceRoot !== undefined ? { workspaceRoot: input.workspaceRoot } : {}),
      status: 'pending',
      blockedBy: input.blockedBy ?? [],
      createdAt: new Date().toISOString(),
    };
    this.tasks.set(id, task);
    this.notifyChange();
    return task;
  }

  getTask(id: string): TeamTask | undefined {
    return this.tasks.get(id);
  }

  listTasks(): TeamTask[] {
    return [...this.tasks.values()];
  }

  getAvailableTasks(): TeamTask[] {
    return this.listTasks().filter((t) => t.status === 'pending' && this.isUnblocked(t));
  }

  assignTask(id: string, owner: string, runId?: string): void {
    const task = this.requireTask(id);
    const status = this.nextStatus(task, 'claim');
    if (!this.isUnblocked(task)) throw new Error(`Task ${id} is blocked by unfinished dependencies`);
    task.owner = owner;
    task.status = status;
    task.runId = runId;
    task.output = undefined;
    task.error = undefined;
    task.cancelRequested = undefined;
    this.notifyChange();
  }

  completeTask(id: string): void {
    this.updateTask(id, { status: 'completed' });
  }

  releaseTask(id: string): void {
    this.updateTask(id, { status: 'pending' });
  }

  updateTask(id: string, updates: UpdateTaskInput): TeamTask {
    const task = this.requireTask(id);
    const requested = updates.status === task.status ? undefined : updates.status;
    if (requested === 'in_progress') throw new Error(`Task ${id} starts only when a teammate claims it`);
    const status = requested && this.nextStatus(task, STATUS_EVENT[requested]);

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
    if (updates.error !== undefined) {
      task.error = updates.error.slice(0, 4_000);
    }
    if (updates.cancelRequested !== undefined) task.cancelRequested = updates.cancelRequested;

    if (status === 'pending') {
      task.owner = undefined;
      task.completedAt = undefined;
      task.error = undefined;
    } else if (status) {
      task.completedAt = new Date().toISOString();
    }
    if (status) {
      task.status = status;
      task.cancelRequested = undefined;
    }

    this.notifyChange();
    return task;
  }

  stopTask(id: string): TeamTask {
    return this.updateTask(id, { status: 'cancelled' });
  }

  setTaskOutput(id: string, output: string): TeamTask {
    const task = this.requireTask(id);
    task.output = output;
    this.notifyChange();
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
