/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readSquadRunSnapshot, SquadRunMonitor } from '../../../src/core/agents/SquadRunSnapshot.js';
import { AgentRunStore } from '../../../src/core/agents/AgentRunStore.js';

describe('Squad run snapshots', () => {
  let root: string;
  let workspace: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'squad-run-view-'));
    workspace = path.join(root, 'workspace');
    await fs.mkdir(workspace);
    await fs.mkdir(path.join(root, 'runs'));
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  const record = (workspacePath: string) => ({
    id: 'run-1', status: 'running', prompt: 'Review the API', workspace: workspacePath,
    agentId: 'reviewer', command: ['autohand', '--secret', 'never-display'],
    logPath: '/private/never-read.log', createdAt: '2026-09-05T10:00:00Z',
    startedAt: '2026-09-05T10:00:01Z', completedAt: null, exitCode: null,
    channelId: 'channel-a', threadId: 'thread-a',
  });
  const read = () => readSquadRunSnapshot({ workspaceRoot: workspace, env: { AUTOHAND_SQUAD_HOME: root } });

  it('reads native recorded states only for the selected workspace', async () => {
    await fs.writeFile(path.join(root, 'runs', '1.json'), JSON.stringify(record(workspace)));
    await fs.writeFile(path.join(root, 'runs', '2.json'), JSON.stringify({ ...record('/different/repo'), id: 'other' }));
    const result = await read();
    expect(result.available).toBe(true);
    expect(result.runs).toEqual([{
      id: 'run-1', agentName: 'reviewer', task: 'Review the API', status: 'running',
      createdAt: Date.parse('2026-09-05T10:00:00Z'), startedAt: Date.parse('2026-09-05T10:00:01Z'),
      channelId: 'channel-a', threadId: 'thread-a',
    }]);
    expect(JSON.stringify(result)).not.toContain('never-');
    expect(result.message).toContain('independent sessions');
    expect(result.message).toContain('recorded');
  });

  it('does not label missing daemon state as successful work', async () => {
    const result = await readSquadRunSnapshot({ workspaceRoot: workspace, env: { AUTOHAND_SQUAD_HOME: path.join(root, 'absent') } });
    expect(result).toMatchObject({ available: false, runs: [] });
    expect(result.message).toContain('unavailable');
  });

  it('skips invalid, oversized and symlink records without following log paths', async () => {
    await fs.writeFile(path.join(root, 'runs', 'broken.json'), '{');
    await fs.writeFile(path.join(root, 'runs', 'large.json'), ' '.repeat(70_000));
    await fs.writeFile(path.join(root, 'outside.json'), JSON.stringify(record(workspace)));
    await fs.symlink(path.join(root, 'outside.json'), path.join(root, 'runs', 'link.json'));
    const result = await read();
    expect(result.runs).toEqual([]);
    expect(result.message).toContain('skipped');
  });

  it('preserves terminal outcomes, omits unknown model/usage, and strips control text', async () => {
    await fs.writeFile(path.join(root, 'runs', 'done.json'), JSON.stringify({
      ...record(workspace), status: 'failed', prompt: 'Review\u001b[31m RED\u001b[0m\u0007',
      completedAt: '2026-09-05T10:01:00Z', exitCode: 1,
    }));
    const result = await read();
    expect(result.runs[0]).toMatchObject({ status: 'failed', task: 'Review RED', exitCode: 1, completedAt: Date.parse('2026-09-05T10:01:00Z') });
    expect(result.runs[0]).not.toHaveProperty('model');
    expect(result.runs[0]).not.toHaveProperty('usage');
  });

  it('bounds results and orders the most recent first', async () => {
    for (let i = 0; i < 5; i++) {
      await fs.writeFile(path.join(root, 'runs', `${i}.json`), JSON.stringify({
        ...record(workspace), id: `run-${i}`, createdAt: new Date(Date.UTC(2026, 8, 5, 10, i)).toISOString(),
      }));
    }
    const result = await readSquadRunSnapshot({ workspaceRoot: workspace, env: { AUTOHAND_SQUAD_HOME: root }, limit: 2 });
    expect(result.runs.map(run => run.id)).toEqual(['run-4', 'run-3']);
  });

  it('ignores records with missing workspace, unknown status or invalid timestamp', async () => {
    for (const [index, changes] of [{ workspace: null }, { status: 'made-up' }, { createdAt: 'invalid' }].entries()) {
      await fs.writeFile(path.join(root, 'runs', `${index}.json`), JSON.stringify({ ...record(workspace), ...changes }));
    }
    expect((await read()).runs).toEqual([]);
  });

  it('updates external inspector rows without consuming or replacing internal runs', async () => {
    await fs.writeFile(path.join(root, 'runs', 'done.json'), JSON.stringify({ ...record(workspace), status: 'rejected' }));
    const store = new AgentRunStore();
    store.start({ id: 'lead-child', source: 'delegate', name: 'tester', task: 'Test' });
    const monitor = new SquadRunMonitor(store, { workspaceRoot: workspace, env: { AUTOHAND_SQUAD_HOME: root } });
    await monitor.refresh();
    expect(store.getSnapshot().runs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'lead-child', source: 'delegate' }),
      expect.objectContaining({ id: 'squad:run-1', source: 'squad', status: 'failed', cancellable: false }),
    ]));
    expect(store.getSnapshot().externalStatus).toContain('independent sessions');
    monitor.stop();
  });

  it('pauses polling when hidden and stops permanently at shutdown', async () => {
    vi.useFakeTimers();
    try {
      let visible = false;
      const controller = new AbortController();
      const store = new AgentRunStore();
      const update = vi.spyOn(store, 'replaceExternal');
      const monitor = new SquadRunMonitor(store, {
        workspaceRoot: workspace, env: { AUTOHAND_SQUAD_HOME: root },
        isVisible: () => visible, signal: controller.signal,
      });
      monitor.start();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(update).not.toHaveBeenCalled();
      visible = true;
      await monitor.refresh();
      expect(update).toHaveBeenCalledOnce();
      controller.abort();
      await vi.advanceTimersByTimeAsync(10_000);
      await monitor.refresh();
      expect(update).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
