/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { promises as nodeFs } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryManager, type MemoryManagerOptions, type ProjectMemoryAdapter } from '../../src/memory/MemoryManager.js';
import { acquireFileLock } from '../../src/utils/atomicFile.js';
import { MemoryEventLog } from '../../src/memory/MemoryEventLog.js';
import { SYNC_EXCLUDE_ALWAYS } from '../../src/sync/types.js';

const temporaryRoots: string[] = [];

async function createManager(options: MemoryManagerOptions = {}): Promise<{
  manager: MemoryManager;
  memoryDir: string;
}> {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-memory-manager-'));
  temporaryRoots.push(workspaceRoot);
  const manager = new MemoryManager(workspaceRoot, {
    userMemoryDir: path.join(workspaceRoot, 'user-memory'),
    ...options,
  });
  await manager.initialize();
  return {
    manager,
    memoryDir: path.join(workspaceRoot, '.autohand', 'memory'),
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.remove(root)));
});

describe('MemoryManager event log integration', () => {
  it('refreshes shared projects outside the view lock and publishes canonical mutations after release', async () => {
    let sharedDirectory: string | undefined;
    const refresh = vi.fn(async (workspace: string) => {
      sharedDirectory = path.join(workspace, 'account-cache');
      expect(await fs.pathExists(path.join(sharedDirectory, 'events', '.view.lock'))).toBe(false);
    });
    const publish = vi.fn(async () => {
      expect(await fs.pathExists(path.join(sharedDirectory!, 'events', '.view.lock'))).toBe(false);
      expect((await new MemoryEventLog(sharedDirectory!).readAll()).length).toBeGreaterThan(0);
    });
    const adapter: ProjectMemoryAdapter = { refresh, publish, directory: () => sharedDirectory, assertWritable: vi.fn() };
    const { manager, memoryDir } = await createManager({ projectMemory: adapter });
    const entry = await manager.store('Share the repository testing convention', 'project');
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(await fs.pathExists(path.join(memoryDir, `${entry.id}.json`))).toBe(false);
    expect(await fs.pathExists(path.join(sharedDirectory!, `${entry.id}.json`))).toBe(true);
    await manager.store('Private user preference', 'user');
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(path.dirname(path.dirname(memoryDir)), memoryDir, sharedDirectory);
    await manager.updateMemory(entry.id, 'Share the canonical repository testing convention', 'project');
    await manager.delete(entry.id, 'project');
    await manager.recordCapabilityUse({ kind: 'skill', name: 'tdd', source: 'project', origin: 'user', outcome: 'succeeded' });
    expect(publish).toHaveBeenCalledTimes(4);
    expect((await new MemoryEventLog(sharedDirectory!).readAll()).map((event) => event.operation)).toEqual(['create', 'update', 'delete', 'capability_used']);
  });

  it('keeps shared account directories isolated and stops exposing them when disconnected', async () => {
    let selectedAccount = 'team-a';
    let sharedDirectory: string | undefined;
    const adapter: ProjectMemoryAdapter = {
      refresh: async (workspace) => { sharedDirectory = selectedAccount ? path.join(workspace, selectedAccount) : undefined; },
      directory: () => sharedDirectory,
      assertWritable: () => {},
      publish: async () => {},
    };
    const { manager } = await createManager({ projectMemory: adapter });
    await manager.store('Alpha architecture decision', 'project');
    selectedAccount = 'team-b';
    await manager.store('Beta testing convention', 'project');
    expect((await manager.list('project')).map((entry) => entry.content)).toEqual(['Beta testing convention']);
    selectedAccount = 'team-a';
    expect(await manager.getSharedProjectContext()).toContain('Alpha architecture decision');
    expect(await manager.getSharedProjectContext()).not.toContain('Beta testing convention');
    await manager.store('Private preference stays outside team context', 'user');
    const bootstrap = await manager.getContextMemories();
    expect(bootstrap).toContain('<autohand_shared_project_memory>');
    expect(bootstrap.split('</autohand_shared_project_memory>')[1]).toContain('Private preference stays outside team context');
    expect(await manager.getSharedProjectContext()).not.toContain('Private preference stays outside team context');
    selectedAccount = '';
    expect(await manager.getSharedProjectContext()).toBe('');
    expect(await manager.list('project')).toEqual([]);
  });

  it('allows read-only context but rejects canonical project writes', async () => {
    let directory: string | undefined;
    const publish = vi.fn(async () => {});
    const { manager } = await createManager({ projectMemory: {
      refresh: async (workspace) => { directory = path.join(workspace, 'readonly-cache'); },
      directory: () => directory,
      assertWritable: () => { throw new Error('This team account is read-only'); },
      publish,
    } });
    await expect(manager.getSharedProjectContext()).resolves.toContain('supersedes');
    await expect(manager.store('Cannot publish this decision', 'project')).rejects.toThrow(/read-only/);
    expect(publish).not.toHaveBeenCalled();
    await expect(manager.store('Personal preference remains writable', 'user')).resolves.toBeDefined();
  });

  it('bounds large shared raw entries in turn and bootstrap context while preserving personal preferences', async () => {
    let directory: string | undefined;
    const { manager } = await createManager({ projectMemory: {
      refresh: async (workspace) => { directory = path.join(workspace, 'bounded-shared-cache'); },
      directory: () => directory,
      assertWritable: () => {},
      publish: async () => {},
    } });
    const oversized = `Repository guidance ${'long shared coding rule '.repeat(600)}PRIVATE_SHARED_TAIL`;
    const personal = `Personal formatting preference ${'keep original personal text '.repeat(220)}PERSONAL_TAIL`;
    await manager.store(oversized, 'project');
    await manager.store(personal, 'user');

    const turn = await manager.getSharedProjectContext();
    const bootstrap = await manager.getContextMemories();
    const sharedBootstrap = bootstrap.split('<autohand_shared_project_memory>')[1]?.split('</autohand_shared_project_memory>')[0] ?? '';

    expect(turn.length).toBeLessThanOrEqual(4_400);
    expect(sharedBootstrap.length).toBeLessThanOrEqual(4_100);
    expect(turn).toContain('truncated');
    expect(turn).toContain('recall_memory');
    expect(turn).not.toContain('PRIVATE_SHARED_TAIL');
    expect(bootstrap).toContain('<autohand_shared_project_memory>');
    expect(bootstrap).toContain('</autohand_shared_project_memory>');
    expect(bootstrap).toContain(personal);
    expect(bootstrap).not.toContain('PRIVATE_SHARED_TAIL');
    expect(await manager.get((await manager.list('project'))[0]!.id, 'project')).toMatchObject({ content: oversized });
  });

  it('retains local shared writes and reports offline refresh and publishing failures', async () => {
    let directory: string | undefined;
    let offline = false;
    const report = vi.fn();
    const { manager } = await createManager({ projectMemory: {
      refresh: async (workspace) => {
        directory ??= path.join(workspace, 'offline-cache');
        if (offline) throw new Error('Project memory refresh failed: check your connection');
      },
      directory: () => directory,
      assertWritable: () => {},
      publish: async () => { throw new Error('Project memory upload failed: retry when online'); },
    }, onProjectMemoryError: report });
    offline = true;
    const stored = await manager.store('Keep a pending repository decision', 'project');
    expect(await manager.get(stored.id, 'project')).toEqual(stored);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('refresh failed') }));
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('upload failed') }));
  });

  it('rejects an account switch while waiting for the old directory lock', async () => {
    let selectedAccount = 'team-a';
    let directory: string | undefined;
    const adapter: ProjectMemoryAdapter = {
      refresh: vi.fn(async (workspace) => { directory = path.join(workspace, selectedAccount); }),
      directory: (workspace) => path.join(workspace, selectedAccount),
      assertWritable: () => {},
      publish: vi.fn(async () => {}),
    };
    const { manager } = await createManager({ projectMemory: adapter });
    const lease = await acquireFileLock(path.join(directory!, 'events', '.view.lock'));
    const saving = manager.store('Never redirect an account mutation', 'project');
    await vi.waitFor(() => expect(adapter.refresh).toHaveBeenCalledTimes(2));
    selectedAccount = 'team-b';
    await lease!.release();
    await expect(saving).rejects.toThrow(/changed/);
    expect(adapter.publish).not.toHaveBeenCalled();
    expect(await manager.list('project')).toEqual([]);
  });

  it('checks the expected project scope after acquiring a held mutation lock', async () => {
    let identity = 'identity-a';
    let directory: string | undefined;
    const publish = vi.fn(async () => {});
    const refresh = vi.fn(async (workspace: string) => { directory = path.join(workspace, 'same-project-cache'); });
    const { manager } = await createManager({ projectMemory: {
      refresh, directory: () => directory, scope: () => identity, assertWritable: () => {}, publish,
    } });
    const expectedScope = manager.getProjectMemoryScope();
    const lease = await acquireFileLock(path.join(directory!, 'events', '.view.lock'));
    const saving = manager.store('A queued reflection belongs to its original account', 'project', [], 'turn-reflection', null, expectedScope);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    identity = 'identity-b';
    await lease!.release();

    await expect(saving).rejects.toThrow(/scope changed/i);
    expect(await manager.list('project')).toEqual([]);
    expect(publish).not.toHaveBeenCalled();
    await expect(manager.store('Personal preferences ignore project scope switches', 'user', [], 'turn-reflection', null, expectedScope)).resolves.toBeDefined();
  });

  it('preserves the creation session through updates and event-log replay', async () => {
    let sessionId = 'creation-session';
    const { manager, memoryDir } = await createManager({ getSessionId: () => sessionId });
    const entry = await manager.store('Always verify memory storage', 'project');
    expect(entry).toMatchObject({ origin: { sessionId: 'creation-session' } });
    sessionId = 'later-session';
    await manager.updateMemory(entry.id, 'Always verify canonical memory storage', 'project');
    await manager.rebuildFromEventLog('project');
    expect(await manager.get(entry.id, 'project')).toMatchObject({ origin: { sessionId: 'creation-session' } });
    const events = await new MemoryEventLog(memoryDir).readAll();
    expect(events[0]?.entry).toMatchObject({ origin: { sessionId: 'creation-session' } });
  });

  it('keeps startup available when memory initialization runs out of disk space', async () => {
    const { manager } = await createManager();
    await manager.store('Existing user preference', 'user');
    vi.spyOn(nodeFs, 'mkdir').mockRejectedValue(Object.assign(new Error('Disk full'), { code: 'ENOSPC' }));

    await expect(manager.initialize()).resolves.toBeUndefined();
    await expect(manager.getContextMemories()).resolves.toContain('Existing user preference');
  });

  it.each(['ENOSPC', 'EDQUOT'])('keeps prompt memories readable when lock creation fails with %s', async (code) => {
    const { manager } = await createManager();
    await manager.store('Keep the existing project convention', 'project');
    const storageError = Object.assign(new Error('No space left for a memory lock'), { code });
    vi.spyOn(nodeFs, 'mkdir').mockRejectedValue(storageError);

    await expect(manager.getContextMemories()).resolves.toContain('Keep the existing project convention');
    await expect(manager.store('Do not silently discard this write', 'project')).rejects.toBe(storageError);
  });

  it('falls back to bounded raw memories when a context outline cannot acquire its disk lock', async () => {
    const { manager } = await createManager();
    for (let index = 0; index < 6; index += 1) {
      await manager.store(`uniqueconvention${index} preference${index} setting${index}`, 'project');
    }
    vi.spyOn(nodeFs, 'mkdir').mockRejectedValue(Object.assign(new Error('Disk full'), { code: 'ENOSPC' }));

    const context = await manager.getContextMemories(3);

    expect(context).toContain('## Project Memories');
    expect(context.match(/^- /gm)).toHaveLength(3);
    expect(context).not.toContain('snapshot=');
  });

  it('does not hide event-log corruption behind the disk-full context fallback', async () => {
    const { manager, memoryDir } = await createManager();
    await fs.writeFile(path.join(memoryDir, 'events', 'LOG.jsonl'), '{"version":1,"broken":true}\n');

    await expect(manager.getContextMemories()).rejects.toThrow(/corrupt/i);
  });

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
