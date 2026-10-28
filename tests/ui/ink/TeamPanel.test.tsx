/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import React from 'react';
import { stripVTControlCharacters } from 'node:util';
import { cleanup, render } from 'ink-testing-library';
import { TeamPanel } from '../../../src/ui/ink/TeamPanel.js';
import { TeammateView } from '../../../src/ui/ink/TeammateView.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';
import { Theme } from '../../../src/ui/theme/Theme.js';
import { loadTheme } from '../../../src/ui/theme/loader.js';
import type { Team, TeamTask } from '../../../src/core/teams/types.js';
import { AgentUI, createInitialUIState } from '../../../src/ui/ink/AgentUI.js';
import { I18nProvider } from '../../../src/ui/i18n/index.js';
import { resolveKeybindings } from '../../../src/keybindings/profiles.js';

afterEach(cleanup);

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

function renderWithTheme(element: React.ReactElement) {
  return render(<ThemeProvider>{element}</ThemeProvider>);
}

describe('TeamPanel', () => {
  it('shows and handles the configured team shortcut', async () => {
    const onHide = vi.fn();
    const view = renderWithTheme(<TeamPanel team={mockTeam} tasks={mockTasks}
      keybindings={resolveKeybindings('autohand', { toggleTeamPanel: ['ctrl+y'] })}
      onCommand={vi.fn()} onHide={onHide} />);
    expect(view.lastFrame()).toContain('ctrl+y hide');
    await new Promise<void>(resolve => setImmediate(resolve));
    view.stdin.write('\u0019');
    await vi.waitFor(() => expect(onHide).toHaveBeenCalledOnce());
  });
  it('owns recovery keys while the lead is working without sending them as a new prompt', async () => {
    const onInstruction = vi.fn();
    const onToggleTeamPanel = vi.fn();
    const view = render(<I18nProvider><ThemeProvider><AgentUI state={{
      ...createInitialUIState(), isWorking: true, teamPanelVisible: true,
      teamActivity: { team: mockTeam, tasks: mockTasks },
    }} onInstruction={onInstruction} onToggleTeamPanel={onToggleTeamPanel}
      onEscape={() => {}} onCtrlC={() => {}} /></ThemeProvider></I18nProvider>);
    await new Promise<void>(resolve => setImmediate(resolve));
    view.stdin.write('s');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Shut down this team'));
    view.stdin.write('y');
    await vi.waitFor(() => expect(onInstruction).toHaveBeenCalledExactlyOnceWith('/team shutdown'));
    expect(onToggleTeamPanel).toHaveBeenCalledOnce();
  });
  it('inspects a failure and confirms a selected retry without rerunning successful work', async () => {
    const onCommand = vi.fn();
    const onHide = vi.fn();
    const view = renderWithTheme(<TeamPanel team={mockTeam} tasks={[
      mockTasks[0], { ...mockTasks[1], status: 'failed', error: 'Provider unavailable', output: 'Partial findings retained' },
    ]} onCommand={onCommand} onHide={onHide} />);
    await new Promise<void>(resolve => setImmediate(resolve));
    view.stdin.write('\u001b[B');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('› × Write API docs'));
    view.stdin.write('\r');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Provider unavailable'));
    expect(view.lastFrame()).toContain('Partial findings retained');
    view.stdin.write('\u001b');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Enter inspect'));
    view.stdin.write('r');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Retry'));
    expect(onCommand).not.toHaveBeenCalled();
    view.stdin.write('y');
    await vi.waitFor(() => expect(onCommand).toHaveBeenCalledWith('/team retry task-002'));
    expect(onHide).toHaveBeenCalledOnce();
  });

  it('distinguishes hiding from shutting down and permits cancellation of shutdown', async () => {
    const onCommand = vi.fn();
    const onHide = vi.fn();
    const view = renderWithTheme(<TeamPanel team={mockTeam} tasks={mockTasks} onCommand={onCommand} onHide={onHide} />);
    await new Promise<void>(resolve => setImmediate(resolve));
    view.stdin.write('s');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Shut down'));
    view.stdin.write('n');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Enter inspect'));
    expect(onCommand).not.toHaveBeenCalled();
    view.stdin.write('h');
    await vi.waitFor(() => expect(onHide).toHaveBeenCalledOnce());
    expect(onCommand).not.toHaveBeenCalled();
  });
  it('should render team name and status', () => {
    const { lastFrame } = renderWithTheme(<TeamPanel team={mockTeam} tasks={mockTasks} />);
    const output = lastFrame();
    expect(output).toContain('code-cleanup');
    expect(output).toContain('ctrl+t hide');
  });

  it('should render task count', () => {
    const { lastFrame } = renderWithTheme(<TeamPanel team={mockTeam} tasks={mockTasks} />);
    const output = lastFrame();
    expect(output).toContain('1/3 done');
  });

  it.each(['none', 'truecolor'] as const)('labels failed and cancelled tasks without inflating the completed count in %s mode', (colorMode) => {
    const tasks: TeamTask[] = [
      { ...mockTasks[0]!, subject: 'Completed review', status: 'completed' },
      { ...mockTasks[1]!, subject: 'Failed review', status: 'failed' },
      { ...mockTasks[2]!, subject: 'Cancelled review', status: 'cancelled' },
    ];
    const theme = new Theme('dark', loadTheme('dark').colors, colorMode);
    const { lastFrame } = render(
      <ThemeProvider theme={theme}><TeamPanel team={mockTeam} tasks={tasks} /></ThemeProvider>
    );
    const output = stripVTControlCharacters(lastFrame() ?? '');

    expect(output).toContain('1/3 done');
    expect(output).toContain('× Failed review [failed]');
    expect(output).toContain('⊘ Cancelled review [cancelled]');
    expect(output).not.toContain('3/3 done');
  });

  it('should render task subjects', () => {
    const { lastFrame } = renderWithTheme(<TeamPanel team={mockTeam} tasks={mockTasks} />);
    const output = lastFrame();
    expect(output).toContain('Remove dead exports');
    expect(output).toContain('Write API docs');
    expect(output).toContain('Add unit tests');
  });

  it('should render teammate names', () => {
    const { lastFrame } = renderWithTheme(<TeamPanel team={mockTeam} tasks={mockTasks} />);
    const output = lastFrame();
    expect(output).toContain('hunter');
    expect(output).toContain('writer');
  });

  it('shows each teammate\'s effective provider and model', () => {
    const assignedTeam: Team = {
      ...mockTeam,
      members: [
        {
          name: 'researcher',
          agentName: 'researcher',
          pid: 100,
          status: 'working',
          provider: 'autohandai',
          model: 'fantail',
        },
      ],
    };

    const { lastFrame } = renderWithTheme(<TeamPanel team={assignedTeam} tasks={mockTasks} />);

    expect(lastFrame()).toContain('autohandai · fantail');
  });

  it('shows the exit code for a failed teammate process', () => {
    const failedTeam: Team = {
      ...mockTeam,
      members: [
        { name: 'reviewer', agentName: 'security-auditor', pid: 0, status: 'shutdown', exitCode: 1 },
      ],
    };
    const { lastFrame } = renderWithTheme(<TeamPanel team={failedTeam} tasks={mockTasks} />);

    expect(lastFrame()).toContain('security-auditor; exit 1');
  });

  it('should handle empty tasks', () => {
    const { lastFrame } = renderWithTheme(<TeamPanel team={mockTeam} tasks={[]} />);
    const output = lastFrame();
    expect(output).toContain('0/0 done');
    expect(output).toContain('No tasks yet');
  });
});

describe('TeammateView', () => {
  it('should render teammate name and status', () => {
    const { lastFrame } = renderWithTheme(
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
    const { lastFrame } = renderWithTheme(
      <TeammateView name="hunter" status="working" logs={logs} />
    );
    const output = lastFrame();
    expect(output).toContain('Scanning for dead code');
    expect(output).toContain('3 unused exports');
  });

  it('should show waiting message when no logs', () => {
    const { lastFrame } = renderWithTheme(
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
    const { lastFrame } = renderWithTheme(
      <TeammateView name="hunter" status="working" logs={logs} maxLines={5} />
    );
    const output = lastFrame();
    // Should show last 5 lines (15-19)
    expect(output).toContain('Line 19');
    expect(output).toContain('Line 15');
    expect(output).not.toContain('Line 0');
  });
});
