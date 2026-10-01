import { describe, expect, it, vi } from 'vitest';
import { ComputerUseLifecycle } from '../../src/computer/ComputerUseLifecycle.js';
import { HookManager, type HookContext } from '../../src/core/HookManager.js';

describe('Computer Use lifecycle', () => {
  it('reports a failed action with correlated details even when the run recovers', async () => {
    const hooks = new HookManager({ workspaceRoot: '/tmp', settings: { enabled: false } });
    const events: HookContext[] = [];
    const unsubscribe = hooks.subscribeLifecycle(context => events.push(context));
    const lifecycle = new ComputerUseLifecycle(hooks);
    const action = { tool: 'mcp__autohand-computer-use__type_text', toolCallId: 'write-1' };
    try {
      await lifecycle.startAction(action);
      await lifecycle.finishAction({ ...action, success: false, output: 'incomplete: delivered 0 of 11 characters', duration: 42 }, false);
      await lifecycle.startAction({ ...action, toolCallId: 'write-2' });
      await lifecycle.finishAction({ ...action, toolCallId: 'write-2', success: true, output: 'done' }, false);
      await lifecycle.finish('finished');
      const failures = events.filter(event => event.event === 'computer-use-error');
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({
        computerUseId: events[0]?.computerUseId, computerUseStatus: 'failed',
        tool: action.tool, toolCallId: 'write-1', success: false,
        error: 'incomplete: delivered 0 of 11 characters', duration: 42,
      });
      expect(events.map(event => event.event)).toEqual([
        'computer-use-start', 'computer-use-progress', 'computer-use-progress', 'computer-use-error',
        'computer-use-progress', 'computer-use-progress', 'computer-use-stop',
      ]);
      expect(events.at(-1)?.computerUseStatus).toBe('finished');
    } finally {
      unsubscribe();
    }
  });

  it('isolates observer failures and preserves the explicit error over display output', async () => {
    const executeHooks = vi.fn().mockRejectedValue(new Error('observer failed'));
    const lifecycle = new ComputerUseLifecycle({ executeHooks });
    const action = { tool: 'mcp__autohand-computer-use__type_text', toolCallId: 'write-1' };
    await lifecycle.startAction(action);
    await expect(lifecycle.finishAction({
      ...action, success: false, error: 'Delivery incomplete', output: 'Display summary',
    }, false)).resolves.toBeUndefined();
    expect(executeHooks.mock.calls.at(-1)?.slice(0, 2)).toEqual([
      'computer-use-error', expect.objectContaining({ error: 'Delivery incomplete', toolCallId: 'write-1' }),
    ]);
    await lifecycle.finish('failed');
    await lifecycle.finish('failed');
    expect(executeHooks.mock.calls.filter(([event]) => event === 'computer-use-stop')).toHaveLength(1);
  });

  it.each([
    { success: true, output: 'done', aborted: false, status: 'done' },
    { success: true, output: 'delivery unverifiable', aborted: false, status: 'unverified' },
    { success: false, output: 'cancelled', aborted: true, status: 'cancelled' },
  ])('does not emit an error for $status', async ({ success, output, aborted, status }) => {
    const executeHooks = vi.fn().mockResolvedValue([]);
    const lifecycle = new ComputerUseLifecycle({ executeHooks });
    const action = { tool: 'mcp__autohand-computer-use__type_text', toolCallId: 'write-1' };
    await lifecycle.startAction(action);
    await lifecycle.finishAction({ ...action, success, output }, aborted);
    expect(executeHooks.mock.calls.at(-1)?.[1]).toMatchObject({ computerUseStatus: status });
    expect(executeHooks.mock.calls.some(([event]) => event === 'computer-use-error')).toBe(false);
    await lifecycle.finish(aborted ? 'cancelled' : 'finished');
  });

  it('shares one run across concurrent actions, resets between turns, and leaves no timers', async () => {
    vi.useFakeTimers();
    const baseline = vi.getTimerCount();
    const hooks = new HookManager({ workspaceRoot: '/tmp', settings: { enabled: false } });
    const events: HookContext[] = [];
    const unsubscribe = hooks.subscribeLifecycle(context => events.push(context));
    const lifecycle = new ComputerUseLifecycle(hooks);
    const action = { tool: 'mcp__autohand-computer-use__get_window_state', toolCallId: 'a' };
    try {
      await lifecycle.startAction({ tool: 'mcp__other__get_window_state' });
      expect(events).toEqual([]);
      await Promise.all([lifecycle.startAction(action), lifecycle.startAction({ ...action, toolCallId: 'b' })]);
      await lifecycle.finishAction({ ...action, success: false, output: 'incomplete' }, false);
      await lifecycle.finish('cancelled');
      await lifecycle.finish('cancelled');
      expect(events.filter(event => event.event === 'computer-use-start')).toHaveLength(1);
      expect(events.filter(event => event.event === 'computer-use-stop')).toHaveLength(1);
      expect(events.at(-1)).toMatchObject({ computerUseStatus: 'cancelled', toolCallsCount: 2 });
      const firstId = events[0]?.computerUseId;
      await lifecycle.startAction(action);
      expect(events.at(-1)?.computerUseId).not.toBe(firstId);
      await lifecycle.finish('finished');
      expect(vi.getTimerCount()).toBe(baseline);
    } finally {
      unsubscribe();
      vi.useRealTimers();
    }
  });
});
