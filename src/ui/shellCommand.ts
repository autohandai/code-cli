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
