/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import { AgentRunsPanel } from '../../../src/ui/ink/AgentRunsPanel.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';
import { AgentRunStore, type AgentRun, type AgentRunsSnapshot } from '../../../src/core/agents/AgentRunStore.js';

afterEach(() => { cleanup(); vi.useRealTimers(); });

function run(id: string, overrides: Partial<AgentRun> = {}): AgentRun {
  return { id, source: 'delegate', name: id, task: `Task for ${id}`, status: 'running', startedAt: 100, updatedAt: 200,
    provider: 'autohandai', model: 'fantail', cancellable: true, ...overrides };
}

function panel(snapshot: AgentRunsSnapshot, onClose = vi.fn(), onCancel = vi.fn()) {
  return render(<ThemeProvider><AgentRunsPanel snapshot={snapshot} terminalRows={18} onClose={onClose} onCancel={onCancel} onCtrlC={() => {}} /></ThemeProvider>);
}

describe('AgentRunsPanel', () => {
  it('shows the selected workspace and original user request separately from the delegated task', async () => {
    const store = new AgentRunStore();
    store.start({
      id: 'checkout-reviewer', source: 'delegate', name: 'Checkout reviewer',
      task: 'Inspect payment validation.',
      workspaceRoot: '/selected-repository/worktree',
      userRequest: 'Review checkout payments. Do not edit files.',
    });
    const view = panel(store.getSnapshot());

    expect(view.lastFrame()).toContain('Workspace: /selected-repository/worktree');
    await new Promise<void>((resolve) => setImmediate(resolve));
    view.stdin.write('\r');

    await vi.waitFor(() => expect(view.lastFrame()).toContain('User request: Review checkout payments. Do not edit files.'));
    expect(view.lastFrame()).toContain('Workspace: /selected-repository/worktree');
    expect(view.lastFrame()).toContain('Task: Inspect payment validation.');
    expect(view.lastFrame()?.split('\n').length).toBeLessThanOrEqual(18);
  });

  it('bounds multiline workspace context in the list and scrolls the original request in narrow details', async () => {
    const view = render(<ThemeProvider><AgentRunsPanel snapshot={{ updatedAt: 200, runs: [run('reviewer', {
      workspaceRoot: `/selected/${'repository\n'.repeat(20)}worktree`,
      userRequest: `${'Review checkout payments without edits. '.repeat(12)}\nREQUEST_END\u001b[2J`,
      task: 'Inspect payment validation.',
      output: 'CHECKOUT_PROOF', status: 'completed', cancellable: false,
    })] }} terminalRows={18} terminalColumns={36} onClose={() => {}} onCtrlC={() => {}} /></ThemeProvider>);

    expect(view.lastFrame()?.split('\n').length).toBeLessThanOrEqual(18);
    await new Promise<void>((resolve) => setImmediate(resolve));
    view.stdin.write('\r');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('↑/↓ scroll'));
    let sawUserRequest = false;
    let sawRequestEnd = false;
    for (let index = 0; index < 70; index += 1) {
      view.stdin.write('\u001b[B');
      await new Promise<void>((resolve) => setImmediate(resolve));
      const frame = view.lastFrame() ?? '';
      sawUserRequest ||= frame.includes('User request:');
      sawRequestEnd ||= frame.includes('REQUEST_END');
      expect(frame.split('\n').length).toBeLessThanOrEqual(18);
      expect(frame).not.toContain('\u001b[2J');
    }
    expect(sawUserRequest).toBe(true);
    expect(sawRequestEnd).toBe(true);
    expect(view.lastFrame()).toContain('Task: Inspect payment validation.');
    expect(view.lastFrame()).toContain('CHECKOUT_PROOF');
  });

  it('advances a running session duration while waiting without new progress messages', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(5000);
    const view = panel({ updatedAt: 1000, runs: [run('waiting', { startedAt: 1000, updatedAt: 1000 })] });
    expect(view.lastFrame()).toContain('4s');
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(view.lastFrame()).toContain('6s'));
  });

  it('keeps details visible when a progress update shortens the selected output', async () => {
    const long = run('tester', { output: 'a line\n'.repeat(30) });
    const view = panel({ updatedAt: 200, runs: [long] });
    await new Promise<void>((resolve) => setImmediate(resolve));
    view.stdin.write('\r');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('↑/↓ scroll'));
    for (let i = 0; i < 30; i += 1) {
      view.stdin.write('\u001b[B');
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    view.rerender(<ThemeProvider><AgentRunsPanel snapshot={{ updatedAt: 300, runs: [{ ...long, output: 'SHORT_PROOF' }] }}
      terminalRows={18} onClose={() => {}} onCtrlC={() => {}} /></ThemeProvider>);
    await vi.waitFor(() => expect(view.lastFrame()).toContain('SHORT_PROOF'));
  });
  it('labels external Squad scope without inventing session parentage, model, or usage', async () => {
    const view = panel({ updatedAt: 200, runs: [run('external', {
      source: 'squad', provider: undefined, model: undefined, cancellable: false,
    })] });
    await new Promise<void>((resolve) => setImmediate(resolve));
    view.stdin.write('\r');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Scope: Squad external (independent budget)'));
    expect(view.lastFrame()).not.toContain('Parent: session lead');
    expect(view.lastFrame()).toContain('Provider unavailable · model unavailable');
    expect(view.lastFrame()).toContain('Usage unavailable');
    expect(view.lastFrame()).toContain('Workspace: unavailable');
    expect(view.lastFrame()).not.toContain('User request:');
  });

  it('does not show an outstanding stop request on a terminal run', async () => {
    const view = panel({ updatedAt: 200, runs: [run('stopped', {
      status: 'cancelled', cancellable: false, cancelRequested: true,
    })] });
    await new Promise<void>((resolve) => setImmediate(resolve));
    view.stdin.write('\r');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('stopped · cancelled'));
    expect(view.lastFrame()).not.toContain('waiting for agent to stop');
  });
  it('scrolls horizontally long results as wrapped lines within the viewport', async () => {
    const view = render(<ThemeProvider><AgentRunsPanel snapshot={{ updatedAt: 200, runs: [run('tester', {
      output: `${'wide output '.repeat(60)}FINAL_PROOF`, status: 'completed', cancellable: false,
    })] }} terminalRows={18} terminalColumns={36} onClose={() => {}} onCtrlC={() => {}} /></ThemeProvider>);
    await new Promise<void>((resolve) => setImmediate(resolve));
    view.stdin.write('\r');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('↑/↓ scroll'));
    for (let i = 0; i < 35; i += 1) {
      view.stdin.write('\u001b[B');
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    await vi.waitFor(() => expect(view.lastFrame()).toContain('FINAL_PROOF'));
    expect(view.lastFrame()?.split('\n').length).toBeLessThanOrEqual(18);
  });
  it('does not cancel a different run if the selected run disappears during confirmation', async () => {
    const cancel = vi.fn();
    const view = panel({ updatedAt: 200, runs: [run('first'), run('second')] }, vi.fn(), cancel);
    await new Promise<void>((resolve) => setImmediate(resolve));
    view.stdin.write('c');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Cancel first?'));
    view.rerender(<ThemeProvider><AgentRunsPanel snapshot={{ updatedAt: 300, runs: [run('second')] }}
      onClose={() => {}} onCancel={cancel} onCtrlC={() => {}} /></ThemeProvider>);
    await new Promise<void>((resolve) => setImmediate(resolve));
    view.stdin.write('y');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Run is no longer available to cancel.'));
    expect(cancel).not.toHaveBeenCalled();
  });

  it('shows synchronous cancellation failures without breaking the inspector', async () => {
    const view = panel({ updatedAt: 200, runs: [run('tester')] }, vi.fn(), vi.fn(() => { throw new Error('Transport unavailable'); }));
    await new Promise<void>((resolve) => setImmediate(resolve));
    view.stdin.write('c');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Cancel tester?'));
    view.stdin.write('y');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Transport unavailable'));
    expect(view.lastFrame()).toContain('tester · running');
  });

  it('requires confirmation to cancel and leaves Escape available to restore the composer', async () => {
    const cancel = vi.fn();
    const close = vi.fn();
    const view = panel({ updatedAt: 200, runs: [run('tester')] }, close, cancel);
    await new Promise<void>((resolve) => setImmediate(resolve));
    view.stdin.write('c');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Cancel tester?'));
    expect(cancel).not.toHaveBeenCalled();
    view.stdin.write('n');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Esc list'));
    view.stdin.write('c');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Cancel tester?'));
    view.stdin.write('y');
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith('tester'));
    view.stdin.write('\u001b');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Enter details'));
    view.stdin.write('\u001b');
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  });

  it('bounds the list and scrolls through long details without leaking terminal controls', async () => {
    const view = panel({ updatedAt: 200, runs: Array.from({ length: 30 }, (_, i) => run(`worker-${i}`, {
      task: 'Investigate', output: `${'line\n'.repeat(30)}FINAL_PROOF\u001b[2J`,
    })) });
    expect(view.lastFrame()?.split('\n').length).toBeLessThanOrEqual(18);
    await new Promise<void>((resolve) => setImmediate(resolve));
    view.stdin.write('\r');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Task: Investigate'));
    for (let i = 0; i < 35; i += 1) {
      view.stdin.write('\u001b[B');
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    await vi.waitFor(() => expect(view.lastFrame()).toContain('FINAL_PROOF'));
    expect(view.lastFrame()).not.toContain('\u001b[2J');
    expect(view.lastFrame()?.split('\n').length).toBeLessThanOrEqual(18);
  });
  it('selects a child, shows provider usage output and parentage, and returns to the list', async () => {
    const view = panel({ updatedAt: 200, runs: [run('reviewer'), run('tester', {
      parentId: 'reviewer', status: 'completed', finishedAt: 1100, cancellable: false,
      usage: { promptTokens: 30, completionTokens: 12, totalTokens: 42 }, output: 'Checkout visual proof passed.',
    })] });
    expect(view.lastFrame()).toContain('Session agents');
    await new Promise<void>((resolve) => setImmediate(resolve));
    view.stdin.write('\u001b[B');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('›   tester'));
    view.stdin.write('\r');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Checkout visual proof passed.'));
    expect(view.lastFrame()).toContain('autohandai · fantail');
    expect(view.lastFrame()).toContain('42 tokens');
    expect(view.lastFrame()).toContain('Parent: reviewer');
    view.stdin.write('\u001b');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Enter details'));
  });
});
