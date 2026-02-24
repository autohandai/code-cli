/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { TeamPanel } from '../../../src/ui/ink/TeamPanel.js';
import { TeammateView } from '../../../src/ui/ink/TeammateView.js';
import type { Team, TeamTask } from '../../../src/core/teams/types.js';

const mockTeam: Team = {
  name: 'code-cleanup',
  createdAt: new Date().toISOString(),
  leadSessionId: 'session-123',
  status: 'active',
  members: [
    { name: 'hunter', agentName: 'code-cleaner', pid: 100, status: 'working' },
    { name: 'writer', agentName: 'docs-writer', pid: 200, status: 'idle' },
  ],
};

const mockTasks: TeamTask[] = [
  { id: 'task-001', subject: 'Remove dead exports', description: 'Find and remove unused exports', status: 'completed', owner: 'hunter', blockedBy: [], createdAt: '', completedAt: '' },
  { id: 'task-002', subject: 'Write API docs', description: 'Write documentation for API endpoints', status: 'in_progress', owner: 'writer', blockedBy: [], createdAt: '' },
  { id: 'task-003', subject: 'Add unit tests', description: 'Add missing unit tests', status: 'pending', blockedBy: ['task-002'], createdAt: '' },
];

describe('TeamPanel', () => {
  it('should render team name and status', () => {
    const { lastFrame } = render(<TeamPanel team={mockTeam} tasks={mockTasks} />);
    const output = lastFrame();
    expect(output).toContain('code-cleanup');
  });

  it('should render task count', () => {
    const { lastFrame } = render(<TeamPanel team={mockTeam} tasks={mockTasks} />);
    const output = lastFrame();
    expect(output).toContain('1/3 done');
  });

  it('should render task subjects', () => {
    const { lastFrame } = render(<TeamPanel team={mockTeam} tasks={mockTasks} />);
    const output = lastFrame();
    expect(output).toContain('Remove dead exports');
    expect(output).toContain('Write API docs');
    expect(output).toContain('Add unit tests');
  });

  it('should render teammate names', () => {
    const { lastFrame } = render(<TeamPanel team={mockTeam} tasks={mockTasks} />);
    const output = lastFrame();
    expect(output).toContain('hunter');
    expect(output).toContain('writer');
  });

  it('should handle empty tasks', () => {
    const { lastFrame } = render(<TeamPanel team={mockTeam} tasks={[]} />);
    const output = lastFrame();
    expect(output).toContain('0/0 done');
    expect(output).toContain('No tasks yet');
  });
});

describe('TeammateView', () => {
  it('should render teammate name and status', () => {
    const { lastFrame } = render(
      <TeammateView name="hunter" status="working" logs={[]} />
    );
    const output = lastFrame();
    expect(output).toContain('hunter');
    expect(output).toContain('working');
  });

  it('should render log entries', () => {
    const logs = [
      { level: 'info', text: 'Scanning for dead code...', timestamp: '10:00' },
      { level: 'info', text: 'Found 3 unused exports', timestamp: '10:01' },
    ];
    const { lastFrame } = render(
      <TeammateView name="hunter" status="working" logs={logs} />
    );
    const output = lastFrame();
    expect(output).toContain('Scanning for dead code');
    expect(output).toContain('3 unused exports');
  });

  it('should show waiting message when no logs', () => {
    const { lastFrame } = render(
      <TeammateView name="hunter" status="spawning" logs={[]} />
    );
    const output = lastFrame();
    expect(output).toContain('Waiting for output');
  });

  it('should limit visible logs', () => {
    const logs = Array.from({ length: 20 }, (_, i) => ({
      level: 'info',
      text: `Line ${i}`,
      timestamp: '10:00',
    }));
    const { lastFrame } = render(
      <TeammateView name="hunter" status="working" logs={logs} maxLines={5} />
    );
    const output = lastFrame();
    // Should show last 5 lines (15-19)
    expect(output).toContain('Line 19');
    expect(output).toContain('Line 15');
    expect(output).not.toContain('Line 0');
  });
});
