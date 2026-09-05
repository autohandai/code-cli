/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'node:crypto';
import type { ThreadBudget, ThreadLease } from '../agents/SessionThreadBudget.js';

interface PendingLease {
  resolve(lease: ThreadLease): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

export class TeammateThreadBudget implements ThreadBudget {
  private readonly pending = new Map<string, PendingLease>();
  private readonly active = new Set<string>();
  private disconnected = false;

  constructor(
    private readonly send: (method: string, params: Record<string, unknown>) => void,
    private readonly timeoutMs = 10_000,
  ) {}

  tryAcquire(runId: string): Promise<ThreadLease> {
    if (this.disconnected) return Promise.reject(new Error('Team lead disconnected'));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        this.release(requestId);
        reject(new Error('Timed out waiting for a session thread from the team lead'));
      }, this.timeoutMs);
      this.pending.set(requestId, { resolve, reject, timeout });
      try {
        this.send('team.threadAcquire', { requestId, runId });
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  handleResult(params: Record<string, unknown>): void {
    const { requestId, granted, error } = params;
    if (typeof requestId !== 'string' || typeof granted !== 'boolean') return;
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    clearTimeout(pending.timeout);
    if (!granted) {
      pending.reject(new Error(typeof error === 'string' ? error.slice(0, 4_000) : 'Session thread request refused'));
      return;
    }
    this.active.add(requestId);
    pending.resolve({ release: () => {
      if (!this.active.delete(requestId)) return;
      this.release(requestId);
    } });
  }

  disconnect(): void {
    if (this.disconnected) return;
    this.disconnected = true;
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timeout);
      this.release(requestId);
      pending.reject(new Error('Team lead disconnected'));
    }
    this.pending.clear();
  }

  dispose(): void {
    this.disconnect();
    for (const requestId of this.active) this.release(requestId);
    this.active.clear();
  }

  private release(requestId: string): void {
    try {
      this.send('team.threadRelease', { requestId });
    } catch {
      // The lead also releases every child lease when this process closes.
    }
  }
}
