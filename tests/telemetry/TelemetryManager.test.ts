import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelemetryManager } from '../../src/telemetry/TelemetryManager';
import { TelemetryClient } from '../../src/telemetry/TelemetryClient';

describe('TelemetryManager', () => {
  let trackSpy: ReturnType<typeof vi.spyOn>;
  let uploadSessionSpy: ReturnType<typeof vi.spyOn>;
  let now: number;

  beforeEach(() => {
    now = new Date('2026-05-13T10:05:00.000Z').getTime();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.spyOn(TelemetryClient.prototype as unknown as { startFlushTimer: () => void }, 'startFlushTimer')
      .mockImplementation(() => {});
    vi.spyOn(TelemetryClient.prototype, 'syncQueuedSessions')
      .mockResolvedValue({ synced: 0, failed: 0 });
    vi.spyOn(TelemetryClient.prototype, 'syncAll')
      .mockResolvedValue({ sent: 0, failed: 0 });
    vi.spyOn(TelemetryClient.prototype, 'getDeviceId')
      .mockReturnValue('device-1');
    vi.spyOn(TelemetryClient.prototype, 'getStats')
      .mockReturnValue({
        totalEvents: 0,
        eventsSent: 0,
        eventsFailed: 0,
        eventsQueued: 0,
        lastSyncTime: null,
        sessionId: null,
      });
    vi.spyOn(TelemetryClient.prototype, 'flush')
      .mockResolvedValue({ sent: 0, failed: 0, queued: 0 });
    vi.spyOn(TelemetryClient.prototype, 'disable').mockImplementation(() => {});
    vi.spyOn(TelemetryClient.prototype, 'enable').mockImplementation(() => {});
    vi.spyOn(TelemetryClient.prototype, 'stopFlushTimer').mockImplementation(() => {});

    trackSpy = vi.spyOn(TelemetryClient.prototype, 'track').mockResolvedValue(undefined);
    uploadSessionSpy = vi.spyOn(TelemetryClient.prototype, 'uploadSession')
      .mockResolvedValue({ success: true, id: 'history-1' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('computes session_end duration from the explicit app session start time', async () => {
    const manager = new TelemetryManager({ enabled: true });
    const startedAt = new Date('2026-05-13T10:00:00.000Z');

    await manager.startSession('session-1', 'gpt-5', 'openai', startedAt.getTime(), {
      reasoningEffort: 'high',
      contextWindow: 400000,
    });
    await manager.endSession('completed');

    expect(trackSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'session_end',
        sessionId: 'session-1',
        eventData: expect.objectContaining({
          status: 'completed',
          duration: 300,
          model: 'gpt-5',
          provider: 'openai',
          reasoningEffort: 'high',
          contextWindow: 400000,
        }),
      }),
      { signal: expect.any(AbortSignal) }
    );
  });

  it('sends heartbeat uptime from the same app session start time and stops it at session end', async () => {
    let heartbeatCallback: (() => void) | undefined;
    const heartbeatTimer = { unref: vi.fn() };
    const setIntervalSpy = vi.spyOn(global, 'setInterval')
      .mockImplementation(((callback: () => void, intervalMs?: number) => {
        if (intervalMs === 60_000) {
          heartbeatCallback = callback;
        }
        return heartbeatTimer;
      }) as typeof setInterval);
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval')
      .mockImplementation(() => {});
    const manager = new TelemetryManager({ enabled: true });

    await manager.startSession(
      'session-1',
      'gpt-5',
      'openai',
      new Date('2026-05-13T10:00:00.000Z'),
      {
        reasoningEffort: 'medium',
        contextWindow: 200000,
      }
    );

    trackSpy.mockClear();
    now = new Date('2026-05-13T10:06:00.000Z').getTime();
    heartbeatCallback?.();
    await Promise.resolve();

    expect(trackSpy).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'heartbeat',
      sessionId: 'session-1',
      eventData: { uptime: 360 },
    }));

    await manager.endSession('completed');
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);
    expect(clearIntervalSpy).toHaveBeenCalledWith(heartbeatTimer);
    trackSpy.mockClear();
    heartbeatCallback = undefined;
    now = new Date('2026-05-13T10:08:00.000Z').getTime();
    heartbeatCallback?.();
    await Promise.resolve();

    expect(trackSpy).not.toHaveBeenCalled();
  });

  it('includes canonical durationSeconds in synced active-session metadata without ending the session', async () => {
    const manager = new TelemetryManager({ enabled: true, enableSessionSync: true });

    await manager.startSession(
      'session-1',
      'gpt-5',
      'openai',
      new Date('2026-05-13T10:00:00.000Z'),
      {
        reasoningEffort: 'medium',
        contextWindow: 200000,
      }
    );
    now = new Date('2026-05-13T10:07:30.000Z').getTime();

    await manager.syncSession({
      messages: [{ role: 'user', content: 'hello', timestamp: '2026-05-13T10:00:10.000Z' }],
      metadata: {
        workspaceRoot: '/workspace/project',
        totalTokens: 123,
        projectName: 'project',
        status: 'active',
        summary: 'hello',
        usage: {
          promptTokens: 50,
          completionTokens: 73,
          totalTokens: 123,
          turnCount: 1,
          tokenUsageStatus: 'actual',
          updatedAt: '2026-05-13T10:07:00.000Z',
        },
      },
    });

    expect(uploadSessionSpy).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      metadata: expect.objectContaining({
        model: 'gpt-5',
        provider: 'openai',
        startTime: '2026-05-13T10:00:00.000Z',
        durationSeconds: 450,
        workspaceRoot: '/workspace/project',
        totalTokens: 123,
        reasoningEffort: 'medium',
        contextWindow: 200000,
        projectName: 'project',
        status: 'active',
        summary: 'hello',
        usage: expect.objectContaining({
          promptTokens: 50,
          completionTokens: 73,
          totalTokens: 123,
          turnCount: 1,
          tokenUsageStatus: 'actual',
        }),
      }),
    }));
    expect(uploadSessionSpy.mock.calls[0][0].metadata).not.toHaveProperty('endTime');
  });

  it('preserves explicit endTime for final synced session metadata', async () => {
    const manager = new TelemetryManager({ enabled: true, enableSessionSync: true });

    await manager.startSession(
      'session-1',
      'gpt-5',
      'openai',
      new Date('2026-05-13T10:00:00.000Z')
    );

    await manager.syncSession({
      messages: [{ role: 'user', content: 'done', timestamp: '2026-05-13T10:00:10.000Z' }],
      metadata: {
        workspaceRoot: '/workspace/project',
        endTime: '2026-05-13T10:08:00.000Z',
        durationSeconds: 480,
      },
    });

    expect(uploadSessionSpy).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      metadata: expect.objectContaining({
        endTime: '2026-05-13T10:08:00.000Z',
        durationSeconds: 480,
      }),
    }));
  });

  it('tracks model switch metadata needed for provider usage sync', async () => {
    const manager = new TelemetryManager({ enabled: true });

    await manager.startSession('session-1', 'old-model', 'openrouter');
    trackSpy.mockClear();

    await manager.trackModelSwitch({
      fromModel: 'old-model',
      toModel: 'acme-code-1',
      provider: 'custom:acme',
      providerDisplayName: 'Acme AI',
      providerApiFormat: 'openai-compatible',
      reasoningEffort: 'high',
      contextWindow: 256000,
    });

    expect(trackSpy).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'model_switch',
      sessionId: 'session-1',
      eventData: expect.objectContaining({
        fromModel: 'old-model',
        toModel: 'acme-code-1',
        provider: 'custom:acme',
        providerDisplayName: 'Acme AI',
        providerApiFormat: 'openai-compatible',
        reasoningEffort: 'high',
        contextWindow: 256000,
      }),
    }));
  });

  it('shares one bounded flush between concurrent endSession and shutdown calls', async () => {
    let resolveSync: ((result: { sent: number; failed: number }) => void) | undefined;
    const syncAllSpy = vi.spyOn(TelemetryClient.prototype, 'syncAll').mockImplementation(() => (
      new Promise((resolve) => {
        resolveSync = resolve;
      })
    ));
    const manager = new TelemetryManager({ enabled: true });
    await manager.startSession('session-1', 'gpt-5', 'openai');
    trackSpy.mockClear();

    let endSettled = false;
    let shutdownSettled = false;
    const endPromise = manager.endSession('completed').then(() => {
      endSettled = true;
    });
    await vi.waitFor(() => {
      expect(syncAllSpy).toHaveBeenCalledTimes(1);
    });
    const shutdownPromise = manager.shutdown().then(() => {
      shutdownSettled = true;
    });

    expect(endSettled).toBe(false);
    expect(shutdownSettled).toBe(false);
    expect(syncAllSpy).toHaveBeenCalledTimes(1);
    expect(syncAllSpy).toHaveBeenCalledWith({ timeoutMs: 1_500 });
    expect(trackSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'session_end',
        eventData: expect.objectContaining({ status: 'completed' }),
      }),
      { signal: expect.any(AbortSignal) }
    );

    resolveSync?.({ sent: 1, failed: 0 });
    await Promise.all([endPromise, shutdownPromise]);

    expect(endSettled).toBe(true);
    expect(shutdownSettled).toBe(true);
    expect(TelemetryClient.prototype.stopFlushTimer).toHaveBeenCalledTimes(1);
  });

  it('starts the absolute shutdown deadline before enqueueing the session-end event', async () => {
    vi.useFakeTimers();
    const manager = new TelemetryManager({ enabled: true });
    await manager.startSession('session-1', 'gpt-5', 'openai');
    let resolveTrack: (() => void) | undefined;
    trackSpy.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveTrack = resolve;
    }));

    try {
      let settled = false;
      const endPromise = manager.endSession('completed').then(() => {
        settled = true;
      });
      now += 1_500;
      await vi.advanceTimersByTimeAsync(1_500);

      expect(settled).toBe(true);
      expect(TelemetryClient.prototype.syncAll).toHaveBeenCalledWith({ timeoutMs: 0 });
      await endPromise;
    } finally {
      resolveTrack?.();
      vi.useRealTimers();
    }
  });

  it('does not restart the orderly sync deadline after endSession completes', async () => {
    const manager = new TelemetryManager({ enabled: true });
    await manager.startSession('session-1', 'gpt-5', 'openai');

    await manager.endSession('completed');
    now += 500;
    await manager.shutdown();

    const syncAllMock = vi.mocked(TelemetryClient.prototype.syncAll);
    expect(syncAllMock).toHaveBeenNthCalledWith(1, { timeoutMs: 1_500 });
    expect(syncAllMock).toHaveBeenNthCalledWith(2, { timeoutMs: 1_000 });
  });

  it('settles the prior session sync before starting a new shutdown generation', async () => {
    let resolveFirstSync: ((result: { sent: number; failed: number }) => void) | undefined;
    const syncAllMock = vi.mocked(TelemetryClient.prototype.syncAll);
    syncAllMock
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirstSync = resolve;
      }))
      .mockResolvedValue({ sent: 0, failed: 0 });
    const manager = new TelemetryManager({ enabled: true });
    await manager.startSession('session-1', 'gpt-5', 'openai');
    const firstEndPromise = manager.endSession('completed');
    await vi.waitFor(() => {
      expect(syncAllMock).toHaveBeenCalledTimes(1);
    });

    let secondStartSettled = false;
    const secondStartPromise = manager.startSession('session-2', 'gpt-5', 'openai').then(() => {
      secondStartSettled = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const settledBeforePriorSync = secondStartSettled;

    resolveFirstSync?.({ sent: 0, failed: 0 });
    await Promise.all([firstEndPromise, secondStartPromise]);
    await manager.endSession('completed');

    expect(settledBeforePriorSync).toBe(false);
    expect(syncAllMock).toHaveBeenNthCalledWith(2, { timeoutMs: 1_500 });
  });

  it('cleans heartbeat and client timers before awaiting shutdown synchronization', async () => {
    const heartbeatTimer = { unref: vi.fn() };
    const setIntervalSpy = vi.spyOn(global, 'setInterval')
      .mockReturnValue(heartbeatTimer as unknown as ReturnType<typeof setInterval>);
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval').mockImplementation(() => {});
    const manager = new TelemetryManager({ enabled: true });
    await manager.startSession('session-1', 'gpt-5', 'openai');

    await manager.shutdown();

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);
    expect(clearIntervalSpy).toHaveBeenCalledWith(heartbeatTimer);
    expect(TelemetryClient.prototype.stopFlushTimer).toHaveBeenCalledTimes(1);
    expect(clearIntervalSpy.mock.invocationCallOrder[0]).toBeLessThan(
      syncAllSpyCallOrder()
    );
  });

  it('does not resurrect a session heartbeat when startSession resumes after shutdown', async () => {
    let releaseOrderlySync: ((value: { sent: number; failed: number }) => void) | undefined;
    const syncAllMock = vi.mocked(TelemetryClient.prototype.syncAll);
    syncAllMock.mockImplementationOnce(() => new Promise((resolve) => {
      releaseOrderlySync = resolve;
    }));
    const heartbeatTimer = { unref: vi.fn() };
    const setIntervalSpy = vi.spyOn(global, 'setInterval')
      .mockReturnValue(heartbeatTimer as unknown as ReturnType<typeof setInterval>);
    const manager = new TelemetryManager({ enabled: true });
    await manager.startSession('session-1', 'gpt-5', 'openai');

    const ending = manager.endSession('completed');
    await vi.waitFor(() => expect(syncAllMock).toHaveBeenCalledOnce());
    const lateStart = manager.startSession('session-2', 'gpt-5', 'openai');
    const firstShutdown = manager.shutdown();
    const secondShutdown = manager.shutdown();

    expect(secondShutdown).toBe(firstShutdown);
    releaseOrderlySync?.({ sent: 0, failed: 0 });
    await Promise.all([ending, lateStart, firstShutdown]);

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(trackSpy.mock.calls.filter(([event]) => event.eventType === 'session_start')).toHaveLength(1);
    expect(TelemetryClient.prototype.syncQueuedSessions).toHaveBeenCalledTimes(1);
  });

  function syncAllSpyCallOrder(): number {
    const syncAllMock = vi.mocked(TelemetryClient.prototype.syncAll);
    return syncAllMock.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER;
  }
});
