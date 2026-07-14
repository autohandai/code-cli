/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { promises as nodeFs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acquireFileLock,
  atomicRemoveFile,
  atomicWriteFile,
  atomicWriteJson,
} from '../../src/utils/atomicFile.js';

describe('atomic file persistence', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-atomic-file-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.remove(tempDir);
  });

  it('grants exactly one exclusive lock during a concurrent acquisition race', async () => {
    const lockPath = path.join(tempDir, 'resource.lock');
    const leases = await Promise.all(
      Array.from({ length: 12 }, () => acquireFileLock(lockPath)),
    );
    const acquired = leases.filter((lease) => lease !== null);

    expect(acquired).toHaveLength(1);
    await acquired[0].release();
    expect(await fs.pathExists(lockPath)).toBe(false);
  });

  it('blocks another process and reclaims its lock after the owner crashes', async () => {
    const lockPath = path.join(tempDir, 'child-process.lock');
    const helperUrl = pathToFileURL(path.resolve('src/utils/atomicFile.ts')).href;
    const child = spawn(process.execPath, [
      '--import',
      'tsx',
      '--input-type=module',
      '--eval',
      [
        `import { acquireFileLock } from ${JSON.stringify(helperUrl)};`,
        `const lease = await acquireFileLock(${JSON.stringify(lockPath)});`,
        "if (!lease) throw new Error('child failed to acquire lock');",
        "process.stdout.write('locked\\n');",
        'setInterval(() => {}, 1000);',
      ].join('\n'),
    ], {
      cwd: path.resolve('.'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    try {
      const childReady = once(child.stdout, 'data').then(([chunk]) => String(chunk));
      const childFailure = once(child, 'exit').then(([code, signal]) => {
        throw new Error(`lock holder exited before acquiring the lock (${code ?? signal})`);
      });
      await expect(Promise.race([childReady, childFailure])).resolves.toContain('locked');

      await expect(acquireFileLock(lockPath)).resolves.toBeNull();

      const childExited = once(child, 'exit');
      child.kill('SIGKILL');
      await childExited;

      const recovered = await acquireFileLock(lockPath, {
        staleMs: 0,
        waitTimeoutMs: 1000,
        retryDelayMs: 10,
      });
      expect(recovered).not.toBeNull();
      await recovered?.release();
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    }
  });

  it('reclaims a dead stale lock and does not let an old owner release its replacement', async () => {
    const lockPath = path.join(tempDir, 'resource.lock');
    await fs.writeJson(lockPath, {
      version: 1,
      ownerId: 'dead-owner',
      pid: 2147483647,
      createdAt: 0,
    });

    const replacement = await acquireFileLock(lockPath, { staleMs: 1 });
    expect(replacement).not.toBeNull();

    const oldOwner = replacement!;
    await fs.remove(lockPath);
    const newOwner = await acquireFileLock(lockPath);
    expect(newOwner).not.toBeNull();

    await oldOwner.release();
    expect(await fs.pathExists(lockPath)).toBe(true);

    await newOwner!.release();
  });

  it('cannot remove a replacement installed between owner cleanup and lock-directory removal', async () => {
    const lockPath = path.join(tempDir, 'resource.lock');
    const owner = await acquireFileLock(lockPath);
    expect(owner).not.toBeNull();
    const ownerPath = path.join(lockPath, `${owner?.ownerId}.owner`);
    const replacementPath = path.join(lockPath, 'replacement-owner.owner');
    const originalUnlink = nodeFs.unlink.bind(nodeFs);
    let replacementInstalled = false;
    vi.spyOn(nodeFs, 'unlink').mockImplementation(async (target) => {
      await originalUnlink(target);
      if (target === ownerPath) {
        await nodeFs.writeFile(replacementPath, JSON.stringify({
          version: 1,
          ownerId: 'replacement-owner',
          pid: process.pid,
          createdAt: Date.now(),
        }));
        replacementInstalled = true;
      }
    });

    await owner?.release();

    expect(replacementInstalled).toBe(true);
    expect(await fs.pathExists(replacementPath)).toBe(true);
  });

  it('recovers when a crashed stale-lock reaper left its own lock behind', async () => {
    const lockPath = path.join(tempDir, 'resource.lock');
    const deadRecord = {
      version: 1,
      ownerId: 'dead-owner',
      pid: 2147483647,
      createdAt: 0,
    };
    await fs.writeJson(lockPath, deadRecord);
    await fs.writeJson(`${lockPath}.reaper`, {
      ...deadRecord,
      ownerId: 'dead-reaper',
    });

    const recovered = await acquireFileLock(lockPath, {
      staleMs: 1,
      waitTimeoutMs: 100,
      retryDelayMs: 5,
    });

    expect(recovered).not.toBeNull();
    await recovered?.release();
  });

  it('does not reap a live replacement created immediately after stale-directory removal', async () => {
    const lockPath = path.join(tempDir, 'resource.lock');
    await fs.ensureDir(lockPath);
    await fs.writeJson(path.join(lockPath, 'dead-owner.owner'), {
      version: 1,
      ownerId: 'dead-owner',
      pid: 2147483647,
      createdAt: 0,
    });
    const replacementPath = path.join(lockPath, 'replacement-owner.owner');
    const originalRmdir = nodeFs.rmdir.bind(nodeFs);
    let replacementInstalled = false;
    vi.spyOn(nodeFs, 'rmdir').mockImplementation(async (target, options) => {
      await originalRmdir(target, options);
      if (target === lockPath && !replacementInstalled) {
        await nodeFs.mkdir(lockPath);
        await nodeFs.writeFile(replacementPath, JSON.stringify({
          version: 1,
          ownerId: 'replacement-owner',
          pid: process.pid,
          createdAt: Date.now(),
        }));
        replacementInstalled = true;
      }
    });

    const acquired = await acquireFileLock(lockPath, { staleMs: 1 });

    expect(acquired).toBeNull();
    expect(replacementInstalled).toBe(true);
    expect(await fs.pathExists(replacementPath)).toBe(true);
  });

  it('preserves a live legacy replacement installed while a stale directory is inspected', async () => {
    const lockPath = path.join(tempDir, 'resource.lock');
    const ownerPath = path.join(lockPath, 'dead-owner.owner');
    await fs.ensureDir(lockPath);
    await fs.writeJson(ownerPath, {
      version: 1,
      ownerId: 'dead-owner',
      pid: 2147483647,
      createdAt: 0,
    });
    const replacement = {
      version: 1,
      ownerId: 'replacement-owner',
      pid: process.pid,
      createdAt: Date.now(),
    };
    vi.spyOn(nodeFs, 'readFile').mockImplementationOnce(async () => {
      await fs.remove(lockPath);
      await fs.writeJson(lockPath, replacement);
      throw Object.assign(new Error('owner parent was replaced'), { code: 'ENOTDIR' });
    });

    await expect(acquireFileLock(lockPath, { staleMs: 1 })).resolves.toBeNull();

    expect(await fs.readJson(lockPath)).toEqual(replacement);
  });

  it('retries when its empty lock directory is reaped before owner creation', async () => {
    const lockPath = path.join(tempDir, 'resource.lock');
    vi.spyOn(nodeFs, 'open').mockImplementationOnce(async () => {
      await fs.remove(lockPath);
      throw Object.assign(new Error('lock directory disappeared'), { code: 'ENOENT' });
    });

    const acquired = await acquireFileLock(lockPath, {
      staleMs: 0,
      waitTimeoutMs: 100,
      retryDelayMs: 1,
    });

    expect(acquired).not.toBeNull();
    await acquired?.release();
  });

  it('treats Windows EPERM as a contended release when a replacement owner exists', async () => {
    const lockPath = path.join(tempDir, 'resource.lock');
    const owner = await acquireFileLock(lockPath);
    expect(owner).not.toBeNull();
    const replacementPath = path.join(lockPath, 'replacement-owner.owner');
    await fs.writeJson(replacementPath, {
      version: 1,
      ownerId: 'replacement-owner',
      pid: process.pid,
      createdAt: Date.now(),
    });
    vi.spyOn(nodeFs, 'rmdir').mockRejectedValueOnce(
      Object.assign(new Error('directory is not empty'), { code: 'EPERM' }),
    );

    await expect(owner?.release()).resolves.toBeUndefined();
    expect(await fs.pathExists(replacementPath)).toBe(true);
  });

  it('cleans only its own lock directory when owner-file creation fails', async () => {
    const lockPath = path.join(tempDir, 'resource.lock');
    vi.spyOn(nodeFs, 'open').mockRejectedValueOnce(
      Object.assign(new Error('lock access denied'), { code: 'EACCES' }),
    );

    await expect(acquireFileLock(lockPath)).rejects.toThrow('lock access denied');

    expect(await fs.pathExists(lockPath)).toBe(false);
  });

  it('atomically replaces JSON through a same-directory temporary file', async () => {
    const targetPath = path.join(tempDir, 'state.json');
    await fs.writeJson(targetPath, { generation: 'old' });
    const rename = vi.spyOn(nodeFs, 'rename');

    await atomicWriteJson(targetPath, { generation: 'new' });

    expect(await fs.readJson(targetPath)).toEqual({ generation: 'new' });
    expect(rename).toHaveBeenCalledWith(
      expect.stringMatching(/\.state\.json\..+\.tmp$/),
      targetPath,
    );
    expect((await fs.readdir(tempDir)).filter((entry) => entry.endsWith('.tmp'))).toEqual([]);
  });

  it('preserves the previous JSON and removes its temporary file when replacement fails', async () => {
    const targetPath = path.join(tempDir, 'state.json');
    await fs.writeJson(targetPath, { generation: 'old' });
    vi.spyOn(nodeFs, 'rename').mockRejectedValueOnce(
      Object.assign(new Error('simulated rename failure'), { code: 'EIO' }),
    );

    await expect(atomicWriteJson(targetPath, { generation: 'new' }))
      .rejects.toThrow('simulated rename failure');

    expect(await fs.readJson(targetPath)).toEqual({ generation: 'old' });
    expect((await fs.readdir(tempDir)).filter((entry) => entry.endsWith('.tmp'))).toEqual([]);
  });

  it('preserves committed JSON when a lifecycle closes before replacement', async () => {
    const targetPath = path.join(tempDir, 'state.json');
    await fs.writeJson(targetPath, { generation: 'old' });

    await expect(atomicWriteJson(
      targetPath,
      { generation: 'late' },
      {
        beforeCommit: () => {
          throw new Error('lifecycle closed');
        },
      },
    )).rejects.toThrow('lifecycle closed');

    expect(await fs.readJson(targetPath)).toEqual({ generation: 'old' });
    expect((await fs.readdir(tempDir)).filter((entry) => entry.endsWith('.tmp'))).toEqual([]);
  });

  it('preserves committed binary content when a lifecycle closes before replacement', async () => {
    const targetPath = path.join(tempDir, 'memory.bin');
    await fs.writeFile(targetPath, Buffer.from('old'));

    await expect(atomicWriteFile(
      targetPath,
      Buffer.from('late'),
      {
        beforeCommit: () => {
          throw new Error('lifecycle closed');
        },
      },
    )).rejects.toThrow('lifecycle closed');

    expect(await fs.readFile(targetPath, 'utf8')).toBe('old');
    expect((await fs.readdir(tempDir)).filter((entry) => entry.endsWith('.tmp'))).toEqual([]);
  });

  it('keeps the source file when a lifecycle closes before a tombstone commit', async () => {
    const targetPath = path.join(tempDir, 'memory.json');
    await fs.writeFile(targetPath, 'committed');

    await expect(atomicRemoveFile(targetPath, {
      beforeCommit: () => {
        throw new Error('lifecycle closed');
      },
    })).rejects.toThrow('lifecycle closed');

    expect(await fs.readFile(targetPath, 'utf8')).toBe('committed');
    expect((await fs.readdir(tempDir)).filter((entry) => entry.endsWith('.tombstone'))).toEqual([]);
  });

  it('commits deletion through a same-directory tombstone and cleans it up', async () => {
    const targetPath = path.join(tempDir, 'memory.json');
    await fs.writeFile(targetPath, 'committed');
    const rename = vi.spyOn(nodeFs, 'rename');

    await atomicRemoveFile(targetPath);

    expect(await fs.pathExists(targetPath)).toBe(false);
    expect(rename).toHaveBeenCalledWith(
      targetPath,
      expect.stringMatching(/\.memory\.json\..+\.tombstone$/),
    );
    expect((await fs.readdir(tempDir)).filter((entry) => entry.endsWith('.tombstone'))).toEqual([]);
  });

  it('leaves committed JSON readable when a crash left a truncated temporary file', async () => {
    const targetPath = path.join(tempDir, 'state.json');
    await fs.writeJson(targetPath, { generation: 'committed' });
    await fs.writeFile(path.join(tempDir, '.state.json.crashed.tmp'), '{"generation":');

    expect(await fs.readJson(targetPath)).toEqual({ generation: 'committed' });
  });
});
