import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs-extra';
import { promises as nodeFs } from 'node:fs';
import { TelemetryClient } from '../../src/telemetry/TelemetryClient.js';

const { tempRoot } = vi.hoisted(() => ({
  tempRoot: `/tmp/autohand-telemetry-client-${process.pid}`,
}));

async function removeTempRoot(): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await fs.remove(tempRoot);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOTEMPTY' || attempt === 9) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

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
  let clients: TelemetryClient[];

  beforeEach(async () => {
    await removeTempRoot();
    clients = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/health')) {
        return new Response('ok', { status: 200 });
      }
      return new Response(JSON.stringify({ id: 'history-1' }), { status: 200 });
    }));
  });

  afterEach(async () => {
    for (const client of clients) {
      client.stopFlushTimer();
    }
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await removeTempRoot();
  });

  function createClient(config: ConstructorParameters<typeof TelemetryClient>[0]): TelemetryClient {
    const client = new TelemetryClient(config);
    clients.push(client);
    return client;
  }

  function sessionSnapshot(sessionId: string) {
    return {
      sessionId,
      messages: [{
        role: 'user',
        content: `message for ${sessionId}`,
        timestamp: '2026-07-14T00:00:00.000Z',
      }],
      metadata: {
        model: 'gpt-5',
        provider: 'openai',
        totalTokens: 42,
      },
    };
  }

  it('does not upload session snapshots without a logged-in auth token', async () => {
    const client = createClient({
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
    const client = createClient({
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

  it('preserves enriched usage metadata in the history payload', async () => {
    const client = createClient({
      enabled: false,
      enableSessionSync: true,
      apiBaseUrl: 'https://api.example.test',
      authToken: 'auth-token-123',
    });

    await client.uploadSession({
      sessionId: 'session-1',
      messages: [{ role: 'user', content: 'hello' }],
      metadata: {
        workspaceRoot: '/workspace/project',
        projectName: 'project',
        status: 'completed',
        usage: {
          totalTokens: 123,
          promptTokens: 50,
          completionTokens: 73,
          turnCount: 1,
          tokenUsageStatus: 'actual',
          updatedAt: '2026-05-13T10:00:00.000Z',
        },
      },
    });

    const request = vi.mocked(fetch).mock.calls.at(-1)?.[1];
    const body = JSON.parse(String(request?.body)) as {
      metadata?: { projectName?: string; status?: string; usage?: { totalTokens?: number } };
    };
    expect(body.metadata).toMatchObject({
      projectName: 'project',
      status: 'completed',
      usage: { totalTokens: 123 },
    });
  });

  describe('durable session sync queue', () => {
    function createOfflineClient(): TelemetryClient {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('offline', { status: 503 })));
      return createClient({
        enabled: false,
        enableSessionSync: true,
        apiBaseUrl: 'https://api.example.test',
        authToken: 'auth-token-123',
      });
    }

    it.each([
      ['invalid JSON', '{"sessionId":'],
      ['an object instead of an array', JSON.stringify({ sessions: [] })],
      ['a null array entry', JSON.stringify([null])],
      [
        'an incomplete snapshot',
        JSON.stringify([{ sessionId: 'incomplete', messages: [{ role: 'user' }] }]),
      ],
      [
        'invalid usage metadata',
        JSON.stringify([{
          ...sessionSnapshot('invalid-usage'),
          metadata: {
            usage: {
              totalTokens: 'unknown',
              turnCount: 1,
              tokenUsageStatus: 'actual',
              updatedAt: '2026-07-14T00:00:00.000Z',
            },
          },
        }]),
      ],
    ])('fails closed and backs up a session queue containing %s', async (_label, queueContent) => {
      const queuePath = `${tempRoot}/telemetry/session-sync-queue.json`;
      await fs.outputFile(queuePath, queueContent);
      const client = createOfflineClient();

      await expect(client.uploadSession(sessionSnapshot('new-session'))).resolves.toEqual({
        success: false,
        error: 'Offline - queued for sync',
      });

      const telemetryEntries = await fs.readdir(`${tempRoot}/telemetry`);
      const backups = telemetryEntries.filter(
        (entry) => entry.startsWith('session-sync-queue.json.corrupt-')
      );
      expect(backups).toHaveLength(1);
      expect(await fs.readFile(`${tempRoot}/telemetry/${backups[0]}`, 'utf8')).toBe(queueContent);
      expect(await fs.readJson(queuePath)).toEqual([sessionSnapshot('new-session')]);
    });

    it('drains only the newest ten valid persisted session snapshots', async () => {
      const queuePath = `${tempRoot}/telemetry/session-sync-queue.json`;
      await fs.outputJson(
        queuePath,
        Array.from({ length: 12 }, (_, index) => sessionSnapshot(`session-${index + 1}`)),
      );
      const client = createClient({
        enabled: false,
        enableSessionSync: true,
        apiBaseUrl: 'https://api.example.test',
        authToken: 'auth-token-123',
      });

      await expect(client.syncQueuedSessions()).resolves.toEqual({ synced: 10, failed: 0 });
      const historyRequests = vi.mocked(fetch).mock.calls.filter(
        ([input]) => String(input).endsWith('/v1/history')
      );
      expect(historyRequests).toHaveLength(10);
      expect(historyRequests.map(([, init]) => (
        JSON.parse(String(init?.body)).sessionId
      ))).toEqual(Array.from({ length: 10 }, (_, index) => `session-${index + 3}`));
      expect(await fs.pathExists(queuePath)).toBe(false);
    });

    it('drains persisted snapshots with enriched usage metadata intact', async () => {
      const queuePath = `${tempRoot}/telemetry/session-sync-queue.json`;
      const snapshot = {
        ...sessionSnapshot('enriched-session'),
        metadata: {
          ...sessionSnapshot('enriched-session').metadata,
          projectName: 'project',
          status: 'completed',
          usage: {
            totalTokens: 42,
            promptTokens: 30,
            completionTokens: 12,
            turnCount: 1,
            tokenUsageStatus: 'actual' as const,
            updatedAt: '2026-07-14T00:00:00.000Z',
          },
        },
      };
      await fs.outputJson(queuePath, [snapshot]);
      const client = createClient({
        enabled: false,
        enableSessionSync: true,
        apiBaseUrl: 'https://api.example.test',
        authToken: 'auth-token-123',
      });

      await expect(client.syncQueuedSessions()).resolves.toEqual({ synced: 1, failed: 0 });

      const historyRequest = vi.mocked(fetch).mock.calls.find(
        ([input]) => String(input).endsWith('/v1/history')
      );
      const requestBody = JSON.parse(String(historyRequest?.[1]?.body)) as typeof snapshot;
      expect(requestBody.metadata.usage).toEqual(snapshot.metadata.usage);
      expect(await fs.pathExists(queuePath)).toBe(false);
    });

    it('preserves the prior session queue when atomic replacement fails', async () => {
      const queuePath = `${tempRoot}/telemetry/session-sync-queue.json`;
      const previousQueue = [sessionSnapshot('previous-session')];
      await fs.outputJson(queuePath, previousQueue);
      const originalRename = nodeFs.rename.bind(nodeFs);
      vi.spyOn(nodeFs, 'rename').mockImplementation(async (source, destination) => {
        if (destination === queuePath) {
          throw Object.assign(new Error('session queue replacement failed'), { code: 'EIO' });
        }
        return originalRename(source, destination);
      });
      const client = createOfflineClient();

      await expect(client.uploadSession(sessionSnapshot('new-session'))).resolves.toEqual({
        success: false,
        error: 'Failed to queue session',
      });
      expect(await fs.readJson(queuePath)).toEqual(previousQueue);
    });

    it('leaves queued snapshots untouched until session sync has authentication', async () => {
      const queuePath = `${tempRoot}/telemetry/session-sync-queue.json`;
      const previousQueue = [sessionSnapshot('waiting-for-login')];
      await fs.outputJson(queuePath, previousQueue);
      const client = createClient({
        enabled: false,
        enableSessionSync: true,
        apiBaseUrl: 'https://api.example.test',
      });

      await expect(client.syncQueuedSessions()).resolves.toEqual({ synced: 0, failed: 0 });
      expect(await fs.readJson(queuePath)).toEqual(previousQueue);
    });

    it('retains queued snapshots after an authenticated upload failure', async () => {
      const queuePath = `${tempRoot}/telemetry/session-sync-queue.json`;
      const previousQueue = [sessionSnapshot('retry-after-http-failure')];
      await fs.outputJson(queuePath, previousQueue);
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => (
        String(input).endsWith('/health')
          ? new Response('ok', { status: 200 })
          : new Response('unavailable', { status: 503 })
      )));
      const client = createClient({
        enabled: false,
        enableSessionSync: true,
        apiBaseUrl: 'https://api.example.test',
        authToken: 'auth-token-123',
      });

      await expect(client.syncQueuedSessions()).resolves.toEqual({ synced: 0, failed: 1 });
      expect(await fs.readJson(queuePath)).toEqual(previousQueue);
    });

    it('removes only snapshots acknowledged by the session history endpoint', async () => {
      const queuePath = `${tempRoot}/telemetry/session-sync-queue.json`;
      const acknowledged = sessionSnapshot('acknowledged-session');
      const retryable = sessionSnapshot('retryable-session');
      await fs.outputJson(queuePath, [acknowledged, retryable]);
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith('/health')) {
          return new Response('ok', { status: 200 });
        }

        const { sessionId } = JSON.parse(String(init?.body)) as { sessionId: string };
        return sessionId === acknowledged.sessionId
          ? Response.json({ id: 'history-acknowledgement' })
          : new Response('unavailable', { status: 503 });
      }));
      const client = createClient({
        enabled: false,
        enableSessionSync: true,
        apiBaseUrl: 'https://api.example.test',
        authToken: 'auth-token-123',
      });

      await expect(client.syncQueuedSessions()).resolves.toEqual({ synced: 1, failed: 1 });
      expect(await fs.readJson(queuePath)).toEqual([retryable]);
    });
  });

  describe('bounded queue synchronization', () => {
    const event = {
      eventType: 'command_use' as const,
      eventData: { command: '/help' },
      sessionId: 'session-1',
      cliVersion: '0.8.2',
      platform: 'test',
    };

    function createEnabledClient(
      overrides: NonNullable<ConstructorParameters<typeof TelemetryClient>[0]> = {}
    ): TelemetryClient {
      return createClient({
        enabled: true,
        apiBaseUrl: 'https://api.example.test',
        batchSize: 20,
        maxRetries: 3,
        flushIntervalMs: 60_000,
        ...overrides,
      });
    }

    function persistedEvent(id: string) {
      return {
        ...event,
        id,
        deviceId: 'persisted-device',
        clientType: 'cli' as const,
        timestamp: '2026-07-14T00:00:00.000Z',
      };
    }

    it.each([
      ['invalid JSON', '{"eventType":'],
      ['an object instead of an array', JSON.stringify({ events: [] })],
      ['a null array entry', JSON.stringify([null])],
      ['an incomplete event', JSON.stringify([{ id: 'missing-required-fields' }])],
      [
        'duplicate event identifiers',
        JSON.stringify([persistedEvent('duplicate-id'), persistedEvent('duplicate-id')]),
      ],
    ])('fails closed and backs up a durable queue containing %s', async (_label, queueContent) => {
      const queuePath = `${tempRoot}/telemetry/queue.json`;
      await fs.outputFile(queuePath, queueContent);

      const client = createEnabledClient();

      await expect(client.track(event)).resolves.toBeUndefined();
      expect(client.getStats().queued).toBe(1);
      const telemetryEntries = await fs.readdir(`${tempRoot}/telemetry`);
      const backups = telemetryEntries.filter((entry) => entry.startsWith('queue.json.corrupt-'));
      expect(backups).toHaveLength(1);
      expect(await fs.readFile(`${tempRoot}/telemetry/${backups[0]}`, 'utf8')).toBe(queueContent);
      expect(await fs.readJson(queuePath)).toEqual([
        expect.objectContaining({ eventType: 'command_use', sessionId: 'session-1' }),
      ]);
    });

    it('loads only the newest configured maximum of valid durable events', async () => {
      const queuePath = `${tempRoot}/telemetry/queue.json`;
      await fs.outputJson(queuePath, [
        persistedEvent('event-1'),
        persistedEvent('event-2'),
        persistedEvent('event-3'),
      ]);

      const client = createEnabledClient({ maxQueueSize: 2 });

      expect(client.getStats().queued).toBe(2);
      expect((await fs.readdir(`${tempRoot}/telemetry`)).some(
        (entry) => entry.startsWith('queue.json.corrupt-')
      )).toBe(false);
    });

    it('awaits a successful queued-event flush', async () => {
      let resolvePost: ((response: Response) => void) | undefined;
      vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
        if (String(input).endsWith('/health')) {
          return Promise.resolve(new Response('ok', { status: 200 }));
        }
        return new Promise<Response>((resolve) => {
          resolvePost = resolve;
        });
      }));
      const client = createEnabledClient();
      await client.track(event);

      let settled = false;
      const syncPromise = client.syncAll({ timeoutMs: 1000 }).then((result) => {
        settled = true;
        return result;
      });
      await vi.waitFor(() => {
        expect(resolvePost).toBeDefined();
      });
      expect(settled).toBe(false);

      resolvePost?.(new Response('{}', { status: 200 }));

      await expect(syncPromise).resolves.toEqual({ sent: 1, failed: 0 });
      expect(client.getStats().queued).toBe(0);
      expect(await fs.readJson(`${tempRoot}/telemetry/queue.json`)).toEqual([]);
    });

    it('joins and aborts a stalled automatic flush at the strict deadline', async () => {
      vi.useFakeTimers();
      let requestSignal: AbortSignal | undefined;
      vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith('/health')) {
          return Promise.resolve(new Response('ok', { status: 200 }));
        }
        requestSignal = init?.signal ?? undefined;
        if (!requestSignal) {
          return Promise.reject(new Error('telemetry request was not abortable'));
        }
        return new Promise<Response>(() => {});
      }));
      const client = createEnabledClient({ batchSize: 1 });
      await client.track(event);

      let settled = false;
      const syncPromise = client.syncAll({ timeoutMs: 50 }).then((result) => {
        settled = true;
        return result;
      });
      await vi.advanceTimersByTimeAsync(50);
      const settledAtDeadline = settled;
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await syncPromise;

      expect(settledAtDeadline).toBe(true);
      expect(requestSignal?.aborted).toBe(true);
      expect(result).toEqual({ sent: 0, failed: 1 });
      expect(client.getStats().queued).toBe(1);
    });

    it('interrupts retry backoff when the shared deadline expires', async () => {
      vi.useFakeTimers();
      const fetchMock = vi.fn((input: RequestInfo | URL) => {
        if (String(input).endsWith('/health')) {
          return Promise.resolve(new Response('ok', { status: 200 }));
        }
        return Promise.reject(new Error('offline'));
      });
      vi.stubGlobal('fetch', fetchMock);
      const client = createEnabledClient();
      await client.track(event);

      let settled = false;
      const syncPromise = client.syncAll({ timeoutMs: 1500 }).then((result) => {
        settled = true;
        return result;
      });
      await vi.advanceTimersByTimeAsync(1500);
      const settledAtDeadline = settled;
      const attemptsAtDeadline = fetchMock.mock.calls.filter(
        ([input]) => String(input).endsWith('/v1/telemetry')
      ).length;
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await syncPromise;

      expect(settledAtDeadline).toBe(true);
      expect(attemptsAtDeadline).toBe(2);
      expect(result).toEqual({ sent: 0, failed: 1 });
      expect(client.getStats().queued).toBe(1);
    });

    it('persists unsent events when shutdown synchronization is offline', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('offline', { status: 503 })));
      const client = createEnabledClient();
      await client.track(event);

      await expect(client.syncAll({ timeoutMs: 50 })).resolves.toEqual({ sent: 0, failed: 1 });

      const persisted = await fs.readJson(`${tempRoot}/telemetry/queue.json`);
      expect(persisted).toHaveLength(1);
      expect(persisted[0]).toMatchObject({
        eventType: 'command_use',
        sessionId: 'session-1',
      });
    });

    it('keeps the shutdown deadline active while final queue persistence is stalled', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('offline', { status: 503 })));
      const client = createEnabledClient();
      await client.track(event);
      const queuePath = `${tempRoot}/telemetry/queue.json`;
      const originalRename = nodeFs.rename.bind(nodeFs);
      let releaseRename: (() => void) | undefined;
      const rename = vi.spyOn(nodeFs, 'rename').mockImplementation(async (source, destination) => {
        if (destination === queuePath) {
          await new Promise<void>((resolve) => {
            releaseRename = resolve;
          });
        }
        return originalRename(source, destination);
      });

      try {
        let settled = false;
        const syncPromise = client.syncAll({ timeoutMs: 50 }).then((result) => {
          settled = true;
          return result;
        });
        await vi.waitFor(() => {
          expect(releaseRename).toBeDefined();
        });
        await new Promise((resolve) => setTimeout(resolve, 75));
        const settledAtDeadline = settled;

        releaseRename?.();
        const result = await syncPromise;

        expect(settledAtDeadline).toBe(true);
        expect(result).toEqual({ sent: 0, failed: 1 });
      } finally {
        releaseRename?.();
        rename.mockRestore();
      }
    });

    it('preserves the previous durable queue when atomic replacement fails', async () => {
      const client = createEnabledClient();
      await client.track(event);
      const previousQueue = await fs.readJson(`${tempRoot}/telemetry/queue.json`);
      vi.spyOn(nodeFs, 'rename').mockRejectedValueOnce(
        Object.assign(new Error('simulated queue replacement failure'), { code: 'EIO' })
      );

      await client.track({
        ...event,
        eventData: { command: '/status' },
      });

      expect(client.getStats().queued).toBe(2);
      expect(await fs.readJson(`${tempRoot}/telemetry/queue.json`)).toEqual(previousQueue);
    });

    it('removes acknowledged events by identity after concurrent queue trimming', async () => {
      let resolvePost: ((response: Response) => void) | undefined;
      vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
        if (String(input).endsWith('/health')) {
          return Promise.resolve(new Response('ok', { status: 200 }));
        }
        return new Promise<Response>((resolve) => {
          resolvePost = resolve;
        });
      }));
      const client = createEnabledClient({ batchSize: 1, maxQueueSize: 2 });
      await client.track(event);
      await vi.waitFor(() => {
        expect(resolvePost).toBeDefined();
      });
      const activeFlush = client.flush();

      await client.track({ ...event, eventData: { command: '/second' } });
      await client.track({ ...event, eventData: { command: '/third' } });
      resolvePost?.(new Response('{}', { status: 200 }));
      await activeFlush;

      expect(client.getStats().queued).toBe(2);
      const persisted = await fs.readJson(`${tempRoot}/telemetry/queue.json`);
      expect(persisted.map((queuedEvent: { eventData: { command: string } }) => (
        queuedEvent.eventData.command
      ))).toEqual(['/second', '/third']);
    });

    it('cleans deadline, request, retry, and periodic timers after synchronization', async () => {
      vi.useFakeTimers();
      const addEventListenerSpy = vi.spyOn(AbortSignal.prototype, 'addEventListener');
      const removeEventListenerSpy = vi.spyOn(AbortSignal.prototype, 'removeEventListener');
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/health')) {
          return new Response('ok', { status: 200 });
        }
        throw new Error('offline');
      }));
      const client = createEnabledClient();
      await client.track(event);

      const syncPromise = client.syncAll({ timeoutMs: 50 });
      await vi.advanceTimersByTimeAsync(50);
      await syncPromise;
      client.stopFlushTimer();

      expect(vi.getTimerCount()).toBe(0);
      const addedAbortListeners = addEventListenerSpy.mock.calls.filter(([type]) => type === 'abort');
      const removedAbortListeners = removeEventListenerSpy.mock.calls.filter(([type]) => type === 'abort');
      expect(addedAbortListeners.length).toBeGreaterThan(0);
      expect(removedAbortListeners).toHaveLength(addedAbortListeners.length);
    });
  });
});
