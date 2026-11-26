import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reachableStates, terminalStates } from '../../src/utils/stateMachine.js';
import { randomEventWalk } from '../helpers/stateMachineProperties.js';

const pingPaths = vi.hoisted(() => {
  const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const home = `/tmp/autohand-ping-lifecycle-${suffix}`;
  return { home, deviceId: `${home}/device-id`, cache: `${home}/last-ping.json` };
});

vi.mock('../../src/constants.js', () => ({
  AUTOHAND_HOME: pingPaths.home,
  AUTOHAND_FILES: { deviceId: pingPaths.deviceId },
}));

import { PING_SERVICE_LIFECYCLE, PingService } from '../../src/telemetry/PingService.js';

describe('PING_SERVICE_LIFECYCLE transition table', () => {
  it('declares idle → running → stopped with stop allowed before start', () => {
    expect(PING_SERVICE_LIFECYCLE.initial).toBe('idle');
    expect(PING_SERVICE_LIFECYCLE.transitions).toEqual({
      idle: { start: 'running', stop: 'stopped' },
      running: { stop: 'stopped' },
      stopped: {},
    });
    expect(terminalStates(PING_SERVICE_LIFECYCLE)).toEqual(['stopped']);
    expect(reachableStates(PING_SERVICE_LIFECYCLE)).toEqual(new Set(['idle', 'running', 'stopped']));
  });

  it('accepts exactly the declared edges under random event walks', () => {
    randomEventWalk(PING_SERVICE_LIFECYCLE, ['start', 'stop'], { seeds: 30, steps: 20 });
  });
});

describe('PingService lifecycle', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await fs.remove(pingPaths.home);
    vi.stubEnv('AUTOHAND_SKIP_PING', '0');
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await fs.remove(pingPaths.home);
  });

  it('pings on demand before start without starting the periodic timer', async () => {
    const service = new PingService({ cliVersion: '1.0.0' });
    await expect(service.ping()).resolves.toMatchObject({ success: true });
    expect(service.lifecycleState).toBe('idle');
    expect((service as unknown as { pingTimer: NodeJS.Timeout | null }).pingTimer).toBeNull();
  });

  it('starts once and never restarts after stop', async () => {
    const service = new PingService({ cliVersion: '1.0.0' });
    service.start();
    service.start();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(service.lifecycleState).toBe('running');

    service.stop();
    service.stop();
    service.start();

    expect(service.lifecycleState).toBe('stopped');
    expect((service as unknown as { pingTimer: NodeJS.Timeout | null }).pingTimer).toBeNull();
    await expect(service.ping()).resolves.toEqual({ success: false });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('refuses a concurrent ping while one is in flight', async () => {
    const service = new PingService({ cliVersion: '1.0.0' });
    const first = service.ping();
    await expect(service.ping()).resolves.toEqual({ success: false });
    await expect(first).resolves.toMatchObject({ success: true });
  });

  it('shuts down from idle without pinging', async () => {
    const service = new PingService({ cliVersion: '1.0.0' });
    await service.shutdown({ timeoutMs: 10 });
    expect(service.lifecycleState).toBe('stopped');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
