/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyAvailableSessionDownloads } from '../../src/sync/sessionDownloads.js';
import { SyncDownloadNotFoundError } from '../../src/sync/SyncApiClient.js';
import type { SyncFileEntry } from '../../src/sync/types.js';

const files: SyncFileEntry[] = ['metadata.json', 'conversation.jsonl'].map(name => ({
  path: `sessions/fixture/${name}`, hash: 'fixture', size: 3, modifiedAt: '2026-11-03T00:00:00Z', encrypted: false,
}));
afterEach(() => vi.restoreAllMocks());

describe('session download staging', () => {
  it.each(['complete', 'missing', 'server', 'abort', 'apply'] as const)('releases private staging after %s', async outcome => {
    const mkdtemp = vi.spyOn(fs, 'mkdtemp');
    const failure = new Error(outcome);
    let count = 0;
    const download = vi.fn(async () => {
      if (++count === 2 && outcome === 'missing') throw new SyncDownloadNotFoundError();
      if (count === 2 && (outcome === 'server' || outcome === 'abort')) throw failure;
      return Buffer.from('abc');
    });
    const apply = vi.fn(async () => {
      const directory = await mkdtemp.mock.results[0].value;
      if (process.platform !== 'win32') {
        expect((await fs.stat(directory)).mode & 0o777).toBe(0o700);
        expect((await fs.stat(`${directory}/0`)).mode & 0o777).toBe(0o600);
      }
      expect(download).toHaveBeenCalledTimes(2);
      if (outcome === 'apply') throw failure;
    });
    const result = applyAvailableSessionDownloads(files, download, apply, { maxBytes: 64 });
    if (outcome === 'complete' || outcome === 'missing') await expect(result).resolves.toBe(outcome === 'complete');
    else await expect(result).rejects.toBe(failure);
    expect(apply).toHaveBeenCalledTimes(outcome === 'complete' ? 2 : outcome === 'apply' ? 1 : 0);
    const directory = await mkdtemp.mock.results[0].value;
    await expect(fs.stat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('bounds actual staged bytes when cloud descriptors understate their sizes', async () => {
    const mkdtemp = vi.spyOn(fs, 'mkdtemp');
    const apply = vi.fn();
    await expect(applyAvailableSessionDownloads(files, async () => Buffer.from('abc'), apply, { maxBytes: 5 }))
      .rejects.toThrow('Downloaded session exceeds the configured session budget');
    expect(apply).not.toHaveBeenCalled();
    const directory = await mkdtemp.mock.results[0].value;
    await expect(fs.stat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps the transfer error when cleanup also fails', async () => {
    const mkdtemp = vi.spyOn(fs, 'mkdtemp');
    const remove = vi.spyOn(fs, 'rm').mockRejectedValue(new Error('cleanup failed'));
    const failure = new Error('transfer failed');
    try {
      await expect(applyAvailableSessionDownloads(files, async () => { throw failure; }, vi.fn(), { maxBytes: 64 })).rejects.toBe(failure);
    } finally {
      const directory = await mkdtemp.mock.results[0].value;
      remove.mockRestore();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
