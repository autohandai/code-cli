/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { LLMUsage } from '../../types.js';

export type AgentRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type AgentRunSource = 'delegate' | 'team' | 'squad';

export interface AgentRunInput {
  id: string;
  parentId?: string;
  depth?: number;
  source: AgentRunSource;
  name: string;
  task: string;
  workspaceRoot?: string;
  userRequest?: string;
  provider?: string;
  model?: string;
  agentType?: string;
}

export interface AgentRun extends AgentRunInput {
  status: AgentRunStatus;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  usage?: LLMUsage;
  activity?: string;
  output?: string;
  error?: string;
  cancellable: boolean;
  messageable?: boolean;
  cancelRequested?: boolean;
}

export interface AgentRunProgress {
  status?: 'pending' | 'running';
  cancelRequested?: boolean;
  activity?: string;
  usage?: LLMUsage;
  output?: string;
  task?: string;
  provider?: string;
  model?: string;
}

export interface AgentRunCompletion {
  status: 'completed' | 'failed' | 'cancelled';
  result?: string;
  error?: string;
  usage?: LLMUsage;
}

export interface AgentRunsSnapshot {
  runs: AgentRun[];
  updatedAt: number;
  externalStatus?: string;
}

export interface AgentRunStoreOptions {
  now?: () => number;
  maxCompletedRuns?: number;
  maxOutputCharacters?: number;
  onLifecycleEvent?: (event: AgentRunLifecycleEvent) => void | Promise<void>;
}

export interface AgentRunLifecycleEvent {
  type: 'start' | 'progress' | 'message' | 'cancel-requested' | 'stop';
  run: AgentRun;
  message?: string;
}

export function isAgentRunActive(run: Pick<AgentRun, 'status'>): boolean {
  return run.status === 'pending' || run.status === 'running';
}

export class AgentRunStore {
  private readonly runs = new Map<string, AgentRun>();
  private readonly listeners = new Set<(snapshot: AgentRunsSnapshot) => void>();
  private readonly cancellationHandlers = new Map<string, () => void | Promise<void>>();
  private readonly messageHandlers = new Map<string, (message: string) => boolean | Promise<boolean>>();
  private readonly lifecycleTasks = new Map<string, Set<Promise<void>>>();
  private readonly completedRunIds: string[] = [];
  private readonly now: () => number;
  private readonly maxCompletedRuns: number;
  private readonly maxOutputCharacters: number;
  private updatedAt = 0;
  private externalStatus: string | undefined;

  constructor(private readonly options: AgentRunStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.maxCompletedRuns = Math.max(1, Math.floor(options.maxCompletedRuns ?? 100));
    this.maxOutputCharacters = Math.max(1, Math.floor(options.maxOutputCharacters ?? 8192));
  }

  start(input: AgentRunInput): void {
    if (this.runs.has(input.id)) return;
    const now = this.now();
    this.runs.set(input.id, { ...input, status: 'running', startedAt: now, updatedAt: now, cancellable: false, messageable: false });
    this.publish();
    this.emitLifecycle('start', input.id);
  }

  progress(id: string, progress: AgentRunProgress): void {
    const run = this.runs.get(id);
    if (!run || !isAgentRunActive(run)) return;
    this.runs.set(id, {
      ...run, ...progress, updatedAt: this.now(),
      ...(progress.usage ? { usage: { ...progress.usage } } : {}),
      ...(progress.output !== undefined ? { output: this.bounded(progress.output) } : {}),
    });
    this.publish();
    this.emitLifecycle(progress.cancelRequested && !run.cancelRequested ? 'cancel-requested' : 'progress', id);
  }

  finish(id: string, completion: AgentRunCompletion): void {
    const run = this.runs.get(id);
    if (!run || !isAgentRunActive(run)) return;
    const now = this.now();
    this.cancellationHandlers.delete(id);
    this.messageHandlers.delete(id);
    this.runs.set(id, {
      ...run, status: completion.status, finishedAt: now, updatedAt: now, cancellable: false, messageable: false, cancelRequested: false, activity: undefined,
      ...(completion.result !== undefined ? { output: this.bounded(completion.result) } : {}),
      ...(completion.error !== undefined ? { error: this.bounded(completion.error) } : {}),
      ...(completion.usage ? { usage: { ...completion.usage } } : {}),
    });
    this.emitLifecycle('stop', id);
    if (run.source !== 'squad') this.completedRunIds.push(id);
    while (this.completedRunIds.length > this.maxCompletedRuns) {
      const oldestId = this.completedRunIds.shift();
      if (oldestId !== undefined) this.runs.delete(oldestId);
    }
    this.publish();
  }

  private bounded(text: string): string {
    return text.slice(-this.maxOutputCharacters);
  }

  registerMessage(id: string, handler: (message: string) => boolean | Promise<boolean>): () => void {
    const run = this.runs.get(id);
    if (!run || run.source === 'squad' || !isAgentRunActive(run) || run.cancelRequested) return () => {};
    this.messageHandlers.set(id, handler);
    this.runs.set(id, { ...run, messageable: true });
    this.publish();
    return () => {
      if (this.messageHandlers.get(id) !== handler) return;
      this.messageHandlers.delete(id);
      const current = this.runs.get(id);
      if (current) this.runs.set(id, { ...current, messageable: false });
      this.publish();
    };
  }

  async sendMessage(id: string, message: string): Promise<boolean> {
    const run = this.runs.get(id);
    const handler = this.messageHandlers.get(id);
    const content = message.trim();
    if (!run || run.source === 'squad' || !isAgentRunActive(run) || run.cancelRequested
      || !handler || !content || content.length > 8000) return false;
    try {
      const queued = await handler(content);
      if (queued) this.emitLifecycle('message', id, content);
      return queued;
    } catch {
      return false;
    }
  }

  async waitForLifecycle(id: string): Promise<void> {
    await Promise.all(this.lifecycleTasks.get(id) ?? []);
  }

  private emitLifecycle(type: AgentRunLifecycleEvent['type'], id: string, message?: string): void {
    const run = this.runs.get(id);
    if (!run || run.source === 'squad' || !this.options.onLifecycleEvent) return;
    const snapshot = { ...run, ...(run.usage ? { usage: { ...run.usage } } : {}) };
    const task = Promise.resolve().then(() => this.options.onLifecycleEvent?.({ type, run: snapshot, message })).then(() => {}, () => {});
    const pending = this.lifecycleTasks.get(id) ?? new Set<Promise<void>>();
    pending.add(task);
    this.lifecycleTasks.set(id, pending);
    void task.then(() => {
      pending.delete(task);
      if (pending.size === 0) this.lifecycleTasks.delete(id);
    });
  }

  registerCancel(id: string, cancel: () => void | Promise<void>): () => void {
    const run = this.runs.get(id);
    if (!run || run.source === 'squad' || !isAgentRunActive(run)) return () => {};
    this.cancellationHandlers.set(id, cancel);
    this.runs.set(id, { ...run, cancellable: true });
    this.publish();
    return () => {
      if (this.cancellationHandlers.get(id) !== cancel) return;
      this.cancellationHandlers.delete(id);
      const current = this.runs.get(id);
      if (current) this.runs.set(id, { ...current, cancellable: false });
      this.publish();
    };
  }

  async requestCancel(id: string): Promise<boolean> {
    const run = this.runs.get(id);
    const cancel = this.cancellationHandlers.get(id);
    if (!run || !isAgentRunActive(run) || run.cancelRequested || !cancel) return false;
    this.runs.set(id, { ...run, cancelRequested: true });
    this.publish();
    this.emitLifecycle('cancel-requested', id);
    try {
      await cancel();
      return true;
    } catch (error) {
      const current = this.runs.get(id);
      if (current && isAgentRunActive(current)) {
        this.runs.set(id, { ...current, cancelRequested: false, error: this.bounded(error instanceof Error ? error.message : String(error)) });
        this.publish();
      }
      return false;
    }
  }

  getSnapshot(): AgentRunsSnapshot {
    return {
      runs: [...this.runs.values()].map((run) => ({ ...run, ...(run.usage ? { usage: { ...run.usage } } : {}) })),
      updatedAt: this.updatedAt,
      ...(this.externalStatus ? { externalStatus: this.externalStatus } : {}),
    };
  }

  replaceExternal(runs: AgentRun[], message?: string): void {
    for (const run of this.runs.values()) {
      if (run.source === 'squad') this.runs.delete(run.id);
    }
    for (const run of runs.slice(-this.maxCompletedRuns)) {
      if (run.source !== 'squad' || this.runs.has(run.id)) continue;
      this.runs.set(run.id, {
        ...run, cancellable: false, messageable: false,
        ...(run.usage ? { usage: { ...run.usage } } : {}),
        ...(run.output !== undefined ? { output: this.bounded(run.output) } : {}),
      });
    }
    this.externalStatus = message;
    this.publish();
  }

  subscribe(listener: (snapshot: AgentRunsSnapshot) => void): () => void {
    this.listeners.add(listener);
    this.notify(listener);
    return () => { this.listeners.delete(listener); };
  }

  private publish(): void {
    this.updatedAt = this.now();
    for (const listener of this.listeners) {
      this.notify(listener);
    }
  }

  private notify(listener: (snapshot: AgentRunsSnapshot) => void): void {
    try { listener(this.getSnapshot()); } catch { /* Observers must not interrupt running agents. */ }
  }
}
