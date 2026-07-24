/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawn } from 'node:child_process';
import type { SpawnOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
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

export interface BackgroundProcessCompletion {
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
}

export interface RunCommandOptions {
  /** Directory relative to cwd to execute in */
  directory?: string;
  /** Run detached from the current turn; live observation lasts while the host CLI remains alive. */
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
  /** Observe background completion or spawn failure while the host CLI remains alive. */
  onBackgroundExit?: (completion: BackgroundProcessCompletion) => void;
  /** Run command with inherited stdio for interactive prompts (passwords, etc.) */
  interactive?: boolean;
  /** Cancel a foreground command. Already-started detached commands ignore later aborts. */
  signal?: AbortSignal;
  /** Grace period between SIGTERM and SIGKILL for foreground termination. */
  killGracePeriodMs?: number;
}

function unrefBackgroundHandle(handle: unknown): void {
  if (
    typeof handle !== 'object'
    || handle === null
    || !('unref' in handle)
    || typeof handle.unref !== 'function'
  ) {
    return;
  }

  try {
    handle.unref();
  } catch {
    // Some stream implementations expose unref but reject it after closing.
  }
}

function toCommandSpawnError(error: unknown, cmd: string, workDir: string): Error {
  const spawnError = error as NodeJS.ErrnoException;
  if (spawnError.code === 'ENOENT') {
    if (!existsSync(workDir)) {
      return new Error(`Working directory not found: ${workDir}`);
    }
    return new Error(`Command not found: ${cmd}`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

function invokeBackgroundExit(
  callback: RunCommandOptions['onBackgroundExit'],
  completion: BackgroundProcessCompletion,
): void {
  try {
    callback?.(completion);
  } catch {
    // Detached-process observers must not destabilize the CLI event loop.
  }
}

function invokeBackgroundOutput(
  callback: ((chunk: string) => void) | undefined,
  chunk: string,
): void {
  try {
    callback?.(chunk);
  } catch {
    // Output observers are isolated from the detached process lifecycle.
  }
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
    const hasTimeout = options.timeout !== undefined && options.timeout > 0;
    const isolateProcessGroup = hasTimeout && process.platform !== 'win32' && !options.background && !options.interactive;

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
    } else if (isolateProcessGroup) {
      spawnOptions.detached = true;
    }

    // Bun may throw synchronously from spawn() when the command is not found (ENOENT),
    // unlike Node.js which defers it to the 'error' event. Catch here to prevent
    // uncaught exceptions from crashing the process.
    let child;
    try {
      child = spawn(cmd, args, spawnOptions);
    } catch (error) {
      const spawnError = toCommandSpawnError(error, cmd, workDir);
      if (options.background) {
        invokeBackgroundExit(options.onBackgroundExit, {
          code: null,
          signal: null,
          error: spawnError,
        });
      }
      reject(spawnError);
      return;
    }

    // Observe detached output and completion without making the caller await it.
    if (options.background) {
      let completed = false;
      let startSettled = false;
      let streamError: Error | undefined;
      const complete = (completion: BackgroundProcessCompletion): void => {
        if (completed) return;
        completed = true;
        invokeBackgroundExit(options.onBackgroundExit, completion);
      };

      const failStart = (error: Error): void => {
        if (startSettled) return;
        startSettled = true;
        reject(error);
      };

      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        invokeBackgroundOutput(options.onStdout, chunk);
      });
      child.stderr?.on('data', (chunk: string) => {
        invokeBackgroundOutput(options.onStderr, chunk);
      });

      child.once('error', (error: unknown) => {
        const spawnError = toCommandSpawnError(error, cmd, workDir);
        complete({
          code: null,
          signal: null,
          error: spawnError,
        });
        failStart(spawnError);
      });
      const recordStreamError = (error: unknown): void => {
        streamError ??= error instanceof Error ? error : new Error(String(error));
      };
      child.stdout?.once('error', recordStreamError);
      child.stderr?.once('error', recordStreamError);
      child.once('close', (code, signal) => {
        complete({
          code,
          signal,
          ...(streamError ? { error: streamError } : {}),
        });
      });

      child.once('spawn', () => {
        const backgroundPid = child.pid;
        if (backgroundPid === undefined) {
          const spawnError = new Error(`Command started without a process ID: ${cmd}`);
          complete({ code: null, signal: null, error: spawnError });
          failStart(spawnError);
          child.kill();
          return;
        }

        if (startSettled) return;
        startSettled = true;
        unrefBackgroundHandle(child);
        unrefBackgroundHandle(child.stdout);
        unrefBackgroundHandle(child.stderr);
        resolve({
          stdout: '',
          stderr: '',
          code: null,
          backgroundPid,
          signal: null,
        });
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

    const signalChild = (signal: NodeJS.Signals): void => {
      if (isolateProcessGroup && child.pid) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
          // The process group may already be gone; fall back to the direct child.
        }
      }
      child.kill(signal);
    };

    const terminate = (reason: 'abort' | 'timeout'): void => {
      if (settled || terminationReason) return;
      terminationReason = reason;
      signalChild('SIGTERM');
      forceKillId = setTimeout(() => {
        if (!settled) {
          signalChild('SIGKILL');
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
    if (hasTimeout) {
      timeoutId = setTimeout(() => {
        terminate('timeout');
      }, options.timeout);
      timeoutId.unref?.();
    }

    if (!options.interactive) {
      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        stdout += chunk;
        options.onStdout?.(chunk);
      });

      child.stderr?.on('data', (chunk: string) => {
        stderr += chunk;
        options.onStderr?.(chunk);
      });
    }

    child.once('error', (error: NodeJS.ErrnoException) => {
      if (terminationReason === 'abort') {
        finishWithError(new CommandAbortedError(stdout, stderr));
        return;
      }
      finishWithError(toCommandSpawnError(error, cmd, workDir));
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
 * Send a signal to a detached process group, falling back to a direct pid
 * kill on Windows or if the group no longer exists. Returns whether the
 * signal was delivered to something — false means the pid is already gone.
 */
function attemptKill(pid: number, signal: NodeJS.Signals): boolean {
  if (process.platform !== 'win32') {
    try {
      process.kill(-pid, signal);
      return true;
    } catch {
      // Process group doesn't exist or already gone; fall back to direct kill.
    }
  }
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

/**
 * Send SIGTERM to a detached process group, then SIGKILL after a grace
 * period if it hasn't exited. Used to stop background processes tracked
 * by BackgroundProcessRegistry (see src/core/agent/BackgroundProcessRegistry.ts).
 * Never throws — a process that's already gone is treated as already stopped.
 */
export async function killProcessGroup(
  pid: number,
  gracePeriodMs: number = DEFAULT_KILL_GRACE_PERIOD_MS,
): Promise<void> {
  if (!attemptKill(pid, 'SIGTERM')) {
    // Already dead — no point waiting out the grace period.
    return;
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      // Grace period elapsed; escalate to SIGKILL regardless of outcome.
      attemptKill(pid, 'SIGKILL');
      resolve();
    }, gracePeriodMs);
    timer.unref?.();
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
