/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryEventLog, MemoryEventLogCorruptionError } from '../../src/memory/MemoryEventLog.js';
import type { MemoryEntry } from '../../src/memory/types.js';

const temporaryRoots: string[] = [];

async function createLog(): Promise<{ log: MemoryEventLog; logPath: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-memory-events-'));
  temporaryRoots.push(root);
  return {
    log: new MemoryEventLog(root),
    logPath: path.join(root, 'events', 'LOG.jsonl'),
  };
}

function entry(id: string, content = `memory ${id}`): MemoryEntry {
  return {
    id,
    content,
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
    tags: ['test'],
    source: 'test',
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.remove(root)));
});

describe('MemoryEventLog', () => {
  it('keeps prior records byte-for-byte while appending later events', async () => {
    const { log, logPath } = await createLog();
    const first = await log.append({
      operation: 'create',
      level: 'project',
      entry: entry('one'),
    });
    const firstBytes = await fs.readFile(logPath);

    const second = await log.append({
      operation: 'update',
      level: 'project',
      entry: entry('one', 'updated memory'),
    });
    const allBytes = await fs.readFile(logPath);
    const events = await log.readAll();

    expect(allBytes.subarray(0, firstBytes.length)).toEqual(firstBytes);
    expect(events.map((event) => event.eventId)).toEqual([first.eventId, second.eventId]);
    expect(events.map((event) => event.operation)).toEqual(['create', 'update']);
  });

  it('repairs a torn trailing record before the next append', async () => {
    const { log, logPath } = await createLog();
    await log.append({
      operation: 'create',
      level: 'project',
      entry: entry('one'),
    });
    await fs.appendFile(logPath, '{"version":1,"eventId":"torn');

    await log.append({
      operation: 'create',
      level: 'project',
      entry: entry('two'),
    });

    await expect(log.readAll()).resolves.toHaveLength(2);
    expect(await fs.readFile(logPath, 'utf8')).not.toContain('"eventId":"torn');
  });

  it('serializes concurrent writers without losing or corrupting events', async () => {
    const { log } = await createLog();

    await Promise.all(
      Array.from({ length: 32 }, (_, index) => log.append({
        operation: 'create',
        level: 'project',
        entry: entry(`memory-${index}`),
      })),
    );

    const events = await log.readAll();
    expect(events).toHaveLength(32);
    expect(new Set(events.map((event) => event.eventId))).toHaveLength(32);
    expect(new Set(events.map((event) => event.entry?.id))).toHaveLength(32);
  });

  it('does not silently discard a corrupt complete record', async () => {
    const { log, logPath } = await createLog();
    await fs.ensureDir(path.dirname(logPath));
    await fs.writeFile(logPath, '{"version":1,"broken":true}\n');

    await expect(log.readAll()).rejects.toBeInstanceOf(MemoryEventLogCorruptionError);
  });

  it('bootstraps existing entries once and replays the latest materialized view', async () => {
    const { log } = await createLog();
    await log.initialize('project', [entry('legacy')]);
    await log.initialize('project', [entry('duplicate-bootstrap')]);
    await log.append({
      operation: 'update',
      level: 'project',
      entry: entry('legacy', 'new content'),
    });
    await log.append({
      operation: 'create',
      level: 'project',
      entry: entry('removed'),
    });
    await log.append({
      operation: 'delete',
      level: 'project',
      memoryId: 'removed',
    });

    const replayed = await log.replay();

    expect(replayed).toEqual([entry('legacy', 'new content')]);
    expect((await log.readAll()).map((event) => event.operation)).toEqual([
      'snapshot',
      'update',
      'create',
      'delete',
    ]);
  });
});
