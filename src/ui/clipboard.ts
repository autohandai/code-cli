/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawn } from 'node:child_process';

type Env = Record<string, string | undefined>;

/** OSC 52 clipboard write; tmux only forwards it inside a DCS passthrough. */
export function osc52(text: string, env: Env = process.env): string {
  const sequence = `\u001B]52;c;${Buffer.from(text, 'utf8').toString('base64')}\u0007`;
  return env.TMUX ? `\u001BPtmux;${sequence.replaceAll('\u001B', '\u001B\u001B')}\u001B\\` : sequence;
}

function pbcopy(text: string): void {
  try {
    const child = spawn('pbcopy', [], { stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', () => {});
    child.stdin.on('error', () => {});
    child.stdin.end(text);
  } catch {
    // OSC 52 already went to the terminal; pbcopy is a best-effort second path.
  }
}

interface CopyOptions {
  write: (data: string) => void;
  platform?: NodeJS.Platform;
  env?: Env;
  pbcopy?: (text: string) => void;
}

/**
 * Copy through the terminal (works over SSH and in Ghostty, kitty, WezTerm, Windows Terminal) and,
 * on a local macOS session, also through pbcopy for terminals that leave OSC 52 disabled.
 */
export function copyToClipboard(text: string, { write, platform = process.platform, env = process.env, pbcopy: localCopy = pbcopy }: CopyOptions): void {
  if (!text) return;
  write(osc52(text, env));
  if (platform === 'darwin' && !env.SSH_CONNECTION && !env.SSH_TTY) localCopy(text);
}
