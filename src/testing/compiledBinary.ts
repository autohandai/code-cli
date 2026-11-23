/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawnSync } from 'node:child_process';

/**
 * Give a freshly compiled Bun executable a valid ad-hoc signature on macOS.
 *
 * `bun build --compile` appends the bundle to a signed runtime. Some Bun and macOS pairs leave
 * the result with a signature that no longer matches, and Apple silicon kills such a binary on
 * launch (SIGKILL, no output). Signing it again is what a local build has to do before running it.
 */
export function signCompiledBinary(executable: string, platform: NodeJS.Platform = process.platform): void {
  if (platform !== 'darwin') return;
  const signed = spawnSync('codesign', ['--force', '--sign', '-', executable], { encoding: 'utf8' });
  if (signed.error || signed.status !== 0) {
    throw new Error(`Could not sign ${executable}: ${signed.error?.message ?? signed.stderr}`);
  }
}
