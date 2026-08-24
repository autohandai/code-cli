/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { TeamTaskListOutput } from '../../../src/ui/ink/TeamTaskListOutput.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';
import { buildTeamTaskPayload } from '../../../src/core/teams/taskPayload.js';
import type { TeamTask } from '../../../src/core/teams/types.js';

function renderWithTheme(element: React.ReactElement) {
  return render(<ThemeProvider>{element}</ThemeProvider>);
}

/** The payload from the transcript that motivated this panel. */
const reviewTasks: TeamTask[] = [
  {
    id: 'task-1',
    subject: 'Security review of idle-timeout and auth changes',
    description: 'x'.repeat(900),
    status: 'in_progress',
    blockedBy: [],
    createdAt: '2026-08-24T09:19:10.132Z',
    owner: 'correctness-reviewer',
  },
  {
    id: 'task-2',
    subject: 'Review OpenRouter 402 downgrade + model tier policy',
    description: 'x'.repeat(900),
    status: 'in_progress',
    blockedBy: [],
    createdAt: '2026-08-24T09:19:10.133Z',
    owner: 'auth-security',
  },
  {
    id: 'task-3',
    subject: 'Run tests and audit coverage for last 5 commits',
    description: 'x'.repeat(900),
    status: 'in_progress',
    blockedBy: [],
    createdAt: '2026-08-24T09:19:10.134Z',
    owner: 'llm-provider-reviewer',
  },
  {
    id: 'task-4',
    subject: 'Correctness review of goal queueing',
    description: 'x'.repeat(900),
    status: 'in_progress',
    blockedBy: [],
    createdAt: '2026-08-24T09:19:31.121Z',
    owner: 'correctness-reviewer',
  },
];

describe('TeamTaskListOutput', () => {
  it('renders a panel instead of raw JSON for the motivating payload', () => {
    const output = buildTeamTaskPayload({ tasks: reviewTasks, truncateDescriptions: true });
    const frame = renderWithTheme(<TeamTaskListOutput output={output} />).lastFrame() ?? '';

    expect(frame).toContain('Tasks');
    expect(frame).toContain('task-1');
    expect(frame).toContain('Security review of idle-timeout');
    expect(frame).not.toContain('"createdAt"');
    expect(frame).not.toContain('"blockedBy"');
    expect(frame).not.toContain('{');
  });

  it('never renders task descriptions', () => {
    const output = buildTeamTaskPayload({
      tasks: [{ ...reviewTasks[0]!, description: 'SECRET-DESCRIPTION-BODY' }],
    });
    const frame = renderWithTheme(<TeamTaskListOutput output={output} />).lastFrame() ?? '';
    expect(frame).not.toContain('SECRET-DESCRIPTION-BODY');
  });

  it('groups by status with active work first', () => {
    const output = buildTeamTaskPayload({
      tasks: [
        { ...reviewTasks[0]!, id: 'task-9', status: 'completed', subject: 'Finished work' },
        { ...reviewTasks[1]!, id: 'task-8', status: 'pending', subject: 'Waiting work' },
        { ...reviewTasks[2]!, id: 'task-7', status: 'in_progress', subject: 'Active work' },
      ],
    });
    const frame = renderWithTheme(<TeamTaskListOutput output={output} />).lastFrame() ?? '';

    expect(frame).toContain('in progress');
    expect(frame).toContain('pending');
    expect(frame).toContain('completed');
    expect(frame.indexOf('in progress')).toBeLessThan(frame.indexOf('pending'));
    expect(frame.indexOf('pending')).toBeLessThan(frame.indexOf('completed'));
  });

  it('shows the owner on its own sub-line', () => {
    const output = buildTeamTaskPayload({ tasks: [reviewTasks[0]!] });
    const frame = renderWithTheme(<TeamTaskListOutput output={output} />).lastFrame() ?? '';
    expect(frame).toContain('↳ correctness-reviewer');
  });

  it('shows blockers on their own sub-line', () => {
    const output = buildTeamTaskPayload({
      tasks: [{ ...reviewTasks[0]!, status: 'pending', owner: undefined, blockedBy: ['task-1', 'task-2'] }],
    });
    const frame = renderWithTheme(<TeamTaskListOutput output={output} />).lastFrame() ?? '';
    expect(frame).toContain('⊘ blocked by task-1, task-2');
  });

  it('renders a progress summary', () => {
    const output = buildTeamTaskPayload({
      tasks: [
        { ...reviewTasks[0]!, status: 'completed' },
        { ...reviewTasks[1]!, status: 'in_progress' },
      ],
    });
    const frame = renderWithTheme(<TeamTaskListOutput output={output} />).lastFrame() ?? '';
    expect(frame).toContain('1/2 done');
    expect(frame).toContain('50%');
  });

  it('renders the headline for mutation results', () => {
    const output = buildTeamTaskPayload({ tasks: [reviewTasks[0]!], headline: 'Task task-1 updated' });
    const frame = renderWithTheme(<TeamTaskListOutput output={output} />).lastFrame() ?? '';
    expect(frame).toContain('Task task-1 updated');
  });

  it('notes the active filter', () => {
    const output = buildTeamTaskPayload({ tasks: [reviewTasks[0]!], filter: { status: 'in_progress' } });
    const frame = renderWithTheme(<TeamTaskListOutput output={output} />).lastFrame() ?? '';
    expect(frame).toContain('in_progress');
  });

  it('notes when descriptions were truncated so the model can fetch detail', () => {
    const output = buildTeamTaskPayload({ tasks: reviewTasks, truncateDescriptions: true });
    const frame = renderWithTheme(<TeamTaskListOutput output={output} />).lastFrame() ?? '';
    expect(frame).toContain('task_get');
  });

  it('collapses overflow rather than flooding the terminal', () => {
    const many: TeamTask[] = Array.from({ length: 20 }, (_, i) => ({
      ...reviewTasks[0]!,
      id: `task-${i}`,
      subject: `Task number ${i}`,
      status: i < 4 ? 'in_progress' : 'completed',
    }));
    const frame = renderWithTheme(<TeamTaskListOutput output={buildTeamTaskPayload({ tasks: many })} />).lastFrame() ?? '';

    expect(frame).toContain('+8 completed');
    expect(frame).toContain('Task number 0');
    expect(frame).not.toContain('Task number 19');
  });

  it('renders an empty list without an empty frame', () => {
    const frame = renderWithTheme(<TeamTaskListOutput output={buildTeamTaskPayload({ tasks: [] })} />).lastFrame() ?? '';
    expect(frame).toContain('No tasks');
  });

  it('falls back to the raw output when it is not a task payload', () => {
    const frame = renderWithTheme(<TeamTaskListOutput output={'Task "task-9" not found.'} />).lastFrame() ?? '';
    expect(frame).toContain('Task "task-9" not found.');
  });

  it('renders legacy bare-array output from a resumed session', () => {
    const frame = renderWithTheme(
      <TeamTaskListOutput output={JSON.stringify(reviewTasks, null, 2)} />,
    ).lastFrame() ?? '';
    expect(frame).toContain('task-1');
    expect(frame).not.toContain('"createdAt"');
  });
});
