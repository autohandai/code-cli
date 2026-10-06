/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildZitSessionInstructions,
  createSessionZitFinalizer,
  finishSessionZit,
  isSessionZitEnabled,
  prepareSessionZit,
  resolveZitIntent,
  trimZitSummary,
} from '../../src/utils/sessionZit.js';
import { validateZitOption } from '../../src/startup/cliOptions.js';

const ZIT_BIN = process.env.ZIT_BIN
  || '/Users/igorcosta/Documents/autohand/faster_worktree/target/release/zit';
const hasZit = existsSync(ZIT_BIN);

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout;
}

function zit(cwd: string, args: string[]): string {
  const result = spawnSync(ZIT_BIN, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`zit ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout;
}

describe.skipIf(!hasZit)('prepareSessionZit / finishSessionZit (real zit)', () => {
  const savedEnv = {
    ZIT_BIN: process.env.ZIT_BIN,
    ZIT_HOME: process.env.ZIT_HOME,
    ZIT_WORKSPACE: process.env.ZIT_WORKSPACE,
    PATH: process.env.PATH,
  };
  let tmp: string;
  let repo: string;

  beforeEach(() => {
    tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'autohand-zit-')));
    repo = path.join(tmp, 'repo');
    process.env.ZIT_BIN = ZIT_BIN;
    process.env.ZIT_HOME = path.join(tmp, 'zit-home');
    delete process.env.ZIT_WORKSPACE;

    mkdirSync(repo, { recursive: true });
    git(repo, ['init', '-q']);
    writeFileSync(path.join(repo, 'README.md'), '# Demo\n');
    git(repo, ['add', '.']);
    git(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'init']);
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(tmp, { recursive: true, force: true });
  });

  it('initialises zit once per repository', () => {
    const first = prepareSessionZit({ cwd: repo, zit: true });
    expect(first.initialized).toBe(true);
    expect(git(repo, ['rev-parse', '--verify', '--quiet', 'refs/zit/current']).trim()).not.toBe('');

    const second = prepareSessionZit({ cwd: repo, zit: true });
    expect(second.initialized).toBe(false);
    expect(second.workspaceId).not.toBe(first.workspaceId);

    finishSessionZit(first);
    finishSessionZit(second);
  });

  it('materialises a workspace that exists and is not a git worktree', () => {
    const info = prepareSessionZit({ cwd: repo, zit: 'Add usage docs' });

    expect(info.repoRoot).toBe(repo);
    expect(existsSync(info.workspacePath)).toBe(true);
    expect(existsSync(path.join(info.workspacePath, 'README.md'))).toBe(true);
    expect(path.basename(path.dirname(info.workspacePath))).toBe(info.workspaceId);
    expect(process.env.ZIT_WORKSPACE).toBe(info.workspaceId);
    expect(info.zitCommand).toBe('zit');
    expect(process.env.PATH?.split(path.delimiter)[0]).toBe(path.dirname(ZIT_BIN));

    const worktrees = git(repo, ['worktree', 'list', '--porcelain']);
    expect(worktrees).not.toContain(info.workspacePath);

    finishSessionZit(info);
  });

  it('records edits as a change with the summary and removes the workspace', () => {
    const info = prepareSessionZit({ cwd: repo, zit: true, prompt: 'Add a Usage section\nwith examples' });
    writeFileSync(path.join(info.workspacePath, 'README.md'), '# Demo\n\n## Usage\n\nRun it.\n');

    const result = finishSessionZit(info, 'Added a Usage section to README.md');

    expect(result.changeId).toMatch(/^[0-9a-f]{40}$/);
    expect(result.writes).toContain('README.md#Usage');
    expect(existsSync(info.workspacePath)).toBe(false);

    const shown = zit(repo, ['show', result.changeId!]);
    expect(shown).toContain('reported Added a Usage section to README.md');
    expect(shown).toContain('intent   Add a Usage section');
    expect(shown).toContain('agent    autohand');
  });

  it('records nothing for a session without edits and still removes the workspace', () => {
    const info = prepareSessionZit({ cwd: repo, zit: true });

    const result = finishSessionZit(info, 'Looked around');

    expect(result.changeId).toBeNull();
    expect(result.writes).toEqual([]);
    expect(existsSync(info.workspacePath)).toBe(false);
  });

  it('does not record Autohand runtime state written into the workspace', () => {
    const info = prepareSessionZit({ cwd: repo, zit: true });
    mkdirSync(path.join(info.workspacePath, '.autohand', 'memory'), { recursive: true });
    writeFileSync(path.join(info.workspacePath, '.autohand', 'memory', 'index.json'), '{}\n');
    writeFileSync(path.join(info.workspacePath, '.autohand', 'session-permissions.json'), '{}\n');

    const result = finishSessionZit(info);

    expect(result.changeId).toBeNull();
  });

  it('records and exits on SIGTERM when graceful shutdown stalls', async () => {
    const root = path.resolve(import.meta.dirname, '../..');
    const script = path.join(tmp, 'stalled-session.ts');
    writeFileSync(script, `
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { createSessionZitFinalizer, prepareSessionZit } from ${JSON.stringify(path.join(root, 'src/utils/sessionZit.ts'))};
const info = prepareSessionZit({ cwd: ${JSON.stringify(repo)}, zit: 'Stalled session' });
writeFileSync(path.join(info.workspacePath, 'STALLED.md'), 'work\\n');
createSessionZitFinalizer(info, { exitOnSignal: () => true, signalGraceMs: 300, getSummary: () => 'Stalled summary' });
// A graceful handler that never finishes, and a handle that keeps the loop alive.
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
process.stdout.write('READY\\n');
`);
    const child = spawn(process.execPath, ['--import', path.join(root, 'node_modules/tsx/dist/loader.mjs'), script], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`never ready: ${stderr}`)), 60_000);
      child.stdout.on('data', (chunk) => {
        if (String(chunk).includes('READY')) { clearTimeout(timer); resolve(); }
      });
    });

    child.kill('SIGTERM');
    const code = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`still running: ${stderr}`)), 20_000);
      child.on('exit', (exitCode) => { clearTimeout(timer); resolve(exitCode); });
    });

    expect(code).toBe(143);
    const recorded = /zit: recorded ([0-9a-f]{40})/.exec(stderr);
    expect(recorded).not.toBeNull();
    expect(zit(repo, ['show', recorded![1]!])).toContain('reported Stalled summary');
    expect(JSON.parse(zit(repo, ['status', '--json'])).workspaces).toEqual([]);
  }, 120_000);

  it('finalizer records only once', () => {
    const info = prepareSessionZit({ cwd: repo, zit: true });
    writeFileSync(path.join(info.workspacePath, 'NOTES.md'), 'notes\n');
    const lines: string[] = [];

    const finalizer = createSessionZitFinalizer(info, { log: (line) => lines.push(line) });
    finalizer.finish('Wrote notes');
    finalizer.finish('Wrote notes again');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^zit: recorded [0-9a-f]{40}$/);
  });

  it('throws a clear error when cwd is not a git repository', () => {
    const notGit = path.join(tmp, 'plain');
    mkdirSync(notGit, { recursive: true });

    expect(() => prepareSessionZit({ cwd: notGit, zit: true })).toThrow('--zit requires a git repository');
  });

  it('throws an install hint when the zit binary is missing', () => {
    process.env.ZIT_BIN = path.join(tmp, 'no-such-zit');

    expect(() => prepareSessionZit({ cwd: repo, zit: true })).toThrow('cargo install zit');
  });
});

describe('resolveZitIntent', () => {
  it('prefers the flag value, then the prompt first line, then a default', () => {
    expect(resolveZitIntent('  Fix login  ', 'ignored')).toBe('Fix login');
    expect(resolveZitIntent(true, '\n  Add tests\nfor parser')).toBe('Add tests');
    expect(resolveZitIntent(true)).toBe('Autohand session');
    expect(resolveZitIntent('   ', '')).toBe('Autohand session');
  });
});

describe('trimZitSummary', () => {
  it('keeps the end of long summaries', () => {
    const summary = `${'a'.repeat(9000)}END`;
    const trimmed = trimZitSummary(summary);
    expect(trimmed).toHaveLength(8000);
    expect(trimmed.endsWith('END')).toBe(true);
  });
});

describe('buildZitSessionInstructions', () => {
  it('tells the agent to claim before editing and not to commit', () => {
    const text = buildZitSessionInstructions({ workspaceId: 'abc123' });
    expect(text).toContain('abc123');
    expect(text).toContain('zit claim <path>');
    expect(text).toContain('zit status');
    expect(text).toContain('Do not commit');
  });

  it('uses the zit command the agent shell can run', () => {
    const text = buildZitSessionInstructions({ workspaceId: 'abc123', zitCommand: '/opt/tools/git-zit' });
    expect(text).toContain('`/opt/tools/git-zit claim <path>`');
    expect(text).toContain('`/opt/tools/git-zit status`');
  });
});

describe('isSessionZitEnabled', () => {
  it('returns true for enabled variants and false otherwise', () => {
    expect(isSessionZitEnabled(true)).toBe(true);
    expect(isSessionZitEnabled('intent')).toBe(true);
    expect(isSessionZitEnabled(false)).toBe(false);
    expect(isSessionZitEnabled(undefined)).toBe(false);
  });
});

describe('validateZitOption', () => {
  it('rejects --zit with --worktree or --tmux', () => {
    expect(validateZitOption({ zit: true, worktree: true })).toContain('--zit cannot be used with --worktree');
    expect(validateZitOption({ zit: 'x', worktree: 'feature' })).toContain('--zit cannot be used with --worktree');
    expect(validateZitOption({ zit: true, tmux: true })).toContain('--zit cannot be used with --tmux');
  });

  it('rejects modes that do not run a CLI session', () => {
    expect(validateZitOption({ zit: true, patch: true })).toContain('--patch');
    expect(validateZitOption({ zit: true, mode: 'acp' })).toContain('--mode acp');
    expect(validateZitOption({ zit: true, autoMode: 'loop task' })).toContain('--auto-mode');
  });

  it('accepts --zit alone and ignores the flag when absent', () => {
    expect(validateZitOption({ zit: true })).toBeNull();
    expect(validateZitOption({ zit: true, worktree: false })).toBeNull();
    expect(validateZitOption({ worktree: true })).toBeNull();
  });
});
