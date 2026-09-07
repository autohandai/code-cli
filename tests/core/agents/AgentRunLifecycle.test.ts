/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { createAgentRunLifecycleHandler } from '../../../src/core/agents/AgentRunLifecycle.js';
import { AgentRunStore, type AgentRun, type AgentRunLifecycleEvent } from '../../../src/core/agents/AgentRunStore.js';
import type { HookExecutionResult } from '../../../src/core/HookManager.js';
import type { HookResponse } from '../../../src/types.js';

function run(id = 'worker'): AgentRun {
  return { id, source: 'delegate', name: id, task: 'Inspect repository', workspaceRoot: '/repo',
    status: 'running', startedAt: 100, updatedAt: 150, cancellable: true };
}

function results(response: unknown, success = true): HookExecutionResult[] {
  return [{ hook: { event: 'subagent-progress', command: 'configured hook' }, success,
    duration: 0, response: response as HookResponse }];
}

function harness(executeHooks = vi.fn().mockResolvedValue([])) {
  const sendMessage = vi.fn().mockResolvedValue(true);
  const requestCancel = vi.fn().mockResolvedValue(true);
  const handle = createAgentRunLifecycleHandler({ executeHooks, sendMessage, requestCancel });
  return { executeHooks, sendMessage, requestCancel, handle };
}

describe('subagent lifecycle controls', () => {
  it('queues hook messages through the real store without recursive action events or deadlock', async () => {
    const executeHooks = vi.fn().mockResolvedValue(results({ additionalContext: 'Check tests' }));
    const store: AgentRunStore = new AgentRunStore({ onLifecycleEvent: createAgentRunLifecycleHandler({
      executeHooks,
      sendMessage: (id, content) => store.sendMessage(id, content),
      requestCancel: (id) => store.requestCancel(id),
    }) });
    const inbox: string[] = [];
    store.start({ id: 'worker', source: 'delegate', name: 'reader', task: 'Inspect code' });
    store.registerMessage('worker', (content) => { inbox.push(content); return true; });
    await store.waitForLifecycle('worker');
    await vi.waitFor(() => expect(executeHooks.mock.calls.map(([event]) => event)).toEqual(['subagent-start', 'subagent-message']));
    expect(inbox).toEqual(['Check tests']);
  });

  it('does not deliver a delayed hook action after its worker has finished', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const executeHooks = vi.fn().mockImplementation(async () => { await blocked; return results({ additionalContext: 'Too late' }); });
    const store: AgentRunStore = new AgentRunStore({ onLifecycleEvent: createAgentRunLifecycleHandler({
      executeHooks,
      sendMessage: (id, content) => store.sendMessage(id, content),
      requestCancel: (id) => store.requestCancel(id),
    }) });
    const receive = vi.fn().mockReturnValue(true);
    store.start({ id: 'worker', source: 'delegate', name: 'reader', task: 'Inspect code' });
    store.registerMessage('worker', receive);
    store.finish('worker', { status: 'completed' });
    release();
    await store.waitForLifecycle('worker');
    expect(receive).not.toHaveBeenCalled();
    expect(store.getSnapshot().runs[0].status).toBe('completed');
  });

  it('publishes run identity, progress and terminal state without exposing transport callbacks', async () => {
    const { handle, executeHooks } = harness();
    await handle({ type: 'start', run: run() });
    await handle({ type: 'progress', run: { ...run(), activity: 'Reading files' } });
    await handle({ type: 'message', run: run(), message: 'Also check tests' });
    await handle({ type: 'cancel-requested', run: { ...run(), cancelRequested: true } });
    await handle({ type: 'stop', run: { ...run(), status: 'cancelled', finishedAt: 200, error: 'Stopped' } });
    expect(executeHooks.mock.calls.map(([event]) => event)).toEqual([
      'subagent-start', 'subagent-progress', 'subagent-message', 'subagent-cancel-requested', 'subagent-stop',
    ]);
    expect(executeHooks).toHaveBeenCalledWith('subagent-start', expect.objectContaining({
      subagentId: 'worker', subagentName: 'worker', subagentSource: 'delegate', subagentWorkspace: '/repo',
      subagentTask: 'Inspect repository', subagentStatus: 'running',
    }));
    expect(executeHooks).toHaveBeenCalledWith('subagent-stop', expect.objectContaining({
      subagentSuccess: false, subagentStatus: 'cancelled', subagentDuration: 100, subagentError: 'Stopped',
    }));
  });

  it('routes hook messages only to the triggering run', async () => {
    const { handle, sendMessage } = harness(vi.fn().mockResolvedValue(results({ additionalContext: '  Check tests  ', subagentId: 'other' })));
    await handle({ type: 'start', run: run('selected') });
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith('selected', 'Check tests');
  });

  it('honours a literal stop response before messages and cancels only that run', async () => {
    const { handle, sendMessage, requestCancel } = harness(vi.fn().mockResolvedValue(results({ continue: false, additionalContext: 'Do more work' })));
    await handle({ type: 'progress', run: run('selected') });
    expect(requestCancel).toHaveBeenCalledExactlyOnceWith('selected');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it.each(['message', 'cancel-requested', 'stop'] as const)('does not recurse into controls from observational %s hooks', async (type) => {
    const { handle, sendMessage, requestCancel } = harness(vi.fn().mockResolvedValue(results({ continue: false, additionalContext: 'Repeat forever' })));
    await handle({ type, run: run() });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(requestCancel).not.toHaveBeenCalled();
  });

  it('treats async hooks as observation-only even when they return control fields', async () => {
    const asyncResults = results({ continue: false, additionalContext: 'Do more work' });
    asyncResults[0].hook.async = true;
    const { handle, sendMessage, requestCancel } = harness(vi.fn().mockResolvedValue(asyncResults));
    await handle({ type: 'start', run: run() });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(requestCancel).not.toHaveBeenCalled();
  });

  it('rejects malformed and failed responses, and bounds accepted context', async () => {
    const executeHooks = vi.fn()
      .mockResolvedValueOnce(results({ continue: 'false', additionalContext: { content: 'Not text' } }))
      .mockResolvedValueOnce(results({ additionalContext: 'Failed output' }, false))
      .mockResolvedValueOnce(results({ additionalContext: 'x'.repeat(9_000) }));
    const { handle, sendMessage, requestCancel } = harness(executeHooks);
    await handle({ type: 'start', run: run() });
    await handle({ type: 'progress', run: run() });
    await handle({ type: 'progress', run: run() });
    expect(requestCancel).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith('worker', 'x'.repeat(8_000));
  });

  it('isolates failures and serializes each worker without blocking siblings', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const executeHooks = vi.fn().mockImplementation(async (_event, context) => {
      if (context.subagentId === 'slow') await blocked;
      throw new Error('Hook failed');
    });
    const { handle } = harness(executeHooks);
    const slow = handle({ type: 'start', run: run('slow') });
    await expect(handle({ type: 'start', run: run('fast') })).resolves.toBeUndefined();
    release();
    await expect(slow).resolves.toBeUndefined();
    await expect(handle({ type: 'stop', run: run('slow') })).resolves.toBeUndefined();
  });

  it('coalesces queued progress while preserving control-event ordering', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const executeHooks = vi.fn().mockImplementation(async (event) => { if (event === 'subagent-start') await blocked; return []; });
    const { handle } = harness(executeHooks);
    const events: AgentRunLifecycleEvent[] = [
      { type: 'start', run: run() },
      { type: 'progress', run: { ...run(), activity: 'old' } },
      { type: 'progress', run: { ...run(), activity: 'latest' } },
      { type: 'message', run: run(), message: 'Check tests' },
      { type: 'stop', run: { ...run(), status: 'completed' } },
    ];
    const pending = events.map(handle);
    release();
    await Promise.all(pending);
    expect(executeHooks.mock.calls.map(([event]) => event)).toEqual([
      'subagent-start', 'subagent-progress', 'subagent-message', 'subagent-stop',
    ]);
    expect(executeHooks).toHaveBeenCalledWith('subagent-progress', expect.objectContaining({ subagentActivity: 'latest' }));
  });

  it('does not execute local control hooks for external Squad records', async () => {
    const { handle, executeHooks } = harness();
    await handle({ type: 'start', run: { ...run(), source: 'squad' } });
    expect(executeHooks).not.toHaveBeenCalled();
  });
});
