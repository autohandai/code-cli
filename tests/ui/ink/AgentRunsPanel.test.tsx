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
import { AgentUI, createInitialUIState } from '../../../src/ui/ink/AgentUI.js';
import { I18nProvider } from '../../../src/ui/i18n/index.js';

afterEach(() => { cleanup(); vi.useRealTimers(); });

function run(id: string, overrides: Partial<AgentRun> = {}): AgentRun {
  return { id, source: 'delegate', name: id, task: `Task for ${id}`, status: 'running', startedAt: 100, updatedAt: 200,
    provider: 'autohandai', model: 'fantail', cancellable: true, ...overrides };
}

function panel(snapshot: AgentRunsSnapshot, onClose = vi.fn(), onCancel = vi.fn()) {
  return render(<ThemeProvider><AgentRunsPanel snapshot={snapshot} terminalRows={18} onClose={onClose} onCancel={onCancel} onCtrlC={() => {}} /></ThemeProvider>);
}

describe('AgentRunsPanel', () => {
  it('routes inspector messages through the active agent UI without submitting a main-agent instruction', async () => {
    const onMessageAgentRun = vi.fn(async () => true);
    const onInstruction = vi.fn();
    const view = render(<I18nProvider><ThemeProvider><AgentUI state={{
      ...createInitialUIState(), isWorking: true, agentRunsPanelVisible: true,
      agentRuns: { updatedAt: 200, runs: [run('reader', { messageable: true })] },
    }} onMessageAgentRun={onMessageAgentRun} onInstruction={onInstruction}
      onEscape={() => {}} onCtrlC={() => {}} /></ThemeProvider></I18nProvider>);
    await new Promise<void>((resolve) => setImmediate(resolve));
    view.stdin.write('m');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Message reader'));
    view.stdin.write('Stay read-only.');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Stay read-only.'));
    view.stdin.write('\r');
    await vi.waitFor(() => expect(onMessageAgentRun).toHaveBeenCalledWith('reader', 'Stay read-only.'));
    expect(onInstruction).not.toHaveBeenCalled();
  });

  it('queues a message for the selected worker without cancelling or changing its task', async () => {
    const onMessage = vi.fn(async () => true);
    const onCancel = vi.fn();
    const view = render(<ThemeProvider><AgentRunsPanel snapshot={{ updatedAt: 200, runs: [
      run('reader', { messageable: true }), run('tester', { messageable: true }),
    ] }} terminalRows={18} onMessage={onMessage} onCancel={onCancel}
      onClose={() => {}} onCtrlC={() => {}} /></ThemeProvider>);
    await new Promise<void>((resolve) => setImmediate(resolve));
    view.stdin.write('\u001b[B');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('› tester'));
    view.stdin.write('m');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Message tester'));
    view.stdin.write('Focus on cancellation coverage.');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Focus on cancellation coverage.'));
    view.stdin.write('\r');

    await vi.waitFor(() => expect(onMessage).toHaveBeenCalledWith('tester', 'Focus on cancellation coverage.'));
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Message queued for next model request.'));
    expect(view.lastFrame()).toContain('Task for tester');
    expect(onCancel).not.toHaveBeenCalled();
    expect(view.lastFrame()?.split('\n').length).toBeLessThanOrEqual(18);
  });

  it('does not message a replacement run when the target disappears while drafting', async () => {
    const onMessage = vi.fn(async () => true);
    const renderPanel = (runs: AgentRun[]) => <ThemeProvider><AgentRunsPanel snapshot={{ updatedAt: 200, runs }}
      onMessage={onMessage} onClose={() => {}} onCtrlC={() => {}} /></ThemeProvider>;
    const view = render(renderPanel([run('first', { messageable: true }), run('second', { messageable: true })]));
    await new Promise<void>((resolve) => setImmediate(resolve));
    view.stdin.write('m');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Message first'));
    view.stdin.write('Read only');
    view.rerender(renderPanel([run('second', { messageable: true })]));
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Message unavailable agent'));
    view.stdin.write('\r');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Run is no longer available to message.'));
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('keeps long message drafts bounded, allows editing, and discards them on Escape', async () => {
    const onMessage = vi.fn(async () => true);
    const onCtrlC = vi.fn();
    const view = render(<ThemeProvider><AgentRunsPanel snapshot={{ updatedAt: 200,
      runs: [run('reader', { messageable: true })] }} terminalColumns={36} terminalRows={18}
      onMessage={onMessage} onClose={() => {}} onCtrlC={onCtrlC} /></ThemeProvider>);
    await new Promise<void>((resolve) => setImmediate(resolve));
    view.stdin.write('m');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Message reader'));
    view.stdin.write(`${'Preserve read-only scope. '.repeat(40)}END`);
    await vi.waitFor(() => expect(view.lastFrame()).toContain('END'));
    expect(view.lastFrame()?.split('\n').length).toBeLessThanOrEqual(18);
    view.stdin.write('\u001b');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Enter details'));
    expect(onMessage).not.toHaveBeenCalled();
    view.stdin.write('m');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Message reader'));
    expect(view.lastFrame()).not.toContain('END');
    view.stdin.write('Read λx');
    view.stdin.write('\u001b[D');
    view.stdin.write('only ');
    view.stdin.write('\r');
    await vi.waitFor(() => expect(onMessage).toHaveBeenCalledWith('reader', 'Read λonly x'));
    view.stdin.write('m');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Message reader'));
    view.stdin.write('\u0003');
    await vi.waitFor(() => expect(onCtrlC).toHaveBeenCalledOnce());
  });

  it('does not claim delivery or queue duplicate messages while submission is pending', async () => {
    let resolveMessage: (queued: boolean) => void = () => {};
    const onMessage = vi.fn(() => new Promise<boolean>((resolve) => { resolveMessage = resolve; }));
    const view = render(<ThemeProvider><AgentRunsPanel snapshot={{ updatedAt: 200,
      runs: [run('reader', { messageable: true })] }} onMessage={onMessage}
      onClose={() => {}} onCtrlC={() => {}} /></ThemeProvider>);
    await new Promise<void>((resolve) => setImmediate(resolve));
    view.stdin.write('m');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Message reader'));
    view.stdin.write('Read only');
    view.stdin.write('\r');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Queueing message'));
    view.stdin.write('\r');
    expect(onMessage).toHaveBeenCalledOnce();
    expect(view.lastFrame()).not.toContain('Message queued for next model request.');
    resolveMessage(false);
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Message was not queued'));
    expect(view.lastFrame()).toContain('Read only');
  });

  it.each(['queued', 'rejected'] as const)('ignores a late %s response after another worker editor opens', async (outcome) => {
    let settle: () => void = () => {};
    const onMessage = vi.fn(() => new Promise<boolean>((resolve, reject) => {
      settle = () => outcome === 'queued' ? resolve(true) : reject(new Error('Old request failed'));
    }));
    const view = render(<ThemeProvider><AgentRunsPanel snapshot={{ updatedAt: 200,
      runs: [run('first', { messageable: true }), run('second', { messageable: true })] }}
      onMessage={onMessage} onClose={() => {}} onCtrlC={() => {}} /></ThemeProvider>);
    await new Promise<void>((resolve) => setImmediate(resolve));
    view.stdin.write('m');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Message first'));
    view.stdin.write('First instruction');
    view.stdin.write('\r');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Queueing message'));
    view.stdin.write('\u001b');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Enter details'));
    view.stdin.write('\u001b[B');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('› second'));
    view.stdin.write('m');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Message second'));
    view.stdin.write('Second draft stays here');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Second draft stays here'));
    settle();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(view.lastFrame()).toContain('Message second');
    expect(view.lastFrame()).toContain('Second draft stays here');
    expect(view.lastFrame()).not.toContain('Message queued for next model request.');
    expect(view.lastFrame()).not.toContain('Old request failed');
    expect(onMessage).toHaveBeenCalledOnce();
  });

  it('supports backspace and keeps the draft when messaging fails', async () => {
    const onMessage = vi.fn(async () => { throw new Error('Worker transport unavailable'); });
    const view = render(<ThemeProvider><AgentRunsPanel snapshot={{ updatedAt: 200,
      runs: [run('reader', { messageable: true })] }} onMessage={onMessage}
      onClose={() => {}} onCtrlC={() => {}} /></ThemeProvider>);
    await new Promise<void>((resolve) => setImmediate(resolve));
    view.stdin.write('m');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Message reader'));
    view.stdin.write('\r');
    expect(onMessage).not.toHaveBeenCalled();
    view.stdin.write('Read λx');
    view.stdin.write('\u007f');
    view.stdin.write('y');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Read λy'));
    view.stdin.write('\r');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Worker transport unavailable'));
    expect(onMessage).toHaveBeenCalledWith('reader', 'Read λy');
    expect(view.lastFrame()).toContain('Read λy');
  });

  it.each([
    { key: '\u001b[H', expected: 'Xalpha beta' },
    { key: '\u001b[1;5D', expected: 'alpha Xbeta' },
  ])('supports message cursor navigation for $key', async ({ key, expected }) => {
    const onMessage = vi.fn(async () => true);
    const view = render(<ThemeProvider><AgentRunsPanel snapshot={{ updatedAt: 200,
      runs: [run('reader', { messageable: true })] }} onMessage={onMessage}
      onClose={() => {}} onCtrlC={() => {}} /></ThemeProvider>);
    await new Promise<void>((resolve) => setImmediate(resolve));
    view.stdin.write('m');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Message reader'));
    view.stdin.write('alpha beta');
    view.stdin.write(key);
    view.stdin.write('X');
    view.stdin.write('\r');
    await vi.waitFor(() => expect(onMessage).toHaveBeenCalledWith('reader', expected));
  });

  it.each([
    { overrides: { source: 'squad' as const }, key: 'm', reason: 'External Squad runs cannot receive messages here.' },
    { overrides: { status: 'completed' as const }, key: 'm', reason: 'This run has finished and cannot receive messages.' },
    { overrides: { cancelRequested: true }, key: 'm', reason: 'This run is stopping and cannot receive messages.' },
    { overrides: { messageable: false }, key: 'm', reason: 'This run cannot receive messages.' },
    { overrides: { source: 'squad' as const }, key: 'c', reason: 'External Squad runs cannot be stopped here.' },
  ])('explains disabled controls: $reason', async ({ overrides, key, reason }) => {
    const onMessage = vi.fn(async () => true);
    const onCancel = vi.fn();
    const view = render(<ThemeProvider><AgentRunsPanel snapshot={{ updatedAt: 200,
      runs: [run('reader', { messageable: true, ...overrides })] }} onMessage={onMessage}
      onCancel={onCancel} onClose={() => {}} onCtrlC={() => {}} /></ThemeProvider>);
    await new Promise<void>((resolve) => setImmediate(resolve));
    view.stdin.write(key);
    await vi.waitFor(() => expect(view.lastFrame()).toContain(reason));
    expect(onMessage).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('updates each list row with its actual activity without opening details or changing selection', async () => {
    const store = new AgentRunStore();
    store.start({ id: 'reader', source: 'delegate', name: 'Reader', task: 'Inspect source' });
    store.start({ id: 'tester', source: 'delegate', name: 'Tester', task: 'Check tests' });
    store.progress('reader', { activity: 'Thinking' });
    store.progress('tester', { activity: 'run_command' });
    const view = panel(store.getSnapshot());
    const unsubscribe = store.subscribe((snapshot) => {
      view.rerender(<ThemeProvider><AgentRunsPanel snapshot={snapshot} terminalRows={18}
        onClose={() => {}} onCtrlC={() => {}} /></ThemeProvider>);
    });

    try {
      await vi.waitFor(() => expect(view.lastFrame()).toContain('Waiting for model'));
      expect(view.lastFrame()).toContain('Running command');
      view.stdin.write('\u001b[B');
      await vi.waitFor(() => expect(view.lastFrame()).toContain('› Tester'));

      store.progress('reader', { activity: 'read_file' });
      store.progress('tester', { activity: 'Thinking' });

      await vi.waitFor(() => expect(view.lastFrame()).toContain('Reading files'));
      expect(view.lastFrame()).toContain('Waiting for model');
      expect(view.lastFrame()).not.toContain('Running command');
      expect(view.lastFrame()).toContain('› Tester');
      expect(view.lastFrame()).toContain('Enter details');
      expect(view.lastFrame()?.split('\n').length).toBeLessThanOrEqual(18);
    } finally {
      unsubscribe();
    }
  });

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

  it('keeps irrelevant Squad notices out of a session-only inspector', () => {
    const view = panel({
      updatedAt: 200, runs: [run('reader')],
      externalStatus: 'Squad runs are independent sessions with their own budgets.',
    });
    expect(view.lastFrame()).not.toContain('Squad runs are independent');
  });

  it('keeps live stages visible in narrow lists and scrolls selection past the visible page', async () => {
    const runs = Array.from({ length: 12 }, (_, index) => run(`worker-${index}`, {
      name: `Worker ${index} with a very long descriptive name`,
      activity: index === 11 ? 'fff_grep, fff_find' : 'Thinking',
    }));
    const view = render(<ThemeProvider><AgentRunsPanel snapshot={{ updatedAt: 200, runs }}
      terminalRows={18} terminalColumns={36} onClose={() => {}} onCtrlC={() => {}} /></ThemeProvider>);

    expect(view.lastFrame()).toContain('Waiting for model');
    expect(view.lastFrame()?.split('\n').length).toBeLessThanOrEqual(18);
    await new Promise<void>((resolve) => setImmediate(resolve));
    for (let index = 0; index < 11; index += 1) {
      view.stdin.write('\u001b[B');
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    await vi.waitFor(() => expect(view.lastFrame()).toContain('12/12'));
    expect(view.lastFrame()).toContain('Searching contents; Finding files');
    expect(view.lastFrame()).toContain('› Worker 11');
    expect(view.lastFrame()?.split('\n').length).toBeLessThanOrEqual(18);
  });

  it('sanitizes live activity into one line without rendering output or tool arguments', () => {
    const view = panel({ updatedAt: 200, runs: [run('reader', {
      activity: 'custom_tool\n\nworking\u001b[2J',
      output: 'PRIVATE_TOOL_OUTPUT',
      task: 'Run a check',
    })] });
    expect(view.lastFrame()).toContain('custom_tool working');
    expect(view.lastFrame()).not.toContain('\u001b[2J');
    expect(view.lastFrame()).not.toContain('PRIVATE_TOOL_OUTPUT');
    expect(view.lastFrame()?.split('\n').length).toBeLessThanOrEqual(18);
  });

  it('retains Squad status when external runs are visible or explicitly requested', () => {
    const snapshot: AgentRunsSnapshot = {
      updatedAt: 200, runs: [run('external', { source: 'squad' })],
      externalStatus: 'Squad daemon unavailable; showing last recorded state.',
    };
    const view = panel(snapshot);
    expect(view.lastFrame()).toContain('Squad daemon unavailable');
    view.rerender(<ThemeProvider><AgentRunsPanel snapshot={{ ...snapshot, runs: [] }} source="squad"
      onClose={() => {}} onCtrlC={() => {}} /></ThemeProvider>);
    expect(view.lastFrame()).toContain('Squad daemon unavailable');
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
