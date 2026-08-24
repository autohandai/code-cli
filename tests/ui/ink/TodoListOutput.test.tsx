/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { TodoListOutput } from '../../../src/ui/ink/TodoListOutput.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';

const tasks = [
  { title: 'Investigate repo state', status: 'completed' as const },
  { title: 'Write failing tests', status: 'completed' as const },
  { title: 'Fix executor leak', status: 'in_progress' as const },
  { title: 'Implement TUI panel', status: 'pending' as const },
];

function renderWithTheme(element: React.ReactElement) {
  return render(<ThemeProvider>{element}</ThemeProvider>);
}

describe('TodoListOutput', () => {
  it('renders a task panel header', () => {
    const { lastFrame } = renderWithTheme(<TodoListOutput output={JSON.stringify({ tasks })} />);
    expect(lastFrame()).toContain('Tasks');
  });

  it('renders every task title', () => {
    const { lastFrame } = renderWithTheme(<TodoListOutput output={JSON.stringify({ tasks })} />);
    const frame = lastFrame();
    expect(frame).toContain('Investigate repo state');
    expect(frame).toContain('Write failing tests');
    expect(frame).toContain('Fix executor leak');
    expect(frame).toContain('Implement TUI panel');
  });

  it('shows progress count and percent', () => {
    const { lastFrame } = renderWithTheme(<TodoListOutput output={JSON.stringify({ tasks })} />);
    const frame = lastFrame();
    expect(frame).toContain('2/4 done');
    expect(frame).toContain('50%');
  });

  it('marks in-progress tasks distinctly from completed ones', () => {
    const { lastFrame } = renderWithTheme(<TodoListOutput output={JSON.stringify({ tasks })} />);
    const frame = lastFrame();
    // Standardized glyph vocabulary, shared with the team task panel.
    expect(frame).toContain('■'); // completed
    expect(frame).toContain('▣'); // in progress
    expect(frame).toContain('□'); // pending
  });

  it('groups tasks by status with active work first', () => {
    const { lastFrame } = renderWithTheme(<TodoListOutput output={JSON.stringify({ tasks })} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('in progress');
    expect(frame).toContain('pending');
    expect(frame).toContain('completed');
    expect(frame.indexOf('in progress')).toBeLessThan(frame.indexOf('pending'));
    expect(frame.indexOf('pending')).toBeLessThan(frame.indexOf('completed'));
  });

  it('collapses long todo lists instead of flooding the terminal', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      title: `Todo number ${i}`,
      status: i < 3 ? ('in_progress' as const) : ('completed' as const),
    }));
    const { lastFrame } = renderWithTheme(<TodoListOutput output={JSON.stringify({ tasks: many })} />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain('Todo number 0');
    expect(frame).toContain('+8 completed');
    expect(frame).not.toContain('Todo number 19');
  });

  it('renders the summary line when present', () => {
    const { lastFrame } = renderWithTheme(
      <TodoListOutput output={JSON.stringify({ tasks, summary: 'Updated task list: 50% complete (2/4)' })} />,
    );
    expect(lastFrame()).toContain('Updated task list: 50% complete (2/4)');
  });

  it('falls back to plain text when payload is not valid todo JSON', () => {
    const { lastFrame } = renderWithTheme(<TodoListOutput output="Task list cleared (0 tasks)" />);
    expect(lastFrame()).toContain('Task list cleared (0 tasks)');
  });

  it('renders an empty-state message for an empty task list', () => {
    const { lastFrame } = renderWithTheme(<TodoListOutput output={JSON.stringify({ tasks: [] })} />);
    expect(lastFrame()).toContain('No tasks');
  });
});
