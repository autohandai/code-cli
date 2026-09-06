/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoalManager } from '../../src/goals/GoalManager.js';
import type { GoalSessionSnapshot } from '../../src/goals/types.js';
import { enqueueGoalFromAnotherProcess } from '../../src/testing/scenarios/goalPanelScenario.js';

describe('goal snapshot subscriptions', () => {
  let workspaceRoot: string;
  let unsubscribers: Array<() => void>;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-goal-subscription-'));
    unsubscribers = [];
  });

  afterEach(async () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
    vi.restoreAllMocks();
    await fs.remove(workspaceRoot);
  });

  it('observes atomic writes from a separate process without local mutations', async () => {
    const listener = vi.fn();
    unsubscribers.push(new GoalManager(workspaceRoot, { sessionId: 'observer' }).subscribe(listener));
    await vi.waitFor(() => expect(listener).toHaveBeenCalled());
    await enqueueGoalFromAnotherProcess(workspaceRoot, 'REMOTE_QUEUE_UPDATE');
    await vi.waitFor(() => expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({
      sessionId: 'observer', queue: [expect.objectContaining({ objective: 'REMOTE_QUEUE_UPDATE' })],
    })), { timeout: 4000 });
  });

  it('refreshes elapsed time and owner liveness without writing state', async () => {
    let alive = true;
    const manager = new GoalManager(workspaceRoot, { sessionId: 'observer', isSessionAlive: async () => alive });
    await manager.createGoal({ objective: 'watch the clock' });
    await new GoalManager(workspaceRoot, { sessionId: 'peer' }).createGoal({ objective: 'peer work' });
    const statePath = path.join(workspaceRoot, '.autohand', 'goals.local.json');
    const saved = await fs.readFile(statePath, 'utf8');
    const snapshots: GoalSessionSnapshot[] = [];
    unsubscribers.push(manager.subscribe((snapshot) => snapshots.push(snapshot)));
    await vi.waitFor(() => expect(snapshots[0]?.peers[0]?.ownerAlive).toBe(true));
    alive = false;
    await vi.waitFor(() => {
      expect(snapshots.at(-1)?.goal?.timeUsedSeconds).toBeGreaterThanOrEqual(1);
      expect(snapshots.at(-1)?.peers[0]?.ownerAlive).toBe(false);
    }, { timeout: 4000 });
    expect(await fs.readFile(statePath, 'utf8')).toBe(saved);
  });

  it('shares one disposable unreferenced poller and suppresses unchanged empty snapshots', async () => {
    const start = vi.spyOn(globalThis, 'setInterval');
    const stop = vi.spyOn(globalThis, 'clearInterval');
    const first = vi.fn();
    const second = vi.fn();
    const manager = new GoalManager(workspaceRoot);
    const unsubscribeFirst = manager.subscribe(first);
    const unsubscribeSecond = manager.subscribe(second);
    unsubscribers.push(unsubscribeFirst, unsubscribeSecond);
    await vi.waitFor(() => expect(second).toHaveBeenCalledOnce());
    expect(start).toHaveBeenCalledTimes(1);
    const timer = start.mock.results[0].value as NodeJS.Timeout;
    expect(timer.hasRef()).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 2200));
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    unsubscribeFirst();
    expect(stop).not.toHaveBeenCalledWith(timer);
    unsubscribeSecond();
    expect(stop).toHaveBeenCalledWith(timer);
  });

  it('does not deliver an in-flight read after unsubscribe', async () => {
    await new GoalManager(workspaceRoot, { sessionId: 'peer' }).createGoal({ objective: 'peer work' });
    const pending = Promise.withResolvers<boolean>();
    const probe = vi.fn(() => pending.promise);
    const listener = vi.fn();
    const manager = new GoalManager(workspaceRoot, { sessionId: 'observer', isSessionAlive: probe });
    const unsubscribe = manager.subscribe(listener);
    unsubscribers.push(unsubscribe);
    await vi.waitFor(() => expect(probe).toHaveBeenCalled());
    unsubscribe();
    pending.resolve(false);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps the last valid view with a visible storage error until storage is repaired', async () => {
    const manager = new GoalManager(workspaceRoot, { sessionId: 'observer' });
    await manager.createGoal({ objective: 'preserve the visible goal' });
    await manager.updateGoal({ status: 'paused' });
    const listener = vi.fn();
    unsubscribers.push(manager.subscribe(listener));
    await vi.waitFor(() => expect(listener).toHaveBeenCalled());
    const statePath = path.join(workspaceRoot, '.autohand', 'goals.local.json');
    const saved = await fs.readFile(statePath, 'utf8');
    await fs.writeFile(statePath, '{broken');
    await vi.waitFor(() => expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({
      goal: expect.objectContaining({ objective: 'preserve the visible goal' }),
      storageError: expect.stringContaining('Goal storage'),
    })), { timeout: 4000 });
    expect(await fs.readFile(statePath, 'utf8')).toBe('{broken');
    await fs.writeFile(statePath, saved);
    await vi.waitFor(() => expect(listener.mock.calls.at(-1)?.[0]).not.toHaveProperty('storageError'), { timeout: 4000 });
  });

  it('does not keep a separate subscribing process alive', async () => {
    const moduleUrl = new URL('../../src/goals/GoalManager.ts', import.meta.url).href;
    const result = await promisify(execFile)(process.execPath, [
      '--import', 'tsx', '--input-type=module', '--eval',
      `import { GoalManager } from ${JSON.stringify(moduleUrl)};
       new GoalManager(process.argv[1]).subscribe(() => console.log('OBSERVED'));`,
      workspaceRoot,
    ], { timeout: 5000 });
    expect(result.stdout).toContain('OBSERVED');
  });

  it('coalesces slow reads and catches up after a write during an in-flight refresh', async () => {
    await new GoalManager(workspaceRoot, { sessionId: 'peer' }).createGoal({ objective: 'peer work' });
    const pending = Promise.withResolvers<boolean>();
    const probe = vi.fn(() => pending.promise);
    const listener = vi.fn();
    unsubscribers.push(new GoalManager(workspaceRoot, { sessionId: 'observer', isSessionAlive: probe }).subscribe(listener));
    await vi.waitFor(() => expect(probe).toHaveBeenCalledOnce());
    await enqueueGoalFromAnotherProcess(workspaceRoot, 'WRITE_DURING_READ');
    await new Promise((resolve) => setTimeout(resolve, 2100));
    expect(probe).toHaveBeenCalledOnce();
    pending.resolve(false);
    await vi.waitFor(() => expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({
      queue: [expect.objectContaining({ objective: 'WRITE_DURING_READ' })],
    })));
  });

  it('refreshes a lazily switched owner and does not reuse the previous owner view on error', async () => {
    const owner = new GoalManager(workspaceRoot, { sessionId: 'original' });
    await owner.createGoal({ objective: 'original work' });
    await owner.updateGoal({ status: 'paused' });
    let sessionId = 'original';
    const listener = vi.fn();
    unsubscribers.push(new GoalManager(workspaceRoot, {
      getSessionId: () => sessionId, isSessionAlive: async () => false,
    }).subscribe(listener));
    await vi.waitFor(() => expect(listener.mock.calls.at(-1)?.[0].goal?.objective).toBe('original work'));
    sessionId = 'new-owner';
    await fs.writeFile(path.join(workspaceRoot, '.autohand', 'goals.local.json'), '{broken');
    await vi.waitFor(() => expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({
      sessionId: 'new-owner', goal: null, storageError: expect.any(String),
    })), { timeout: 4000 });
    await owner.repairSnapshot();
    await vi.waitFor(() => expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({
      sessionId: 'new-owner', goal: null, peers: [expect.objectContaining({ sessionId: 'original' })],
    })));
    expect(listener.mock.calls.at(-1)?.[0]).not.toHaveProperty('storageError');
  });

  it('discards an old-owner snapshot when the session switches during a liveness read', async () => {
    await new GoalManager(workspaceRoot, { sessionId: 'original' }).createGoal({ objective: 'original work' });
    await new GoalManager(workspaceRoot, { sessionId: 'restored' }).createGoal({ objective: 'restored work' });
    const pending = Promise.withResolvers<boolean>();
    const probe = vi.fn(() => pending.promise);
    let sessionId = 'original';
    const listener = vi.fn();
    unsubscribers.push(new GoalManager(workspaceRoot, { getSessionId: () => sessionId, isSessionAlive: probe }).subscribe(listener));
    await vi.waitFor(() => expect(probe).toHaveBeenCalledOnce());
    sessionId = 'restored';
    pending.resolve(false);
    await vi.waitFor(() => expect(listener).toHaveBeenCalled());
    expect(listener.mock.calls.every(([view]) => view.sessionId === 'restored')).toBe(true);
    expect(listener.mock.calls.at(-1)?.[0].goal?.objective).toBe('restored work');
  });
});
