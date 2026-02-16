/**
 * Normalizes MCP stdio commands for non-interactive execution.
 */

function isNpxCommand(command: string): boolean {
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
