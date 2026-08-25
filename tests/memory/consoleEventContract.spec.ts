/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Cross-repo contract: the Autohand console appends memory events to this same
 * append-only log, through `api/src/memory/memoryEvents.ts`. If the CLI stops
 * accepting what the console writes, a user's own memory log becomes
 * unparseable and they lose access to their memories.
 *
 * The fixtures below are verbatim output from the console's event builders. The
 * matching test on the API side (`api/tests/memoryEvents.test.ts`) pins the
 * shape it produces, so a drift on either side fails one of the two suites.
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MemoryEventLog,
  mergeMemoryEventLogContents,
} from '../../src/memory/MemoryEventLog.js';

const temporaryRoots: string[] = [];

async function createLog(): Promise<{ log: MemoryEventLog; logPath: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-console-contract-'));
  temporaryRoots.push(root);
  return {
    log: new MemoryEventLog(root),
    logPath: path.join(root, 'events', 'LOG.jsonl'),
  };
}

/** Exactly what `buildCreateEvent` serializes in the console API. */
const CONSOLE_CREATE_EVENT = JSON.stringify({
  version: 1,
  eventId: '6f1a2c3d-4e5b-4a7c-8d9e-0f1a2b3c4d5e',
  operation: 'create',
  level: 'user',
  memoryId: 'always-run-proof',
  occurredAt: '2026-08-25T10:00:00.000Z',
  entry: {
    id: 'always-run-proof',
    content: 'Always run `bun run proof` before claiming a task is done.',
    createdAt: '2026-08-25T10:00:00.000Z',
    updatedAt: '2026-08-25T10:00:00.000Z',
    source: 'console',
  },
});

/** Exactly what `buildDeleteEvent` serializes — note `entry` is absent, not null. */
const CONSOLE_DELETE_EVENT = JSON.stringify({
  version: 1,
  eventId: '7a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d',
  operation: 'delete',
  level: 'user',
  memoryId: 'always-run-proof',
  occurredAt: '2026-08-25T10:00:01.000Z',
});

async function writeLog(logPath: string, lines: string[]): Promise<void> {
  await fs.ensureDir(path.dirname(logPath));
  await fs.writeFile(logPath, `${lines.join('\n')}\n`, 'utf8');
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.remove(root)));
});

describe('console-authored memory events', () => {
  it('parses a console create event', async () => {
    const { log, logPath } = await createLog();
    await writeLog(logPath, [CONSOLE_CREATE_EVENT]);

    const events = await log.readAll();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      operation: 'create',
      level: 'user',
      memoryId: 'always-run-proof',
    });
  });

  it('replays a console create into a memory entry', async () => {
    const { log, logPath } = await createLog();
    await writeLog(logPath, [CONSOLE_CREATE_EVENT]);

    const entries = await log.replay();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'always-run-proof',
      content: 'Always run `bun run proof` before claiming a task is done.',
      source: 'console',
    });
  });

  it('replays a console delete as a removal', async () => {
    const { log, logPath } = await createLog();
    await writeLog(logPath, [CONSOLE_CREATE_EVENT, CONSOLE_DELETE_EVENT]);

    expect(await log.replay()).toEqual([]);
  });

  it('accepts a console event appended after a CLI event', async () => {
    const { log, logPath } = await createLog();
    await log.append({
      operation: 'create',
      level: 'user',
      entry: {
        id: 'written-by-cli',
        content: 'from the CLI',
        createdAt: '2026-08-25T09:00:00.000Z',
        updatedAt: '2026-08-25T09:00:00.000Z',
      },
    });

    const existing = await fs.readFile(logPath, 'utf8');
    await fs.writeFile(logPath, `${existing}${CONSOLE_CREATE_EVENT}\n`, 'utf8');

    const entries = await log.replay();
    expect(entries.map((entry) => entry.id).sort()).toEqual(['always-run-proof', 'written-by-cli']);
  });

  it('merges a console-appended log into a diverged local log', async () => {
    const { log, logPath } = await createLog();
    await log.append({
      operation: 'create',
      level: 'user',
      entry: {
        id: 'written-by-cli',
        content: 'from the CLI',
        createdAt: '2026-08-25T09:00:00.000Z',
        updatedAt: '2026-08-25T09:00:00.000Z',
      },
    });
    const localContent = await fs.readFile(logPath, 'utf8');

    // What the console left in R2: the same history plus its own event.
    const remoteContent = `${localContent}${CONSOLE_CREATE_EVENT}\n`;
    const merged = mergeMemoryEventLogContents(localContent, remoteContent);

    await fs.writeFile(logPath, merged, 'utf8');
    const entries = await log.replay();
    expect(entries.map((entry) => entry.id).sort()).toEqual(['always-run-proof', 'written-by-cli']);
  });

  it('is idempotent when the same console event merges twice', async () => {
    const { logPath } = await createLog();
    await writeLog(logPath, [CONSOLE_CREATE_EVENT]);
    const content = await fs.readFile(logPath, 'utf8');

    const merged = mergeMemoryEventLogContents(content, content);

    expect(merged.trim().split('\n')).toHaveLength(1);
  });
});
