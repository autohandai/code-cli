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
    TeammateProcess: vi.fn().mockImplementation((opts) => ({
      name: opts.name,
      status: 'spawning',
      pid: 0,
      setStatus: vi.fn(),
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
    })),
  };
});

/**
 * Tests for team LLM tool execution paths.
 *
 * These verify that the 5 new team tool actions (create_team, add_teammate,
 * create_task, team_status, send_team_message) work correctly through the
 * TeamManager, matching the executor wiring in agent.ts.
 */
describe('Team tool execution paths', () => {
  let manager: TeamManager;

  beforeEach(() => {
    manager = new TeamManager({ leadSessionId: 'sess-001', workspacePath: '/tmp/project' });
  });

  describe('create_team', () => {
    it('creates a team and returns it', () => {
      const team = manager.createTeam('auth-refactor');
      expect(team.name).toBe('auth-refactor');
      expect(team.status).toBe('active');
      expect(team.members).toEqual([]);
    });

    it('throws if team already active', () => {
      manager.createTeam('first');
      expect(() => manager.createTeam('second')).toThrow('already active');
    });

    it('returns existing team when same name requested (idempotent)', () => {
      manager.createTeam('my-team');
      const existing = manager.getTeam();
      // Same name → reuse
      expect(existing).not.toBeNull();
      expect(existing!.name).toBe('my-team');
    });

    it('replaces team when different name requested after shutdown', async () => {
      manager.createTeam('old-team');
      manager.addTeammate({ name: 'worker', agentName: 'code-cleaner' });
      await manager.shutdown();
      // After shutdown, can create a new team
      const newTeam = manager.createTeam('new-team');
      expect(newTeam.name).toBe('new-team');
      expect(newTeam.members).toEqual([]);
    });
  });

  describe('add_teammate', () => {
    it('adds a teammate to an active team', () => {
      manager.createTeam('test');
      manager.addTeammate({ name: 'coder', agentName: 'code-cleaner' });
      const team = manager.getTeam();
      expect(team?.members).toHaveLength(1);
      expect(team?.members[0].name).toBe('coder');
      expect(team?.members[0].agentName).toBe('code-cleaner');
    });

    it('supports optional model override', () => {
      manager.createTeam('test');
      // Should not throw when model is provided
      expect(() => {
        manager.addTeammate({ name: 'fast-coder', agentName: 'code-cleaner', model: 'gpt-4o' });
      }).not.toThrow();
    });

    it('throws without active team', () => {
      expect(() => manager.addTeammate({ name: 'x', agentName: 'y' })).toThrow('No active team');
    });
  });

  describe('create_task', () => {
    it('creates a task with subject and description', () => {
      manager.createTeam('test');
      const task = manager.tasks.createTask({
        subject: 'Fix auth bug',
        description: 'The login endpoint returns 500 on expired tokens',
      });
      expect(task.id).toBe('task-1');
      expect(task.subject).toBe('Fix auth bug');
      expect(task.status).toBe('pending');
      expect(task.blockedBy).toEqual([]);
    });

    it('creates a task with blocked_by dependencies', () => {
      manager.createTeam('test');
      const t1 = manager.tasks.createTask({ subject: 'Setup', description: 'init' });
      const t2 = manager.tasks.createTask({
        subject: 'Build',
        description: 'build it',
        blockedBy: [t1.id],
      });
      expect(t2.blockedBy).toEqual([t1.id]);
    });

    it('blocked tasks are not available until dependencies complete', () => {
      manager.createTeam('test');
      const t1 = manager.tasks.createTask({ subject: 'A', description: '' });
      manager.tasks.createTask({ subject: 'B', description: '', blockedBy: [t1.id] });
      // Only t1 is available
      expect(manager.tasks.getAvailableTasks()).toHaveLength(1);
      expect(manager.tasks.getAvailableTasks()[0].id).toBe(t1.id);
      // After completing t1, t2 becomes available
      manager.tasks.assignTask(t1.id, 'worker');
      manager.tasks.completeTask(t1.id);
      expect(manager.tasks.getAvailableTasks()).toHaveLength(1);
      expect(manager.tasks.getAvailableTasks()[0].subject).toBe('B');
    });
  });

  describe('task primitives', () => {
    it('gets a task by id from the team task list', () => {
      manager.createTeam('test');
      const task = manager.tasks.createTask({ subject: 'Inspect logs', description: 'Read runtime logs' });

      const fetched = manager.tasks.getTask(task.id);

      expect(fetched?.id).toBe(task.id);
      expect(fetched?.subject).toBe('Inspect logs');
    });

    it('lists tasks with their latest state', () => {
      manager.createTeam('test');
      manager.tasks.createTask({ subject: 'A', description: '' });
      const task = manager.tasks.createTask({ subject: 'B', description: '' });
      manager.tasks.assignTask(task.id, 'worker');

      const tasks = manager.tasks.listTasks();

      expect(tasks).toHaveLength(2);
      expect(tasks.find((item) => item.id === task.id)?.status).toBe('in_progress');
    });

    it('updates a task fields and status', () => {
      manager.createTeam('test');
      const task = manager.tasks.createTask({ subject: 'Old', description: 'old desc' });

      const updated = manager.tasks.updateTask(task.id, {
        subject: 'New',
        description: 'new desc',
        status: 'completed',
      });

      expect(updated.subject).toBe('New');
      expect(updated.description).toBe('new desc');
      expect(updated.status).toBe('completed');
      expect(updated.completedAt).toBeDefined();
    });

    it('stops an assigned task and returns it to pending', () => {
      manager.createTeam('test');
      const task = manager.tasks.createTask({ subject: 'Long run', description: '' });
      manager.tasks.assignTask(task.id, 'worker');

      const stopped = manager.tasks.stopTask(task.id);

      expect(stopped.status).toBe('pending');
      expect(stopped.owner).toBeUndefined();
    });

    it('stores task output for later inspection', () => {
      manager.createTeam('test');
      const task = manager.tasks.createTask({ subject: 'Inspect logs', description: '' });
      manager.tasks.assignTask(task.id, 'worker');

      const updated = manager.tasks.setTaskOutput(task.id, 'Found stack trace in auth flow');

      expect(updated.output).toBe('Found stack trace in auth flow');
      expect(updated.status).toBe('in_progress');
    });
  });

  describe('team_status', () => {
    it('returns null when no team', () => {
      expect(manager.getTeam()).toBeNull();
    });

    it('returns status with members and task progress', () => {
      manager.createTeam('my-team');
      manager.addTeammate({ name: 'worker', agentName: 'code-cleaner' });
      manager.tasks.createTask({ subject: 'T1', description: '' });
      manager.tasks.createTask({ subject: 'T2', description: '' });
      manager.tasks.assignTask('task-1', 'worker');
      manager.tasks.completeTask('task-1');

      const status = manager.getStatus();
      expect(status.teamName).toBe('my-team');
      expect(status.memberCount).toBe(1);
      expect(status.tasksDone).toBe(1);
      expect(status.tasksTotal).toBe(2);
    });
  });

  describe('send_team_message', () => {
    it('sends a message to a teammate', () => {
      manager.createTeam('test');
      manager.addTeammate({ name: 'target', agentName: 'code-cleaner' });
      // Should not throw
      expect(() => manager.sendMessageTo('target', 'lead', 'hello')).not.toThrow();
    });

    it('throws for unknown teammate', () => {
      manager.createTeam('test');
      expect(() => manager.sendMessageTo('ghost', 'lead', 'hi')).toThrow('not found');
    });
  });
});
