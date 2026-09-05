/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { TeammateProcess } from './TeammateProcess.js';
import { TaskManager, type UpdateTaskInput } from './TaskManager.js';
import type { HookContext } from '../HookManager.js';
import type { HookEvent, ProviderName } from '../../types.js';
import type { Team, TeamActivitySnapshot, TeamTask, TaskStatus } from './types.js';
import type { TeamModelAssignmentSource } from './TeamModelPolicy.js';
import { SessionThreadBudget, type ThreadLease } from '../agents/SessionThreadBudget.js';
import type { AgentRunStore } from '../agents/AgentRunStore.js';
import { TeammateAuthorizationRequestSchema, type TeammateAuthorizationResult, type TeammateToolCall } from './TeammateAuthorization.js';

interface TeamManagerOptions {
  leadSessionId: string | (() => string | undefined);
  workspacePath: string;
  configPath?: string;
  maxTeammates?: number;
  threadBudget?: SessionThreadBudget;
  runStore?: AgentRunStore;
  authorizeTool?: (call: TeammateToolCall, signal: AbortSignal) => Promise<TeammateAuthorizationResult>;
  onTeammateMessage?: (from: string, msg: { method: string; params: Record<string, unknown> }) => void;
  onHookEvent?: (event: HookEvent, context: Omit<HookContext, 'event' | 'workspace'>) => Promise<void> | void;
}

interface AddTeammateOptions {
  name: string;
  agentName: string;
  provider?: ProviderName;
  model?: string;
  modelSource?: TeamModelAssignmentSource;
  requestedRole?: string;
  agentSource?: string;
}

const TEAM_SHUTDOWN_TIMEOUT_MS = 2_000;
const LEGACY_TEAMMATE_GRACE_MS = 750;
const UsageSchema = z.object({
  promptTokens: z.number().finite().nonnegative(),
  completionTokens: z.number().finite().nonnegative(),
  totalTokens: z.number().finite().nonnegative(),
  cacheReadTokens: z.number().finite().nonnegative().optional(),
  cacheWriteTokens: z.number().finite().nonnegative().optional(),
});

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
  private _tasks: TaskManager;
  private readonly opts: TeamManagerOptions;
  private shutdownPromise: Promise<void> | null = null;
  private closing = false;
  private readonly maxTeammates: number;
  private readonly listeners = new Set<(snapshot: TeamActivitySnapshot) => void>();
  private readonly threadBudget: SessionThreadBudget;
  private readonly processLeases = new Map<TeammateProcess, ThreadLease>();
  private readonly nestedLeases = new Map<TeammateProcess, Map<string, ThreadLease>>();
  private readonly taskRuns = new Map<string, string>();
  private readonly requestedTaskStates = new Map<string, Exclude<TaskStatus, 'in_progress'>>();
  private readonly lastAssignedRuns = new Map<TeammateProcess, string>();
  private readonly nestedRuns = new Map<TeammateProcess, Set<string>>();
  private readonly authorizations = new Map<TeammateProcess, Map<string, { taskId: string; controller: AbortController }>>();

  constructor(opts: TeamManagerOptions) {
    this.opts = opts;
    this.maxTeammates = Math.max(1, Math.floor(opts.maxTeammates ?? 5));
    this.threadBudget = opts.threadBudget ?? new SessionThreadBudget();
    this._tasks = this.createTaskManager();
  }

  private createTaskManager(): TaskManager {
    return new TaskManager(() => {
      this.notifyStateChanged();
      for (const teammate of this.teammates.values()) {
        if (this.processLeases.has(teammate)) teammate.send({
          method: 'team.updateContext', params: { tasks: this._tasks.listTasks() },
        });
      }
    });
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
    if (this.processLeases.size > 0) throw new Error('Previous teammates are still shutting down.');
    const leadSessionId = typeof this.opts.leadSessionId === 'function'
      ? this.opts.leadSessionId() : this.opts.leadSessionId;
    if (!leadSessionId) throw new Error('The lead session must be initialized before creating a team.');
    this.team = {
      name,
      createdAt: new Date().toISOString(),
      leadSessionId,
      status: 'active',
      members: [],
    };
    this.shutdownPromise = null;
    this._tasks = this.createTaskManager();
    this.taskRuns.clear();
    this.requestedTaskStates.clear();
    this.notifyStateChanged();
    void this.emitHookEvent('team-created', {
      sessionId: this.team.leadSessionId,
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
    if (!this.team || this.team.status !== 'active') throw new Error('No active team');
    const existing = this.teammates.get(opts.name);
    if (existing && this.processLeases.has(existing)) {
      throw new Error(`Teammate "${opts.name}" is already active`);
    }
    if (this.processLeases.size >= this.maxTeammates) {
      throw new Error(`Team has reached the configured maximum of ${this.maxTeammates} teammates`);
    }

    const lease = this.threadBudget.tryAcquire(`team:${randomUUID()}`);
    const tp = new TeammateProcess({
      teamName: this.team.name,
      name: opts.name,
      agentName: opts.agentName,
      leadSessionId: this.team.leadSessionId,
      provider: opts.provider,
      model: opts.model,
      modelSource: opts.modelSource,
      requestedRole: opts.requestedRole,
      agentSource: opts.agentSource,
      workspacePath: this.opts.workspacePath,
      configPath: this.opts.configPath,
    });

    this.teammates.set(opts.name, tp);
    this.processLeases.set(tp, lease);
    try {
      tp.spawn(
        (msg) => {
          if (this.teammates.get(opts.name) === tp) this.handleTeammateMessage(opts.name, msg);
        },
        (code) => this.handleTeammateExit(opts.name, code, tp),
      );
    } catch (error) {
      this.releaseProcessLeases(tp);
      this.teammates.delete(opts.name);
      this.notifyStateChanged();
      throw error;
    }
    this.notifyStateChanged();

    void this.emitHookEvent('teammate-spawned', {
      sessionId: this.team.leadSessionId,
      teamName: this.team.name,
      teammateName: opts.name,
      teammateAgentName: opts.agentName,
      teammatePid: tp.pid,
      teamMemberCount: this.processLeases.size,
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
    if (!tp || !this.processLeases.has(tp)) return;

    switch (msg.method) {
      case 'team.ready':
        if (this.closing || tp.status !== 'spawning') break;
        tp?.setStatus('idle');
        void this.emitTeammateIdleHook(from);
        this.tryAssignIdleTeammate();
        break;

      case 'team.taskUpdate': {
        const { taskId, status, result, error } = msg.params;
        if (typeof taskId !== 'string') break;
        const task = this._tasks.getTask(taskId);
        if (!task || task.owner !== from || task.status !== 'in_progress') break;
        if (!task.runId || msg.params.runId !== task.runId) break;
        if (status !== 'in_progress' && status !== 'completed' && status !== 'failed' && status !== 'cancelled') break;
        if (!task.cancelRequested && typeof result === 'string' && result.length > 0) {
          this._tasks.setTaskOutput(taskId, result);
        }
        if (status === 'completed' || status === 'failed' || status === 'cancelled') {
          const cancelled = task.cancelRequested === true;
          const cancellationReason = cancelled ? task.error : undefined;
          const terminalStatus = cancelled ? this.requestedTaskStates.get(taskId) ?? 'cancelled' : status;
          this.requestedTaskStates.delete(taskId);
          this._tasks.updateTask(taskId, {
            status: terminalStatus,
            ...(!task.cancelRequested && typeof error === 'string' ? { error } : {}),
          });
          this.finishTaskRun(task, cancelled ? 'cancelled' : status, cancellationReason);
          tp?.setStatus('idle');
          if (terminalStatus === 'completed') void this.emitHookEvent('task-completed', {
            sessionId: this.team?.leadSessionId,
            teamName: this.team?.name,
            ...this.getTeamProgressContext(),
            teammateName: from,
            teamTaskId: taskId,
            teamTaskOwner: task?.owner ?? from,
            teamTaskResult: typeof result === 'string' ? result : undefined,
          });
          void this.emitTeammateIdleHook(from);
        } else if (status === 'in_progress') {
          tp?.setStatus('working');
        }
        break;
      }

      case 'team.message': {
        const { to, content } = msg.params;
        if (typeof to !== 'string' || typeof content !== 'string') break;
        const target = this.teammates.get(to);
        if (target) {
          target.sendMessage(from, content);
        }
        break;
      }

      case 'team.idle':
        if (this.closing) break;
        if (msg.params.runId !== this.lastAssignedRuns.get(tp)) break;
        if (this._tasks.listTasks().some((task) => task.owner === from && task.status === 'in_progress')) break;
        tp?.setStatus('idle');
        void this.emitTeammateIdleHook(from);
        this.tryAssignIdleTeammate();
        break;

      case 'team.shutdownAck':
        tp?.setStatus('shutdown');
        break;

      case 'team.threadAcquire':
        this.acquireNestedThread(tp, msg.params);
        break;

      case 'team.authorizeTool':
        void this.authorizeTeammateTool(tp, msg.params);
        break;

      case 'team.authorizationCancel':
        if (typeof msg.params.requestId === 'string') this.authorizations.get(tp)?.get(msg.params.requestId)?.controller.abort();
        break;

      case 'team.threadRelease': {
        const requestId = msg.params.requestId;
        if (typeof requestId !== 'string') break;
        const leases = this.nestedLeases.get(tp);
        const lease = leases?.get(requestId);
        leases?.delete(requestId);
        if (lease) void Promise.resolve(lease.release()).catch(() => {});
        break;
      }

      case 'team.progress': {
        const taskId = msg.params.taskId;
        if (typeof taskId !== 'string') break;
        const task = this._tasks.getTask(taskId);
        const runId = this.taskRuns.get(taskId);
        if (!task || task.owner !== from || task.status !== 'in_progress' || !runId || msg.params.runId !== runId) break;
        this.opts.runStore?.progress(runId, {
          activity: task.cancelRequested ? 'Cancellation requested; waiting for agent to stop.'
            : typeof msg.params.tool === 'string' ? msg.params.tool : 'Thinking',
          ...(typeof msg.params.output === 'string' ? { output: msg.params.output } : {}),
          ...this.parseUsage(msg.params.usage),
        });
        break;
      }

      case 'team.subagentStart':
      case 'team.subagentProgress':
      case 'team.subagentStop':
        this.handleNestedRun(tp, msg.method, msg.params);
        break;
    }

    this.notifyStateChanged();
    this.opts.onTeammateMessage?.(from, msg);
  }

  private handleTeammateExit(name: string, code: number | null, exited?: TeammateProcess): void {
    const tp = exited ?? this.teammates.get(name);
    if (!tp) return;
    this.releaseProcessLeases(tp);
    for (const runId of this.nestedRuns.get(tp) ?? []) {
      this.opts.runStore?.finish(runId, {
        status: this.closing ? 'cancelled' : 'failed',
        error: this.closing ? 'Team shut down' : `Teammate exited (code ${code ?? 'unknown'})`,
      });
    }
    this.nestedRuns.delete(tp);
    if (this.teammates.get(name) !== tp) return;
    if (tp) {
      tp.setStatus('shutdown');
    }
    if (!this.closing && this.team?.status === 'active') {
      this.opts.onTeammateMessage?.(name, {
        method: 'team.log',
        params: {
          level: 'error',
          text: `Teammate process exited unexpectedly (code ${code ?? 'unknown'}).`,
        },
      });
    }
    for (const task of this._tasks.listTasks()) {
      if (task.owner === name && task.status === 'in_progress') {
        const cancelled = this.closing || task.cancelRequested;
        const error = task.cancelRequested ? task.error : this.closing ? 'Team shut down' : `Teammate exited (code ${code ?? 'unknown'})`;
        this._tasks.updateTask(task.id, {
          status: this.closing ? 'cancelled' : task.cancelRequested ? this.requestedTaskStates.get(task.id) ?? 'cancelled' : 'failed',
          error,
        });
        this.requestedTaskStates.delete(task.id);
        this.finishTaskRun(task, cancelled ? 'cancelled' : 'failed', error);
      }
    }
    this.tryAssignIdleTeammate();
    this.notifyStateChanged();
  }

  /**
   * Try to assign the next available task to any idle teammate.
   * Call after creating tasks or when a teammate becomes idle.
   */
  tryAssignIdleTeammate(): void {
    if (this.closing || this.team?.status !== 'active') return;
    for (const [name, tp] of this.teammates) {
      if (tp.status !== 'idle' || !this.processLeases.has(tp)) continue;
      const available = this._tasks.getAvailableTasks();
      if (available.length === 0) return;
      const task = available[0];
      const runId = `team-task:${randomUUID()}`;
      this._tasks.assignTask(task.id, name, runId);
      this.taskRuns.set(task.id, runId);
      this.lastAssignedRuns.set(tp, runId);
      const member = tp.toMember();
      this.opts.runStore?.start({
        id: runId,
        parentId: this.team.leadSessionId,
        depth: 1,
        source: 'team',
        name,
        task: task.subject,
        provider: member.provider,
        model: member.model,
      });
      this.opts.runStore?.registerCancel(runId, () => { this.stopTask(task.id); });
      tp.setStatus('working');
      tp.send({ method: 'team.updateContext', params: { tasks: this._tasks.listTasks() } });
      tp.assignTask({ ...task, runId });
      this.notifyStateChanged();
      void this.emitHookEvent('task-assigned', {
        sessionId: this.team.leadSessionId,
        teamName: this.team?.name,
        ...this.getTeamProgressContext(),
        teammateName: name,
        teamTaskId: task.id,
        teamTaskOwner: name,
      });
    }
  }

  stopTask(taskId: string, reason = 'Task cancelled by the lead'): TeamTask {
    return this.requestTaskState(taskId, 'cancelled', reason);
  }

  updateTask(taskId: string, updates: UpdateTaskInput): TeamTask {
    const task = this._tasks.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    if (task.status === 'in_progress' && updates.status && updates.status !== 'in_progress') {
      const { status, ...metadata } = updates;
      this._tasks.updateTask(taskId, metadata);
      return this.requestTaskState(taskId, status, `Task status changed to ${status} by the lead`);
    }
    const updated = this._tasks.updateTask(taskId, updates);
    if (updates.status === 'pending') this.tryAssignIdleTeammate();
    return updated;
  }

  private requestTaskState(taskId: string, status: Exclude<TaskStatus, 'in_progress'>, reason: string): TeamTask {
    const task = this._tasks.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') return task;
    for (const pending of this.authorizations.values()) {
      for (const entry of pending.values()) if (entry.taskId === taskId) entry.controller.abort();
    }
    this.requestedTaskStates.set(taskId, status);
    if (task.cancelRequested) return task;
    if (task.owner && task.status === 'in_progress') {
      const teammate = this.teammates.get(task.owner);
      if (teammate && this.processLeases.has(teammate)) {
        this._tasks.updateTask(task.id, { cancelRequested: true, error: reason });
        const runId = this.taskRuns.get(task.id);
        if (runId) this.opts.runStore?.progress(runId, {
          cancelRequested: true, activity: 'Cancellation requested; waiting for agent to stop.',
        });
        teammate.cancelTask(task.id, reason, task.runId);
        return task;
      }
    }
    this._tasks.updateTask(task.id, { status, error: reason });
    this.requestedTaskStates.delete(taskId);
    this.finishTaskRun(task);
    return task;
  }

  private finishTaskRun(task: TeamTask, status: TaskStatus = task.status, error = task.error): void {
    const runId = this.taskRuns.get(task.id);
    if (!runId || (status !== 'completed' && status !== 'failed' && status !== 'cancelled')) return;
    this.opts.runStore?.finish(runId, { status, result: task.output, error });
    this.taskRuns.delete(task.id);
  }

  private parseUsage(value: unknown): { usage?: z.infer<typeof UsageSchema> } {
    const parsed = UsageSchema.safeParse(value);
    return parsed.success ? { usage: parsed.data } : {};
  }

  private handleNestedRun(tp: TeammateProcess, method: string, params: Record<string, unknown>): void {
    const { taskId, subagentId } = params;
    if (typeof taskId !== 'string' || typeof subagentId !== 'string' || subagentId.length > 200) return;
    const task = this._tasks.getTask(taskId);
    if (!task || task.owner !== tp.name || !task.runId || params.runId !== task.runId) return;
    let runs = this.nestedRuns.get(tp);
    if (method === 'team.subagentStart') {
      if (task.status !== 'in_progress' || typeof params.subagentName !== 'string' || typeof params.task !== 'string') return;
      const parentId = this.taskRuns.get(taskId);
      if (!parentId || (params.parentId !== parentId && !runs?.has(String(params.parentId)))) return;
      if (!runs) {
        runs = new Set();
        this.nestedRuns.set(tp, runs);
      }
      if (runs.has(subagentId)) return;
      runs.add(subagentId);
      this.opts.runStore?.start({
        id: subagentId,
        parentId: String(params.parentId),
        depth: typeof params.depth === 'number' ? Math.max(2, Math.min(4, params.depth)) : 2,
        source: 'delegate',
        name: params.subagentName,
        task: params.task,
        ...(typeof params.provider === 'string' ? { provider: params.provider } : {}),
        ...(typeof params.model === 'string' ? { model: params.model } : {}),
      });
      this.opts.runStore?.registerCancel(subagentId, () => {
        tp.send({ method: 'team.cancelRun', params: { runId: subagentId } });
      });
    } else if (runs?.has(subagentId) && method === 'team.subagentProgress') {
      this.opts.runStore?.progress(subagentId, {
        activity: typeof params.tool === 'string' ? params.tool : 'Thinking',
        ...(typeof params.output === 'string' ? { output: params.output } : {}),
        ...this.parseUsage(params.usage),
      });
    } else if (runs?.has(subagentId) && method === 'team.subagentStop') {
      const status = params.status === 'cancelled' ? 'cancelled' : params.success === true ? 'completed' : 'failed';
      this.opts.runStore?.finish(subagentId, {
        status,
        ...(typeof params.result === 'string' ? { result: params.result } : {}),
        ...(typeof params.error === 'string' ? { error: params.error } : {}),
        ...this.parseUsage(params.usage),
      });
      runs.delete(subagentId);
    }
  }

  private acquireNestedThread(tp: TeammateProcess, params: Record<string, unknown>): void {
    const { requestId, runId } = params;
    if (typeof requestId !== 'string' || !requestId || requestId.length > 200
      || typeof runId !== 'string' || !runId || runId.length > 200) return;
    let leases = this.nestedLeases.get(tp);
    if (!leases) {
      leases = new Map();
      this.nestedLeases.set(tp, leases);
    }
    try {
      if (this.closing) throw new Error('Team is shutting down');
      if (leases.has(requestId)) throw new Error('Thread request is already registered');
      const lease = this.threadBudget.tryAcquire(`team-nested:${tp.name}:${runId}`);
      leases.set(requestId, lease);
      tp.send({ method: 'team.threadResult', params: { requestId, granted: true } });
    } catch (error) {
      tp.send({ method: 'team.threadResult', params: {
        requestId, granted: false,
        error: (error instanceof Error ? error.message : String(error)).slice(0, 4_000),
      } });
    }
  }

  private async authorizeTeammateTool(tp: TeammateProcess, params: Record<string, unknown>): Promise<void> {
    const parsed = TeammateAuthorizationRequestSchema.safeParse(params);
    if (!parsed.success) return;
    const { requestId, taskId, runId, call } = parsed.data;
    const respond = (result: TeammateAuthorizationResult) => tp.send({ method: 'team.authorizationResult', params: { requestId, result } });
    const task = this._tasks.getTask(taskId);
    if (this.closing || !task || task.owner !== tp.name || task.status !== 'in_progress'
      || task.cancelRequested || task.runId !== runId || !this.opts.authorizeTool) {
      respond({ allowed: false, error: 'The lead cannot authorize this inactive task attempt.' });
      return;
    }
    let pending = this.authorizations.get(tp);
    if (!pending) { pending = new Map(); this.authorizations.set(tp, pending); }
    if (pending.has(requestId) || pending.size >= 128) {
      respond({ allowed: false, error: 'Invalid or excessive teammate authorization requests.' });
      return;
    }
    const controller = new AbortController();
    pending.set(requestId, { taskId, controller });
    try {
      const result = await this.opts.authorizeTool(call, controller.signal);
      if (controller.signal.aborted || this.closing || !this.processLeases.has(tp)
        || task.status !== 'in_progress' || task.cancelRequested || task.runId !== runId) {
        respond({ allowed: false, error: 'Teammate tool authorization cancelled.' });
      } else respond(result);
    } catch (error) {
      respond({ allowed: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 4_000) });
    } finally {
      pending.delete(requestId);
      if (pending.size === 0) this.authorizations.delete(tp);
    }
  }

  private releaseProcessLeases(tp: TeammateProcess): void {
    for (const entry of this.authorizations.get(tp)?.values() ?? []) entry.controller.abort();
    this.authorizations.delete(tp);
    const processLease = this.processLeases.get(tp);
    this.lastAssignedRuns.delete(tp);
    this.processLeases.delete(tp);
    const leases = [...(this.nestedLeases.get(tp)?.values() ?? [])];
    this.nestedLeases.delete(tp);
    if (processLease) leases.push(processLease);
    for (const lease of leases) void Promise.resolve(lease.release()).catch(() => {});
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
      for (const task of this._tasks.listTasks()) this.stopTask(task.id, 'Team shutting down');
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

      if (this.processLeases.size > 0) {
        throw new Error('Teammates have not stopped; their session thread reservations are retained.');
      }
      this.team.status = 'completed';
      this.notifyStateChanged();
      const tasks = this._tasks.listTasks();
      await settleWithin(this.emitHookEvent('team-shutdown', {
        sessionId: this.team.leadSessionId,
        teamName,
        teamMemberCount: this.teammates.size,
        teamTasksCompleted: tasks.filter((task) => task.status === 'completed').length,
        teamTasksTotal: tasks.length,
      }), TEAM_SHUTDOWN_TIMEOUT_MS);
    } finally {
      if (this.processLeases.size === 0) this.teammates.clear();
      this.closing = this.processLeases.size > 0;
      if (this.closing) this.shutdownPromise = null;
      this.notifyStateChanged();
    }
  }

  getSnapshot(): TeamActivitySnapshot {
    const team = this.getTeam();
    return {
      team: team ? {
        ...team,
        members: team.members.map((member) => ({ ...member })),
      } : null,
      tasks: this._tasks.listTasks().map((task) => ({
        ...task,
        blockedBy: [...task.blockedBy],
      })),
    };
  }

  subscribe(listener: (snapshot: TeamActivitySnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyStateChanged(): void {
    if (this.listeners.size === 0) return;
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // UI and protocol listeners must not interrupt team orchestration.
      }
    }
  }

  /**
   * Return a summary of the current team state: name, member count, and task progress.
   */
  getStatus(): { teamName: string; memberCount: number; tasksDone: number; tasksTotal: number } {
    const tasks = this._tasks.listTasks();
    return {
      teamName: this.team?.name ?? '',
      memberCount: this.processLeases.size,
      tasksDone: tasks.filter((t) => t.status === 'completed').length,
      tasksTotal: tasks.length,
    };
  }

  private async emitTeammateIdleHook(teammateName: string): Promise<void> {
    await this.emitHookEvent('teammate-idle', {
      sessionId: this.team?.leadSessionId,
      teamName: this.team?.name,
      teammateName,
      ...this.getTeamProgressContext(),
    });
  }

  private getTeamProgressContext(): Pick<
    HookContext,
    'teamMemberCount' | 'teamTasksCompleted' | 'teamTasksTotal'
  > {
    const tasks = this._tasks.listTasks();
    return {
      teamMemberCount: this.processLeases.size,
      teamTasksCompleted: tasks.filter((task) => task.status === 'completed').length,
      teamTasksTotal: tasks.length,
    };
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
