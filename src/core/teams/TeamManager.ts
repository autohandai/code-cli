/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { TeammateProcess } from './TeammateProcess.js';
import { TaskManager } from './TaskManager.js';
import type { Team, TeamTask } from './types.js';

interface TeamManagerOptions {
  leadSessionId: string;
  workspacePath: string;
  onTeammateMessage?: (from: string, msg: { method: string; params: Record<string, unknown> }) => void;
}

interface AddTeammateOptions {
  name: string;
  agentName: string;
  model?: string;
}

/**
 * Orchestrates the full lifecycle of a team: creation, teammate management,
 * inter-agent message routing, task assignment, crash recovery, and shutdown.
 *
 * Only one team may be active at a time. The lead process creates a TeamManager
 * and uses it to coordinate all teammates and their tasks.
 */
export class TeamManager {
  private team: Team | null = null;
  private teammates: Map<string, TeammateProcess> = new Map();
  private _tasks = new TaskManager();
  private readonly opts: TeamManagerOptions;

  constructor(opts: TeamManagerOptions) {
    this.opts = opts;
  }

  /** Access the underlying task manager for creating and querying tasks. */
  get tasks(): TaskManager {
    return this._tasks;
  }

  /**
   * Create a new team. Throws if one is already active.
   * Resets the task manager for a fresh session.
   */
  createTeam(name: string): Team {
    if (this.team?.status === 'active') {
      throw new Error('A team is already active. Shut it down first.');
    }
    this.team = {
      name,
      createdAt: new Date().toISOString(),
      leadSessionId: this.opts.leadSessionId,
      status: 'active',
      members: [],
    };
    this._tasks = new TaskManager();
    return this.team;
  }

  /**
   * Return the current team snapshot, or null if none exists.
   * Members are rebuilt from live TeammateProcess instances.
   */
  getTeam(): Team | null {
    if (!this.team) return null;
    return {
      ...this.team,
      members: [...this.teammates.values()].map((t) => t.toMember()),
    };
  }

  /**
   * Add a teammate to the active team. Spawns the child process and
   * wires up message and exit handlers.
   */
  addTeammate(opts: AddTeammateOptions): TeammateProcess {
    if (!this.team) throw new Error('No active team');

    const tp = new TeammateProcess({
      teamName: this.team.name,
      name: opts.name,
      agentName: opts.agentName,
      leadSessionId: this.opts.leadSessionId,
      model: opts.model,
      workspacePath: this.opts.workspacePath,
    });

    this.teammates.set(opts.name, tp);

    tp.spawn(
      (msg) => this.handleTeammateMessage(opts.name, msg),
      (code) => this.handleTeammateExit(opts.name, code),
    );

    return tp;
  }

  /**
   * Route an incoming message from a teammate to the appropriate handler.
   *
   * Supported methods:
   *  - `team.ready`       — mark teammate as idle
   *  - `team.taskUpdate`  — mark task completed, free the teammate
   *  - `team.message`     — forward a message to another teammate
   *  - `team.idle`        — teammate is idle, try assigning pending work
   *  - `team.shutdownAck` — teammate acknowledged shutdown
   */
  private handleTeammateMessage(from: string, msg: { method: string; params: Record<string, unknown> }): void {
    const tp = this.teammates.get(from);

    switch (msg.method) {
      case 'team.ready':
        tp?.setStatus('idle');
        break;

      case 'team.taskUpdate': {
        const { taskId, status } = msg.params as { taskId: string; status: string };
        if (status === 'completed') {
          this._tasks.completeTask(taskId);
          tp?.setStatus('idle');
        } else if (status === 'in_progress') {
          tp?.setStatus('working');
        }
        break;
      }

      case 'team.message': {
        const { to, content } = msg.params as { to: string; content: string };
        const target = this.teammates.get(to);
        if (target) {
          target.sendMessage(from, content);
        }
        break;
      }

      case 'team.idle':
        tp?.setStatus('idle');
        this.tryAssignWork(from);
        break;

      case 'team.shutdownAck':
        tp?.setStatus('shutdown');
        break;
    }

    this.opts.onTeammateMessage?.(from, msg);
  }

  /**
   * Handle teammate process exit. Marks the teammate as shutdown and
   * releases any in-progress tasks back to pending so they can be
   * picked up by another teammate (crash recovery).
   */
  private handleTeammateExit(name: string, _code: number | null): void {
    const tp = this.teammates.get(name);
    if (tp) {
      tp.setStatus('shutdown');
    }
    for (const task of this._tasks.listTasks()) {
      if (task.owner === name && task.status === 'in_progress') {
        this._tasks.releaseTask(task.id);
      }
    }
  }

  /**
   * Try to assign the next available task to a teammate that just became idle.
   */
  private tryAssignWork(teammateName: string): void {
    const available = this._tasks.getAvailableTasks();
    if (available.length === 0) return;
    const task = available[0];
    this._tasks.assignTask(task.id, teammateName);
    const tp = this.teammates.get(teammateName);
    tp?.assignTask(task);
  }

  /**
   * Send a direct message from one entity (lead or teammate) to a teammate.
   */
  sendMessageTo(to: string, from: string, content: string): void {
    const tp = this.teammates.get(to);
    if (!tp) throw new Error(`Teammate "${to}" not found`);
    tp.sendMessage(from, content);
  }

  /**
   * Gracefully shut down the team. Sends shutdown requests, waits briefly
   * for acknowledgement, then force-kills any remaining processes.
   */
  async shutdown(): Promise<void> {
    if (!this.team) return;
    for (const [, tp] of this.teammates) {
      tp.requestShutdown('Team shutting down');
    }
    await new Promise((r) => setTimeout(r, 3000));
    for (const [, tp] of this.teammates) {
      tp.kill();
    }
    this.team.status = 'completed';
    this.teammates.clear();
  }

  /**
   * Return a summary of the current team state: name, member count, and task progress.
   */
  getStatus(): { teamName: string; memberCount: number; tasksDone: number; tasksTotal: number } {
    const tasks = this._tasks.listTasks();
    return {
      teamName: this.team?.name ?? '',
      memberCount: this.teammates.size,
      tasksDone: tasks.filter((t) => t.status === 'completed').length,
      tasksTotal: tasks.length,
    };
  }
}
