import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudSession } from '../../src/cloud/CloudSession.js';
import { CloudClient } from '../../src/cloud/CloudClient.js';

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

describe('cloud terminal session lifecycle', () => {
  it('queues Enter without steering or authorizing tools', async () => {
    const client = fixture(), send = vi.spyOn(client, 'send').mockResolvedValue({ id, revision: 0, state: 'queued', content: 'Keep public API' });
    const steer = vi.spyOn(client, 'steer'), answer = vi.spyOn(client, 'answer');
    const session = new CloudSession(client, conversation);
    await session.submit('Keep public API');
    expect(send).toHaveBeenCalledWith(id, 'Keep public API', 'moa', expect.any(String), 'auto', expect.any(AbortSignal));
    expect(steer).not.toHaveBeenCalled(); expect(answer).not.toHaveBeenCalled();
    session.dispose();
  });
  it('steers only the selected queued row using its saved revision', async () => {
    const client = fixture(), queued = { id, state: 'queued' as const, revision: 7, content: 'Selected correction' };
    vi.mocked(client.queue).mockResolvedValue({ jobs: [queued], paused: false });
    const steer = vi.spyOn(client, 'steer').mockResolvedValue({ job: queued });
    const session = new CloudSession(client, conversation);
    await session.refresh(); await session.submit('/steer');
    expect(steer).toHaveBeenCalledWith(id, queued, expect.any(AbortSignal));
    session.dispose();
  });
  it('preserves the selected message when a refreshed queue changes order', async () => {
    const client = fixture();
    const first = { id, state: 'queued' as const, revision: 1, content: 'First correction' };
    const selected = { ...first, id: '22222222-2222-4222-8222-222222222222', revision: 7, content: 'Selected correction' };
    vi.mocked(client.queue).mockResolvedValueOnce({ jobs: [first, selected], paused: false }).mockResolvedValue({ jobs: [selected, first], paused: false });
    const steer = vi.spyOn(client, 'steer').mockResolvedValue({ job: selected });
    const session = new CloudSession(client, conversation);
    await session.refresh(); session.select(1); await session.refresh(); await session.submit('/steer');
    expect(steer).toHaveBeenCalledWith(id, selected, expect.any(AbortSignal));
    session.dispose();
  });
  it('requires another selection when the selected message leaves the queue', async () => {
    const client = fixture();
    const first = { id, state: 'queued' as const, revision: 1, content: 'First correction' };
    const selected = { ...first, id: '22222222-2222-4222-8222-222222222222', content: 'Selected correction' };
    vi.mocked(client.queue).mockResolvedValueOnce({ jobs: [first, selected], paused: false }).mockResolvedValue({ jobs: [first], paused: false });
    const steer = vi.spyOn(client, 'steer').mockResolvedValue({ job: first });
    const session = new CloudSession(client, conversation);
    await session.refresh(); session.select(1); await session.refresh(); await session.refresh();
    expect(await session.submit('/steer')).toBe(false);
    expect(steer).not.toHaveBeenCalled();
    session.select(1); expect(await session.submit('/steer')).toBe(true);
    expect(steer).toHaveBeenCalledWith(id, first, expect.any(AbortSignal));
    session.dispose();
  });
  it('keeps a failed draft available and does not resubmit after ambiguous admission', async () => {
    const client = fixture(), send = vi.spyOn(client, 'send').mockRejectedValue(new Error('connection lost'));
    const session = new CloudSession(client, conversation);
    expect(await session.submit('Repair parser')).toBe(false);
    expect(session.getSnapshot().notice).toContain('connection lost');
    expect(send).toHaveBeenCalledOnce();
    await session.submit('Repair parser');
    expect(send.mock.calls[1][3]).toBe(send.mock.calls[0][3]);
    session.dispose();
  });
  it('clears an admitted draft even when the following refresh fails', async () => {
    const client = fixture();
    vi.spyOn(client, 'send').mockResolvedValue({ id, revision: 0, state: 'queued', content: 'Repair parser' });
    vi.mocked(client.queue).mockRejectedValue(new Error('observation lost'));
    const session = new CloudSession(client, conversation);
    expect(await session.submit('Repair parser')).toBe(true);
    expect(session.getSnapshot().notice).toContain('admitted');
    session.dispose();
  });
  it('detaches observation and clears timers without stopping the cloud run', async () => {
    vi.useFakeTimers(); const baseline = vi.getTimerCount(), client = fixture(), stop = vi.spyOn(client, 'stop');
    const session = new CloudSession(client, conversation);
    await session.start();
    await vi.advanceTimersByTimeAsync(1);
    session.dispose();
    await vi.advanceTimersByTimeAsync(1);
    expect(stop).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(baseline);
  });
  it('aborts an in-flight admission request on detach without sending stop', async () => {
    const client = fixture();
    const send = vi.spyOn(client, 'send').mockImplementation((...args) => new Promise((_resolve, reject) => {
      const signal: unknown = Reflect.get(args, 5);
      if (signal instanceof AbortSignal) signal.addEventListener('abort', () => reject(new Error('detached')), { once: true });
    }));
    const stop = vi.spyOn(client, 'stop'), session = new CloudSession(client, conversation);
    const operation = session.submit('Repair parser');
    expect(Reflect.get(send.mock.calls[0], 5)).toBeInstanceOf(AbortSignal);
    session.dispose(); expect(await operation).toBe(false); expect(stop).not.toHaveBeenCalled();
  });
  it('never approves without an explicit reviewed decision', async () => {
    const client = fixture(), answer = vi.spyOn(client, 'answer').mockResolvedValue({ job: { id, state: 'queued', revision: 0, content: '' } });
    const interaction = { id, revision: 3, state: 'pending', payload: { kind: 'approval' as const, repository: 'autohand/parser', action: { action: 'command', command: 'bun test' } } };
    vi.mocked(client.interactions).mockResolvedValue({ interaction });
    const confirm = vi.fn().mockResolvedValue(false);
    const session = new CloudSession(client, conversation, { confirmApproval: confirm });
    await session.refresh(); expect(answer).not.toHaveBeenCalled();
    await session.submit('/approve');
    expect(confirm).toHaveBeenCalledWith(interaction);
    expect(answer).not.toHaveBeenCalled();
    session.dispose();
  });
  it('opens the same account-owned session in Desktop', async () => {
    const client = fixture(), open = vi.fn().mockResolvedValue(undefined);
    const session = new CloudSession(client, conversation, { open });
    expect(await session.submit('/open desktop')).toBe(true);
    expect(open).toHaveBeenCalledWith(`autohand://cloud/session/${id}?account=personal_fixture`);
    session.dispose();
  });
  it('does not apply cloud changes locally when opening or detaching a session', async () => {
    const client = fixture(), open = vi.fn().mockResolvedValue(undefined), stop = vi.spyOn(client, 'stop');
    const session = new CloudSession(client, conversation, { open });
    await session.submit('/open web');
    expect(open).toHaveBeenCalledWith(`https://dev.autohand.ai/c/${id}?account=personal_fixture`);
    session.dispose(); expect(stop).not.toHaveBeenCalled();
  });
});
