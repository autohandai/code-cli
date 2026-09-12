/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase timing for interactive startup. Marks are cheap and always recorded;
 * the report is shown when AUTOHAND_STARTUP_TIMING=1 (or AUTOHAND_DEBUG) so a
 * slow start can be attributed to a phase instead of guessed at.
 */

export interface StartupTimelineEntry {
  name: string;
  /** Milliseconds since the timeline started. */
  at: number;
  /** Milliseconds since the previous mark. */
  delta: number;
}

export class StartupTimeline {
  private readonly entries: StartupTimelineEntry[] = [];
  private last: number;

  constructor(private readonly origin: number = now()) {
    this.last = origin;
  }

  mark(name: string, at: number = now()): StartupTimelineEntry {
    const entry = { name, at: Math.max(0, at - this.origin), delta: Math.max(0, at - this.last) };
    this.last = at;
    this.entries.push(entry);
    return entry;
  }

  list(): readonly StartupTimelineEntry[] {
    return this.entries;
  }

  /** One line per mark: `  1234 ms  +56 ms  name`, slowest phase flagged. */
  format(): string {
    if (this.entries.length === 0) return 'Startup timing: no marks recorded.';
    const slowest = this.entries.reduce((max, entry) => (entry.delta > max.delta ? entry : max), this.entries[0]!);
    const lines = this.entries.map((entry) => {
      const flag = entry === slowest && entry.delta >= 250 ? '  ← slowest' : '';
      return `  ${String(Math.round(entry.at)).padStart(6)} ms  +${String(Math.round(entry.delta)).padStart(5)} ms  ${entry.name}${flag}`;
    });
    return ['Startup timing (ms since process start):', ...lines].join('\n');
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function isStartupTimingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.AUTOHAND_STARTUP_TIMING?.trim().toLowerCase();
  if (flag === '1' || flag === 'true') return true;
  const debug = env.AUTOHAND_DEBUG?.trim().toLowerCase();
  return debug === '1' || debug === 'true';
}

/** Process-wide timeline; the origin is the moment this module is first loaded. */
export const startupTimeline = new StartupTimeline(now());
