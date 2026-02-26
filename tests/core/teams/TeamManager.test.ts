/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TeamManager } from '../../../src/core/teams/TeamManager.js';

// Mock TeammateProcess to avoid real process spawning
vi.mock('../../../src/core/teams/TeammateProcess.js', () => {
  return {
    TeammateProcess: vi.fn().mockImplementation((opts) => {
      const mock = {
        name: opts.name,
        status: 'spawning' as string,
        pid: 0,
        setStatus: vi.fn((s: string) => { mock.status = s; }),
        spawn: vi.fn(),
        send: vi.fn(),
        assignTask: vi.fn(),
        sendMessage: vi.fn(),
        requestShutdown: vi.fn(),
        kill: vi.fn(),
        toMember: () => ({
          name: opts.name,
          agentName: opts.agentName,
          pid: 0,
          status: 'idle',
        }),
      };
      return mock;
    }),
  };
});

describe('TeamManager', () => {
  let manager: TeamManager;

  beforeEach(() => {
    manager = new TeamManager({ leadSessionId: 'sess-123', workspacePath: '/tmp' });
  });

  it('should create a team', () => {
    const team = manager.createTeam('code-cleanup');
    expect(team.name).toBe('code-cleanup');
    expect(team.status).toBe('active');
    expect(team.members).toEqual([]);
  });

  it('should not create a second team', () => {
    manager.createTeam('team-a');
    expect(() => manager.createTeam('team-b')).toThrow('already active');
  });

  it('should add a teammate', () => {
    manager.createTeam('test');
    manager.addTeammate({ name: 'researcher', agentName: 'researcher' });
    const team = manager.getTeam();
    expect(team?.members).toHaveLength(1);
  });

  it('should get team status', () => {
    manager.createTeam('test');
    manager.addTeammate({ name: 'worker', agentName: 'code-cleaner' });
    const status = manager.getStatus();
    expect(status.memberCount).toBe(1);
    expect(status.teamName).toBe('test');
  });

  it('should expose task manager', () => {
    manager.createTeam('test');
    const task = manager.tasks.createTask({ subject: 'A', description: '' });
    expect(task.id).toBeDefined();
  });

  it('should throw when adding teammate without team', () => {
    expect(() => manager.addTeammate({ name: 'x', agentName: 'y' })).toThrow('No active team');
  });

  it('should report zero tasks when no tasks created', () => {
    manager.createTeam('test');
    const status = manager.getStatus();
    expect(status.tasksDone).toBe(0);
    expect(status.tasksTotal).toBe(0);
  });

  it('should auto-assign idle teammate when tryAssignIdleTeammate is called', () => {
    manager.createTeam('test');
    manager.addTeammate({ name: 'worker', agentName: 'code-cleaner' });
    // The mock starts with status 'spawning'; set it to 'idle' so the method picks it up
    const teammates = (manager as unknown as { teammates: Map<string, { status: string; setStatus: (s: string) => void }> }).teammates;
    const tp = teammates.get('worker')!;
    tp.setStatus('idle');
    manager.tasks.createTask({ subject: 'Fix bug', description: 'Fix it' });
    manager.tryAssignIdleTeammate();
    const tasks = manager.tasks.listTasks();
    expect(tasks[0].owner).toBe('worker');
    expect(tasks[0].status).toBe('in_progress');
  });
});
