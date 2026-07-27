/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface SessionDiffStats {
  added: number;
  removed: number;
}

export interface SessionDiffStatsTrackerOptions {
  /** How long a computed snapshot is served before a background refresh starts. */
  cacheTtlMs?: number;
}

interface DiffBaseline {
  tracked: SessionDiffStats;
  untrackedPaths: Set<string>;
}

const ZERO_STATS: SessionDiffStats = { added: 0, removed: 0 };
const MAX_UNTRACKED_FILE_BYTES = 1024 * 1024;
const GIT_COMMAND_TIMEOUT_MS = 10_000;
const DEFAULT_CACHE_TTL_MS = 2_000;

/**
 * Tracks how many lines changed since the session began.
 *
 * Every git call and file read here is asynchronous by design. The status line
 * polls this from several timers while a turn runs, and the previous synchronous
 * implementation froze the event loop on each poll — long enough that typing in
 * the composer visibly stuttered. `getStats()` is therefore a pure read of the
 * last snapshot, and refreshes happen off the calling thread.
 */
export class SessionDiffStatsTracker {
  private readonly cacheTtlMs: number;
  private baseline: DiffBaseline = { tracked: { ...ZERO_STATS }, untrackedPaths: new Set() };
  private snapshot: SessionDiffStats = { ...ZERO_STATS };
  private snapshotAt = 0;
  private readonly ready: Promise<void>;
  private refreshing: Promise<SessionDiffStats> | null = null;

  constructor(
    private readonly workspaceRoot: string,
    options: SessionDiffStatsTrackerOptions = {},
  ) {
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.ready = this.captureBaseline();
  }

  /** Resolves once the session baseline has been captured. */
  whenReady(): Promise<void> {
    return this.ready;
  }

  /**
   * Returns the most recent snapshot without doing any work, scheduling a
   * background refresh when the snapshot has gone stale. Callers on a render
   * path must use this rather than `refresh()`.
   */
  getStats(): SessionDiffStats {
    if (Date.now() - this.snapshotAt >= this.cacheTtlMs) {
      void this.refresh().catch(() => {
        // A failed refresh keeps the previous snapshot; stats are cosmetic.
      });
    }
    return this.snapshot;
  }

  /** Recomputes now. Concurrent callers share one in-flight computation. */
  async refresh(): Promise<SessionDiffStats> {
    if (this.refreshing) {
      return this.refreshing;
    }

    this.refreshing = (async () => {
      await this.ready;
      const stats = await this.computeStats();
      this.snapshot = stats;
      this.snapshotAt = Date.now();
      return stats;
    })();

    try {
      return await this.refreshing;
    } finally {
      this.refreshing = null;
    }
  }

  private async captureBaseline(): Promise<void> {
    const [tracked, untrackedPaths] = await Promise.all([
      this.readTrackedDiffStats(),
      this.readUntrackedPaths(),
    ]);
    this.baseline = { tracked, untrackedPaths };
    this.snapshotAt = Date.now();
  }

  private async computeStats(): Promise<SessionDiffStats> {
    const [tracked, untrackedAdded] = await Promise.all([
      this.readTrackedDiffStats(),
      this.countNewUntrackedLines(),
    ]);

    return {
      added: Math.max(0, tracked.added - this.baseline.tracked.added) + untrackedAdded,
      removed: Math.max(0, tracked.removed - this.baseline.tracked.removed),
    };
  }

  private async readTrackedDiffStats(): Promise<SessionDiffStats> {
    const output = await this.runGit(['diff', '--numstat', 'HEAD', '--'])
      ?? await this.runGit(['diff', '--numstat', '--']);
    return output ? parseGitNumstat(output) : { ...ZERO_STATS };
  }

  private async readUntrackedPaths(): Promise<Set<string>> {
    const output = await this.runGit(['ls-files', '--others', '--exclude-standard', '-z']);
    if (!output) {
      return new Set();
    }
    return new Set(output.split('\0').filter(Boolean));
  }

  private async countNewUntrackedLines(): Promise<number> {
    const paths = await this.readUntrackedPaths();
    const counts = await Promise.all(
      [...paths]
        .filter((relativePath) => !this.baseline.untrackedPaths.has(relativePath))
        .map((relativePath) => countFileLines(
          path.resolve(this.workspaceRoot, relativePath),
          this.workspaceRoot,
        )),
    );
    return counts.reduce((total, count) => total + count, 0);
  }

  private runGit(args: string[]): Promise<string | null> {
    return new Promise((resolve) => {
      execFile('git', args, {
        cwd: this.workspaceRoot,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        timeout: GIT_COMMAND_TIMEOUT_MS,
      }, (error, stdout) => {
        resolve(error ? null : stdout);
      });
    });
  }
}

export function parseGitNumstat(output: string): SessionDiffStats {
  const stats: SessionDiffStats = { added: 0, removed: 0 };

  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    const [added, removed] = line.split('\t');
    const addedCount = Number.parseInt(added, 10);
    const removedCount = Number.parseInt(removed, 10);

    if (Number.isFinite(addedCount)) {
      stats.added += addedCount;
    }
    if (Number.isFinite(removedCount)) {
      stats.removed += removedCount;
    }
  }

  return stats;
}

async function countFileLines(filePath: string, workspaceRoot: string): Promise<number> {
  const resolvedRoot = path.resolve(workspaceRoot);
  if (filePath !== resolvedRoot && !filePath.startsWith(`${resolvedRoot}${path.sep}`)) {
    return 0;
  }

  let buffer: Buffer;
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile() || stats.size > MAX_UNTRACKED_FILE_BYTES) {
      return 0;
    }
    buffer = await fs.readFile(filePath);
  } catch {
    return 0;
  }

  if (buffer.length === 0 || buffer.includes(0)) {
    return 0;
  }

  // Indexed scan rather than iterating the Buffer: the iterator protocol is
  // orders of magnitude slower on the megabyte-sized files this accepts.
  let lines = 0;
  for (let index = 0; index < buffer.length; index++) {
    if (buffer[index] === 10) {
      lines++;
    }
  }

  return buffer[buffer.length - 1] === 10 ? lines : lines + 1;
}
