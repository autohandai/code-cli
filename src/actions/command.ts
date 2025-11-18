/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawn } from 'node:child_process';
import type { SpawnOptions } from 'node:child_process';

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export function runCommand(cmd: string, args: string[], cwd: string, options: SpawnOptions = {}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, shell: false, ...options });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => {
      resolve({ stdout, stderr, code });
    });
  });
}
