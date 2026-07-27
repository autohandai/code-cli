/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  isGitMutationCommand,
  resolveAwarenessTier,
  warnForClaimConflict,
  warnForFileWrite,
  warnForGitMutation,
  warnForRepoDrift,
} from '../../../src/session/peers/PeerWarnings.js';
import type { ActiveAgentRecord } from '../../../src/session/ActiveAgentRegistry.js';
import type { LoadedConfig } from '../../../src/types.js';

function peer(overrides: Partial<ActiveAgentRecord> = {}): ActiveAgentRecord {
  return {
    version: 1,
    pid: 4242,
    sessionId: 'peer-1',
    workspaceRoot: '/repo',
    projectName: 'repo',
    provider: 'openrouter',
    model: 'claude',
    mode: 'interactive',
    status: 'working',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messageCount: 3,
    contextPercent: 90,
    tokensUsed: 10,
    activity: {
      phase: 'editing',
      pathsWritten: ['src/a.ts'],
      claims: ['src/claimed.ts'],
    },
    ...overrides,
  };
}

describe('isGitMutationCommand', () => {
  it.each([
    'git commit -m "x"',
    'git merge main',
    'git rebase -i HEAD~2',
    'git reset --hard',
    'git checkout -b thing',
    'git switch main',
    'git push origin main',
    'git cherry-pick abc',
    '  GIT  COMMIT  -a ',
    'GIT_DIR=.git git commit -m x',
    'cd /repo && git commit -m x',
  ])('treats %j as a mutation', (command) => {
    expect(isGitMutationCommand(command)).toBe(true);
  });

  it.each([
    'git status',
    'git log --oneline',
    'git diff',
    'gitk',
    'legit commit',
    'echo git commit',
  ])('treats %j as safe', (command) => {
    expect(isGitMutationCommand(command)).toBe(false);
  });
});

describe('peer warning decisions', () => {
  it('warns for git mutations only when warnings are enabled and peers exist', () => {
    expect(warnForGitMutation('warn', 'git commit', [peer()])[0]?.kind).toBe('git-mutation');
    expect(warnForGitMutation('warn', 'git status', [peer()])).toEqual([]);
    expect(warnForGitMutation('passive', 'git commit', [peer()])).toEqual([]);
    expect(warnForGitMutation('warn', 'git commit', [])).toEqual([]);
  });

  it('normalizes peer paths before detecting collisions', () => {
    expect(warnForFileWrite('warn', './src\\a.ts', [peer()])[0]?.kind).toBe('file-collision');
    expect(warnForFileWrite('warn', 'src/other.ts', [peer()])).toEqual([]);
  });

  it('warns once a repository head moves', () => {
    const before = { branch: 'main', sha: 'aaa' };
    expect(warnForRepoDrift('warn', before, { branch: 'main', sha: 'bbb' }, [peer()])[0]?.kind)
      .toBe('repo-drift');
    expect(warnForRepoDrift('warn', before, before, [peer()])).toEqual([]);
    expect(warnForRepoDrift('passive', before, { branch: 'main', sha: 'bbb' }, [peer()]))
      .toEqual([]);
  });

  it('only treats claims as conflicts in coordinate mode', () => {
    expect(warnForClaimConflict('coordinate', 'src/claimed.ts', [peer()])[0]?.kind)
      .toBe('claim-conflict');
    expect(warnForClaimConflict('warn', 'src/claimed.ts', [peer()])).toEqual([]);
  });
});

describe('resolveAwarenessTier', () => {
  function config(awareness?: string): LoadedConfig {
    return {
      configPath: '/tmp/config.json',
      ...(awareness ? { sessions: { awareness } } : {}),
    } as LoadedConfig;
  }

  it('defaults unknown values to warn', () => {
    expect(resolveAwarenessTier(config())).toBe('warn');
    expect(resolveAwarenessTier(config('passive'))).toBe('passive');
    expect(resolveAwarenessTier(config('coordinate'))).toBe('coordinate');
    expect(resolveAwarenessTier(config('invalid'))).toBe('warn');
  });
});
