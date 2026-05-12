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

    await manager.startSession('session-1', 'gpt-5', 'openai', startedAt.getTime());
    await manager.endSession('completed');

    expect(trackSpy).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'session_end',
      sessionId: 'session-1',
      eventData: expect.objectContaining({
        status: 'completed',
        duration: 300,
        model: 'gpt-5',
        provider: 'openai',
      }),
    }));
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
      new Date('2026-05-13T10:00:00.000Z')
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

  it('includes canonical durationSeconds in synced session metadata', async () => {
    const manager = new TelemetryManager({ enabled: true, enableSessionSync: true });

    await manager.startSession(
      'session-1',
      'gpt-5',
      'openai',
      new Date('2026-05-13T10:00:00.000Z')
    );
    now = new Date('2026-05-13T10:07:30.000Z').getTime();

    await manager.syncSession({
      messages: [{ role: 'user', content: 'hello', timestamp: '2026-05-13T10:00:10.000Z' }],
      metadata: { workspaceRoot: '/workspace/project' },
    });

    expect(uploadSessionSpy).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      metadata: expect.objectContaining({
        model: 'gpt-5',
        provider: 'openai',
        startTime: '2026-05-13T10:00:00.000Z',
        endTime: '2026-05-13T10:07:30.000Z',
        durationSeconds: 450,
        workspaceRoot: '/workspace/project',
      }),
    }));
  });
});
