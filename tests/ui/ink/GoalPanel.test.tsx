/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { fileURLToPath } from 'node:url';
import { cleanup, render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GoalSessionSnapshot } from '../../../src/goals/types.js';
import { GoalPanel } from '../../../src/ui/ink/GoalPanel.js';
import { AgentUI, createInitialUIState } from '../../../src/ui/ink/AgentUI.js';
import { I18nProvider } from '../../../src/ui/i18n/index.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';
import { Box } from 'ink';
import stripAnsi from 'strip-ansi';
import path from 'node:path';
import { renderInkScreen } from '../../../src/testing/drivers/ink-driver.js';
import { createLongGoalsSnapshot } from '../../../src/testing/scenarios/goalsCommandScenario.js';

afterEach(cleanup);

describe('GoalPanel summaries', () => {
  it.each([40, 80, 160])('keeps long current, queued, and peer goals compact at %i columns', async (width) => {
    const snapshot = createLongGoalsSnapshot();
    const onRowLayoutChange = vi.fn();
    const screen = renderInkScreen(
      <Box width={width} flexDirection="column">
        <GoalPanel snapshot={snapshot} selectedIndex={1} onRowLayoutChange={onRowLayoutChange} />
      </Box>,
    );
    await vi.waitFor(() => expect(onRowLayoutChange).toHaveBeenCalled());
    const output = stripAnsi(screen.lastFrame() ?? '');
    expect(output).not.toContain('FULL_FAILURE_TRANSCRIPT');
    expect(output).toContain('Repair failing goal tests…');
    expect(output).toContain('› 2. Review the terminal layout… queued');
    expect(output).toContain('Ship the documentation… active');
    expect(output).toContain('enter edit');
    expect(output).toContain('Ctrl+G close · ↑↓ navigate');
    expect(output).toContain('/goals');
    expect(output.split('\n').length).toBeLessThanOrEqual(19);
    expect(onRowLayoutChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'queue-next', objective: snapshot.queue[0]!.objective }),
      expect.objectContaining({ height: 1 }),
    );
    if (width === 80) {
      await expect(`${output.trimEnd()}\n`).toMatchFileSnapshot(path.resolve(
        import.meta.dirname, '../../../src/testing/snapshots/goals-summary.txt',
      ));
    }
  });

  it('shows the close shortcut in the footer when no goals are editable', () => {
    const snapshot = createLongGoalsSnapshot();
    snapshot.goal = null;
    snapshot.queue = [];
    const screen = renderInkScreen(<GoalPanel snapshot={snapshot} selectedIndex={null} />);
    expect(stripAnsi(screen.lastFrame() ?? '')).toContain('\nCtrl+G close\nManage:');
  });

  it.each([
    ['  \n\tRepair\t the tests\r\nprivate detail', 'Repair the tests…'],
    ['Repair the tests', 'Repair the tests'],
    ['\u001b[31mRepair the tests\u001b[0m\nprivate detail', 'Repair the tests…'],
    [`Repair ${'the failing tests '.repeat(100)}`, 'Repair the failing tests'],
    [`修复终端 ${'🧪 '.repeat(100)}`, '修复终端'],
  ])('summarizes objective %# without wrapping its status', async (objective, expected) => {
    const snapshot = createLongGoalsSnapshot();
    snapshot.queue = [];
    snapshot.peers = [];
    snapshot.goal!.objective = objective;
    const onRowLayoutChange = vi.fn();
    const screen = renderInkScreen(
      <Box width={40} flexDirection="column">
        <GoalPanel snapshot={snapshot} selectedIndex={0} onRowLayoutChange={onRowLayoutChange} />
      </Box>,
    );
    await vi.waitFor(() => expect(onRowLayoutChange).toHaveBeenCalled());
    const output = stripAnsi(screen.lastFrame() ?? '');
    const row = output.split('\n').find((line) => line.includes('› 1.'));
    expect(row).toContain(expected);
    expect(row).toContain('paused');
    expect(output).not.toContain('private detail');
    expect(output).not.toContain('�');
    expect(onRowLayoutChange).toHaveBeenCalledWith(
      expect.objectContaining({ objective }), expect.objectContaining({ height: 1 }),
    );
  });

  it('keeps a single-line objective short even in a wide terminal', async () => {
    const snapshot = createLongGoalsSnapshot();
    snapshot.goal!.objective = 'Repair the failing tests and validate the terminal behavior. '.repeat(100);
    const screen = renderInkScreen(
      <Box width={160} flexDirection="column">
        <GoalPanel snapshot={snapshot} selectedIndex={0} />
      </Box>,
    );
    await vi.waitFor(() => expect(screen.lastFrame()).toContain('Repair the failing tests'));
    const row = stripAnsi(screen.lastFrame() ?? '').split('\n').find((line) => line.includes('› 1.'));
    expect(row).toMatch(/^› 1\. Repair the failing tests.*… paused$/u);
    expect(row!.length).toBeLessThan(110);
  });
});

function snapshot(overrides: Partial<GoalSessionSnapshot> = {}): GoalSessionSnapshot {
  return {
    version: 2, sessionId: 'current-owner', goal: null, completed: [], peers: [],
    updatedAt: 1, sessionAttachment: 'none',
    queue: ['first', 'second', 'third'].map((id) => ({
      queueId: id, objective: `${id} objective`, source: 'command', createdAt: 1,
    })),
    ...overrides,
  };
}

function wrap(element: React.ReactElement): React.ReactElement {
  return <I18nProvider><ThemeProvider>{element}</ThemeProvider></I18nProvider>;
}

describe('live goal panel', () => {
  it('shows ownership, budgets, stop details, checkpoints, and offline peers inline', async () => {
    const ui = render(wrap(<GoalPanel selectedIndex={null} snapshot={snapshot({
      goal: {
        goalId: 'goal', objective: 'release work', status: 'blocked', tokensUsed: 42, tokenBudget: 100,
        timeUsedSeconds: 12.9, timeBudgetSeconds: 60, createdAt: 1, updatedAt: 1,
        stopReason: 'Needs approval', resumeWhen: 'Owner approves',
        checkpoint: { summary: 'Patch prepared', nextStep: 'Run checks', artifacts: ['report.md'], recordedAt: 1 },
      },
      peers: [{ sessionId: 'other-owner', objective: 'peer work', status: 'paused', ownerAlive: false }],
    })} />));
    await vi.waitFor(() => expect(ui.lastFrame()).toContain('Owner: current-owner'));
    for (const detail of ['Tokens: 42 / 100', 'Time: 12s / 60s', 'Needs approval', 'Owner approves', 'Patch prepared', 'Run checks', 'report.md', '○ peer work', 'paused']) {
      expect(ui.lastFrame()).toContain(detail);
    }
    await expect(`${ui.lastFrame()?.trim()}\n`).toMatchFileSnapshot(fileURLToPath(new URL('../../../src/testing/snapshots/goal-panel.txt', import.meta.url)));
  });

  it('labels the latest completion receipt as reported evidence after queue advancement', async () => {
    const ui = render(wrap(<GoalPanel selectedIndex={null} snapshot={snapshot({
      completed: [{
        goalId: 'finished', sessionId: 'current-owner', objective: 'previous objective', status: 'complete',
        tokensUsed: 40, timeUsedSeconds: 8, createdAt: 1, completedAt: 2,
        completionReceipt: { summary: 'Checks passed in local tests', checks: [], recordedAt: 2, provenance: 'reported' },
      }],
    })} />));
    await vi.waitFor(() => expect(ui.lastFrame()).toContain('Reported completion: Checks passed in local tests'));
    expect(ui.lastFrame()).toContain('previous objective');
  });

  it('shows a storage error instead of implying the workspace has no goals', async () => {
    const ui = render(wrap(<GoalPanel selectedIndex={null} snapshot={snapshot({
      queue: [], storageError: 'Goal storage: invalid snapshot. Use /goal repair.',
    })} />));
    await vi.waitFor(() => expect(ui.lastFrame()).toContain('Goal storage: invalid snapshot'));
    expect(ui.lastFrame()).not.toContain('No active or queued goals.');
  });

  it('uses receipt time rather than history position and excludes another owner’s evidence', async () => {
    const completed = [
      { owner: 'current-owner', summary: 'Newest receipt', time: 30 },
      { owner: 'current-owner', summary: 'Older receipt', time: 10 },
      { owner: 'other-owner', summary: 'Other owner receipt', time: 40 },
    ].map(({ owner, summary, time }) => ({
      goalId: summary, sessionId: owner, objective: summary, status: 'complete' as const,
      tokensUsed: 1, timeUsedSeconds: 1, createdAt: 1, completedAt: time,
      completionReceipt: { summary, checks: [], recordedAt: time, provenance: 'reported' as const },
    }));
    const ui = render(wrap(<GoalPanel selectedIndex={null} snapshot={snapshot({ completed })} />));
    await vi.waitFor(() => expect(ui.lastFrame()).toContain('Reported completion: Newest receipt'));
    expect(ui.lastFrame()).not.toContain('Reported completion: Other owner receipt');
  });

  it('shows an unscoped current receipt and explicit unlimited budgets', async () => {
    const ui = render(wrap(<GoalPanel selectedIndex={null} snapshot={snapshot({
      sessionId: undefined, queue: [], goal: {
        goalId: 'current', objective: 'finished current work', status: 'complete', tokensUsed: 7,
        timeUsedSeconds: 3, createdAt: 1, updatedAt: 2,
        completionReceipt: { summary: 'Current evidence', checks: [], recordedAt: 2, provenance: 'reported' },
      },
    })} />));
    await vi.waitFor(() => expect(ui.lastFrame()).toContain('Reported completion: Current evidence'));
    expect(ui.lastFrame()).toContain('Owner: unscoped');
    expect(ui.lastFrame()).toContain('Tokens: 7 / no limit');
    expect(ui.lastFrame()).toContain('Time: 3s / no limit');
  });

  it('shows the persisted unscoped owner’s receipt after queue advancement', async () => {
    const ui = render(wrap(<GoalPanel selectedIndex={null} snapshot={snapshot({
      sessionId: undefined, completed: [{
        goalId: 'finished', sessionId: '__unscoped__', objective: 'finished unscoped work', status: 'complete',
        tokensUsed: 1, timeUsedSeconds: 1, createdAt: 1, completedAt: 2,
        completionReceipt: { summary: 'Unscoped evidence', checks: [], recordedAt: 2, provenance: 'reported' },
      }],
    })} />));
    await vi.waitFor(() => expect(ui.lastFrame()).toContain('Reported completion: Unscoped evidence'));
  });

  it('keeps selection attached to the same goal when an earlier queue item disappears', async () => {
    const onEditGoalObjective = vi.fn();
    const view = (goalActivity: GoalSessionSnapshot) => wrap(<AgentUI
      state={{ ...createInitialUIState(), goalPanelVisible: true, goalActivity }}
      onInstruction={vi.fn()} onEscape={vi.fn()} onCtrlC={vi.fn()} onEditGoalObjective={onEditGoalObjective}
    />);
    const original = snapshot();
    const ui = render(view(original));
    await new Promise<void>((resolve) => setImmediate(resolve));
    ui.stdin.write('\u001b[B');
    ui.stdin.write('\u001b[B');
    await vi.waitFor(() => expect(ui.lastFrame()).toContain('› 2.'));
    ui.rerender(view({ ...original, queue: original.queue.slice(1) }));
    await vi.waitFor(() => expect(ui.lastFrame()).not.toContain('first objective'));
    ui.stdin.write('\r');
    await vi.waitFor(() => expect(ui.lastFrame()).toContain('❯ second objective'));
    ui.stdin.write(' edited');
    ui.stdin.write('\r');
    await vi.waitFor(() => expect(onEditGoalObjective).toHaveBeenCalledWith({
      kind: 'queued', id: 'second', objective: 'second objective edited',
    }));
  });

  it('preserves an edit draft during refresh and never submits a removed goal as an agent instruction', async () => {
    const onInstruction = vi.fn();
    const onEditGoalObjective = vi.fn();
    const view = (goalActivity: GoalSessionSnapshot) => wrap(<AgentUI
      state={{ ...createInitialUIState(), goalPanelVisible: true, goalActivity }}
      onInstruction={onInstruction} onEscape={vi.fn()} onCtrlC={vi.fn()} onEditGoalObjective={onEditGoalObjective}
    />);
    const original = snapshot();
    const ui = render(view(original));
    await new Promise<void>((resolve) => setImmediate(resolve));
    ui.stdin.write('\u001b[B');
    ui.stdin.write('\r');
    await vi.waitFor(() => expect(ui.lastFrame()).toContain('❯ first objective'));
    ui.stdin.write(' draft');
    await vi.waitFor(() => expect(ui.lastFrame()).toContain('❯ first objective draft'));
    ui.rerender(view({ ...original, queue: original.queue.slice(0, 2) }));
    await vi.waitFor(() => expect(ui.lastFrame()).not.toContain('third objective'));
    expect(ui.lastFrame()).toContain('❯ first objective draft');
    ui.rerender(view({ ...original, queue: original.queue.slice(1) }));
    await vi.waitFor(() => expect(ui.lastFrame()).toContain('Goal is unavailable. Draft kept; Esc cancels.'));
    ui.stdin.write('\r');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onInstruction).not.toHaveBeenCalled();
    expect(onEditGoalObjective).not.toHaveBeenCalled();
    expect(ui.lastFrame()).toContain('❯ first objective draft');
    ui.stdin.write('\u001b');
    await vi.waitFor(() => expect(ui.lastFrame()).not.toContain('Draft kept'));
  });
});
