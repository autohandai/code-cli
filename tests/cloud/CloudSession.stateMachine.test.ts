import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLOUD_SESSION_LIFECYCLE, CloudSession } from '../../src/cloud/CloudSession.js';
import { CloudClient, CloudRequestError } from '../../src/cloud/CloudClient.js';
import { reachableStates, StateMachine, terminalStates } from '../../src/utils/stateMachine.js';
import { randomEventWalk } from '../helpers/stateMachineProperties.js';

const id = '11111111-1111-4111-8111-111111111111';
const conversation = { id, title: 'Repair parser', model: 'moa', updated_at: '2026-10-12T00:00:00Z' };
function fixture() {
  const client = new CloudClient({ token: 'fixture-token', userId: 'ada', accountId: 'personal_fixture' });
  vi.spyOn(client, 'detail').mockResolvedValue({ conversation, messages: [] });
  vi.spyOn(client, 'queue').mockResolvedValue({ jobs: [], paused: false });
  vi.spyOn(client, 'interactions').mockResolvedValue({ interaction: null });
  vi.spyOn(client, 'events').mockImplementation(async function* () { yield { type: 'messages', messages: [] }; });
  return client;
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('CLOUD_SESSION_LIFECYCLE transition table', () => {
  const events = ['start', 'connected', 'failed', 'end', 'dispose'] as const;

  it('declares the observation lifecycle edges', () => {
    expect(CLOUD_SESSION_LIFECYCLE.initial).toBe('idle');
    expect(CLOUD_SESSION_LIFECYCLE.transitions).toEqual({
      idle: { start: 'connecting', dispose: 'disposed' },
      connecting: { connected: 'observing', failed: 'ended', dispose: 'disposed' },
      observing: { end: 'ended', dispose: 'disposed' },
      ended: { start: 'connecting', dispose: 'disposed' },
      disposed: {},
    });
  });

  it('rejects a second start while connecting or observing', () => {
    const machine = new StateMachine(CLOUD_SESSION_LIFECYCLE);
    machine.send('start');
    expect(machine.can('start')).toBe(false);
    machine.send('connected');
    expect(machine.can('start')).toBe(false);
  });

  it('has disposed as its only terminal state and reaches every state', () => {
    expect(terminalStates(CLOUD_SESSION_LIFECYCLE)).toEqual(['disposed']);
    expect(reachableStates(CLOUD_SESSION_LIFECYCLE)).toEqual(new Set(Object.keys(CLOUD_SESSION_LIFECYCLE.transitions)));
  });

  it('accepts exactly the declared edges under random event walks', () => {
    randomEventWalk(CLOUD_SESSION_LIFECYCLE, events, { seeds: 50, steps: 40 });
  });
});

describe('CloudSession lifecycle behaviour', () => {
  it('runs one observation loop when start is called concurrently', async () => {
    vi.useFakeTimers();
    const client = fixture();
    const session = new CloudSession(client, conversation);
    await Promise.all([session.start(), session.start()]);
    await vi.advanceTimersByTimeAsync(1);
    expect(client.events).toHaveBeenCalledOnce();
    expect(session.lifecycleState).toBe('observing');
    session.dispose();
    await session.settled();
  });

  it('leaves observation ended when the connection fails so start can be retried', async () => {
    const client = fixture();
    vi.mocked(client.queue).mockRejectedValueOnce(new Error('offline'));
    const session = new CloudSession(client, conversation);
    await expect(session.start()).rejects.toThrow('offline');
    expect(session.lifecycleState).toBe('ended');
    await session.start();
    expect(session.lifecycleState).toBe('observing');
    session.dispose();
    await session.settled();
  });

  it('reconnects observation through /refresh after the cloud rejects the event stream', async () => {
    vi.useFakeTimers();
    const client = fixture();
    let rejectFirst = true;
    vi.mocked(client.events).mockImplementation(async function* () {
      if (rejectFirst) { rejectFirst = false; throw new CloudRequestError('Session access denied.', 403, undefined); }
      yield { type: 'messages', messages: [] };
    });
    const session = new CloudSession(client, conversation);
    await session.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(session.lifecycleState).toBe('ended');
    expect(session.getSnapshot().connected).toBe(false);

    expect(await session.submit('/refresh')).toBe(true);
    await vi.advanceTimersByTimeAsync(1);

    expect(client.events).toHaveBeenCalledTimes(2);
    expect(session.lifecycleState).toBe('observing');
    expect(session.getSnapshot().connected).toBe(true);
    session.dispose();
    await session.settled();
  });

  it('keeps /refresh as the recovery path when a reconnect attempt itself fails', async () => {
    vi.useFakeTimers();
    const client = fixture();
    let rejectFirst = true;
    vi.mocked(client.events).mockImplementation(async function* () {
      if (rejectFirst) { rejectFirst = false; throw new CloudRequestError('Unauthorized', 401, undefined); }
      yield { type: 'messages', messages: [] };
    });
    const session = new CloudSession(client, conversation);
    await session.start();
    await vi.advanceTimersByTimeAsync(1);
    vi.mocked(client.queue).mockRejectedValueOnce(new Error('still offline'));
    expect(await session.submit('/refresh')).toBe(false);
    expect(session.lifecycleState).toBe('ended');
    expect(await session.submit('/refresh')).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(session.lifecycleState).toBe('observing');
    expect(client.events).toHaveBeenCalledTimes(2);
    session.dispose();
    await session.settled();
  });

  it('keeps a single periodic refresh timer after reconnecting', async () => {
    vi.useFakeTimers();
    const baseline = vi.getTimerCount();
    const client = fixture();
    let rejectFirst = true;
    vi.mocked(client.events).mockImplementation(async function* () {
      if (rejectFirst) { rejectFirst = false; throw new CloudRequestError('Not found', 404, undefined); }
      yield { type: 'messages', messages: [] };
    });
    const session = new CloudSession(client, conversation);
    await session.start();
    await vi.advanceTimersByTimeAsync(1);
    await session.submit('/refresh');
    await vi.advanceTimersByTimeAsync(1);
    // one periodic refresh timer plus one observation backoff timer
    expect(vi.getTimerCount()).toBe(baseline + 2);
    session.dispose();
    expect(vi.getTimerCount()).toBe(baseline);
  });

  it('does not start observation from /refresh when the session was never started', async () => {
    const client = fixture();
    const session = new CloudSession(client, conversation);
    expect(await session.submit('/refresh')).toBe(true);
    expect(client.events).not.toHaveBeenCalled();
    expect(session.lifecycleState).toBe('idle');
    session.dispose();
  });

  it('treats start and dispose after dispose as silent no-ops', async () => {
    const client = fixture();
    const session = new CloudSession(client, conversation);
    session.dispose();
    session.dispose();
    await session.start();
    expect(session.lifecycleState).toBe('disposed');
    expect(client.queue).not.toHaveBeenCalled();
  });

  it('does not begin observing when disposed while connecting', async () => {
    const client = fixture();
    const session = new CloudSession(client, conversation);
    const starting = session.start();
    session.dispose();
    await starting;
    expect(client.events).not.toHaveBeenCalled();
    expect(session.lifecycleState).toBe('disposed');
  });
});
