import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TELEMETRY_SESSION_LIFECYCLE, TelemetryManager } from '../../src/telemetry/TelemetryManager';
import { TelemetryClient } from '../../src/telemetry/TelemetryClient';
import { reachableStates, terminalStates } from '../../src/utils/stateMachine.js';
import { randomEventWalk } from '../helpers/stateMachineProperties.js';

describe('TELEMETRY_SESSION_LIFECYCLE transition table', () => {
  it('declares the session lifecycle edges', () => {
    expect(TELEMETRY_SESSION_LIFECYCLE.initial).toBe('idle');
    expect(TELEMETRY_SESSION_LIFECYCLE.transitions).toEqual({
      idle: { start: 'active', shutdown: 'shutdown' },
      active: { start: 'active', end: 'ended', shutdown: 'shutdown' },
      ended: { start: 'active', shutdown: 'shutdown' },
      shutdown: {},
    });
  });

  it('only ends an active session and never leaves shutdown', () => {
    const { transitions } = TELEMETRY_SESSION_LIFECYCLE;
    expect(transitions.idle).not.toHaveProperty('end');
    expect(transitions.ended).not.toHaveProperty('end');
    expect(terminalStates(TELEMETRY_SESSION_LIFECYCLE)).toEqual(['shutdown']);
    expect(reachableStates(TELEMETRY_SESSION_LIFECYCLE)).toEqual(new Set(['idle', 'active', 'ended', 'shutdown']));
  });

  it('accepts exactly the declared edges under random event walks', () => {
    randomEventWalk(TELEMETRY_SESSION_LIFECYCLE, ['start', 'end', 'shutdown'], { seeds: 50, steps: 30 });
  });
});

describe('TelemetryManager session lifecycle', () => {
  let trackSpy: ReturnType<typeof vi.spyOn>;
  let uploadSessionSpy: ReturnType<typeof vi.spyOn>;
  let setIntervalSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.spyOn(TelemetryClient.prototype as unknown as { startFlushTimer: () => void }, 'startFlushTimer')
      .mockImplementation(() => {});
    vi.spyOn(TelemetryClient.prototype, 'syncQueuedSessions').mockResolvedValue({ synced: 0, failed: 0 });
    vi.spyOn(TelemetryClient.prototype, 'syncAll').mockResolvedValue({ sent: 0, failed: 0 });
    vi.spyOn(TelemetryClient.prototype, 'enable').mockImplementation(() => {});
    vi.spyOn(TelemetryClient.prototype, 'disable').mockImplementation(() => {});
    vi.spyOn(TelemetryClient.prototype, 'stopFlushTimer').mockImplementation(() => {});
    trackSpy = vi.spyOn(TelemetryClient.prototype, 'track').mockResolvedValue(undefined);
    uploadSessionSpy = vi.spyOn(TelemetryClient.prototype, 'uploadSession')
      .mockResolvedValue({ success: true, id: 'history-1' });
    setIntervalSpy = vi.spyOn(global, 'setInterval')
      .mockReturnValue({ unref: vi.fn() } as unknown as ReturnType<typeof setInterval>);
    vi.spyOn(global, 'clearInterval').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const sessionEnds = () => trackSpy.mock.calls.filter(([event]) => event.eventType === 'session_end');

  it('emits a single session_end when endSession is called twice', async () => {
    const manager = new TelemetryManager({ enabled: true });
    await manager.startSession('session-1', 'gpt-5', 'openai');
    await Promise.all([manager.endSession('completed'), manager.endSession('crashed')]);
    await manager.endSession('abandoned');

    expect(sessionEnds()).toHaveLength(1);
    expect(sessionEnds()[0]?.[0]).toMatchObject({ sessionId: 'session-1', eventData: { status: 'completed' } });
    expect(manager.lifecycleState).toBe('ended');
  });

  it('does not report a session_end for an unknown session but still flushes queued telemetry', async () => {
    const manager = new TelemetryManager({ enabled: true });
    await manager.endSession('completed');

    expect(sessionEnds()).toHaveLength(0);
    expect(TelemetryClient.prototype.syncAll).toHaveBeenCalledOnce();
    expect(manager.lifecycleState).toBe('idle');
  });

  it('does not restart the heartbeat for an ended session when telemetry is re-enabled', async () => {
    const manager = new TelemetryManager({ enabled: true });
    await manager.startSession('session-1', 'gpt-5', 'openai');
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    await manager.endSession('completed');

    manager.disable();
    manager.enable();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it('restarts the heartbeat for an active session when telemetry is re-enabled', async () => {
    const manager = new TelemetryManager({ enabled: true });
    await manager.startSession('session-1', 'gpt-5', 'openai');
    manager.disable();
    manager.enable();
    expect(setIntervalSpy).toHaveBeenCalledTimes(2);
  });

  it('keeps the ended session id for the final session upload that races endSession', async () => {
    const manager = new TelemetryManager({ enabled: true, enableSessionSync: true });
    await manager.startSession('session-1', 'gpt-5', 'openai');
    await manager.endSession('completed');

    expect(manager.getSessionId()).toBe('session-1');
    await expect(manager.syncSession({ messages: [] })).resolves.toEqual({ success: true, id: 'history-1' });
    expect(uploadSessionSpy).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-1' }));
  });

  it('starts a fresh session after one has ended and ends it independently', async () => {
    const manager = new TelemetryManager({ enabled: true });
    await manager.startSession('session-1', 'gpt-5', 'openai');
    await manager.endSession('completed');
    await manager.startSession('session-2', 'gpt-5', 'openai');
    expect(manager.lifecycleState).toBe('active');
    await manager.endSession('completed');

    expect(sessionEnds().map(([event]) => event.sessionId)).toEqual(['session-1', 'session-2']);
  });

  it('ignores startSession and endSession once shut down', async () => {
    const manager = new TelemetryManager({ enabled: true });
    await manager.startSession('session-1', 'gpt-5', 'openai');
    await manager.shutdown();
    trackSpy.mockClear();

    await manager.startSession('session-2', 'gpt-5', 'openai');
    await manager.endSession('completed');

    expect(trackSpy).not.toHaveBeenCalled();
    expect(manager.lifecycleState).toBe('shutdown');
    expect(manager.getSessionId()).toBe('session-1');
  });
});
