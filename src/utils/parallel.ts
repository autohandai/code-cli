/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Safe to parallelize:
 * - multiple read-only file reads on different paths
 * - repository inspection like git status, git log, and shallow directory listing
 * - existence checks for unrelated files
 * - independent network or manager initialization tasks
 *
 * Unsafe to parallelize:
 * - read -> write on the same path
 * - write -> write where one output changes the other's inputs
 * - write/delete/rename combinations that touch the same files or directories
 * - any sequence where later tasks depend on earlier task output
 */

export interface ParallelTaskSpec<T> {
  label: string;
  run: () => Promise<T>;
}

export async function runWithConcurrency<T>(
  tasks: ParallelTaskSpec<T>[],
  maxConcurrency = 5,
): Promise<T[]> {
  if (tasks.length === 0) {
    return [];
  }

  const normalizedConcurrency = Number.isFinite(maxConcurrency) && maxConcurrency > 0
    ? Math.floor(maxConcurrency)
    : 5;

  const results = new Array<T>(tasks.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < tasks.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await tasks[currentIndex].run();
    }
  };

  const workerCount = Math.min(normalizedConcurrency, tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
