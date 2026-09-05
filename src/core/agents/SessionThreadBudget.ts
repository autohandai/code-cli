/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { LoadedConfig } from '../../types.js';

export const DEFAULT_MAX_CONCURRENT_THREADS_PER_SESSION = 9;
export const MAX_CONCURRENT_THREADS_PER_SESSION = 64;

export interface ThreadLease {
  release(): void | Promise<void>;
}

export interface ThreadBudget {
  tryAcquire(runId: string): ThreadLease | Promise<ThreadLease>;
}

export function isValidSessionThreadLimit(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 1
    && value <= MAX_CONCURRENT_THREADS_PER_SESSION;
}

export class SessionThreadLimitError extends Error {
  constructor(readonly maxThreads: number) {
    super(maxThreads === 1
      ? 'Delegation is disabled: this session allows only the lead thread. Change features.multi_agent_v2.max_concurrent_threads_per_session to enable subagents.'
      : `This session is limited to ${maxThreads} concurrent threads, including the lead. Finish or stop an existing child before starting another, or change features.multi_agent_v2.max_concurrent_threads_per_session.`);
    this.name = 'SessionThreadLimitError';
  }
}

export class SessionThreadBudget implements ThreadBudget {
  private readonly children = new Set<string>();

  constructor(
    private readonly getMaxThreads: () => number = () => DEFAULT_MAX_CONCURRENT_THREADS_PER_SESSION,
  ) {}

  get maxThreads(): number {
    const limit = this.getMaxThreads();
    if (!isValidSessionThreadLimit(limit)) {
      throw new RangeError(`Session thread limit must be an integer between 1 and ${MAX_CONCURRENT_THREADS_PER_SESSION}.`);
    }
    return limit;
  }

  get activeChildren(): number {
    return this.children.size;
  }

  get availableChildren(): number {
    return Math.max(0, this.maxThreads - 1 - this.activeChildren);
  }

  tryAcquire(runId: string): ThreadLease {
    if (!runId.trim()) throw new Error('A child run identifier is required.');
    if (this.children.has(runId)) throw new Error(`Child run '${runId}' is already registered.`);
    const limit = this.maxThreads;
    // Waiting here can deadlock when every parent holds a lease while delegating.
    if (this.children.size >= limit - 1) throw new SessionThreadLimitError(limit);
    this.children.add(runId);
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.children.delete(runId);
      },
    };
  }
}

type ThreadBudgetConfig = Pick<LoadedConfig, 'features'>;
const sessionBudgets = new WeakMap<ThreadBudgetConfig, SessionThreadBudget>();

export function getSessionThreadBudget(config?: ThreadBudgetConfig): SessionThreadBudget {
  if (!config) return new SessionThreadBudget();
  const existing = sessionBudgets.get(config);
  if (existing) return existing;
  const budget = new SessionThreadBudget(() =>
    config.features?.multi_agent_v2?.max_concurrent_threads_per_session
      ?? DEFAULT_MAX_CONCURRENT_THREADS_PER_SESSION);
  sessionBudgets.set(config, budget);
  return budget;
}
