/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import {
  isValidGitHubLogin,
  resolveGitHubIdentity,
  type IdentityCommandRunner,
} from '../../src/feedback/githubIdentity.js';

function runnerFor(answers: Record<string, string | null>): IdentityCommandRunner {
  return vi.fn(async (command: string, args: string[]) => answers[`${command} ${args.join(' ')}`] ?? null);
}

const GH = 'gh api user --jq .login';
const GIT_USER = 'git config --get github.user';
const GIT_EMAIL = 'git config --get user.email';

describe('resolveGitHubIdentity', () => {
  it('uses the account the gh CLI is authenticated as', async () => {
    const run = runnerFor({ [GH]: 'octocat\n', [GIT_USER]: 'someone-else' });

    await expect(resolveGitHubIdentity({ run })).resolves.toEqual({ login: 'octocat', source: 'gh' });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('falls back to git config github.user when gh is missing or signed out', async () => {
    const run = runnerFor({ [GH]: null, [GIT_USER]: ' hubber \n' });

    await expect(resolveGitHubIdentity({ run })).resolves.toEqual({ login: 'hubber', source: 'git-config' });
  });

  it.each([
    ['12345+mona@users.noreply.github.com', 'mona'],
    ['mona-lisa@users.noreply.github.com', 'mona-lisa'],
    ['12345+Mona@USERS.NOREPLY.GITHUB.COM', 'Mona'],
  ])('reads the login out of the GitHub noreply address %s', async (email, login) => {
    const run = runnerFor({ [GIT_EMAIL]: `${email}\n` });

    await expect(resolveGitHubIdentity({ run })).resolves.toEqual({ login, source: 'git-noreply-email' });
  });

  it('never guesses a login from an ordinary e-mail address', async () => {
    const run = runnerFor({ [GIT_EMAIL]: 'mona@example.com' });

    await expect(resolveGitHubIdentity({ run })).resolves.toBeNull();
  });

  it('returns null when nothing identifies the user', async () => {
    const run = runnerFor({});

    await expect(resolveGitHubIdentity({ run })).resolves.toBeNull();
    expect(run).toHaveBeenCalledTimes(3);
  });

  it.each([
    'gh: To get started with GitHub CLI, please run: gh auth login',
    '{"message":"Bad credentials"}',
    '-leading-hyphen',
    'has space',
    'a'.repeat(40),
    '',
  ])('ignores gh output that is not a login (%s) and keeps looking', async (output) => {
    const run = runnerFor({ [GH]: output, [GIT_USER]: 'fallback-user' });

    await expect(resolveGitHubIdentity({ run })).resolves.toEqual({ login: 'fallback-user', source: 'git-config' });
  });

  it('survives a runner that throws', async () => {
    const run: IdentityCommandRunner = vi.fn(async () => {
      throw new Error('spawn ENOENT');
    });

    await expect(resolveGitHubIdentity({ run })).resolves.toBeNull();
  });

  it('passes the workspace and a short timeout to every lookup', async () => {
    const run = runnerFor({});

    await resolveGitHubIdentity({ run, cwd: '/repo' });

    for (const call of vi.mocked(run).mock.calls) {
      expect(call[2]).toEqual({ cwd: '/repo', timeoutMs: expect.any(Number) });
      expect(call[2].timeoutMs).toBeLessThanOrEqual(5_000);
    }
  });

  it('runs real commands without throwing when the binaries are absent', async () => {
    const previousPath = process.env.PATH;
    process.env.PATH = '';
    try {
      await expect(resolveGitHubIdentity()).resolves.toBeNull();
    } finally {
      process.env.PATH = previousPath;
    }
  });
});

describe('isValidGitHubLogin', () => {
  it.each(['octocat', 'a', 'mona-lisa', 'user123', 'A1-b2'])('accepts %s', (login) => {
    expect(isValidGitHubLogin(login)).toBe(true);
  });

  it.each(['', '-mona', 'mo na', 'mona_lisa', 'mona@x', 'a'.repeat(40), '@mona', 'mona\n'])('rejects %j', (login) => {
    expect(isValidGitHubLogin(login)).toBe(false);
  });
});
