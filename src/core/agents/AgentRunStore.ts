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
  provider?: string;
  model?: string;
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
}

export function isAgentRunActive(run: Pick<AgentRun, 'status'>): boolean {
  return run.status === 'pending' || run.status === 'running';
}

export class AgentRunStore {
  private readonly runs = new Map<string, AgentRun>();
  private readonly listeners = new Set<(snapshot: AgentRunsSnapshot) => void>();
  private readonly cancellationHandlers = new Map<string, () => void | Promise<void>>();
  private readonly completedRunIds: string[] = [];
  private readonly now: () => number;
  private readonly maxCompletedRuns: number;
  private readonly maxOutputCharacters: number;
  private updatedAt = 0;
  private externalStatus: string | undefined;

  constructor(options: AgentRunStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.maxCompletedRuns = Math.max(1, Math.floor(options.maxCompletedRuns ?? 100));
    this.maxOutputCharacters = Math.max(1, Math.floor(options.maxOutputCharacters ?? 8192));
  }

  start(input: AgentRunInput): void {
    if (this.runs.has(input.id)) return;
    const now = this.now();
    this.runs.set(input.id, { ...input, status: 'running', startedAt: now, updatedAt: now, cancellable: false });
    this.publish();
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
  }

  finish(id: string, completion: AgentRunCompletion): void {
    const run = this.runs.get(id);
    if (!run || !isAgentRunActive(run)) return;
    const now = this.now();
    this.cancellationHandlers.delete(id);
    this.runs.set(id, {
      ...run, status: completion.status, finishedAt: now, updatedAt: now, cancellable: false, cancelRequested: false, activity: undefined,
      ...(completion.result !== undefined ? { output: this.bounded(completion.result) } : {}),
      ...(completion.error !== undefined ? { error: this.bounded(completion.error) } : {}),
      ...(completion.usage ? { usage: { ...completion.usage } } : {}),
    });
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
        ...run, cancellable: false,
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
