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
  const manager = new MemoryManager(workspaceRoot, {
    userMemoryDir: path.join(workspaceRoot, 'user-memory'),
  });
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
    expect(SYNC_EXCLUDE_ALWAYS).not.toContain('memory/events/');
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

  it('learns ranked project capabilities from canonical usage events', async () => {
    const { manager, memoryDir } = await createManager();

    await manager.recordCapabilityUse({
      kind: 'skill',
      name: 'tdd',
      source: 'autohand-project',
      origin: 'user',
      outcome: 'succeeded',
    });
    await manager.recordCapabilityUse({
      kind: 'skill',
      name: 'tdd',
      source: 'autohand-project',
      origin: 'agent',
      outcome: 'succeeded',
    });
    await manager.recordCapabilityUse({
      kind: 'slash_command',
      name: '/release',
      source: 'extension:release-tools',
      origin: 'user',
      outcome: 'failed',
    });

    const learned = await manager.getLearnedProjectCapabilities();
    const context = await manager.getContextMemories();
    const events = await new MemoryEventLog(memoryDir).readAll();

    expect(learned[0]).toMatchObject({
      kind: 'skill',
      name: 'tdd',
      source: 'autohand-project',
      uses: 2,
      successfulUses: 2,
      userUses: 1,
      agentUses: 1,
    });
    expect(learned[0]!.score).toBeGreaterThan(learned[1]!.score);
    expect(context).toContain('## Learned Project Capabilities');
    expect(context).toContain('Skill `tdd`');
    expect(context).not.toContain('Slash command `/release`');
    expect(events.map((event) => event.operation)).toEqual([
      'capability_used',
      'capability_used',
      'capability_used',
    ]);
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

  it('stores the canonical project event log inside .autohand/memory', async () => {
    const { manager, memoryDir } = await createManager();
    await manager.store('Canonical location contract', 'project');

    await expect(fs.pathExists(path.join(memoryDir, 'events', 'LOG.jsonl'))).resolves.toBe(true);
  });

  it('uses a snapshot-stable derived outline for bounded context injection', async () => {
    const { manager } = await createManager();
    await Promise.all(
      Array.from({ length: 18 }, (_, index) =>
        manager.store(`outlineitem${index} convention${index} decision${index}`, 'project')
      ),
    );

    const outline = await manager.getMemoryOutline('project', {
      maxLines: 8,
      maxChars: 1_000,
      recentRawCount: 3,
    });
    const context = await manager.getContextMemories(8);

    expect(outline.nodes.length).toBeLessThanOrEqual(8);
    expect(outline.text.length).toBeLessThanOrEqual(1_000);
    expect(context).toContain('## Project Memory Outline');
    expect(context).toContain(`snapshot=${outline.snapshotId}`);
  });

  it('ranks exact content and tag matches ahead of unrelated recent entries', async () => {
    const { manager } = await createManager();
    await manager.store('Use Vitest fake timers for scheduler tests', 'project', ['testing']);
    await manager.store('Deploy documentation through the release pipeline', 'project', ['release']);
    await manager.store('Keep terminal colors accessible', 'project', ['vitest']);

    const recalled = await manager.recall('vitest testing', 'project');

    expect(recalled[0]?.content).toBe('Use Vitest fake timers for scheduler tests');
    expect(recalled.every((memory) => memory.level === 'project')).toBe(true);
  });

  it('automatically repairs the materialized projection from canonical events on startup', async () => {
    const { manager, memoryDir } = await createManager();
    const created = await manager.store('Recover this projection automatically', 'project');
    await fs.remove(path.join(memoryDir, `${created.id}.json`));
    await fs.remove(path.join(memoryDir, 'index.json'));

    const workspaceRoot = path.dirname(path.dirname(memoryDir));
    const restarted = new MemoryManager(workspaceRoot, {
      userMemoryDir: path.join(workspaceRoot, 'user-memory'),
    });
    await restarted.initialize();

    await expect(restarted.get(created.id, 'project')).resolves.toMatchObject({
      id: created.id,
      content: created.content,
    });
    await expect(fs.readJson(path.join(memoryDir, 'index.json'))).resolves.toMatchObject({
      entries: [{ id: created.id }],
    });
  });

  it('does not rewrite an already-current projection during startup repair', async () => {
    const { manager, memoryDir } = await createManager();
    const created = await manager.store('Keep current projections stable', 'project');
    const entryPath = path.join(memoryDir, `${created.id}.json`);
    const indexPath = path.join(memoryDir, 'index.json');
    const beforeEntry = await fs.stat(entryPath);
    const beforeIndex = await fs.stat(indexPath);
    const workspaceRoot = path.dirname(path.dirname(memoryDir));

    const restarted = new MemoryManager(workspaceRoot, {
      userMemoryDir: path.join(workspaceRoot, 'user-memory'),
    });
    await restarted.initialize();

    expect((await fs.stat(entryPath)).ino).toBe(beforeEntry.ino);
    expect((await fs.stat(indexPath)).ino).toBe(beforeIndex.ino);
  });

  it('rejects memory identifiers that could escape .autohand/memory', async () => {
    const { manager, memoryDir } = await createManager();
    const outsidePath = path.join(path.dirname(memoryDir), 'outside.json');
    await fs.writeJson(outsidePath, { protected: true });

    await expect(manager.get('../outside', 'project')).rejects.toThrow(
      /invalid memory identifier/i,
    );
    await expect(manager.delete('../outside', 'project')).rejects.toThrow(
      /invalid memory identifier/i,
    );
    await expect(fs.pathExists(outsidePath)).resolves.toBe(true);
  });
});
