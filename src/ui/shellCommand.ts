/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shell command execution module for handling ! prefix commands
 * in the interactive prompt.
 */

import { execSync } from 'node:child_process';

/**
 * Default timeout for shell commands (30 seconds)
 */
export const DEFAULT_SHELL_TIMEOUT = 30000;

/**
 * Result of executing a shell command
 */
export interface ShellCommandResult {
  /** Whether the command executed successfully */
  success: boolean;
  /** Command output (stdout) */
  output?: string;
  /** Error message if command failed */
  error?: string;
}

/**
 * Check if the input is a shell command (starts with !)
 * @param input - The user input string
 * @returns true if input is a valid shell command
 */
export function isShellCommand(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed.startsWith('!')) {
    return false;
  }
  // Must have actual command after the !
  const command = trimmed.slice(1).trim();
  return command.length > 0;
}

/**
 * Parse the shell command from input
 * @param input - The user input string starting with !
 * @returns The command to execute (without the ! prefix)
 */
export function parseShellCommand(input: string): string {
  if (!input.trim().startsWith('!')) {
    return '';
  }
  return input.trim().slice(1).trim();
}

/**
 * Check if the input is a command that should execute immediately (not queued).
 * Shell commands (! prefix) and slash commands (/ prefix) bypass the queue.
 */
export function isImmediateCommand(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;

  // Shell commands: ! followed by actual command
  if (isShellCommand(trimmed)) return true;

  // Slash commands: / followed by at least one non-space character
  if (trimmed.startsWith('/')) {
    const command = trimmed.slice(1).trim();
    return command.length > 0;
  }

  return false;
}

/**
 * Execute a shell command and return the result
 * @param command - The command to execute
 * @param cwd - Working directory (defaults to process.cwd())
 * @param timeout - Timeout in milliseconds (defaults to 30000)
 * @returns ShellCommandResult with success status and output/error
 */
export function executeShellCommand(
  command: string,
  cwd?: string,
  timeout: number = DEFAULT_SHELL_TIMEOUT
): ShellCommandResult {
  const trimmedCommand = command.trim();

  try {
    const result = execSync(trimmedCommand, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: cwd ?? process.cwd(),
      timeout
    });

    return {
      success: true,
      output: result || ''
    };
  } catch (error: unknown) {
    const execError = error as { stderr?: string; message?: string };

    if (execError.stderr) {
      return {
        success: false,
        error: execError.stderr
      };
    }

    return {
      success: false,
      error: execError.message || 'Unknown error'
    };
  }
}
