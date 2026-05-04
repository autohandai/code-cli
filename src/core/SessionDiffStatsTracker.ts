/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface SessionDiffStats {
  added: number;
  removed: number;
}

interface DiffBaseline {
  tracked: SessionDiffStats;
  untrackedPaths: Set<string>;
}

const ZERO_STATS: SessionDiffStats = { added: 0, removed: 0 };
const MAX_UNTRACKED_FILE_BYTES = 1024 * 1024;

export class SessionDiffStatsTracker {
  private readonly baseline: DiffBaseline;

  constructor(private readonly workspaceRoot: string) {
    this.baseline = {
      tracked: this.readTrackedDiffStats(),
      untrackedPaths: this.readUntrackedPaths(),
    };
  }

  getStats(): SessionDiffStats {
    const tracked = this.readTrackedDiffStats();
    const untrackedAdded = this.countNewUntrackedLines();

    return {
      added: Math.max(0, tracked.added - this.baseline.tracked.added) + untrackedAdded,
      removed: Math.max(0, tracked.removed - this.baseline.tracked.removed),
    };
  }

  private readTrackedDiffStats(): SessionDiffStats {
    const output = this.runGit(['diff', '--numstat', 'HEAD', '--'])
      ?? this.runGit(['diff', '--numstat', '--']);
    if (!output) {
      return { ...ZERO_STATS };
    }

    return parseGitNumstat(output);
  }

  private readUntrackedPaths(): Set<string> {
    const output = this.runGit(['ls-files', '--others', '--exclude-standard', '-z']);
    if (!output) {
      return new Set();
    }

    return new Set(output.split('\0').filter(Boolean));
  }

  private countNewUntrackedLines(): number {
    let added = 0;
    for (const relativePath of this.readUntrackedPaths()) {
      if (this.baseline.untrackedPaths.has(relativePath)) {
        continue;
      }
      added += countFileLines(path.resolve(this.workspaceRoot, relativePath), this.workspaceRoot);
    }
    return added;
  }

  private runGit(args: string[]): string | null {
    const result = spawnSync('git', args, {
      cwd: this.workspaceRoot,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      timeout: 2_000,
    });

    if (result.error || result.status !== 0) {
      return null;
    }

    return result.stdout;
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

function countFileLines(filePath: string, workspaceRoot: string): number {
  const resolvedRoot = path.resolve(workspaceRoot);
  if (filePath !== resolvedRoot && !filePath.startsWith(`${resolvedRoot}${path.sep}`)) {
    return 0;
  }

  let stats: fs.Stats;
  try {
    stats = fs.statSync(filePath);
  } catch {
    return 0;
  }

  if (!stats.isFile() || stats.size > MAX_UNTRACKED_FILE_BYTES) {
    return 0;
  }

  const buffer = fs.readFileSync(filePath);
  if (buffer.includes(0)) {
    return 0;
  }
  if (buffer.length === 0) {
    return 0;
  }

  let lines = 0;
  for (const byte of buffer) {
    if (byte === 10) {
      lines++;
    }
  }

  return buffer[buffer.length - 1] === 10 ? lines : lines + 1;
}
