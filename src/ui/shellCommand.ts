/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shell command execution module for handling ! prefix commands
 * in the interactive prompt.
 */

import { execSync, spawn } from 'node:child_process';
import { readdirSync, type Dirent } from 'node:fs';
import path from 'node:path';

/**
 * Default timeout for shell commands (30 seconds)
 */
const DEFAULT_SHELL_TIMEOUT = 30000;

const SHELL_HOT_TIP_SUGGESTIONS = [
  'git status',
  'bun test',
  'bun run lint',
];

const SHELL_COMMAND_CANDIDATES = [
  'git',
  'bun',
  'npm',
  'pnpm',
  'yarn',
  'node',
  'python',
  'python3',
  'ls',
  'cd',
  'mkdir',
  'cat',
  'rg',
  'grep',
  'find',
  'touch',
  'cp',
  'mv',
  'rm',
  'pwd',
];

const COMMAND_TEMPLATE_MAP: Record<string, string[]> = {
  git: ['git status', 'git diff', 'git log --oneline -5'],
  bun: ['bun test', 'bun run lint', 'bun run build'],
  npm: ['npm test', 'npm run lint', 'npm run build'],
  pnpm: ['pnpm test', 'pnpm lint', 'pnpm build'],
  yarn: ['yarn test', 'yarn lint', 'yarn build'],
  ls: ['ls -la'],
  cd: ['cd ./', 'cd ..'],
  mkdir: ['mkdir -p '],
  rg: ['rg "TODO" src'],
};

const PATH_COMPLETION_COMMANDS = new Set([
  'cd',
  'mkdir',
  'ls',
  'cat',
  'rm',
  'cp',
  'mv',
  'touch',
]);

const DIRECTORY_ONLY_PATH_COMMANDS = new Set(['cd']);

const DIR_ENTRIES_CACHE_TTL_MS = 750;
const dirEntriesCache = new Map<string, { expiresAt: number; entries: Dirent[] }>();

interface ShellSuggestionOptions {
  cwd?: string;
  limit?: number;
}

function unescapeShellSpaces(value: string): string {
  return value.replace(/\\ /g, ' ');
}

function escapeShellSpaces(value: string): string {
  return value.replace(/ /g, '\\ ');
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items));
}

function getCachedDirectoryEntries(absDir: string): Dirent[] {
  const now = Date.now();
  const cached = dirEntriesCache.get(absDir);
  if (cached && cached.expiresAt > now) {
    return cached.entries;
  }

  try {
    const entries = readdirSync(absDir, { withFileTypes: true });
    dirEntriesCache.set(absDir, {
      expiresAt: now + DIR_ENTRIES_CACHE_TTL_MS,
      entries,
    });
    return entries;
  } catch {
    return [];
  }
}

function completePathToken(
  rawToken: string,
  options: ShellSuggestionOptions & { directoriesOnly?: boolean } = {}
): string[] {
  const cwd = options.cwd ?? process.cwd();
  const unescapedToken = unescapeShellSpaces(rawToken);
  const lastSlash = unescapedToken.lastIndexOf('/');
  const dirPart = lastSlash >= 0 ? unescapedToken.slice(0, lastSlash + 1) : '';
  const namePrefix = lastSlash >= 0 ? unescapedToken.slice(lastSlash + 1) : unescapedToken;
  const directoriesOnly = options.directoriesOnly === true;

  const searchDirAbs = unescapedToken.startsWith('/')
    ? path.resolve(dirPart || '/')
    : path.resolve(cwd, dirPart || '.');

  const matches = getCachedDirectoryEntries(searchDirAbs)
    .filter((entry) => !directoriesOnly || entry.isDirectory())
    .filter((entry) => entry.name.startsWith(namePrefix))
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

  return matches.map((entry) => {
    const suffix = entry.isDirectory() ? '/' : '';
    const completed = `${dirPart}${entry.name}${suffix}`;
    return escapeShellSpaces(completed);
  });
}

function parseBangInput(line: string): { commandBody: string; hasTrailingSpace: boolean } | null {
  const withoutLeading = line.trimStart();
  if (!withoutLeading.startsWith('!')) {
    return null;
  }

  const commandBody = withoutLeading.slice(1).trimStart();
  return {
    commandBody,
    hasTrailingSpace: /\s$/.test(line),
  };
}

function buildCommandNameSuggestions(commandPrefix: string): string[] {
  const prefix = commandPrefix.toLowerCase();
  const matches = SHELL_COMMAND_CANDIDATES.filter((candidate) => candidate.startsWith(prefix));
  const exact = SHELL_COMMAND_CANDIDATES.find((candidate) => candidate === prefix);
  const suggestions: string[] = [];

  if (exact) {
    const templates = COMMAND_TEMPLATE_MAP[exact] ?? [];
    suggestions.push(...templates.map((template) => `! ${template}`));
  }

  for (const candidate of matches) {
    suggestions.push(`! ${candidate} `);
  }

  return unique(suggestions);
}

function buildPathSuggestions(
  commandName: string,
  args: string[],
  hasTrailingSpace: boolean,
  options: ShellSuggestionOptions = {}
): string[] {
  const normalizedCommand = commandName.toLowerCase();
  if (!PATH_COMPLETION_COMMANDS.has(normalizedCommand)) {
    return [];
  }

  if (!hasTrailingSpace && args.length > 0 && args[args.length - 1]?.startsWith('-')) {
    return [];
  }

  const targetIndex = hasTrailingSpace ? args.length : Math.max(0, args.length - 1);
  const rawToken = hasTrailingSpace ? '' : (args[targetIndex] ?? '');
  const completedTokens = completePathToken(rawToken, {
    ...options,
    directoriesOnly: DIRECTORY_ONLY_PATH_COMMANDS.has(normalizedCommand),
  });

  const result: string[] = [];
  for (const token of completedTokens) {
    const nextArgs = [...args];
    if (hasTrailingSpace) {
      nextArgs.push(token);
    } else {
      nextArgs[targetIndex] = token;
    }

    const suggestion = `! ${commandName}${nextArgs.length > 0 ? ` ${nextArgs.join(' ')}` : ''}`;
    result.push(token.endsWith('/') ? suggestion : `${suggestion} `);
  }

  return result;
}

/**
 * Build shell command suggestions for an input line that starts with `!`.
 * Suggestions are ordered with the most likely completion first.
 */
export function getShellCommandSuggestions(
  line: string,
  options: ShellSuggestionOptions = {}
): string[] {
  const parsed = parseBangInput(line);
  if (!parsed) {
    return [];
  }

  const { commandBody, hasTrailingSpace } = parsed;
  const limit = Math.max(1, options.limit ?? 5);

  if (!commandBody) {
    return SHELL_HOT_TIP_SUGGESTIONS.slice(0, limit).map((value) => `! ${value}`);
  }

  const tokens = commandBody.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return SHELL_HOT_TIP_SUGGESTIONS.slice(0, limit).map((value) => `! ${value}`);
  }

  const commandName = tokens[0];
  const args = tokens.slice(1);

  const commandNameSuggestions = (!hasTrailingSpace && tokens.length === 1)
    ? buildCommandNameSuggestions(commandName)
    : [];

  const pathSuggestions = buildPathSuggestions(commandName, args, hasTrailingSpace, options);
  const templates = (COMMAND_TEMPLATE_MAP[commandName.toLowerCase()] ?? [])
    .map((value) => `! ${value}`);
  const hotTips = SHELL_HOT_TIP_SUGGESTIONS.map((value) => `! ${value}`);

  return unique([
    ...pathSuggestions,
    ...commandNameSuggestions,
    ...templates,
    ...hotTips,
  ]).slice(0, limit);
}

/**
 * Return the top shell completion candidate for a `!` command line.
 */
export function getPrimaryShellCommandSuggestion(
  line: string,
  options: ShellSuggestionOptions = {}
): string | null {
  const [first] = getShellCommandSuggestions(line, { ...options, limit: 1 });
  return first ?? null;
}

/**
 * Result of executing a shell command
 */
interface ShellCommandResult {
  /** Whether the command executed successfully */
  success: boolean;
  /** Command output (stdout) */
  output?: string;
  /** Error message if command failed */
  error?: string;
}

type ExecAsyncError = Error & {
  stderr?: string | Buffer;
};

interface ExecuteShellCommandAsyncOptions {
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface ExecuteStreamingShellCommandOptions extends ExecuteShellCommandAsyncOptions {
  preferPty?: boolean;
  columns?: number;
  rows?: number;
  /** Run process in background (detached). Returns immediately with PID. */
  background?: boolean;
}

interface PtyDisposable {
  dispose(): void;
}

interface PtyProcess {
  onData(handler: (data: string) => void): PtyDisposable;
  onExit(handler: (event: { exitCode: number; signal?: number }) => void): PtyDisposable;
  kill(): void;
}

interface NodePtyModule {
  spawn(
    file: string,
    args?: string[],
    options?: {
      name?: string;
      cols?: number;
      rows?: number;
      cwd?: string;
      env?: NodeJS.ProcessEnv;
    }
  ): PtyProcess;
}

async function defaultNodePtyLoader(): Promise<NodePtyModule | null> {
  try {
    return await import('node-pty') as unknown as NodePtyModule;
  } catch {
    return null;
  }
}

let nodePtyLoader: () => Promise<NodePtyModule | null> = defaultNodePtyLoader;

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
 * File paths starting with / (e.g., /var/folders/.../Screenshot.png) are NOT commands.
 */
export function isImmediateCommand(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;

  // Shell commands: ! followed by actual command
  if (isShellCommand(trimmed)) return true;

  // Slash commands: / followed by at least one non-space character
  // BUT: exclude file paths like /var/folders/... or /Users/...
  if (trimmed.startsWith('/')) {
    const command = trimmed.slice(1).trim();
    if (command.length === 0) return false;
    
    // Check if this looks like a file path (has nested slashes or common path prefixes)
    // File paths like /var/folders/... or /Users/... should NOT be treated as commands
    const firstToken = trimmed.split(/\s+/, 1)[0] ?? '';
    const hasNestedSlashes = (firstToken.match(/\//g) || []).length > 1;
    const isCommonPathPrefix = /^\/(?:Users|home|tmp|var|opt|etc|usr)\//i.test(firstToken);
    const looksLikeFile = /\.[a-z0-9]{1,5}$/i.test(firstToken);
    
    if (hasNestedSlashes || isCommonPathPrefix || looksLikeFile) {
      return false; // Looks like a file path, not a command
    }
    
    return true;
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

export async function executeShellCommandAsync(
  command: string,
  cwd?: string,
  timeout: number = DEFAULT_SHELL_TIMEOUT,
  options: ExecuteShellCommandAsyncOptions = {}
): Promise<ShellCommandResult> {
  const trimmedCommand = command.trim();

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let resolved = false;
    let timedOut = false;
    let timeoutId: NodeJS.Timeout | undefined;

    const finish = (result: ShellCommandResult): void => {
      if (resolved) {
        return;
      }
      resolved = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      resolve(result);
    };

    let child;
    try {
      child = spawn(trimmedCommand, {
        cwd: cwd ?? process.cwd(),
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      const execError = error as ExecAsyncError;
      finish({
        success: false,
        error: execError.stderr?.toString() || execError.message || 'Unknown error'
      });
      return;
    }

    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeout);
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

    child.once('error', (error: ExecAsyncError) => {
      finish({
        success: false,
        error: stderr || error.stderr?.toString() || error.message || 'Unknown error'
      });
    });

    child.once('close', (code, signal) => {
      if (code === 0) {
        finish({
          success: true,
          output: stdout
        });
        return;
      }

      const errorMessage = timedOut
        ? `Command timed out after ${timeout}ms`
        : stderr || (signal ? `Command terminated by ${signal}` : `Command failed with exit code ${code ?? 'unknown'}`);

      finish({
        success: false,
        error: errorMessage
      });
    });
  });
}

export async function executeInteractiveShellCommand(
  command: string,
  cwd?: string
): Promise<ShellCommandResult> {
  const trimmedCommand = command.trim();

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(trimmedCommand, {
        cwd: cwd ?? process.cwd(),
        shell: true,
        stdio: 'inherit',
      });
    } catch (error) {
      const execError = error as ExecAsyncError;
      resolve({
        success: false,
        error: execError.stderr?.toString() || execError.message || 'Unknown error'
      });
      return;
    }

    child.once('error', (error: ExecAsyncError) => {
      resolve({
        success: false,
        error: error.stderr?.toString() || error.message || 'Unknown error'
      });
    });

    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve({ success: true, output: '' });
        return;
      }

      resolve({
        success: false,
        error: signal ? `Command terminated by ${signal}` : `Command failed with exit code ${code ?? 'unknown'}`
      });
    });
  });
}

export async function loadNodePty(): Promise<NodePtyModule | null> {
  return nodePtyLoader();
}

export function setNodePtyLoaderForTests(loader?: () => Promise<NodePtyModule | null>): void {
  nodePtyLoader = loader ?? defaultNodePtyLoader;
}

function getPtyShellLaunch(command: string): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    const comspec = process.env.ComSpec || 'cmd.exe';
    return {
      file: comspec,
      args: ['/d', '/s', '/c', command],
    };
  }

  const shell = process.env.SHELL || '/bin/sh';
  return {
    file: shell,
    args: ['-lc', command],
  };
}

export async function executeStreamingShellCommand(
  command: string,
  cwd?: string,
  options: ExecuteStreamingShellCommandOptions = {}
): Promise<ShellCommandResult> {
  const trimmedCommand = command.trim();
  
  // Handle background mode - spawn detached process and return immediately
  if (options.background) {
    return new Promise((resolve) => {
      let child;
      try {
        child = spawn(trimmedCommand, {
          cwd: cwd ?? process.cwd(),
          shell: true,
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error) {
        const execError = error as Error;
        resolve({
          success: false,
          error: execError.message || 'Unknown error'
        });
        return;
      }
      
      // Unref the child so the parent can exit independently
      child.unref();
      
      // Return immediately with PID
      resolve({
        success: true,
        output: '',
        backgroundPid: child.pid
      });
    });
  }
  
  const shouldUsePty = options.preferPty === true && process.stdin.isTTY && process.stdout.isTTY;

  if (!shouldUsePty) {
    return executeShellCommandAsync(trimmedCommand, cwd, DEFAULT_SHELL_TIMEOUT, options);
  }

  const nodePty = await loadNodePty();
  if (!nodePty) {
    return executeShellCommandAsync(trimmedCommand, cwd, DEFAULT_SHELL_TIMEOUT, options);
  }

  return new Promise((resolve) => {
    const { file, args } = getPtyShellLaunch(trimmedCommand);
    const ptyProcess = nodePty.spawn(file, args, {
      name: process.env.TERM || 'xterm-256color',
      cols: Math.max(20, options.columns ?? process.stdout.columns ?? 80),
      rows: Math.max(10, options.rows ?? process.stdout.rows ?? 24),
      cwd: cwd ?? process.cwd(),
      env: {
        ...process.env,
        AUTOHAND_CLI: '1',
      },
    });

    let output = '';
    const dataDisposable = ptyProcess.onData((data) => {
      output += data;
      options.onStdout?.(data);
    });
    const exitDisposable = ptyProcess.onExit((event) => {
      dataDisposable.dispose();
      exitDisposable.dispose();

      const normalized = output.replace(/\r\n/g, '\n');
      if (event.exitCode === 0) {
        resolve({
          success: true,
          output: normalized,
        });
        return;
      }

      resolve({
        success: false,
        error: normalized || `Command failed with exit code ${event.exitCode}`,
      });
    });
  });
}
