import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs-extra';
import { TelemetryClient } from '../../src/telemetry/TelemetryClient.js';

const { tempRoot } = vi.hoisted(() => ({
  tempRoot: `/tmp/autohand-telemetry-client-${process.pid}`,
}));

vi.mock('../../src/constants.js', () => ({
  AUTOHAND_PATHS: {
    telemetry: `${tempRoot}/telemetry`,
  },
  AUTOHAND_FILES: {
    telemetryQueue: `${tempRoot}/telemetry/queue.json`,
    sessionSyncQueue: `${tempRoot}/telemetry/session-sync-queue.json`,
    deviceId: `${tempRoot}/device-id`,
  },
}));

describe('TelemetryClient session sync', () => {
  beforeEach(async () => {
    await fs.remove(tempRoot);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/health')) {
        return new Response('ok', { status: 200 });
      }
      return new Response(JSON.stringify({ id: 'history-1' }), { status: 200 });
    }));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await fs.remove(tempRoot);
  });

  it('does not upload session snapshots without a logged-in auth token', async () => {
    const client = new TelemetryClient({
      enabled: false,
      enableSessionSync: true,
      apiBaseUrl: 'https://api.example.test',
    });

    const result = await client.uploadSession({
      sessionId: 'session-1',
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(result).toEqual({ success: false, error: 'Login required for session sync' });
    expect(fetch).not.toHaveBeenCalledWith(
      'https://api.example.test/v1/history',
      expect.anything()
    );
  });

  it('uploads session snapshots with the user auth token even when telemetry events are disabled', async () => {
    const client = new TelemetryClient({
      enabled: false,
      enableSessionSync: true,
      apiBaseUrl: 'https://api.example.test',
      authToken: 'auth-token-123',
      clientVersion: '0.8.2',
    });

    const result = await client.uploadSession({
      sessionId: 'session-1',
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(result).toEqual({ success: true, id: 'history-1' });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.test/v1/history',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer auth-token-123',
          'X-CLI-Version': '0.8.2',
        }),
      })
    );
  });
});
