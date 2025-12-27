/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawn } from 'node:child_process';
import type { SpawnOptions } from 'node:child_process';
import { join } from 'node:path';

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number | null;
  /** PID of background process (only set when background: true) */
  backgroundPid?: number;
  /** Signal that terminated the process (if any) */
  signal?: NodeJS.Signals | null;
}

export interface RunCommandOptions {
  /** Directory relative to cwd to execute in */
  directory?: string;
  /** Run process in background (detached) */
  background?: boolean;
  /** Use shell mode for piping/chaining (bash -c on Unix, cmd /c on Windows) */
  shell?: boolean;
  /** Additional environment variables */
  env?: Record<string, string>;
  /** Timeout in milliseconds (0 = no timeout) */
  timeout?: number;
  /** Stream stdout output */
  onStdout?: (chunk: string) => void;
  /** Stream stderr output */
  onStderr?: (chunk: string) => void;
}

/**
 * Execute a shell command with enhanced options
 *
 * @param cmd - Command to execute
 * @param args - Command arguments
 * @param cwd - Base working directory
 * @param options - Extended options for directory, background, shell mode
 * @returns Command result with stdout, stderr, code, and optional backgroundPid
 */
export function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  options: RunCommandOptions = {}
): Promise<CommandResult> {
  if (!cmd || typeof cmd !== 'string') {
    return Promise.reject(new Error('Command is required and must be a string'));
  }

  return new Promise((resolve, reject) => {
    const workDir = options.directory
      ? join(cwd, options.directory)
      : cwd;

    // Build spawn options
    const spawnOptions: SpawnOptions = {
      cwd: workDir,
      shell: options.shell ?? false,
      env: {
        ...process.env,
        AUTOHAND_CLI: '1',
        ...options.env,
      },
    };

    // Handle background process
    if (options.background) {
      spawnOptions.detached = true;
      spawnOptions.stdio = ['ignore', 'pipe', 'pipe'];
    }

    const child = spawn(cmd, args, spawnOptions);

    // For background processes, unref and return immediately with PID
    if (options.background) {
      child.unref();
      resolve({
        stdout: '',
        stderr: '',
        code: null,
        backgroundPid: child.pid,
        signal: null,
      });
      return;
    }

    let stdout = '';
    let stderr = '';
    let timeoutId: NodeJS.Timeout | undefined;

    // Set up timeout if specified
    if (options.timeout && options.timeout > 0) {
      timeoutId = setTimeout(() => {
        child.kill('SIGTERM');
      }, options.timeout);
    }

    child.stdout?.on('data', (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      stdout += text;
      options.onStdout?.(text);
    });

    child.stderr?.on('data', (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      stderr += text;
      options.onStderr?.(text);
    });

    child.once('error', (error) => {
      if (timeoutId) clearTimeout(timeoutId);
      reject(error);
    });

    child.once('close', (code, signal) => {
      if (timeoutId) clearTimeout(timeoutId);
      resolve({ stdout, stderr, code, signal });
    });
  });
}

/**
 * Execute a command in shell mode (enables piping and shell features)
 * Convenience wrapper around runCommand with shell: true
 */
export function runShellCommand(
  command: string,
  cwd: string,
  options: Omit<RunCommandOptions, 'shell'> = {}
): Promise<CommandResult> {
  return runCommand(command, [], cwd, { ...options, shell: true });
}
