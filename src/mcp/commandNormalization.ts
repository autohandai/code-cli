/**
 * Normalizes MCP stdio commands for non-interactive execution.
 */
import os from 'node:os';
import path from 'node:path';

export function isNpxCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  return (
    normalized === 'npx'
    || normalized === 'npx.cmd'
    || normalized.endsWith('/npx')
    || normalized.endsWith('\\npx')
    || normalized.endsWith('/npx.cmd')
    || normalized.endsWith('\\npx.cmd')
  );
}

function hasNpxYesFlag(args: string[] | undefined): boolean {
  if (!args) return false;
  return args.some(arg => arg === '-y' || arg === '--yes');
}

function sanitizePathSegment(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
  return sanitized.length > 0 ? sanitized : 'server';
}

/**
 * npm/npx can fail with ENOTEMPTY when install cache state is corrupted.
 * We detect this startup failure and retry with an isolated npm cache.
 */
export function isRetriableNpxInstallError(message: string): boolean {
  const normalized = message.toLowerCase();
  if (/npm\s+error\s+code\s+enotempty/i.test(message)) {
    return true;
  }
  return normalized.includes('enotempty') && normalized.includes('_npx');
}

/**
 * Builds a one-off npm cache environment for npx recovery retries.
 */
export function buildNpxIsolatedCacheEnv(
  baseEnv: NodeJS.ProcessEnv | undefined,
  serverName: string
): NodeJS.ProcessEnv {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const cacheDir = path.join(
    os.tmpdir(),
    'autohand-mcp-npx-cache',
    sanitizePathSegment(serverName),
    token
  );

  return {
    ...(baseEnv ?? {}),
    npm_config_cache: cacheDir,
    NPM_CONFIG_CACHE: cacheDir,
  };
}

/**
 * Returns a spawn-safe command/args pair.
 * Adds `-y` for npx commands so package install prompts do not block MCP startup.
 */
export function normalizeMcpCommandForSpawn(
  command: string,
  args: string[] | undefined
): { command: string; args: string[] | undefined } {
  if (!isNpxCommand(command)) {
    return { command, args };
  }

  const normalizedArgs = args ? [...args] : [];
  if (!hasNpxYesFlag(normalizedArgs)) {
    normalizedArgs.unshift('-y');
  }

  return {
    command,
    args: normalizedArgs.length > 0 ? normalizedArgs : undefined,
  };
}

/**
 * Normalizes command/args before persisting MCP stdio server config.
 */
export function normalizeMcpCommandForConfig(
  command: string | undefined,
  args: string[] | undefined
): { command: string | undefined; args: string[] | undefined } {
  if (!command) {
    return { command, args };
  }

  return normalizeMcpCommandForSpawn(command, args);
}
