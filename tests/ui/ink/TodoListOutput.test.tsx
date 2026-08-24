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
    // Completed marker
    expect(frame).toContain('✓');
    // In-progress marker
    expect(frame).toContain('•');
    // Pending marker
    expect(frame).toContain('○');
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
