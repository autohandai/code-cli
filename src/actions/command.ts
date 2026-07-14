/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawn } from 'node:child_process';
import type { SpawnOptions } from 'node:child_process';
import { isAbsolute, join } from 'node:path';
import { buildAutohandChildProcessEnv } from '../utils/childProcessEnv.js';

const DEFAULT_KILL_GRACE_PERIOD_MS = 1_000;

export class CommandAbortedError extends Error {
  readonly stdout: string;
  readonly stderr: string;

  constructor(stdout = '', stderr = '') {
    super('Command execution aborted');
    this.name = 'AbortError';
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

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
  /** Run command with inherited stdio for interactive prompts (passwords, etc.) */
  interactive?: boolean;
  /** Cancel a foreground command. Already-started detached commands ignore later aborts. */
  signal?: AbortSignal;
  /** Grace period between SIGTERM and SIGKILL for foreground termination. */
  killGracePeriodMs?: number;
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
  if (options.signal?.aborted) {
    return Promise.reject(new CommandAbortedError());
  }

  return new Promise((resolve, reject) => {
    const workDir = options.directory
      ? (isAbsolute(options.directory) ? options.directory : join(cwd, options.directory))
      : cwd;

    // Build spawn options
    const spawnOptions: SpawnOptions = {
      cwd: workDir,
      shell: options.shell ?? false,
      env: buildAutohandChildProcessEnv(options.env),
    };

    // Handle background process
    if (options.background) {
      spawnOptions.detached = true;
      spawnOptions.stdio = ['ignore', 'pipe', 'pipe'];
    } else if (options.interactive) {
      // Interactive mode: inherit stdio for password prompts, TUI apps, etc.
      spawnOptions.stdio = 'inherit';
    }

    // Bun may throw synchronously from spawn() when the command is not found (ENOENT),
    // unlike Node.js which defers it to the 'error' event. Catch here to prevent
    // uncaught exceptions from crashing the process.
    let child;
    try {
      child = spawn(cmd, args, spawnOptions);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        reject(new Error(`Command not found: ${cmd}`));
      } else {
        reject(error);
      }
      return;
    }

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
    let forceKillId: NodeJS.Timeout | undefined;
    let settled = false;
    let terminationReason: 'abort' | 'timeout' | null = null;
    const killGracePeriodMs = Math.max(0, options.killGracePeriodMs ?? DEFAULT_KILL_GRACE_PERIOD_MS);

    const cleanup = (): void => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
      if (forceKillId) {
        clearTimeout(forceKillId);
        forceKillId = undefined;
      }
      options.signal?.removeEventListener('abort', handleAbort);
    };

    const finishWithError = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const finishWithResult = (result: CommandResult): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const terminate = (reason: 'abort' | 'timeout'): void => {
      if (settled || terminationReason) return;
      terminationReason = reason;
      child.kill('SIGTERM');
      forceKillId = setTimeout(() => {
        if (!settled) {
          child.kill('SIGKILL');
        }
      }, killGracePeriodMs);
      forceKillId.unref?.();
    };

    function handleAbort(): void {
      terminate('abort');
    }

    if (options.signal) {
      options.signal.addEventListener('abort', handleAbort, { once: true });
      if (options.signal.aborted) {
        handleAbort();
      }
    }

    // Set up timeout if specified
    if (options.timeout && options.timeout > 0) {
      timeoutId = setTimeout(() => {
        terminate('timeout');
      }, options.timeout);
      timeoutId.unref?.();
    }

    if (!options.interactive) {
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
    }

    child.once('error', (error: NodeJS.ErrnoException) => {
      if (terminationReason === 'abort') {
        finishWithError(new CommandAbortedError(stdout, stderr));
        return;
      }
      if (error.code === 'ENOENT') {
        finishWithError(new Error(`Command not found: ${cmd}`));
      } else {
        finishWithError(error);
      }
    });

    child.once('close', (code, signal) => {
      if (terminationReason === 'abort') {
        finishWithError(new CommandAbortedError(stdout, stderr));
        return;
      }
      finishWithResult({ stdout, stderr, code, signal });
    });
  });
}

/**
 * Detect whether a command string contains shell operators that
 * require `shell: true` to execute correctly (pipes, redirections,
 * chaining, globs, variable expansion, etc.).
 *
 * Only inspects the command string itself. Separate args are always
 * passed as literals by the caller, so shell syntax in args is
 * intentional quoting (e.g., commit messages with `$variable` text).
 */
const SHELL_PATTERN = /[|><;&`]|\$[({A-Za-z_]|&&|\|\||[*?](?![\w./-]*$)/;
export function needsShell(cmd: string): boolean {
  return SHELL_PATTERN.test(cmd);
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
