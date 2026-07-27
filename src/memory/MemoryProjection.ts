/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { atomicRemoveFile, atomicWriteJson } from '../utils/atomicFile.js';
import type { MemoryEntry, MemoryIndex } from './types.js';
import { assertSafeMemoryId } from './MemoryPathSafety.js';

function toIndexEntry(entry: MemoryEntry): MemoryIndex['entries'][number] {
  return {
    id: entry.id,
    preview: entry.content.slice(0, 100),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    ...(entry.tags === undefined ? {} : { tags: entry.tags }),
  };
}

async function writeJsonIfChanged(filePath: string, value: unknown): Promise<void> {
  const existing = await fs.readJson(filePath).catch(() => undefined) as unknown;
  if (existing !== undefined && isDeepStrictEqual(existing, value)) {
    return;
  }
  await atomicWriteJson(filePath, value);
}

export async function materializeMemoryProjection(
  memoryDirectory: string,
  entries: readonly MemoryEntry[],
): Promise<{ restored: number; removed: number }> {
  await fs.ensureDir(memoryDirectory);
  const replayedById = new Map(entries.map((entry) => [entry.id, entry]));
  const files = await fs.readdir(memoryDirectory);
  let restored = 0;
  let removed = 0;

  for (const entry of entries) {
    assertSafeMemoryId(entry.id);
    const entryPath = path.join(memoryDirectory, `${entry.id}.json`);
    if (!(await fs.pathExists(entryPath))) {
      restored += 1;
    }
    await writeJsonIfChanged(entryPath, entry);
  }

  for (const file of files) {
    if (!file.endsWith('.json') || file === 'index.json') {
      continue;
    }
    const id = file.slice(0, -'.json'.length);
    if (!replayedById.has(id)) {
      await atomicRemoveFile(path.join(memoryDirectory, file));
      removed += 1;
    }
  }

  const index: MemoryIndex = {
    version: 1,
    entries: entries.map(toIndexEntry),
  };
  await writeJsonIfChanged(path.join(memoryDirectory, 'index.json'), index);
  return { restored, removed };
}
