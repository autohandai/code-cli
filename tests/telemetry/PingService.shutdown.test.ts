import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pingPaths = vi.hoisted(() => {
  const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const home = `/tmp/autohand-ping-shutdown-${suffix}`;
  return {
    home,
    deviceId: `${home}/device-id`,
    cache: `${home}/last-ping.json`,
  };
});

vi.mock('../../src/constants.js', () => ({
  AUTOHAND_HOME: pingPaths.home,
  AUTOHAND_FILES: {
    deviceId: pingPaths.deviceId,
  },
}));

import { PingService } from '../../src/telemetry/PingService.js';

describe('PingService shutdown', () => {
  beforeEach(async () => {
    await fs.remove(pingPaths.home);
    vi.stubEnv('AUTOHAND_SKIP_PING', '0');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await fs.remove(pingPaths.home);
  });

  it('aborts and drains the immediate ping without a late cache write', async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const responsePending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return responsePending;
    });
    vi.stubGlobal('fetch', fetchMock);
    const service = new PingService({ cliVersion: '1.0.0' });

    service.start();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    const interval = (service as unknown as { pingTimer: NodeJS.Timeout }).pingTimer;
    expect(interval.hasRef()).toBe(false);
    service.stop();

    const requestSignal = fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal;
    expect(requestSignal.aborted).toBe(true);
    resolveFetch?.(new Response(JSON.stringify({ success: true }), { status: 200 }));
    await service.shutdown({ timeoutMs: 100 });

    expect(await fs.pathExists(pingPaths.cache)).toBe(false);
    expect((service as unknown as { pingTimer: NodeJS.Timeout | null }).pingTimer).toBeNull();
    expect((service as unknown as { requestController: AbortController | null }).requestController)
      .toBeNull();
    expect((service as unknown as { activePingPromise: Promise<unknown> | null }).activePingPromise)
      .toBeNull();
    await expect(service.ping()).resolves.toEqual({ success: false });
  });
});
