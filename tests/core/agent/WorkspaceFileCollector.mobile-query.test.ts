/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WorkspaceFileCollector,
  isSafeMobileWorkspaceRelativePath,
} from '../../../src/core/agent/WorkspaceFileCollector.js';
import { GitIgnoreParser } from '../../../src/utils/gitIgnore.js';

const temporaryDirectories: string[] = [];
const gitFixture = vi.hoisted(() => ({
  code: undefined as string | undefined,
  child: undefined as ChildProcess | undefined,
  closed: undefined as Promise<void> | undefined,
  descendantPid: undefined as number | undefined,
}));
vi.mock('node:child_process', async original => {
  const actual = await original<typeof import('node:child_process')>();
  return { ...actual, spawn: (...args: Parameters<typeof actual.spawn>) => {
    if (args[0] !== 'git' || gitFixture.code === undefined) return actual.spawn(...args);
    const child = actual.spawn(process.execPath, ['-e', gitFixture.code], {
      ...args[2], detached: process.platform !== 'win32',
    });
    gitFixture.child = child;
    gitFixture.closed = new Promise<void>(resolve => child.once('close', () => resolve()));
    return child;
  } };
});
const nativeSetTimeout = globalThis.setTimeout;
const nativeClearTimeout = globalThis.clearTimeout;
async function boundedSettlement<T>(pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = nativeSetTimeout(() => reject(new Error('Workspace scan waited for the inherited stdout pipe to close.')), 3000);
  });
  try { return await Promise.race([pending, deadline]); }
  finally { nativeClearTimeout(timer); }
}

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'autohand-mobile-files-'));
  temporaryDirectories.push(workspace);
  return workspace;
}

async function createFile(workspace: string, relativePath: string): Promise<void> {
  const absolutePath = path.join(workspace, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `fixture:${relativePath}`, 'utf8');
}

describe('WorkspaceFileCollector mobile filename query', () => {
  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ));
  });

  it('returns a deterministic bounded top-N list containing paths but no file contents', async () => {
    const workspace = await createWorkspace();
    await createFile(workspace, 'src/mobile/MobileRelay.ts');
    await createFile(workspace, 'tests/mobile/MobileRelay.test.ts');
    await createFile(workspace, 'docs/mobile-relay.md');
    await createFile(workspace, 'src/unrelated.ts');
    const collector = new WorkspaceFileCollector(workspace, new GitIgnoreParser(workspace));

    const result = await collector.queryWorkspaceFiles('MobileRelay', {
      limit: 2,
      timeoutMs: 1_000,
    });

    expect(result).toEqual({
      query: 'MobileRelay',
      files: [
        { relativePath: 'src/mobile/MobileRelay.ts' },
        { relativePath: 'tests/mobile/MobileRelay.test.ts' },
      ],
      truncated: false,
    });
    expect(JSON.stringify(result)).not.toContain('fixture:');
  });

  it('denies secret paths, traversal forms, absolute paths, and symlink escapes', async () => {
    const workspace = await createWorkspace();
    const outside = await createWorkspace();
    await createFile(workspace, 'src/Safe.swift');
    await createFile(workspace, '.env.local');
    await createFile(workspace, 'config/secrets.json');
    await createFile(workspace, 'keys/private.pem');
    await createFile(outside, 'Outside.swift');
    await symlink(outside, path.join(workspace, 'escaped'));
    const collector = new WorkspaceFileCollector(workspace, new GitIgnoreParser(workspace));

    const result = await collector.queryWorkspaceFiles('', {
      limit: 20,
      timeoutMs: 1_000,
    });

    expect(result.files).toEqual([{ relativePath: 'src/Safe.swift' }]);
    expect(isSafeMobileWorkspaceRelativePath('src/Safe.swift')).toBe(true);
    expect(isSafeMobileWorkspaceRelativePath('../secret.txt')).toBe(false);
    expect(isSafeMobileWorkspaceRelativePath('/Users/example/secret.txt')).toBe(false);
    expect(isSafeMobileWorkspaceRelativePath('C:\\Users\\example\\secret.txt')).toBe(false);
    expect(isSafeMobileWorkspaceRelativePath('.env.production')).toBe(false);
    expect(isSafeMobileWorkspaceRelativePath('config/secrets.json')).toBe(false);
  });

  it('refreshes the workspace inventory for each relay-scoped query', async () => {
    const workspace = await createWorkspace();
    await createFile(workspace, 'src/Existing.ts');
    const collector = new WorkspaceFileCollector(workspace, new GitIgnoreParser(workspace));

    await collector.queryWorkspaceFiles('Existing', {
      limit: 8,
      timeoutMs: 1_000,
    });
    await createFile(workspace, 'src/JustCreatedRelayFile.ts');

    await expect(collector.queryWorkspaceFiles('JustCreatedRelayFile', {
      limit: 8,
      timeoutMs: 1_000,
    })).resolves.toEqual({
      query: 'JustCreatedRelayFile',
      files: [{ relativePath: 'src/JustCreatedRelayFile.ts' }],
      truncated: false,
    });
  });

  it('returns a bounded empty result when collection exceeds the query deadline', async () => {
    const workspace = await createWorkspace();
    const collector = new WorkspaceFileCollector(workspace, new GitIgnoreParser(workspace));
    collector.collectWorkspaceFiles = () => new Promise<string[]>(() => {});

    await expect(collector.queryWorkspaceFiles('relay', {
      limit: 8,
      timeoutMs: 5,
    })).resolves.toEqual({
      query: 'relay',
      files: [],
      truncated: true,
    });
  });
});

describe('WorkspaceFileCollector scan budget', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  });

  afterEach(async () => {
    try {
      const child = gitFixture.child;
      if (child?.pid) {
        try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      }
      if (gitFixture.descendantPid) { try { process.kill(gitFixture.descendantPid, 'SIGKILL'); } catch {} }
      await gitFixture.closed;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      gitFixture.code = undefined;
      gitFixture.child = undefined;
      gitFixture.closed = undefined;
      gitFixture.descendantPid = undefined;
      vi.useRealTimers();
      await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
    }
  });

  it('stops waiting on git ls-files once the scan budget is spent', async () => {
    const workspace = await createWorkspace();
    await createFile(workspace, 'src/index.ts');
    gitFixture.code = `const { spawn } = require('node:child_process');
      const child = spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(1), 20000).unref(); setInterval(() => {}, 1000)'], { stdio: 'inherit' });
      child.once('spawn', () => {
        require('node:fs').writeFileSync('collector-pids.json', JSON.stringify([process.pid, child.pid]));
        process.stdout.write('src/index.ts\\n');
      });`;
    const collector = new WorkspaceFileCollector(workspace, new GitIgnoreParser(workspace), {
      scanBudgetMs: 1_000,
    });

    const startedAt = Date.now();
    const pending = collector.collectWorkspaceFiles(true);
    const child = gitFixture.child!;
    await once(child.stdout!, 'data', { signal: AbortSignal.timeout(15_000) });
    const pids = JSON.parse(await readFile(path.join(workspace, 'collector-pids.json'), 'utf8')) as number[];
    gitFixture.descendantPid = pids[1];
    const closed = vi.fn();
    child.once('close', closed);
    await vi.advanceTimersByTimeAsync(1000);
    const files = await boundedSettlement(pending);

    expect(Date.now() - startedAt).toBeLessThan(3_000);
    expect(files).toEqual(['src/index.ts']);
    expect(closed).not.toHaveBeenCalled();
    expect(() => process.kill(pids[1], 0)).not.toThrow();
  });

  it('keeps the complete list when git answers inside the budget', async () => {
    const workspace = await createWorkspace();
    await createFile(workspace, 'src/a.ts');
    await createFile(workspace, 'src/b.ts');
    gitFixture.code = 'process.stdout.write("src/a.ts\\nsrc/b.ts\\n")';
    const collector = new WorkspaceFileCollector(workspace, new GitIgnoreParser(workspace), {
      scanBudgetMs: 2_000,
    });

    const files = await collector.collectWorkspaceFiles(true);

    expect(files).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('bounds the filesystem walk fallback by the same budget', async () => {
    const workspace = await createWorkspace();
    for (let index = 0; index < 40; index += 1) {
      await createFile(workspace, `deep/${index}/${index}.ts`);
    }
    gitFixture.code = 'process.exitCode = 1';
    const exhausted = new WorkspaceFileCollector(workspace, new GitIgnoreParser(workspace), {
      scanBudgetMs: 0,
    });
    const generous = new WorkspaceFileCollector(workspace, new GitIgnoreParser(workspace), {
      scanBudgetMs: 5_000,
    });

    const boundedFiles = await exhausted.collectWorkspaceFiles(true);
    const completeFiles = await generous.collectWorkspaceFiles(true);

    expect(boundedFiles.length).toBeLessThan(completeFiles.length);
    expect(completeFiles).toHaveLength(40);
  });
});
