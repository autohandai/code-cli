/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { TeamManager } from '../../../src/core/teams/TeamManager.js';

// Mock TeammateProcess to avoid real process spawning
vi.mock('../../../src/core/teams/TeammateProcess.js', () => {
  return {
    TeammateProcess: class {
      constructor(opts: any) {
        this.name = opts.name;
        this.agentName = opts.agentName;
        this.status = 'spawning' as string;
        this.pid = 0;
        this.onMessage = undefined as ((message: { method: string; params: Record<string, unknown> }) => void) | undefined;
        this.onExit = undefined as ((code: number | null) => void) | undefined;
        this.setStatus = vi.fn((s: string) => { this.status = s; });
        this.spawn = vi.fn((
          onMessage: (message: { method: string; params: Record<string, unknown> }) => void,
          onExit: (code: number | null) => void,
        ) => {
          this.onMessage = onMessage;
          this.onExit = onExit;
        });
        this.send = vi.fn();
        this.assignTask = vi.fn();
        this.sendMessage = vi.fn();
        this.requestShutdown = vi.fn();
        this.kill = vi.fn();
      }
      emitMessage(message: { method: string; params: Record<string, unknown> }) {
        this.onMessage?.(message);
      }
      emitExit(code: number | null) {
        this.status = 'shutdown';
        this.onExit?.(code);
      }
      toMember() {
        return {
          name: this.name,
          agentName: this.agentName,
          pid: 0,
          status: this.status,
        };
      }
    },
  };
});

describe('TeamManager', () => {
  let manager: TeamManager;

  beforeEach(() => {
    manager = new TeamManager({ leadSessionId: 'sess-123', workspacePath: '/tmp' });
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it('enforces the configured teammate limit without dropping existing members', () => {
    manager = new TeamManager({
      leadSessionId: 'sess-123',
      workspacePath: '/tmp',
      maxTeammates: 2,
    });
    manager.createTeam('limited');
    manager.addTeammate({ name: 'one', agentName: 'researcher' });
    manager.addTeammate({ name: 'two', agentName: 'reviewer' });

    expect(() => manager.addTeammate({ name: 'three', agentName: 'tester' }))
      .toThrow('maximum of 2');
    expect(manager.getTeam()?.members).toHaveLength(2);
  });

  it('should get team status', () => {
    manager.createTeam('test');
    manager.addTeammate({ name: 'worker', agentName: 'code-cleaner' });
    const status = manager.getStatus();
    expect(status.memberCount).toBe(1);
    expect(status.teamName).toBe('test');
  });

  it('reports an unexpected teammate process exit to runtime consumers', () => {
    const onTeammateMessage = vi.fn();
    manager = new TeamManager({
      leadSessionId: 'sess-123',
      workspacePath: '/tmp',
      onTeammateMessage,
    });
    manager.createTeam('test');
    manager.addTeammate({ name: 'worker', agentName: 'code-cleaner' });

    const teammate = (manager as unknown as {
      teammates: Map<string, { emitExit(code: number | null): void }>;
    }).teammates.get('worker');
    teammate?.emitExit(1);

    expect(onTeammateMessage).toHaveBeenCalledWith('worker', {
      method: 'team.log',
      params: {
        level: 'error',
        text: 'Teammate process exited unexpectedly (code 1).',
      },
    });
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

  it('assigns pending work as soon as a spawned teammate reports ready', () => {
    manager.createTeam('test');
    manager.addTeammate({ name: 'worker', agentName: 'code-cleaner' });
    const task = manager.tasks.createTask({ subject: 'Fix bug', description: 'Fix it' });
    const teammates = (manager as unknown as {
      teammates: Map<string, {
        emitMessage(message: { method: string; params: Record<string, unknown> }): void;
      }>;
    }).teammates;

    expect(manager.tasks.getTask(task.id)?.status).toBe('pending');

    teammates.get('worker')?.emitMessage({
      method: 'team.ready',
      params: { name: 'worker' },
    });

    expect(manager.tasks.getTask(task.id)).toEqual(expect.objectContaining({
      owner: 'worker',
      status: 'in_progress',
    }));
  });

  it('publishes live task and teammate snapshots without polling', () => {
    const snapshots: Array<ReturnType<TeamManager['getSnapshot']>> = [];
    const unsubscribe = manager.subscribe((snapshot) => snapshots.push(snapshot));
    manager.createTeam('test');
    manager.addTeammate({ name: 'worker', agentName: 'code-cleaner' });
    const task = manager.tasks.createTask({ subject: 'Fix bug', description: 'Fix it' });
    const teammates = (manager as unknown as {
      teammates: Map<string, {
        emitMessage(message: { method: string; params: Record<string, unknown> }): void;
      }>;
    }).teammates;

    teammates.get('worker')?.emitMessage({
      method: 'team.ready',
      params: { name: 'worker' },
    });
    teammates.get('worker')?.emitMessage({
      method: 'team.taskUpdate',
      params: { taskId: task.id, status: 'completed', result: 'done' },
    });
    unsubscribe();

    expect(snapshots.at(-1)).toEqual(expect.objectContaining({
      team: expect.objectContaining({
        name: 'test',
        members: [expect.objectContaining({ name: 'worker', status: 'idle' })],
      }),
      tasks: [expect.objectContaining({
        id: task.id,
        owner: 'worker',
        status: 'completed',
        output: 'done',
      })],
    }));
  });

  it('emits hook events for team lifecycle operations', async () => {
    const onHookEvent = vi.fn();
    manager = new TeamManager({ leadSessionId: 'sess-123', workspacePath: '/tmp', onHookEvent });

    manager.createTeam('test');
    manager.addTeammate({ name: 'worker', agentName: 'code-cleaner' });
    const teammates = (manager as unknown as { teammates: Map<string, { status: string; setStatus: (s: string) => void }> }).teammates;
    teammates.get('worker')!.setStatus('idle');
    manager.tasks.createTask({ subject: 'Fix bug', description: 'Fix it' });
    manager.tryAssignIdleTeammate();
    const taskId = manager.tasks.listTasks()[0].id;
    (manager as unknown as {
      handleTeammateMessage: (from: string, msg: { method: string; params: Record<string, unknown> }) => void;
    }).handleTeammateMessage('worker', {
      method: 'team.taskUpdate',
      params: { taskId, status: 'completed', result: 'done' },
    });
    await manager.shutdown();

    expect(onHookEvent).toHaveBeenCalledWith('team-created', expect.objectContaining({
      sessionId: 'sess-123',
      teamName: 'test',
    }));
    expect(onHookEvent).toHaveBeenCalledWith('teammate-spawned', expect.objectContaining({
      teammateName: 'worker',
      teammateAgentName: 'code-cleaner',
    }));
    expect(onHookEvent).toHaveBeenCalledWith('task-assigned', expect.objectContaining({
      teamTaskOwner: 'worker',
      teamMemberCount: 1,
      teamTasksCompleted: 0,
      teamTasksTotal: 1,
    }));
    expect(onHookEvent).toHaveBeenCalledWith('task-completed', expect.objectContaining({
      teamTaskId: taskId,
      teamTaskResult: 'done',
      teamMemberCount: 1,
      teamTasksCompleted: 1,
      teamTasksTotal: 1,
    }));
    expect(onHookEvent).toHaveBeenCalledWith('teammate-idle', expect.objectContaining({
      teammateName: 'worker',
      teamTasksCompleted: 1,
      teamTasksTotal: 1,
    }));
    expect(onHookEvent).toHaveBeenCalledWith('team-shutdown', expect.objectContaining({
      teamName: 'test',
      teamTasksTotal: 1,
    }));
  });

  it('rejects new teammates while shutdown is in progress', async () => {
    vi.useFakeTimers();
    manager.createTeam('test');
    manager.addTeammate({ name: 'worker', agentName: 'code-cleaner' });

    const shutdown = manager.shutdown();

    expect(() => manager.addTeammate({ name: 'late', agentName: 'researcher' }))
      .toThrow(/shutting down/i);
    await vi.runAllTimersAsync();
    await shutdown;
  });

  it('rejects creating a replacement team until shutdown fully settles', async () => {
    vi.useFakeTimers();
    let resolveShutdownHook!: () => void;
    const onHookEvent = vi.fn((event: string) => {
      if (event === 'team-shutdown') {
        return new Promise<void>((resolve) => {
          resolveShutdownHook = resolve;
        });
      }
      return undefined;
    });
    manager = new TeamManager({ leadSessionId: 'sess-123', workspacePath: '/tmp', onHookEvent });
    manager.createTeam('test');
    manager.addTeammate({ name: 'worker', agentName: 'code-cleaner' });

    const shutdown = manager.shutdown();
    await vi.advanceTimersByTimeAsync(750);

    expect(() => manager.createTeam('replacement')).toThrow(/shutting down/i);
    resolveShutdownHook();
    await shutdown;
    expect(manager.createTeam('replacement').name).toBe('replacement');
  });
});
