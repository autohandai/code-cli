/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { TeammateProcess } from './TeammateProcess.js';
import { TaskManager } from './TaskManager.js';
import type { HookContext } from '../HookManager.js';
import type { HookEvent } from '../../types.js';
import type { Team } from './types.js';

interface TeamManagerOptions {
  leadSessionId: string;
  workspacePath: string;
  onTeammateMessage?: (from: string, msg: { method: string; params: Record<string, unknown> }) => void;
  onHookEvent?: (event: HookEvent, context: Omit<HookContext, 'event' | 'workspace'>) => Promise<void> | void;
}

interface AddTeammateOptions {
  name: string;
  agentName: string;
  model?: string;
}

const TEAM_SHUTDOWN_TIMEOUT_MS = 2_000;
const LEGACY_TEAMMATE_GRACE_MS = 750;

function settleWithin(task: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timeout = setTimeout(resolve, timeoutMs);
    timeout.unref?.();
  });
  return Promise.race([task.then(() => undefined, () => undefined), deadline]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
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
  private shutdownPromise: Promise<void> | null = null;
  private closing = false;

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
    if (this.closing) {
      throw new Error('Team is shutting down');
    }
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
    this.shutdownPromise = null;
    this._tasks = new TaskManager();
    void this.emitHookEvent('team-created', {
      sessionId: this.opts.leadSessionId,
      teamName: this.team.name,
      teamMemberCount: 0,
    });
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
    if (this.closing) throw new Error('Team is shutting down');
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

    void this.emitHookEvent('teammate-spawned', {
      sessionId: this.opts.leadSessionId,
      teamName: this.team.name,
      teammateName: opts.name,
      teammateAgentName: opts.agentName,
      teammatePid: tp.pid,
      teamMemberCount: this.teammates.size,
    });

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
        void this.emitTeammateIdleHook(from);
        break;

      case 'team.taskUpdate': {
        const { taskId, status, result } = msg.params as { taskId: string; status: string; result?: string };
        if (typeof result === 'string' && result.length > 0) {
          this._tasks.setTaskOutput(taskId, result);
        }
        if (status === 'completed') {
          const task = this._tasks.getTask(taskId);
          this._tasks.completeTask(taskId);
          tp?.setStatus('idle');
          void this.emitHookEvent('task-completed', {
            sessionId: this.opts.leadSessionId,
            teamName: this.team?.name,
            teammateName: from,
            teamTaskId: taskId,
            teamTaskOwner: task?.owner ?? from,
            teamTaskResult: result,
          });
          void this.emitTeammateIdleHook(from);
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
        void this.emitTeammateIdleHook(from);
        this.tryAssignIdleTeammate();
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
   * Try to assign the next available task to any idle teammate.
   * Call after creating tasks or when a teammate becomes idle.
   */
  tryAssignIdleTeammate(): void {
    for (const [name, tp] of this.teammates) {
      if (tp.status !== 'idle') continue;
      const available = this._tasks.getAvailableTasks();
      if (available.length === 0) return;
      const task = available[0];
      this._tasks.assignTask(task.id, name);
      tp.assignTask(task);
      void this.emitHookEvent('task-assigned', {
        sessionId: this.opts.leadSessionId,
        teamName: this.team?.name,
        teammateName: name,
        teamTaskId: task.id,
        teamTaskOwner: name,
      });
      return;
    }
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
  shutdown(): Promise<void> {
    if (!this.shutdownPromise) {
      this.closing = true;
      this.shutdownPromise = this.performShutdown();
    }
    return this.shutdownPromise;
  }

  private async performShutdown(): Promise<void> {
    try {
      if (!this.team) return;
      const teamName = this.team.name;
      const teammates = [...this.teammates.values()];
      for (const tp of teammates) {
        tp.requestShutdown('Team shutting down');
      }

      await settleWithin(Promise.all(teammates.map(async (tp) => {
        const terminate = (tp as TeammateProcess & {
          terminate?: () => Promise<void>;
        }).terminate;
        if (typeof terminate === 'function') {
          await terminate.call(tp);
          return;
        }

        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, LEGACY_TEAMMATE_GRACE_MS);
          timeout.unref?.();
        });
        tp.kill();
      })), TEAM_SHUTDOWN_TIMEOUT_MS);

      this.team.status = 'completed';
      const tasks = this._tasks.listTasks();
      await settleWithin(this.emitHookEvent('team-shutdown', {
        sessionId: this.opts.leadSessionId,
        teamName,
        teamMemberCount: this.teammates.size,
        teamTasksCompleted: tasks.filter((task) => task.status === 'completed').length,
        teamTasksTotal: tasks.length,
      }), TEAM_SHUTDOWN_TIMEOUT_MS);
    } finally {
      this.teammates.clear();
      this.closing = false;
    }
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

  private async emitTeammateIdleHook(teammateName: string): Promise<void> {
    await this.emitHookEvent('teammate-idle', {
      sessionId: this.opts.leadSessionId,
      teamName: this.team?.name,
      teammateName,
      teamMemberCount: this.teammates.size,
    });
  }

  private async emitHookEvent(
    event: HookEvent,
    context: Omit<HookContext, 'event' | 'workspace'>,
  ): Promise<void> {
    try {
      await this.opts.onHookEvent?.(event, context);
    } catch {
      // Hook failures are already captured by HookManager; team orchestration should continue.
    }
  }
}
