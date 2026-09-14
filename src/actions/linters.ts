/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Code Linters
 * Supports eslint, pylint, clippy, golangci-lint, and more
 */
import { signalCoordinatedProcess, spawnCoordinatedProcess, waitForProcessPublication } from '../session/peers/CommandCoordinationGate.js';
import { killAfter } from '../utils/processTimeout.js';

export interface LinterInfo {
  name: string;
  command: string;
  extensions: string[];
  description: string;
  checkCmd: string[];
  installed?: boolean;
}

/**
 * Available linters with their configurations
 */
export const LINTERS: Record<string, LinterInfo> = {
  eslint: {
    name: 'eslint',
    command: 'eslint',
    extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
    description: 'Pluggable JavaScript/TypeScript linter',
    checkCmd: ['eslint', '--version'],
  },
  pylint: {
    name: 'pylint',
    command: 'pylint',
    extensions: ['.py'],
    description: 'Python static code analysis tool',
    checkCmd: ['pylint', '--version'],
  },
  ruff: {
    name: 'ruff',
    command: 'ruff',
    extensions: ['.py'],
    description: 'Extremely fast Python linter (recommended)',
    checkCmd: ['ruff', '--version'],
  },
  clippy: {
    name: 'clippy',
    command: 'cargo',
    extensions: ['.rs'],
    description: 'Rust linter with helpful suggestions',
    checkCmd: ['cargo', 'clippy', '--version'],
  },
  golangci: {
    name: 'golangci-lint',
    command: 'golangci-lint',
    extensions: ['.go'],
    description: 'Fast Go linter aggregator',
    checkCmd: ['golangci-lint', '--version'],
  },
  shellcheck: {
    name: 'shellcheck',
    command: 'shellcheck',
    extensions: ['.sh', '.bash'],
    description: 'Shell script static analysis tool',
    checkCmd: ['shellcheck', '--version'],
  },
  stylelint: {
    name: 'stylelint',
    command: 'stylelint',
    extensions: ['.css', '.scss', '.less'],
    description: 'CSS linter',
    checkCmd: ['stylelint', '--version'],
  },
  htmlhint: {
    name: 'htmlhint',
    command: 'htmlhint',
    extensions: ['.html', '.htm'],
    description: 'HTML linter',
    checkCmd: ['htmlhint', '--version'],
  },
};

/**
 * Check if a command is available in PATH
 */
async function isCommandAvailable(command: string, args: string[] = ['--version']): Promise<boolean> {
  const proc = await spawnCoordinatedProcess({ file: command, args, cwd: process.cwd() }, {
    stdio: 'ignore', shell: process.platform === 'win32',
  });
  return new Promise<boolean>((resolve) => {
    proc.on('error', () => { resolve(false); });
    proc.on('close', (code) => { resolve(code === 0); });

    killAfter(proc, 3000, () => {
      signalCoordinatedProcess(proc);
      resolve(false);
    });
  }).finally(() => waitForProcessPublication(proc));
}

/**
 * Check which linters are available
 */
export async function checkAvailableLinters(): Promise<Record<string, boolean>> {
  const results: Record<string, boolean> = {};

  const checks = Object.entries(LINTERS).map(async ([name, info]) => {
    if (name === 'clippy') {
      // Clippy is a cargo subcommand
      results[name] = await isCommandAvailable('cargo', ['clippy', '--version']);
    } else {
      results[name] = await isCommandAvailable(info.command);
    }
  });

  const settled = await Promise.allSettled(checks);
  const failed = settled.find(result => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
  return results;
}

/**
 * List all linters with their availability status
 */
export async function listLinters(): Promise<LinterInfo[]> {
  const available = await checkAvailableLinters();

  return Object.entries(LINTERS).map(([name, info]) => ({
    ...info,
    installed: available[name] ?? false,
  }));
}
