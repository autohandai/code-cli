/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import {
  getTaskActivityMaxVisible,
  TaskActivityPanel,
  type ActivityItem,
} from '../../../src/ui/ink/TaskActivityPanel.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';

function renderPanel(items: ActivityItem[], maxVisible?: number) {
  return render(
    <ThemeProvider>
      <TaskActivityPanel items={items} maxVisible={maxVisible} />
    </ThemeProvider>,
  );
}

describe('TaskActivityPanel', () => {
  it('keeps only the summary and active task in a 14-row terminal', () => {
    expect(getTaskActivityMaxVisible(14)).toBe(1);
    expect(getTaskActivityMaxVisible(18)).toBe(4);
  });

  it('keeps the active authored plan ahead of queued work and separates workers', () => {
    const { lastFrame } = renderPanel([
      { id: 'done', kind: 'todo', label: 'Inspect the existing layout', status: 'completed' },
      { id: 'queue-first', kind: 'todo', label: 'Write the failing terminal test', status: 'pending' },
      { id: 'active', kind: 'todo', label: 'Keep task progress visible', status: 'in_progress' },
      { id: 'queue-second', kind: 'todo', label: 'Validate the full proof gate', status: 'pending' },
      { id: 'worker', kind: 'subagent', label: 'tui-reviewer: auditing layout', status: 'in_progress', detail: '12s' },
    ], 3);

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Task plan · 1/4 complete · 1 active · 2 queued');
    expect(frame).toContain('Workers · 1 running');
    expect(frame.indexOf('Keep task progress visible')).toBeLessThan(frame.indexOf('Write the failing terminal test'));
    expect(frame.indexOf('Write the failing terminal test')).toBeLessThan(frame.indexOf('Validate the full proof gate'));
    expect(frame).not.toContain('Inspect the existing layout');
    expect(frame).toContain('… +1 completed');
  });
});
