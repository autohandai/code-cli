/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { AgentRunStore } from '../../../src/core/agents/AgentRunStore.js';

describe('AgentRunStore', () => {
  it('queues messages only for the selected active run and rejects unavailable targets', async () => {
    const store = new AgentRunStore();
    for (const id of ['first', 'second']) store.start({ id, source: 'delegate', name: 'reader', task: id });
    const firstInbox = vi.fn(() => true);
    const secondInbox = vi.fn(() => true);
    store.registerMessage('first', firstInbox);
    store.registerMessage('second', secondInbox);
    expect(store.getSnapshot().runs[0].messageable).toBe(true);
    expect(await store.sendMessage('second', '  Inspect the tests.  ')).toBe(true);
    expect(firstInbox).not.toHaveBeenCalled();
    expect(secondInbox).toHaveBeenCalledWith('Inspect the tests.');
    expect(await store.sendMessage('second', ' ')).toBe(false);
    expect(await store.sendMessage('second', 'x'.repeat(8001))).toBe(false);
    store.finish('second', { status: 'completed' });
    expect(store.getSnapshot().runs[1].messageable).toBe(false);
    expect(await store.sendMessage('second', 'Too late')).toBe(false);
    expect(await store.sendMessage('missing', 'No target')).toBe(false);
    store.registerCancel('first', () => {});
    await store.requestCancel('first');
    expect(await store.sendMessage('first', 'Cancelling')).toBe(false);
    store.start({ id: 'external', source: 'squad', name: 'external', task: 'Independent work' });
    store.registerMessage('external', firstInbox);
    expect(await store.sendMessage('external', 'Unsupported')).toBe(false);
    expect(secondInbox).toHaveBeenCalledOnce();
  });

  it('returns truthful message failures and safely unregisters replaced message handlers', async () => {
    const store = new AgentRunStore();
    store.start({ id: 'live', source: 'team', name: 'reader', task: 'Read' });
    const unregister = store.registerMessage('live', () => true);
    store.registerMessage('live', () => { throw new Error('Transport unavailable'); });
    unregister();
    expect(store.getSnapshot().runs[0].messageable).toBe(true);
    expect(await store.sendMessage('live', 'Read tests')).toBe(false);
    store.registerMessage('live', () => false);
    expect(await store.sendMessage('live', 'Read tests')).toBe(false);
  });

  it('publishes isolated lifecycle events without recursively awaiting action observers', async () => {
    const events: string[] = [];
    const store = new AgentRunStore({ onLifecycleEvent: async event => {
      events.push(event.type);
      if (event.type === 'start') await store.sendMessage(event.run.id, 'Start with tests');
      if (event.type === 'message') throw new Error('Observer failed');
    } });
    store.start({ id: 'live', source: 'delegate', name: 'reader', task: 'Read' });
    const inbox = vi.fn(() => true);
    store.registerMessage('live', inbox);
    await vi.waitFor(() => expect(inbox).toHaveBeenCalledWith('Start with tests'));
    store.progress('live', { activity: 'read_file' });
    store.registerCancel('live', () => {});
    await store.requestCancel('live');
    store.finish('live', { status: 'cancelled' });
    await vi.waitFor(() => expect(events).toEqual(['start', 'message', 'progress', 'cancel-requested', 'stop']));
  });

  it('waits for earlier pending lifecycle work even when a newer observer finishes first', async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const store = new AgentRunStore({ onLifecycleEvent: async event => {
      if (event.type === 'start') { started.resolve(); await release.promise; }
    } });
    store.start({ id: 'live', source: 'team', name: 'reader', task: 'Read' });
    await started.promise;
    store.progress('live', { activity: 'Thinking' });
    const settled = vi.fn();
    const ready = store.waitForLifecycle('live').then(settled);
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(settled).not.toHaveBeenCalled();
    release.resolve();
    await ready;
    expect(settled).toHaveBeenCalledOnce();
  });

  it('isolates failing observers and honours cancellation already requested through a team command', async () => {
    const store = new AgentRunStore();
    expect(() => store.subscribe(() => { throw new Error('unmounted renderer'); })).not.toThrow();
    store.start({ id: 'live', source: 'team', name: 'tester', task: 'Test checkout' });
    const cancel = vi.fn();
    store.registerCancel('live', cancel);
    store.progress('live', { cancelRequested: true });
    expect(await store.requestCancel('live')).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('retains the most recently finished run even when it started first', () => {
    const store = new AgentRunStore({ maxCompletedRuns: 1, now: () => 1 });
    store.start({ id: 'slow', source: 'delegate', name: 'slow', task: 'Slow task' });
    store.start({ id: 'fast', source: 'delegate', name: 'fast', task: 'Fast task' });
    store.finish('fast', { status: 'completed' });
    store.finish('slow', { status: 'completed' });
    expect(store.getSnapshot().runs.map((run) => run.id)).toEqual(['slow']);
  });

  it('refreshes external Squad runs without replacing session work or exposing cancellation', () => {
    const store = new AgentRunStore();
    store.start({ id: 'local', source: 'delegate', name: 'tester', task: 'Local task' });
    store.replaceExternal([{ id: 'squad:run-1', source: 'squad', name: 'external', task: 'External task',
      status: 'running', startedAt: 1, updatedAt: 2, cancellable: true }], 'Squad uses an independent budget.');
    expect(store.getSnapshot()).toMatchObject({ externalStatus: 'Squad uses an independent budget.',
      runs: [{ id: 'local' }, { id: 'squad:run-1', cancellable: false }] });
    store.registerCancel('squad:run-1', vi.fn());
    expect(store.getSnapshot().runs[1].cancellable).toBe(false);
    store.replaceExternal([], 'Squad runtime unavailable.');
    expect(store.getSnapshot().runs.map((run) => run.id)).toEqual(['local']);
  });
  it('requests cancellation once and waits for the runner to report its terminal state', async () => {
    const store = new AgentRunStore();
    store.start({ id: 'live', source: 'delegate', name: 'tester', task: 'Test checkout' });
    const cancel = vi.fn();
    store.registerCancel('live', cancel);
    expect(await store.requestCancel('live')).toBe(true);
    expect(await store.requestCancel('live')).toBe(false);
    expect(cancel).toHaveBeenCalledOnce();
    expect(store.getSnapshot().runs[0]).toMatchObject({ status: 'running', cancelRequested: true });
    store.progress('live', { activity: 'Cancellation requested; waiting for agent to stop.' });
    store.finish('live', { status: 'cancelled' });
    expect(store.getSnapshot().runs[0]).toMatchObject({ status: 'cancelled', cancellable: false, cancelRequested: false });
    expect(store.getSnapshot().runs[0].activity).toBeUndefined();
    expect(await store.requestCancel('live')).toBe(false);
  });

  it('reports failed cancellation without marking the worker stopped and allows retry', async () => {
    const store = new AgentRunStore();
    store.start({ id: 'live', source: 'team', name: 'tester', task: 'Test checkout' });
    store.registerCancel('live', () => { throw new Error('transport unavailable'); });
    expect(await store.requestCancel('live')).toBe(false);
    expect(store.getSnapshot().runs[0]).toMatchObject({ status: 'running', cancelRequested: false, error: 'transport unavailable' });
    const cancel = vi.fn();
    store.registerCancel('live', cancel);
    expect(await store.requestCancel('live')).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('bounds historical output without evicting running agents or exposing mutable usage', () => {
    const store = new AgentRunStore({ maxCompletedRuns: 1, maxOutputCharacters: 8 });
    const usage = { promptTokens: 1, completionTokens: 2, totalTokens: 3 };
    for (const id of ['live', 'first', 'second']) {
      store.start({ id, source: 'team', name: id, task: id });
    }
    store.progress('live', { usage });
    usage.totalTokens = 900;
    store.finish('first', { status: 'failed', error: 'old failure' });
    store.finish('second', { status: 'completed', result: '0123456789abcdef' });
    const snapshot = store.getSnapshot();
    expect(snapshot.runs.map((run) => run.id)).toEqual(['live', 'second']);
    expect(snapshot.runs[0].usage?.totalTokens).toBe(3);
    expect(snapshot.runs[1].output).toBe('89abcdef');
    snapshot.runs[0].usage!.totalTokens = 400;
    expect(store.getSnapshot().runs[0].usage?.totalTokens).toBe(3);
    store.progress('second', { status: 'running' });
    expect(store.getSnapshot().runs[1].status).toBe('completed');
  });
  it('retains a completed child with its parent, model, usage, and output for a later subscriber', () => {
    const store = new AgentRunStore({ now: () => 100 });
    store.start({ id: 'child', parentId: 'lead', source: 'delegate', name: 'reviewer', task: 'Review authentication', provider: 'autohandai', model: 'fantail' });
    store.progress('child', { activity: 'read_file', usage: { promptTokens: 30, completionTokens: 12, totalTokens: 42 } });
    store.finish('child', { status: 'completed', result: 'No unsafe paths found.' });
    const listener = vi.fn();
    store.subscribe(listener);

    expect(listener).toHaveBeenCalledWith({ updatedAt: 100, runs: [expect.objectContaining({
      id: 'child', parentId: 'lead', source: 'delegate', name: 'reviewer', task: 'Review authentication',
      provider: 'autohandai', model: 'fantail', status: 'completed', output: 'No unsafe paths found.',
      usage: { promptTokens: 30, completionTokens: 12, totalTokens: 42 }, startedAt: 100, finishedAt: 100, cancellable: false,
    })] });
  });
});
