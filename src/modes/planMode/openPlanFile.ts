/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawn } from 'node:child_process';

/** Starts a program detached from the CLI; resolves false when it cannot be started. */
export type PlanFileLauncher = (command: string, args: string[]) => Promise<boolean>;

export const launchDetached: PlanFileLauncher = (command, args) =>
  new Promise((resolve) => {
    try {
      const child = spawn(command, args, { detached: true, stdio: 'ignore' });
      child.once('error', () => resolve(false));
      child.once('spawn', () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });

function defaultApplication(filePath: string, platform: NodeJS.Platform): [string, string[]] {
  if (platform === 'darwin') return ['open', [filePath]];
  if (platform === 'win32') return ['cmd', ['/c', 'start', '""', filePath]];
  return ['xdg-open', [filePath]];
}

/**
 * Opens a saved plan outside the terminal so it can be read and edited while
 * the review prompt stays up: VS Code when its launcher is installed,
 * otherwise whatever the system opens Markdown with. Returns the program that
 * was started, or null when none could be.
 */
export async function openPlanFile(
  filePath: string,
  options: { launch?: PlanFileLauncher; platform?: NodeJS.Platform } = {},
): Promise<string | null> {
  const launch = options.launch ?? launchDetached;
  const candidates: Array<[string, string[]]> = [
    ['code', ['--reuse-window', filePath]],
    defaultApplication(filePath, options.platform ?? process.platform),
  ];

  for (const [command, args] of candidates) {
    try {
      if (await launch(command, args)) {
        return command;
      }
    } catch {
      // Try the next way of opening the file.
    }
  }
  return null;
}
