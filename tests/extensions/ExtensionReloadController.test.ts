/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { watch } from 'node:fs';
import { EXTENSION_RELOAD_LIFECYCLE, ExtensionReloadController } from '../../src/extensions/ExtensionReloadController.js';
import { reachableStates, StateMachine, terminalStates } from '../../src/utils/stateMachine.js';
import { randomEventWalk } from '../helpers/stateMachineProperties.js';

const watchers = vi.hoisted(() => new Map<string, { root: string; change: (event: string, file: string) => void; close: ReturnType<typeof vi.fn> }>());
vi.mock('node:fs', async (original) => ({
  ...await original<typeof import('node:fs')>(),
  watch: vi.fn((root: string, _options: unknown, change: (event: string, file: string) => void) => {
    const watcher = { root, change, close: vi.fn(), on: vi.fn().mockReturnThis(), unref: vi.fn() };
    watchers.set(root, watcher);
    return watcher;
  }),
}));

describe('ExtensionReloadController', () => {
  const roots: string[] = [];
  const controllers: ExtensionReloadController[] = [];
  afterEach(async () => {
    for (const controller of controllers.splice(0)) await controller.stop();
    vi.useRealTimers();
    watchers.clear();
    vi.mocked(watch).mockClear();
    await Promise.all(roots.splice(0).map((root) => fs.remove(root)));
  });

  async function setup(isIdle = () => true, reload = vi.fn(async () => {})) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-live-watch-'));
    roots.push(root);
    const abort = new AbortController();
    const controller = new ExtensionReloadController({ roots: [root], isIdle, reload, signal: abort.signal });
    controllers.push(controller);
    await controller.start();
    return { root, controller, abort, reload };
  }

  it('records discovered packages without starting watchers before session initialization', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-watch-not-started-'));
    roots.push(root);
    const controller = new ExtensionReloadController({ roots: [root], isIdle: () => true, reload: async () => {} });
    controllers.push(controller);
    await controller.setPackageRoots([root]);
    expect(watchers.size).toBe(0);
    await controller.start();
    expect(watchers.has(root)).toBe(true);
  });

  it('coalesces build events and waits until the current turn and modal finish', async () => {
    let idle = false;
    const { root, reload } = await setup(() => idle);
    vi.useFakeTimers();
    const baseline = vi.getTimerCount();
    watchers.get(root)?.change('change', 'autohand.demo/dist/main.mjs');
    watchers.get(root)?.change('rename', 'autohand.demo/dist/main.mjs');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(reload).not.toHaveBeenCalled();
    idle = true;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(baseline);
  });

  it('ignores atomic installation staging and closes watchers and pending timers on abort', async () => {
    const { root, abort, reload, controller } = await setup();
    vi.useFakeTimers();
    const baseline = vi.getTimerCount();
    watchers.get(root)?.change('rename', '.tmp-install/runtime.mjs');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(reload).not.toHaveBeenCalled();
    watchers.get(root)?.change('change', '.state/autohand.demo.json');
    abort.abort();
    await controller.stop();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(reload).not.toHaveBeenCalled();
    expect(watchers.get(root)?.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(baseline);
  });

  it('creates missing extension storage and follows linked package sources without watching the workspace tree', async () => {
    const { root, controller } = await setup();
    const source = path.join(root, 'source');
    await fs.ensureDir(source);
    await controller.setPackageRoots([source]);
    expect(watchers.has(source)).toBe(true);
    const missing = path.join(root, 'missing', 'extensions');
    const reload = vi.fn(async () => {});
    const missingController = new ExtensionReloadController({ roots: [missing], isIdle: () => true, reload });
    controllers.push(missingController);
    await missingController.start();
    expect(await fs.pathExists(missing)).toBe(true);
    expect(watchers.has(missing)).toBe(true);
    vi.useFakeTimers();
    watchers.get(root)?.change('change', 'unrelated.txt');
    await vi.advanceTimersByTimeAsync(500);
    expect(reload).not.toHaveBeenCalled();
    watchers.get(missing)?.change('rename', 'autohand.new');
    await vi.advanceTimersByTimeAsync(500);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('keeps one refresh in flight and drains a later edit without leaking timers', async () => {
    let finish: (() => void) | undefined;
    const reload = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const { root, controller } = await setup(() => true, reload);
    vi.useFakeTimers();
    const baseline = vi.getTimerCount();
    watchers.get(root)?.change('change', 'autohand.demo/main.mjs');
    await vi.advanceTimersByTimeAsync(500);
    expect(reload).toHaveBeenCalledTimes(1);
    watchers.get(root)?.change('change', 'autohand.demo/main.mjs');
    await vi.advanceTimersByTimeAsync(500);
    expect(reload).toHaveBeenCalledTimes(1);
    finish?.();
    await vi.advanceTimersByTimeAsync(500);
    expect(reload).toHaveBeenCalledTimes(2);
    const stopped = controller.stop();
    finish?.();
    await stopped;
    expect(vi.getTimerCount()).toBe(baseline);
  });
  it('admits commands and model turns only after a running reload and holds later edits until they finish', async () => {
    let finishReload: (() => void) | undefined;
    const reload = vi.fn(() => new Promise<void>((resolve) => { finishReload = resolve; }));
    const { root, controller } = await setup(() => true, reload);
    vi.useFakeTimers();
    watchers.get(root)?.change('change', 'autohand.demo/main.mjs');
    await vi.advanceTimersByTimeAsync(500);
    let finishTurn: (() => void) | undefined;
    const turn = vi.fn(() => new Promise<void>((resolve) => { finishTurn = resolve; }));
    const runningTurn = controller.withStableExtensions(turn);
    expect(turn).not.toHaveBeenCalled();
    finishReload?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(turn).toHaveBeenCalledOnce();
    watchers.get(root)?.change('change', 'autohand.demo/main.mjs');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(reload).toHaveBeenCalledTimes(1);
    finishTurn?.();
    await runningTurn;
    await vi.advanceTimersByTimeAsync(500);
    expect(reload).toHaveBeenCalledTimes(2);
    const stopped = controller.stop();
    finishReload?.();
    await stopped;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('starts once when start is called concurrently', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-watch-double-start-'));
    roots.push(root);
    const controller = new ExtensionReloadController({ roots: [root], isIdle: () => true, reload: async () => {} });
    controllers.push(controller);

    await Promise.all([controller.start(), controller.start()]);

    expect(vi.mocked(watch).mock.calls.filter(([watched]) => watched === root)).toHaveLength(1);
  });

  it('watches the most recently requested package roots when updates overlap', async () => {
    const { root, controller } = await setup();
    const [first, extra, second] = ['first', 'extra', 'second'].map((name) => path.join(root, name));
    await Promise.all([first, extra, second].map((dir) => fs.ensureDir(dir)));
    vi.mocked(watch).mockClear();

    await Promise.all([controller.setPackageRoots([first, extra]), controller.setPackageRoots([second])]);

    const created = vi.mocked(watch).mock.results.map((result) => result.value as { root: string; close: ReturnType<typeof vi.fn> });
    const open = created.filter((watcher) => watcher.close.mock.calls.length === 0).map((watcher) => watcher.root);
    expect(open).toEqual([second]);
    expect(new Set(created.map((watcher) => watcher.root)).size).toBe(created.length);

    await controller.stop();
    expect(created.every((watcher) => watcher.close.mock.calls.length === 1)).toBe(true);
  });

  it('never starts watching after stop wins a race with start', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-watch-stop-race-'));
    roots.push(root);
    const controller = new ExtensionReloadController({ roots: [root], isIdle: () => true, reload: async () => {} });
    const starting = controller.start();
    await controller.stop();
    await starting;
    await controller.start();
    await controller.setPackageRoots([root]);
    expect(watch).not.toHaveBeenCalled();
  });
});

describe('extension reload lifecycle table', () => {
  it('only moves forward from idle through starting and watching to stopped', () => {
    const machine = new StateMachine(EXTENSION_RELOAD_LIFECYCLE);
    expect(machine.send('start')).toBe('starting');
    expect(machine.can('start')).toBe(false);
    expect(machine.send('ready')).toBe('watching');
    expect(machine.can('start')).toBe(false);
    expect(machine.send('stop')).toBe('stopped');
    expect(terminalStates(EXTENSION_RELOAD_LIFECYCLE)).toEqual(['stopped']);
    expect([...reachableStates(EXTENSION_RELOAD_LIFECYCLE)].sort()).toEqual(['idle', 'starting', 'stopped', 'watching']);
    for (const from of ['idle', 'starting'] as const) {
      expect(new StateMachine(EXTENSION_RELOAD_LIFECYCLE, { initial: from }).send('stop')).toBe('stopped');
    }
    expect(new StateMachine(EXTENSION_RELOAD_LIFECYCLE).can('ready')).toBe(false);
  });

  it('accepts exactly the table edges for any event sequence', () => {
    randomEventWalk(EXTENSION_RELOAD_LIFECYCLE, ['start', 'ready', 'stop'], { seeds: 50, steps: 40 });
  });
});
