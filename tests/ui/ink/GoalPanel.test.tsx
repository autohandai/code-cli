import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { Box } from 'ink';
import { cleanup } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import path from 'node:path';
import { GoalPanel } from '../../../src/ui/ink/GoalPanel.js';
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
