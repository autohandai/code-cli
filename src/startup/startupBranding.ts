/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import wrapAnsi from 'wrap-ansi';
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import path from 'node:path';

function readGitMetadata(filePath: string): string {
  const descriptor = openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(4096);
    return buffer.toString('utf8', 0, readSync(descriptor, buffer, 0, buffer.length, 0)).trim();
  } finally {
    closeSync(descriptor);
  }
}

export function getStartupGitLabel(workspaceRoot: string): string | undefined {
  let directory = path.resolve(workspaceRoot);
  for (let depth = 0; depth < 32; depth++) {
    let gitDirectory = path.join(directory, '.git');
    try {
      if (statSync(gitDirectory).isFile()) {
        const pointer = /^gitdir: (.+)$/.exec(readGitMetadata(gitDirectory));
        if (!pointer) return undefined;
        gitDirectory = path.resolve(directory, pointer[1]);
      }
      const head = readGitMetadata(path.join(gitDirectory, 'HEAD'));
      return head.startsWith('ref: refs/heads/') ? head.slice('ref: refs/heads/'.length) : head.slice(0, 7);
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') return undefined;
    }
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
  return undefined;
}

interface StartupLogoLayout {
  columns: number;
  rows: number;
  welcomeLines: readonly string[];
  footerText: string;
}

export async function countStartupWorkspacePeers(
  workspaceRoot: string,
  listPeers: () => Promise<readonly { workspaceRoot: string }[]>,
): Promise<number> {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const records = await Promise.race([
      listPeers(),
      new Promise<readonly { workspaceRoot: string }[]>((resolve) => {
        deadline = setTimeout(() => resolve([]), 100);
      }),
    ]);
    const normalizedWorkspace = path.resolve(workspaceRoot);
    return records.filter((record) => path.resolve(record.workspaceRoot) === normalizedWorkspace).length;
  } catch {
    return 0;
  } finally {
    if (deadline) clearTimeout(deadline);
  }
}

export function getStartupLogoRows({ columns, rows, welcomeLines, footerText }: StartupLogoLayout): number {
  const width = Math.max(1, Math.floor(columns));
  const wrappedRows = (text: string, columns: number): number => wrapAnsi(text, columns, { hard: true, trim: false }).split('\n').length;
  const welcomeRows = welcomeLines.reduce((total, line) => total + wrappedRows(line, width), 0);
  // The composer has three input rows, three clearance rows, a leading gap, and its final newline.
  const composerRows = 8 + wrappedRows(footerText, Math.max(1, width - 1));
  return Math.max(0, Math.floor(rows) - welcomeRows - composerRows);
}

interface StartupBannerOptions {
  output: Pick<NodeJS.WriteStream, 'isTTY' | 'write'>;
  renderLogo(): string;
  disabled?: boolean;
}

export class StartupBranding {
  private loginPromptShown = false;

  readonly onLoginPromptShown = (): void => {
    this.loginPromptShown = true;
  };

  printBanner({ output, renderLogo, disabled }: StartupBannerOptions): void {
    if (disabled || (output.isTTY && this.loginPromptShown)) {
      return;
    }

    if (!output.isTTY) {
      output.write('autohand\n');
      return;
    }

    output.write('\x1b[3J\x1b[2J\x1b[H');
    output.write(`${renderLogo()}\n`);
  }
}
