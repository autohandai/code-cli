/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawn } from 'node:child_process';
import { killAfter } from '../utils/processTimeout.js';

export type GitHubIdentitySource = 'gh' | 'git-config' | 'git-noreply-email';

export interface GitHubIdentity {
  login: string;
  source: GitHubIdentitySource;
}

export type IdentityCommandRunner = (
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs: number },
) => Promise<string | null>;

const LOOKUP_TIMEOUT_MS = 4_000;
const GITHUB_LOGIN = /^[A-Za-z\d](?:[A-Za-z\d-]{0,38})$/u;
const GITHUB_NOREPLY_EMAIL = /^(?:\d+\+)?([A-Za-z\d-]+)@users\.noreply\.github\.com$/iu;

export function isValidGitHubLogin(login: string): boolean {
  return GITHUB_LOGIN.test(login);
}

/** Resolves with trimmed stdout, or null when the command is missing, fails, or times out. */
const runIdentityCommand: IdentityCommandRunner = (command, args, { cwd, timeoutMs }) =>
  new Promise((resolve) => {
    let stdout = '';
    try {
      const child = spawn(command, args, {
        cwd,
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', GIT_TERMINAL_PROMPT: '0' },
      });
      killAfter(child, timeoutMs, () => {
        child.kill();
        resolve(null);
      });
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.once('error', () => resolve(null));
      child.once('close', (code) => resolve(code === 0 ? stdout.trim() : null));
    } catch {
      resolve(null);
    }
  });

/**
 * Finds the GitHub account behind this terminal without guessing: the account
 * `gh` is signed in as, then the login git was explicitly told about, then a
 * GitHub noreply commit address (which embeds the login). Remote URLs and
 * display names are never used — they name repositories and people, not accounts.
 */
export async function resolveGitHubIdentity(
  options: { cwd?: string; run?: IdentityCommandRunner } = {},
): Promise<GitHubIdentity | null> {
  const run = options.run ?? runIdentityCommand;
  const lookup = async (command: string, args: string[]): Promise<string> => {
    try {
      return (await run(command, args, { cwd: options.cwd, timeoutMs: LOOKUP_TIMEOUT_MS }))?.trim() ?? '';
    } catch {
      return '';
    }
  };

  const ghLogin = await lookup('gh', ['api', 'user', '--jq', '.login']);
  if (isValidGitHubLogin(ghLogin)) {
    return { login: ghLogin, source: 'gh' };
  }

  const configuredLogin = await lookup('git', ['config', '--get', 'github.user']);
  if (isValidGitHubLogin(configuredLogin)) {
    return { login: configuredLogin, source: 'git-config' };
  }

  const noreplyLogin = GITHUB_NOREPLY_EMAIL.exec(await lookup('git', ['config', '--get', 'user.email']))?.[1] ?? '';
  if (isValidGitHubLogin(noreplyLogin)) {
    return { login: noreplyLogin, source: 'git-noreply-email' };
  }

  return null;
}
