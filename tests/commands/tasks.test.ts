/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { stripAnsiCodes } from '../../src/ui/displayUtils.js';
import type { TeamTask } from '../../src/core/teams/types.js';

function task(overrides: Partial<TeamTask> = {}): TeamTask {
  return {
    id: 'task-1',
    subject: 'Security review of idle-timeout and auth changes',
    description: 'x'.repeat(900),
    status: 'in_progress',
    blockedBy: [],
    createdAt: '2026-08-24T09:19:10.132Z',
    owner: 'correctness-reviewer',
    ...overrides,
  };
}

function teamManagerStub(tasks: TeamTask[], hasTeam = true) {
  return {
    getTeam: () => (hasTeam ? { name: 'review-crew', members: [] } : null),
    tasks: { listTasks: () => tasks },
  };
}

async function runTasks(tasks: TeamTask[], hasTeam = true): Promise<string> {
  const { tasks: tasksCommand } = await import('../../src/commands/tasks.js');
  const output = await tasksCommand({ teamManager: teamManagerStub(tasks, hasTeam) as never });
  return stripAnsiCodes(output ?? '');
}

describe('/tasks command', () => {
  it('renders the same grouped panel as the TUI tool output', async () => {
    const output = await runTasks([
      task(),
      task({ id: 'task-2', subject: 'Waiting work', status: 'pending', owner: undefined }),
      task({ id: 'task-3', subject: 'Finished work', status: 'completed', owner: 'auth-security' }),
    ]);

    expect(output).toContain('Tasks');
    expect(output).toContain('1/3 done');
    expect(output).toContain('in progress');
    expect(output).toContain('pending');
    expect(output).toContain('completed');
    expect(output.indexOf('in progress')).toBeLessThan(output.indexOf('pending'));
  });

  it('shows owners and blockers as sub-lines', async () => {
    const output = await runTasks([
      task(),
      task({ id: 'task-5', subject: 'Blocked work', status: 'pending', owner: undefined, blockedBy: ['task-1'] }),
    ]);

    expect(output).toContain('↳ correctness-reviewer');
    expect(output).toContain('⊘ blocked by task-1');
  });

  it('never prints task descriptions', async () => {
    const output = await runTasks([task({ description: 'SECRET-DESCRIPTION-BODY' })]);
    expect(output).not.toContain('SECRET-DESCRIPTION-BODY');
  });

  it('reports an empty task list', async () => {
    expect(await runTasks([])).toContain('No tasks');
  });

  it('reports a missing team', async () => {
    expect(await runTasks([], false)).toContain('No active team');
  });

  it('reports a missing team manager', async () => {
    const { tasks: tasksCommand } = await import('../../src/commands/tasks.js');
    const output = await tasksCommand({});
    expect(stripAnsiCodes(output ?? '')).toContain('Team manager not available');
  });
});
