import { describe, expect, it, vi } from 'vitest';
import { ComputerUseLifecycle } from '../../src/computer/ComputerUseLifecycle.js';
import { HookManager, type HookContext } from '../../src/core/HookManager.js';

describe('Computer Use lifecycle', () => {
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
