/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ActionExecutor } from '../../src/core/actionExecutor.js';
import { FileActionManager } from '../../src/actions/filesystem.js';
import type { AgentRuntime } from '../../src/types.js';
import { finishSessionZit, prepareSessionZit, ZitClaimGuard, type SessionZitInfo } from '../../src/utils/sessionZit.js';

const REAL_ZIT = process.env.ZIT_BIN
  || '/Users/igorcosta/Documents/autohand/faster_worktree/target/release/zit';
const hasZit = existsSync(REAL_ZIT);

const README = '# Demo\n\nintro\n\n## Install\nrun it\n\n## Usage\nuse it\n';
const WITH_NEW_USAGE = README.replace('use it', 'use it well');
const WITH_NEW_INSTALL = README.replace('run it', 'run it twice');
const APP = 'export function first() {\n  return 1;\n}\n\nexport function second() {\n  return 2;\n}\n';
const replaceBlock = (search: string, replace: string) =>
  `<<<<<<< SEARCH\n${search}\n=======\n${replace}\n>>>>>>> REPLACE`;

function git(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
}

function zit(cwd: string, args: string[]): { stdout: string; status: number | null } {
  const result = spawnSync(REAL_ZIT, args, { cwd, encoding: 'utf8' });
  return { stdout: result.stdout ?? '', status: result.status };
}

describe.skipIf(!hasZit)('ActionExecutor zit claims (real zit)', () => {
  const savedEnv = {
    ZIT_BIN: process.env.ZIT_BIN,
    ZIT_HOME: process.env.ZIT_HOME,
    ZIT_WORKSPACE: process.env.ZIT_WORKSPACE,
    PATH: process.env.PATH,
  };
  let tmp: string;
  let repo: string;
  let callLog: string;
  let info: SessionZitInfo;

  beforeEach(() => {
    tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'autohand-zit-claims-')));
    repo = path.join(tmp, 'repo');
    callLog = path.join(tmp, 'zit-calls.log');

    // A wrapper that logs every zit invocation, so tests can count claims.
    const wrapper = path.join(tmp, 'bin', 'zit-logged');
    mkdirSync(path.dirname(wrapper), { recursive: true });
    writeFileSync(wrapper, `#!/bin/sh\necho "$*" >> "${callLog}"\nexec "${REAL_ZIT}" "$@"\n`);
    chmodSync(wrapper, 0o755);

    process.env.ZIT_BIN = wrapper;
    process.env.ZIT_HOME = path.join(tmp, 'zit-home');
    delete process.env.ZIT_WORKSPACE;

    mkdirSync(repo, { recursive: true });
    git(repo, ['init', '-q']);
    writeFileSync(path.join(repo, 'README.md'), README);
    writeFileSync(path.join(repo, 'notes.md'), 'notes\n');
    writeFileSync(path.join(repo, 'app.ts'), APP);
    git(repo, ['add', '.']);
    git(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'init']);

    info = prepareSessionZit({ cwd: repo, zit: 'Claims test' });
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(tmp, { recursive: true, force: true });
  });

  function createExecutor(): ActionExecutor {
    return new ActionExecutor({
      runtime: {
        workspaceRoot: info.workspacePath,
        config: {},
        options: { yes: true },
        zitClaims: new ZitClaimGuard(info),
      } as AgentRuntime,
      files: new FileActionManager(info.workspacePath),
      resolveWorkspacePath: (relativePath) => path.resolve(info.workspacePath, relativePath),
      confirmDangerousAction: async () => true,
    });
  }

  /** Claims that took something; `--edit --dry-run` queries are not claims. */
  function claimCalls(): string[] {
    if (!existsSync(callLog)) return [];
    return readFileSync(callLog, 'utf8')
      .split('\n')
      .filter((line) => line.startsWith('claim ') && !line.includes('--dry-run'));
  }

  function readApp(): string {
    return readFileSync(path.join(info.workspacePath, 'app.ts'), 'utf8');
  }

  /** Replace the wrapper with one that predates `zit claim --edit`. */
  function useZitWithoutEdit(): void {
    const wrapper = path.join(tmp, 'bin', 'zit-logged');
    writeFileSync(wrapper, [
      '#!/bin/sh',
      `echo "$*" >> "${callLog}"`,
      'for arg in "$@"; do',
      '  if [ "$arg" = "--edit" ]; then',
      "    echo \"error: unexpected argument '--edit' found\" >&2",
      '    exit 2',
      '  fi',
      'done',
      `exec "${REAL_ZIT}" "$@"`,
      '',
    ].join('\n'));
    chmodSync(wrapper, 0o755);
  }

  function workspaceClaims(workspaceId: string): string[] {
    const status = JSON.parse(zit(repo, ['status', '--json']).stdout) as {
      workspaces: Array<{ id: string; claims: string[] }>;
    };
    return status.workspaces.find((workspace) => workspace.id === workspaceId)?.claims ?? [];
  }

  function readme(): string {
    return readFileSync(path.join(info.workspacePath, 'README.md'), 'utf8');
  }

  /** A second workspace whose recorded, unaccepted change wrote the Install section. */
  function rivalWritesInstall(): string {
    const other = zit(repo, ['materialise', '--agent', 'rival-agent', '--intent', 'Rival']).stdout.trim();
    const otherId = path.basename(path.dirname(other));
    writeFileSync(path.join(other, 'README.md'), WITH_NEW_INSTALL.replace('twice', 'by the rival'));
    expect(zit(repo, ['record', '--workspace', otherId, '--dispose']).status).toBe(0);
    return otherId;
  }

  it('claims only the Markdown section a write changes, and the claim shows in zit status', async () => {
    const executor = createExecutor();

    await executor.execute({ type: 'read_file', path: 'README.md' });
    const outcome = await executor.executeForTool(
      { type: 'write_file', path: 'README.md', contents: WITH_NEW_USAGE },
      { approvalHandled: true },
    );

    expect(outcome.success).toBe(true);
    expect(readme()).toBe(WITH_NEW_USAGE);
    expect(workspaceClaims(info.workspaceId)).toEqual(['README.md#Usage']);
    expect(claimCalls()).toEqual([`claim --workspace ${info.workspaceId} README.md#Usage`]);

    finishSessionZit(info);
  });

  it('refuses the write when another workspace holds the file, naming the holder', async () => {
    const other = zit(repo, ['materialise', '--agent', 'rival-agent', '--intent', 'Rival']).stdout.trim();
    const otherId = path.basename(path.dirname(other));
    expect(zit(other, ['claim', '--workspace', otherId, 'README.md']).status).toBe(0);

    const executor = createExecutor();
    await executor.execute({ type: 'read_file', path: 'README.md' });
    const outcome = await executor.executeForTool(
      { type: 'write_file', path: 'README.md', contents: WITH_NEW_USAGE },
      { approvalHandled: true },
    );

    expect(outcome.success).toBe(false);
    const error = outcome.success ? '' : outcome.error;
    expect(error).toContain('rival-agent');
    expect(error).toContain(otherId);
    expect(error).toContain('Another agent holds this. Pick other work or stop.');
    expect(readme()).toBe(README);
    expect(workspaceClaims(info.workspaceId)).toEqual([]);

    finishSessionZit(info);
    zit(repo, ['dispose', otherId]);
  });

  it('lets a write to our section through while another change holds a different section of the file', async () => {
    const rivalChange = rivalWritesInstall();
    expect(rivalChange).toBeTruthy();
    // The model claims its section through the shell, as it did in the real run.
    expect(zit(info.workspacePath, ['claim', '--workspace', info.workspaceId, 'README.md#Usage']).status).toBe(0);
    const executor = createExecutor();

    await executor.execute({ type: 'read_file', path: 'README.md' });
    const ours = await executor.executeForTool(
      { type: 'search_replace', path: 'README.md', blocks: replaceBlock('use it', 'use it well') },
      { approvalHandled: true },
    );
    expect(ours.success).toBe(true);
    expect(readme()).toBe(WITH_NEW_USAGE);

    await executor.execute({ type: 'read_file', path: 'README.md' });
    const theirs = await executor.executeForTool(
      { type: 'search_replace', path: 'README.md', blocks: replaceBlock('run it', 'run it twice') },
      { approvalHandled: true },
    );
    expect(theirs.success).toBe(false);
    const error = theirs.success ? '' : theirs.error;
    expect(error).toContain('README.md#Install');
    expect(error).toContain('rival-agent');
    expect(error).toContain('Another agent holds this. Pick other work or stop.');
    expect(readme()).toBe(WITH_NEW_USAGE);

    finishSessionZit(info);
  });

  it('claims each section once per session', async () => {
    const executor = createExecutor();

    await executor.execute({ type: 'read_file', path: 'README.md' });
    await executor.execute({ type: 'write_file', path: 'README.md', contents: WITH_NEW_USAGE }, { approvalHandled: true });
    await executor.execute({ type: 'read_file', path: 'README.md' });
    await executor.execute(
      { type: 'write_file', path: 'README.md', contents: WITH_NEW_USAGE.replace('well', 'very well') },
      { approvalHandled: true },
    );
    expect(claimCalls()).toEqual([`claim --workspace ${info.workspaceId} README.md#Usage`]);

    await executor.execute({ type: 'read_file', path: 'README.md' });
    await executor.execute(
      { type: 'search_replace', path: 'README.md', blocks: replaceBlock('run it', 'run it twice') },
      { approvalHandled: true },
    );
    expect(claimCalls()).toEqual([
      `claim --workspace ${info.workspaceId} README.md#Usage`,
      `claim --workspace ${info.workspaceId} README.md#Install`,
    ]);

    finishSessionZit(info);
  });

  it('lets an edit to our function through while another workspace holds a different function', async () => {
    const other = zit(repo, ['materialise', '--agent', 'rival-agent', '--intent', 'Rival']).stdout.trim();
    const otherId = path.basename(path.dirname(other));
    const rivalContent = path.join(tmp, 'rival-app.ts');
    writeFileSync(rivalContent, APP.replace('return 1', 'return 10'));
    expect(zit(other, ['claim', '--workspace', otherId, '--edit', 'app.ts', '--content', rivalContent]).status).toBe(0);
    const executor = createExecutor();

    await executor.execute({ type: 'read_file', path: 'app.ts' });
    const ours = await executor.executeForTool(
      { type: 'search_replace', path: 'app.ts', blocks: replaceBlock('  return 2;', '  return 20;') },
      { approvalHandled: true },
    );
    expect(ours.success).toBe(true);
    expect(readApp()).toBe(APP.replace('return 2', 'return 20'));
    expect(claimCalls()).toEqual([`claim --workspace ${info.workspaceId} app.ts#second`]);

    await executor.execute({ type: 'read_file', path: 'app.ts' });
    const theirs = await executor.executeForTool(
      { type: 'search_replace', path: 'app.ts', blocks: replaceBlock('  return 1;', '  return 100;') },
      { approvalHandled: true },
    );
    expect(theirs.success).toBe(false);
    const error = theirs.success ? '' : theirs.error;
    expect(error).toContain('app.ts#first');
    expect(error).toContain('rival-agent');
    expect(error).toContain('Another agent holds this. Pick other work or stop.');
    expect(readApp()).toBe(APP.replace('return 2', 'return 20'));

    finishSessionZit(info);
    zit(repo, ['dispose', otherId]);
  });

  it('claims a new file whole', async () => {
    const executor = createExecutor();

    await executor.execute({ type: 'write_file', path: 'docs/new.md', contents: '# New\n' }, { approvalHandled: true });

    expect(claimCalls()).toEqual([`claim --workspace ${info.workspaceId} docs/new.md`]);

    finishSessionZit(info);
  });

  it('falls back to Markdown sections and whole code files when zit has no --edit', async () => {
    useZitWithoutEdit();
    const executor = createExecutor();

    await executor.execute({ type: 'read_file', path: 'README.md' });
    await executor.execute({ type: 'write_file', path: 'README.md', contents: WITH_NEW_USAGE }, { approvalHandled: true });
    await executor.execute({ type: 'read_file', path: 'app.ts' });
    await executor.execute(
      { type: 'search_replace', path: 'app.ts', blocks: replaceBlock('  return 2;', '  return 20;') },
      { approvalHandled: true },
    );

    expect(readApp()).toBe(APP.replace('return 2', 'return 20'));
    expect(claimCalls().filter((line) => !line.includes('--edit'))).toEqual([
      `claim --workspace ${info.workspaceId} README.md#Usage`,
      `claim --workspace ${info.workspaceId} app.ts`,
    ]);
    // Detected once: no further --edit attempts after the first refusal of the flag.
    expect(claimCalls().filter((line) => line.includes('--edit'))).toHaveLength(0);
    const editQueries = readFileSync(callLog, 'utf8').split('\n').filter((line) => line.includes('--edit'));
    expect(editQueries).toHaveLength(1);

    finishSessionZit(info);
  });

  it('claims both ends of a rename in one call', async () => {
    const executor = createExecutor();

    const outcome = await executor.executeForTool(
      { type: 'rename_path', from: 'notes.md', to: 'docs/notes.md' },
      { approvalHandled: true },
    );

    expect(outcome.success).toBe(true);
    expect(claimCalls()).toEqual([`claim --workspace ${info.workspaceId} notes.md docs/notes.md`]);
    expect(workspaceClaims(info.workspaceId)).toEqual(expect.arrayContaining(['notes.md', 'docs/notes.md']));

    finishSessionZit(info);
  });

  it('claims the files named in a git patch', async () => {
    const executor = createExecutor();
    const patch = [
      'diff --git a/notes.md b/notes.md',
      '--- a/notes.md',
      '+++ b/notes.md',
      '@@ -1 +1,2 @@',
      ' notes',
      '+more',
      '',
    ].join('\n');

    const outcome = await executor.executeForTool({ type: 'git_apply_patch', patch }, { approvalHandled: true });

    expect(outcome.success).toBe(true);
    expect(claimCalls()).toEqual([`claim --workspace ${info.workspaceId} notes.md`]);
    expect(readFileSync(path.join(info.workspacePath, 'notes.md'), 'utf8')).toBe('notes\nmore\n');

    finishSessionZit(info);
  });

  it('does not write when zit itself fails', async () => {
    const executor = createExecutor();
    rmSync(path.join(tmp, 'bin', 'zit-logged'));

    await executor.execute({ type: 'read_file', path: 'README.md' });
    const outcome = await executor.executeForTool(
      { type: 'write_file', path: 'README.md', contents: 'lost\n' },
      { approvalHandled: true },
    );

    expect(outcome.success).toBe(false);
    expect(outcome.success ? '' : outcome.error).toContain('zit claim failed');
    expect(readme()).toBe(README);
  });
});
