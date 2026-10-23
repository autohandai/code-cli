/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExtensionReloadController } from '../../src/extensions/ExtensionReloadController.js';

const watchers = vi.hoisted(() => new Map<string, { change: (event: string, file: string) => void; close: ReturnType<typeof vi.fn> }>());
vi.mock('node:fs', async (original) => ({
  ...await original<typeof import('node:fs')>(),
  watch: vi.fn((root: string, _options: unknown, change: (event: string, file: string) => void) => {
    const watcher = { change, close: vi.fn(), on: vi.fn().mockReturnThis(), unref: vi.fn() };
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

});
