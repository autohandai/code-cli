import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AhTracesDaemon } from '../../src/traces/daemon/AhTracesDaemon.js';
import { NodeAhTracesSupervisorHost } from '../../src/traces/supervisor/NodeAhTracesSupervisorHost.js';
import type { AhTracesRuntimePaths } from '../../src/traces/runtimePaths.js';

const roots: string[] = [];

async function createPaths(): Promise<AhTracesRuntimePaths> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahtraces-daemon-test-'));
  roots.push(root);
  return {
    directory: root,
    stateFile: path.join(root, 'daemon.json'),
    daemonLock: path.join(root, 'daemon.lock'),
    supervisorLock: path.join(root, 'supervisor.lock'),
    checkpointsFile: path.join(root, 'checkpoints.json'),
    workMapFile: path.join(root, 'work-map.json'),
    socketPath: path.join(root, 'control.sock'),
  };
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => fs.remove(root)));
});

describe('AhTracesDaemon', () => {
  it('authenticates control requests, refreshes the monitor, and removes runtime state on shutdown', async () => {
    const paths = await createPaths();
    const monitor = {
      start: vi.fn(async () => {}),
      refreshConfig: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
    };
    const daemon = new AhTracesDaemon({
      paths,
      version: '0.8.2:abc123',
      protocolVersion: 1,
      configPath: '/tmp/config.json',
      instanceId: 'instance-1',
      controlToken: 'control-token-1234567890',
      monitor,
    });
    await daemon.start();
    const host = new NodeAhTracesSupervisorHost({ paths, launch: async () => {
      throw new Error('not used');
    } });
    const state = await host.readState();

    expect(state).toMatchObject({
      pid: process.pid,
      instanceId: 'instance-1',
      version: '0.8.2:abc123',
      protocolVersion: 1,
      configPath: '/tmp/config.json',
    });
    await expect(host.request(state!, { type: 'ping' })).resolves.toMatchObject({
      ok: true,
      state: { instanceId: 'instance-1' },
    });
    await expect(host.request({ ...state!, controlToken: 'wrong-token' }, { type: 'ping' }))
      .resolves.toEqual({ ok: false, error: 'Unauthorized control request' });
    await expect(host.request(state!, { type: 'refresh-config' })).resolves.toEqual({ ok: true });
    expect(monitor.refreshConfig).toHaveBeenCalledOnce();

    await expect(host.request(state!, { type: 'shutdown' })).resolves.toEqual({ ok: true });
    await daemon.waitUntilStopped();

    expect(monitor.stop).toHaveBeenCalledOnce();
    expect(await fs.pathExists(paths.stateFile)).toBe(false);
    expect(await fs.pathExists(paths.socketPath)).toBe(false);
  });

  it('keeps a second daemon from acquiring the single-instance lease', async () => {
    const paths = await createPaths();
    const monitor = {
      start: vi.fn(async () => {}),
      refreshConfig: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
    };
    const first = new AhTracesDaemon({
      paths,
      version: 'current',
      protocolVersion: 1,
      configPath: '/tmp/config.json',
      instanceId: 'first',
      controlToken: 'first-token-1234567890',
      monitor,
    });
    const second = new AhTracesDaemon({
      paths,
      version: 'current',
      protocolVersion: 1,
      instanceId: 'second',
      controlToken: 'second-token-1234567890',
      monitor,
    });

    await first.start();
    await expect(second.start()).rejects.toThrow('already running');
    await first.stop();
  });

  it('acknowledges configuration refresh before a monitor rescan completes', async () => {
    const paths = await createPaths();
    let finishRefresh: (() => void) | undefined;
    const monitor = {
      start: vi.fn(async () => {}),
      refreshConfig: vi.fn(() => new Promise<void>((resolve) => {
        finishRefresh = resolve;
      })),
      stop: vi.fn(async () => {}),
    };
    const daemon = new AhTracesDaemon({
      paths,
      version: '0.8.2:abc123',
      protocolVersion: 1,
      configPath: '/tmp/config.json',
      instanceId: 'instance-refresh',
      controlToken: 'control-token-1234567890',
      monitor,
    });
    await daemon.start();
    const host = new NodeAhTracesSupervisorHost({ paths, launch: async () => {
      throw new Error('not used');
    } });
    const state = await host.readState();

    const response = await Promise.race([
      host.request(state!, { type: 'refresh-config' }),
      new Promise<'timed-out'>((resolve) => setTimeout(() => resolve('timed-out'), 50)),
    ]);

    expect(response).toEqual({ ok: true });
    finishRefresh?.();
    await daemon.stop();
  });
});
