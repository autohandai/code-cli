/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryManager } from '../../src/memory/MemoryManager.js';
import { MemoryEventLog } from '../../src/memory/MemoryEventLog.js';
import { SYNC_EXCLUDE_ALWAYS } from '../../src/sync/types.js';

const temporaryRoots: string[] = [];

async function createManager(): Promise<{
  manager: MemoryManager;
  memoryDir: string;
}> {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-memory-manager-'));
  temporaryRoots.push(workspaceRoot);
  const manager = new MemoryManager(workspaceRoot);
  await manager.initialize();
  return {
    manager,
    memoryDir: path.join(workspaceRoot, '.autohand', 'memory'),
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.remove(root)));
});

describe('MemoryManager event log integration', () => {
  it('keeps transient memory lock directories out of sync manifests', () => {
    expect(SYNC_EXCLUDE_ALWAYS).toContain('memory/index.json.lock');
    expect(SYNC_EXCLUDE_ALWAYS).toContain('memory/events/');
  });

  it('records create, update, and delete without changing public read behavior', async () => {
    const { manager, memoryDir } = await createManager();

    const created = await manager.store('Use Vitest for memory tests', 'project', ['testing'], 'manual');
    const updated = await manager.updateMemory(
      created.id,
      'Use Vitest and temporary directories for memory tests',
      'project',
      ['testing', 'filesystem'],
    );
    await manager.delete(created.id, 'project');

    expect(updated.createdAt).toBe(created.createdAt);
    await expect(manager.get(created.id, 'project')).resolves.toBeNull();
    const events = await new MemoryEventLog(memoryDir).readAll();
    expect(events.map((event) => event.operation)).toEqual(['create', 'update', 'delete']);
    expect(events[0]?.entry?.source).toBe('manual');
  });

  it('preserves every entry in the index during parallel stores', async () => {
    const { manager, memoryDir } = await createManager();

    const stored = await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        manager.store(
          `uniqueconvention${index} setting${index} preference${index}`,
          'project',
          [`tag-${index}`],
        )
      ),
    );

    const index = await fs.readJson(path.join(memoryDir, 'index.json')) as {
      entries: Array<{ id: string }>;
    };
    expect(new Set(stored.map((memory) => memory.id))).toHaveLength(24);
    expect(new Set(index.entries.map((memory) => memory.id))).toEqual(
      new Set(stored.map((memory) => memory.id)),
    );
    await expect(new MemoryEventLog(memoryDir).readAll()).resolves.toHaveLength(24);
  });

  it('keeps the materialized view aligned with the final concurrent update event', async () => {
    const { manager, memoryDir } = await createManager();
    const created = await manager.store('Initial concurrency value', 'project');

    await Promise.all(
      Array.from({ length: 16 }, (_, index) =>
        manager.updateMemory(created.id, `Concurrent update ${index}`, 'project', [`update-${index}`])
      ),
    );

    const materialized = await manager.get(created.id, 'project');
    const replayed = await new MemoryEventLog(memoryDir).replay();
    expect(materialized).toEqual(replayed.find((entry) => entry.id === created.id));
  });

  it('bootstraps legacy JSON entries before recording the first new mutation', async () => {
    const { manager, memoryDir } = await createManager();
    const legacy = {
      id: 'legacy',
      content: 'Existing memory from before the event log',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      tags: ['legacy'],
    };
    await fs.writeJson(path.join(memoryDir, 'legacy.json'), legacy);

    await manager.store('New event-backed memory', 'project');

    const events = await new MemoryEventLog(memoryDir).readAll();
    expect(events[0]).toMatchObject({
      operation: 'snapshot',
      entry: legacy,
    });
    expect(events[1]?.operation).toBe('create');
  });

  it('rebuilds missing materialized JSON and index files from the event log', async () => {
    const { manager, memoryDir } = await createManager();
    const first = await manager.store('First rebuildable memory', 'project', ['first']);
    const second = await manager.store('Second rebuildable memory', 'project', ['second']);
    await manager.delete(second.id, 'project');
    await fs.remove(path.join(memoryDir, `${first.id}.json`));
    await fs.remove(path.join(memoryDir, 'index.json'));

    const result = await manager.rebuildFromEventLog('project');

    expect(result).toEqual({ restored: 1, removed: 0 });
    await expect(manager.get(first.id, 'project')).resolves.toMatchObject({
      id: first.id,
      content: first.content,
    });
    await expect(manager.get(second.id, 'project')).resolves.toBeNull();
    const index = await fs.readJson(path.join(memoryDir, 'index.json')) as {
      entries: Array<{ id: string }>;
    };
    expect(index.entries.map((entry) => entry.id)).toEqual([first.id]);
  });
});
