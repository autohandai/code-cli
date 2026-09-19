import { describe, expect, it, vi } from 'vitest';
import {
  AhTracesSupervisor,
  matchesAhTracesDaemonIdentity,
  type AhTracesDaemonState,
  type AhTracesSupervisorHost,
} from '../../src/traces/supervisor/AhTracesSupervisor.js';

function daemonState(overrides: Partial<AhTracesDaemonState> = {}): AhTracesDaemonState {
  return {
    pid: 123,
    instanceId: 'instance-current',
    version: '0.8.2:abc123',
    protocolVersion: 1,
    configPath: '/tmp/config.json',
    socketPath: '/tmp/ahtraces.sock',
    controlToken: 'control-token',
    startedAt: '2026-09-18T00:00:00.000Z',
    ...overrides,
  };
}

function hostWithState(current: AhTracesDaemonState | null): AhTracesSupervisorHost & {
  readState: ReturnType<typeof vi.fn>;
  request: ReturnType<typeof vi.fn>;
  launch: ReturnType<typeof vi.fn>;
  waitForTermination: ReturnType<typeof vi.fn>;
  forceTerminate: ReturnType<typeof vi.fn>;
  clearLocalData: ReturnType<typeof vi.fn>;
} {
  return {
    readState: vi.fn(async () => current),
    request: vi.fn(async (_state, command) => (
      command.type === 'ping'
        ? { ok: true, state: current ?? undefined }
        : { ok: true }
    )),
    launch: vi.fn(async () => daemonState()),
    waitForTermination: vi.fn(async () => true),
    forceTerminate: vi.fn(async () => {}),
    clearLocalData: vi.fn(async () => {}),
    withReconcileLock: vi.fn(async (operation: () => Promise<unknown>) => operation()),
  };
}

describe('AhTracesSupervisor', () => {
  it('matches daemon identity only when both instance ID and control token agree', () => {
    const persisted = daemonState();

    expect(matchesAhTracesDaemonIdentity(persisted, { ...persisted })).toBe(true);
    expect(matchesAhTracesDaemonIdentity(persisted, { ...persisted, instanceId: 'replacement' })).toBe(false);
    expect(matchesAhTracesDaemonIdentity(persisted, { ...persisted, controlToken: 'replacement-token' })).toBe(false);
    expect(matchesAhTracesDaemonIdentity(persisted, undefined)).toBe(false);
  });

  it('refreshes exactly one current daemon without launching another process', async () => {
    const host = hostWithState(daemonState());
    const supervisor = new AhTracesSupervisor(host, {
      version: '0.8.2:abc123',
      protocolVersion: 1,
      configPath: '/tmp/config.json',
    });

    await expect(supervisor.reconcile({ enabled: true })).resolves.toEqual({
      status: 'running',
      pid: 123,
      restarted: false,
    });
    expect(host.request).toHaveBeenNthCalledWith(1, expect.anything(), { type: 'ping' });
    expect(host.request).toHaveBeenNthCalledWith(2, expect.anything(), { type: 'refresh-config' });
    expect(host.launch).not.toHaveBeenCalled();
  });

  it('restarts a current daemon when it rejects the refreshed configuration', async () => {
    const current = daemonState();
    const host = hostWithState(current);
    host.request.mockImplementation(async (_state, command) => {
      if (command.type === 'ping') return { ok: true, state: current };
      if (command.type === 'refresh-config') return { ok: false, error: 'invalid config' };
      return { ok: true };
    });
    const supervisor = new AhTracesSupervisor(host, {
      version: '0.8.2:abc123',
      protocolVersion: 1,
      configPath: '/tmp/config.json',
    });

    await expect(supervisor.reconcile({ enabled: true })).resolves.toMatchObject({
      status: 'running',
      restarted: true,
    });
    expect(host.request).toHaveBeenNthCalledWith(2, current, { type: 'refresh-config' });
    expect(host.request).toHaveBeenCalledWith(current, { type: 'shutdown' });
    expect(host.launch).toHaveBeenCalledOnce();
  });

  it('stops the daemon when the master traces setting is disabled', async () => {
    const host = hostWithState(daemonState());
    const supervisor = new AhTracesSupervisor(host, {
      version: '0.8.2:abc123',
      protocolVersion: 1,
      configPath: '/tmp/config.json',
    });

    await expect(supervisor.reconcile({ enabled: false })).resolves.toEqual({ status: 'disabled' });
    expect(host.request).toHaveBeenCalledWith(expect.anything(), { type: 'shutdown' });
    expect(host.clearLocalData).toHaveBeenCalledOnce();
    expect(host.request.mock.invocationCallOrder.at(-1)).toBeLessThan(
      host.clearLocalData.mock.invocationCallOrder[0],
    );
    expect(host.launch).not.toHaveBeenCalled();
  });

  it('clears persisted Work Map state when monitoring is disabled without a running daemon', async () => {
    const host = hostWithState(null);
    const supervisor = new AhTracesSupervisor(host, {
      version: '0.8.2:abc123',
      protocolVersion: 1,
      configPath: '/tmp/config.json',
    });

    await expect(supervisor.reconcile({ enabled: false })).resolves.toEqual({ status: 'disabled' });

    expect(host.clearLocalData).toHaveBeenCalledOnce();
  });

  it('replaces an authenticated outdated daemon before launching the current version', async () => {
    const outdated = daemonState({ version: '0.8.1:old' });
    const host = hostWithState(outdated);
    host.request.mockImplementation(async (_state, command) => (
      command.type === 'ping'
        ? { ok: true, state: outdated }
        : { ok: false, error: 'shutdown timeout' }
    ));
    const supervisor = new AhTracesSupervisor(host, {
      version: '0.8.2:abc123',
      protocolVersion: 1,
      configPath: '/tmp/config.json',
    });

    await expect(supervisor.reconcile({ enabled: true })).resolves.toMatchObject({
      status: 'running',
      restarted: true,
    });
    expect(host.forceTerminate).toHaveBeenCalledWith(outdated);
    expect(host.forceTerminate.mock.invocationCallOrder[0]).toBeLessThan(host.launch.mock.invocationCallOrder[0]);
  });

  it('replaces an authenticated daemon that belongs to a different config file', async () => {
    const otherConfig = daemonState({ configPath: '/tmp/other-config.json' });
    const host = hostWithState(otherConfig);
    const supervisor = new AhTracesSupervisor(host, {
      version: '0.8.2:abc123',
      protocolVersion: 1,
      configPath: '/tmp/config.json',
    });

    await expect(supervisor.reconcile({ enabled: true })).resolves.toMatchObject({
      status: 'running',
      restarted: true,
    });
    expect(host.request).toHaveBeenCalledWith(otherConfig, { type: 'shutdown' });
    expect(host.waitForTermination).toHaveBeenCalledWith(otherConfig);
    expect(host.waitForTermination.mock.invocationCallOrder[0]).toBeLessThan(
      host.launch.mock.invocationCallOrder[0],
    );
    expect(host.launch).toHaveBeenCalledOnce();
  });

  it('force terminates an authenticated daemon that misses its graceful shutdown deadline', async () => {
    const outdated = daemonState({ version: '0.8.1:old' });
    const host = hostWithState(outdated);
    host.waitForTermination.mockResolvedValue(false);
    const supervisor = new AhTracesSupervisor(host, {
      version: '0.8.2:abc123',
      protocolVersion: 1,
      configPath: '/tmp/config.json',
    });

    await expect(supervisor.reconcile({ enabled: true })).resolves.toMatchObject({
      status: 'running',
      restarted: true,
    });

    expect(host.waitForTermination).toHaveBeenCalledWith(outdated);
    expect(host.forceTerminate).toHaveBeenCalledWith(outdated);
    expect(host.forceTerminate.mock.invocationCallOrder[0]).toBeLessThan(
      host.launch.mock.invocationCallOrder[0],
    );
  });

  it('coalesces concurrent startup supervision into one launch', async () => {
    const host = hostWithState(null);
    let release: ((state: AhTracesDaemonState) => void) | undefined;
    host.launch.mockImplementation(() => new Promise((resolve) => {
      release = resolve;
    }));
    const supervisor = new AhTracesSupervisor(host, {
      version: '0.8.2:abc123',
      protocolVersion: 1,
      configPath: '/tmp/config.json',
    });

    const first = supervisor.reconcile({ enabled: true });
    const second = supervisor.reconcile({ enabled: true });
    await vi.waitFor(() => expect(host.launch).toHaveBeenCalledOnce());
    release?.(daemonState());

    await expect(Promise.all([first, second])).resolves.toEqual([
      { status: 'running', pid: 123, restarted: false },
      { status: 'running', pid: 123, restarted: false },
    ]);
    expect(host.launch).toHaveBeenCalledOnce();
  });
});
