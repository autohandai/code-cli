/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { killProcessGroup } from '../../actions/command.js';

export interface BackgroundProcessEntry {
  id: number;
  pid: number;
  command: string;
  directory?: string;
  startedAt: number;
}

export interface StopResult {
  ok: boolean;
  message: string;
}

/**
 * Session-scoped registry of currently-running background shell processes,
 * backing the /ps and /stop slash commands. `id` is a monotonically
 * increasing counter, never reused, so a stale reference from an earlier
 * /ps listing can never resolve to a different process later.
 */
export class BackgroundProcessRegistry {
  private nextId = 1;
  private readonly entries = new Map<number, BackgroundProcessEntry>();

  register(pid: number, command: string, directory?: string): number {
    const id = this.nextId;
    this.nextId += 1;
    this.entries.set(id, { id, pid, command, directory, startedAt: Date.now() });
    return id;
  }

  remove(id: number): void {
    this.entries.delete(id);
  }

  list(): BackgroundProcessEntry[] {
    return [...this.entries.values()].sort((a, b) => a.id - b.id);
  }

  get(id: number): BackgroundProcessEntry | undefined {
    return this.entries.get(id);
  }

  async stop(id: number, gracePeriodMs?: number): Promise<StopResult> {
    const entry = this.entries.get(id);
    if (!entry) {
      return { ok: false, message: `No background process with index ${id}.` };
    }

    await killProcessGroup(entry.pid, gracePeriodMs);
    this.entries.delete(id);
    return { ok: true, message: `Stopped "${entry.command}" (pid ${entry.pid}).` };
  }

  async killAll(gracePeriodMs?: number): Promise<void> {
    const ids = [...this.entries.keys()];
    await Promise.all(ids.map((id) => this.stop(id, gracePeriodMs)));
  }
}
