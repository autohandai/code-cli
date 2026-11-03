/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SyncDownloadNotFoundError } from './SyncApiClient.js';
import type { SyncFileEntry } from './types.js';

export async function applyAvailableSessionDownloads(
  files: readonly SyncFileEntry[],
  download: (file: SyncFileEntry) => Promise<Buffer>,
  apply: (file: SyncFileEntry, content: Buffer) => Promise<void>,
  options: { maxBytes: number },
): Promise<boolean> {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0) throw new Error('Invalid session staging budget');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-session-download-'));
  let settled = false;
  let stagedBytes = 0;
  try {
    for (const [index, file] of files.entries()) {
      let content: Buffer;
      try {
        content = await download(file);
      } catch (error) {
        if (!(error instanceof SyncDownloadNotFoundError)) throw error;
        settled = true;
        return false;
      }
      if (content.length > options.maxBytes - stagedBytes) {
        throw new Error('Downloaded session exceeds the configured session budget');
      }
      stagedBytes += content.length;
      await fs.writeFile(path.join(directory, String(index)), content, { mode: 0o600, flag: 'wx' });
    }
    for (const [index, file] of files.entries()) {
      await apply(file, await fs.readFile(path.join(directory, String(index))));
    }
    settled = true;
    return true;
  } finally {
    try {
      await fs.rm(directory, { recursive: true, force: true });
    } catch (error) {
      if (settled) throw error;
    }
  }
}
