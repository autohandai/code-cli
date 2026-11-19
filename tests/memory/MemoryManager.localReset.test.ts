/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const scheduleBackgroundSync = vi.fn();
vi.mock('../../src/sync/runtimeSyncService.js', () => ({ scheduleBackgroundSync }));

const { MemoryManager } = await import('../../src/memory/MemoryManager.js');
type ProjectMemoryAdapter = import('../../src/memory/MemoryManager.js').ProjectMemoryAdapter;

const temporaryRoots: string[] = [];

async function createWorkspace(adapter?: ProjectMemoryAdapter) {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-memory-reset-'));
  temporaryRoots.push(workspaceRoot);
  const userDir = path.join(workspaceRoot, 'user-memory');
  const projectDir = path.join(workspaceRoot, '.autohand', 'memory');
  const create = () => new MemoryManager(workspaceRoot, { userMemoryDir: userDir, projectMemory: adapter });
  const manager = create();
  await manager.initialize();
  return { manager, create, workspaceRoot, userDir, projectDir };
}

async function memoryArtifacts(directory: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (current: string): Promise<void> => {
    for (const name of await fs.readdir(current)) {
      const full = path.join(current, name);
      if ((await fs.stat(full)).isDirectory()) await walk(full);
      else if (!name.endsWith('.lock')) found.push(path.relative(directory, full));
    }
  };
  if (await fs.pathExists(directory)) await walk(directory);
  return found.sort();
}

beforeEach(() => {
  scheduleBackgroundSync.mockClear();
});

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.remove(root)));
});

describe('MemoryManager local reset', () => {
  it('describes the local user and project stores with their entry counts', async () => {
    const { manager, userDir, projectDir } = await createWorkspace();
    await manager.store('Prefer pnpm', 'user');
    await manager.store('Use strict TypeScript', 'project');
    await manager.store('Run the linter before committing', 'project');

    expect(await manager.describeLocalStores()).toEqual([
      { level: 'project', directory: projectDir, entries: 2 },
      { level: 'user', directory: userDir, entries: 1 },
    ]);
  });

  it('describes only the user store when no workspace is set', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-memory-reset-'));
    temporaryRoots.push(root);
    const manager = new MemoryManager(undefined, { userMemoryDir: path.join(root, 'user-memory') });

    expect(await manager.describeLocalStores()).toEqual([
      { level: 'user', directory: path.join(root, 'user-memory'), entries: 0 },
    ]);
    await expect(manager.resetLocalStore('project')).resolves.toBe(0);
  });

  it('removes entries, the index, the event history and derived summaries of one level only', async () => {
    const { manager, userDir, projectDir } = await createWorkspace();
    await manager.store('Prefer pnpm', 'user');
    await manager.store('Use strict TypeScript', 'project');
    await manager.store('Run the linter before committing', 'project');
    await manager.getMemoryOutline('project');
    await fs.outputFile(path.join(projectDir, 'derived', 'summaries', 'project', 'stale.json'), '{}');
    expect(await memoryArtifacts(projectDir)).toContain(path.join('events', 'LOG.jsonl'));

    await expect(manager.resetLocalStore('project')).resolves.toBe(2);

    expect(await memoryArtifacts(projectDir)).toEqual([]);
    expect(await manager.list('user')).toHaveLength(1);
    expect((await memoryArtifacts(userDir)).length).toBeGreaterThan(2);
  });

  it('keeps files in the directory that are not memory artifacts', async () => {
    const { manager, userDir } = await createWorkspace();
    await manager.store('Prefer pnpm', 'user');
    await fs.outputFile(path.join(userDir, 'imported-gemini', 'GEMINI.md'), 'imported');
    await fs.outputFile(path.join(userDir, 'notes.md'), 'mine');

    await expect(manager.resetLocalStore('user')).resolves.toBe(1);

    expect(await memoryArtifacts(userDir)).toEqual([path.join('imported-gemini', 'GEMINI.md'), 'notes.md']);
  });

  it('leaves nothing for a later session to replay and keeps the store usable', async () => {
    const { manager, create, projectDir } = await createWorkspace();
    await manager.store('Use strict TypeScript', 'project');
    await manager.recordCapabilityUse({ kind: 'skill', name: 'tdd', source: 'project', origin: 'user', outcome: 'succeeded' });

    await manager.resetLocalStore('project');

    expect(await manager.list('project')).toEqual([]);
    expect(await manager.getLearnedProjectCapabilities()).toEqual([]);
    const later = create();
    await later.initialize();
    expect(await later.list('project')).toEqual([]);

    const stored = await manager.store('Fresh start', 'project');
    expect((await manager.list('project')).map((entry) => entry.id)).toEqual([stored.id]);
    expect(await fs.pathExists(path.join(projectDir, 'events', 'LOG.jsonl'))).toBe(true);
  });

  it('never schedules a sync, so a reset cannot propagate beyond this machine', async () => {
    const { manager } = await createWorkspace();
    await manager.store('Prefer pnpm', 'user');
    scheduleBackgroundSync.mockClear();

    await manager.resetLocalStore('user');
    await manager.resetLocalStore('project');

    expect(scheduleBackgroundSync).not.toHaveBeenCalled();
  });

  it('clears only the local project directory when the project is shared with a team', async () => {
    const team: { directory?: string } = {};
    const adapter: ProjectMemoryAdapter = {
      refresh: vi.fn(async () => {}),
      publish: vi.fn(async () => {}),
      directory: () => team.directory,
      assertWritable: vi.fn(),
    };
    const { manager, workspaceRoot, projectDir } = await createWorkspace(adapter);
    await manager.store('Local before the team was connected', 'project');
    team.directory = path.join(workspaceRoot, 'team-cache');
    const shared = await manager.store('Team convention', 'project');
    const sharedBefore = await memoryArtifacts(team.directory);
    vi.mocked(adapter.refresh).mockClear();
    vi.mocked(adapter.publish).mockClear();

    expect((await manager.describeLocalStores())[0]).toEqual({ level: 'project', directory: projectDir, entries: 1 });
    await expect(manager.resetLocalStore('project')).resolves.toBe(1);

    expect(await memoryArtifacts(projectDir)).toEqual([]);
    expect(await memoryArtifacts(team.directory)).toEqual(sharedBefore);
    expect(adapter.refresh).not.toHaveBeenCalled();
    expect(adapter.publish).not.toHaveBeenCalled();
    expect((await manager.list('project')).map((entry) => entry.id)).toEqual([shared.id]);
  });

  it('returns zero for a store that was never created', async () => {
    const { manager, projectDir } = await createWorkspace();
    await fs.remove(projectDir);

    await expect(manager.resetLocalStore('project')).resolves.toBe(0);
    expect(await fs.pathExists(projectDir)).toBe(false);
  });
});
