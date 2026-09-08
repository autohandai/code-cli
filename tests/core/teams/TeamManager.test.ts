/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { TeamManager } from '../../../src/core/teams/TeamManager.js';
import { SessionThreadBudget } from '../../../src/core/agents/SessionThreadBudget.js';
import { AgentRunStore } from '../../../src/core/agents/AgentRunStore.js';
import { PassThrough } from 'node:stream';
import { runTeammateModeWithStreams } from '../../../src/modes/teammate.js';

const spawnControl = vi.hoisted(() => ({ error: undefined as Error | undefined }));

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
          if (spawnControl.error) throw spawnControl.error;
          this.onMessage = onMessage;
          this.onExit = onExit;
        });
        this.send = vi.fn().mockReturnValue(true);
        this.assignTask = vi.fn();
        this.sendMessage = vi.fn();
        this.cancelTask = vi.fn();
        this.updateContext = vi.fn();
        this.requestShutdown = vi.fn();
        this.kill = vi.fn(() => this.emitExit(0));
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
    spawnControl.error = undefined;
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

  it('authorizes only the active teammate attempt and cancels permission checks when the task stops', async () => {
    const authorizeTool = vi.fn(async (_call, signal: AbortSignal) => new Promise<{ allowed: false; error: string }>((resolve) => {
      signal.addEventListener('abort', () => resolve({ allowed: false, error: 'Cancelled' }), { once: true });
    }));
    const manager = new TeamManager({ leadSessionId: 'lead', workspacePath: '/tmp', authorizeTool });
    manager.createTeam('auth-team');
    const teammate = manager.addTeammate({ name: 'worker', agentName: 'tester' });
    const transport = teammate as unknown as { emitMessage(message: { method: string; params: Record<string, unknown> }): void; send: ReturnType<typeof vi.fn> };
    transport.emitMessage({ method: 'team.ready', params: {} });
    const task = manager.tasks.createTask({ subject: 'Inspect', description: 'Read source' });
    manager.tryAssignIdleTeammate();
    const call = { id: 'read-call', tool: 'read_file', args: { path: 'a.txt' } };
    transport.emitMessage({ method: 'team.authorizeTool', params: { requestId: 'stale', taskId: task.id, runId: 'old-attempt', call } });
    expect(authorizeTool).not.toHaveBeenCalled();
    expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({ method: 'team.authorizationResult', params: expect.objectContaining({ requestId: 'stale', result: expect.objectContaining({ allowed: false }) }) }));
    transport.emitMessage({ method: 'team.authorizeTool', params: { requestId: 'current', taskId: task.id, runId: task.runId, call } });
    expect(authorizeTool).toHaveBeenCalledOnce();
    manager.stopTask(task.id);
    expect(authorizeTool.mock.calls[0][1].aborted).toBe(true);
    await vi.waitFor(() => expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({ method: 'team.authorizationResult', params: expect.objectContaining({ requestId: 'current', result: expect.objectContaining({ allowed: false }) }) })));
  });

  it('should not create a second team', () => {
    manager.createTeam('team-a');
    expect(() => manager.createTeam('team-b')).toThrow('already active');
  });

  it('acknowledges run messages only for the exact task, attempt, and target', async () => {
    const runStore = new AgentRunStore();
    manager = new TeamManager({ leadSessionId: 'lead', workspacePath: '/tmp', runStore });
    manager.createTeam('messages');
    const worker = manager.addTeammate({ name: 'worker', agentName: 'tester' });
    emit(worker, 'team.ready', {});
    const task = manager.tasks.createTask({ subject: 'Review', description: 'Check changes' });
    manager.tryAssignIdleTeammate();
    const run = runStore.getSnapshot().runs[0];
    const settled = vi.fn();
    const delivery = runStore.sendMessage(run.id, 'Check the cancellation path').then(settled);
    try {
      expect(runStore.getSnapshot().runs[0].messageable).toBe(true);
      const request = vi.mocked(worker.send).mock.calls.find(([message]) => message.method === 'team.runMessage')?.[0];
      expect(request).toEqual({ method: 'team.runMessage', params: {
        requestId: expect.any(String), taskId: task.id, runId: run.id, targetRunId: run.id,
        content: 'Check the cancellation path',
      } });
      for (const mismatch of [{ taskId: 'another-task' }, { runId: 'previous-attempt' }, { targetRunId: 'another-run' }]) {
        emit(worker, 'team.runMessageResult', { ...request?.params, ...mismatch, accepted: true });
        await Promise.resolve();
        expect(settled).not.toHaveBeenCalled();
      }
      emit(worker, 'team.runMessageResult', { ...request?.params, accepted: true });
      await delivery;
      expect(settled).toHaveBeenCalledExactlyOnceWith(true);
    } finally {
      exitTeammate(worker, 0);
      await delivery;
    }
  });

  it('rejects stale attempts and targets nested messages without redirecting them to the teammate', async () => {
    const runStore = new AgentRunStore();
    manager = new TeamManager({ leadSessionId: 'lead', workspacePath: '/tmp', runStore });
    manager.createTeam('nested-messages');
    const worker = manager.addTeammate({ name: 'worker', agentName: 'tester' });
    emit(worker, 'team.ready', {});
    const task = manager.tasks.createTask({ subject: 'Review', description: 'Check changes' });
    manager.tryAssignIdleTeammate();
    const firstRunId = runStore.getSnapshot().runs[0].id;
    emit(worker, 'team.taskUpdate', { taskId: task.id, status: 'failed', error: 'Retry' });
    manager.updateTask(task.id, { status: 'pending' });
    const currentRunId = runStore.getSnapshot().runs.at(-1)!.id;
    expect(currentRunId).not.toBe(firstRunId);
    await expect(runStore.sendMessage(firstRunId, 'Must not enter the retry')).resolves.toBe(false);
    emit(worker, 'team.subagentStart', {
      taskId: task.id, subagentId: 'nested-message-run', subagentName: 'reviewer', subagentType: 'researcher',
      task: 'Inspect cancellation', parentId: currentRunId, messageable: true,
    });
    const delivery = runStore.sendMessage('nested-message-run', 'Inspect only this child');
    try {
      const request = vi.mocked(worker.send).mock.calls.find(([message]) => message.method === 'team.runMessage')?.[0];
      expect(request?.params).toMatchObject({ taskId: task.id, runId: currentRunId, targetRunId: 'nested-message-run' });
      expect(runStore.getSnapshot().runs.at(-1)).toMatchObject({ messageable: true, agentType: 'researcher' });
      emit(worker, 'team.runMessageResult', { ...request?.params, accepted: false });
      await expect(delivery).resolves.toBe(false);
      emit(worker, 'team.subagentStop', { taskId: task.id, subagentId: 'nested-message-run', success: true });
      await expect(runStore.sendMessage('nested-message-run', 'Too late')).resolves.toBe(false);
    } finally {
      exitTeammate(worker, 0);
      await delivery;
    }
  });

  it('settles unacknowledged run messages when transport closes, cancellation starts, or acknowledgement expires', async () => {
    vi.useFakeTimers();
    const runStore = new AgentRunStore();
    manager = new TeamManager({ leadSessionId: 'lead', workspacePath: '/tmp', runStore });
    manager.createTeam('message-failures');
    const worker = manager.addTeammate({ name: 'worker', agentName: 'tester' });
    emit(worker, 'team.ready', {});
    const task = manager.tasks.createTask({ subject: 'Review', description: 'Check changes' });
    manager.tryAssignIdleTeammate();
    const runId = runStore.getSnapshot().runs[0].id;
    try {
      vi.mocked(worker.send).mockReturnValueOnce(false);
      await expect(runStore.sendMessage(runId, 'Closed pipe')).resolves.toBe(false);
      const timedOut = runStore.sendMessage(runId, 'No acknowledgement');
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(timedOut).resolves.toBe(false);
      const cancelled = runStore.sendMessage(runId, 'Cancellation race');
      manager.stopTask(task.id);
      await expect(cancelled).resolves.toBe(false);
      emit(worker, 'team.taskUpdate', { taskId: task.id, status: 'cancelled' });
      manager.updateTask(task.id, { status: 'pending' });
      const disconnected = runStore.sendMessage(runStore.getSnapshot().runs.at(-1)!.id, 'Disconnect race');
      exitTeammate(worker, 1);
      await expect(disconnected).resolves.toBe(false);
    } finally {
      exitTeammate(worker, 0);
    }
  });

  it('does not let a teammate claim another run identifier and replace its message or cancellation controls', async () => {
    const runStore = new AgentRunStore();
    const sendMessage = vi.fn(() => true);
    const cancel = vi.fn();
    runStore.start({ id: 'existing-direct-run', source: 'delegate', name: 'reader', task: 'Existing direct work' });
    runStore.registerMessage('existing-direct-run', sendMessage);
    runStore.registerCancel('existing-direct-run', cancel);
    manager = new TeamManager({ leadSessionId: 'lead', workspacePath: '/tmp', runStore });
    manager.createTeam('run-ownership');
    const worker = manager.addTeammate({ name: 'worker', agentName: 'tester' });
    emit(worker, 'team.ready', {});
    const task = manager.tasks.createTask({ subject: 'Review', description: 'Check changes' });
    manager.tryAssignIdleTeammate();
    try {
      emit(worker, 'team.subagentStart', {
        taskId: task.id, subagentId: 'existing-direct-run', subagentName: 'spoofed-reader',
        task: 'Different work', parentId: task.runId, messageable: true,
      });
      const delivery = runStore.sendMessage('existing-direct-run', 'For the original run');
      expect(sendMessage).toHaveBeenCalledExactlyOnceWith('For the original run');
      await expect(delivery).resolves.toBe(true);
      await expect(runStore.requestCancel('existing-direct-run')).resolves.toBe(true);
      expect(cancel).toHaveBeenCalledOnce();
      expect(worker.send).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'team.runMessage' }));
      expect(worker.send).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'team.cancelRun' }));
      emit(worker, 'team.subagentStop', { taskId: task.id, subagentId: 'existing-direct-run', success: true });
      expect(runStore.getSnapshot().runs[0]).toMatchObject({ name: 'reader', status: 'running' });
    } finally {
      exitTeammate(worker, 0);
    }
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

  it('records failures and rejects task updates from a different teammate', () => {
    manager.createTeam('test');
    const worker = manager.addTeammate({ name: 'worker', agentName: 'tester' });
    const other = manager.addTeammate({ name: 'other', agentName: 'tester' });
    const task = manager.tasks.createTask({ subject: 'Verify', description: '' });
    emit(worker, 'team.ready', {});
    emit(other, 'team.taskUpdate', { taskId: task.id, status: 'completed', result: 'forged' });
    expect(manager.tasks.getTask(task.id)?.status).toBe('in_progress');
    expect(manager.tasks.getTask(task.id)?.output).toBeUndefined();

    emit(worker, 'team.taskUpdate', { taskId: task.id, status: 'failed', error: 'Unavailable' });
    expect(manager.tasks.getTask(task.id)).toMatchObject({ status: 'failed', error: 'Unavailable' });
    expect(worker.status).toBe('idle');
    expect(() => emit(worker, 'team.taskUpdate', { taskId: 'missing', status: 'completed' })).not.toThrow();
  });

  it('cancels the executing child and ignores its late completion', () => {
    manager.createTeam('test');
    const worker = manager.addTeammate({ name: 'worker', agentName: 'tester' });
    const task = manager.tasks.createTask({ subject: 'Verify', description: '' });
    emit(worker, 'team.ready', {});

    manager.stopTask(task.id);
    expect(worker.cancelTask).toHaveBeenCalledWith(task.id, 'Task cancelled by the lead', task.runId);
    expect(manager.tasks.getTask(task.id)).toMatchObject({ status: 'in_progress', cancelRequested: true });
    expect(worker.status).toBe('working');
    emit(worker, 'team.taskUpdate', { taskId: task.id, status: 'completed', result: 'too late' });
    expect(manager.tasks.getTask(task.id)?.status).toBe('cancelled');
  });

  it.each(['pending', 'completed', 'failed', 'cancelled'] as const)(
    'waits for child drainage before task_update applies %s', (requestedStatus) => {
      const runStore = new AgentRunStore();
      manager = new TeamManager({ leadSessionId: 'session', workspacePath: '/tmp', runStore });
      manager.createTeam('update');
      const worker = manager.addTeammate({ name: 'worker', agentName: 'tester' });
      const task = manager.tasks.createTask({ subject: 'Verify', description: '' });
      emit(worker, 'team.ready', {});

      manager.updateTask(task.id, { status: requestedStatus, subject: 'Revised verification' });

      expect(worker.cancelTask).toHaveBeenCalledWith(task.id, expect.any(String), task.runId);
      expect(task).toMatchObject({ status: 'in_progress', cancelRequested: true, subject: 'Revised verification' });
      expect(runStore.getSnapshot().runs[0].status).toBe('running');
      emit(worker, 'team.taskUpdate', { taskId: task.id, status: 'completed', result: 'Late success' });
      expect(task.status).toBe(requestedStatus);
      expect(runStore.getSnapshot().runs[0].status).toBe('cancelled');
    },
  );

  it('rejects stale and missing execution identifiers after retrying a task with the same owner', () => {
    const runStore = new AgentRunStore();
    manager = new TeamManager({ leadSessionId: 'session', workspacePath: '/tmp', runStore });
    manager.createTeam('retry');
    const worker = manager.addTeammate({ name: 'worker', agentName: 'tester' });
    const task = manager.tasks.createTask({ subject: 'Verify', description: '' });
    emit(worker, 'team.ready', {});
    const oldRunId = task.runId;
    emit(worker, 'team.taskUpdate', { taskId: task.id, status: 'failed' });
    manager.updateTask(task.id, { status: 'pending' });
    expect(task.runId).not.toBe(oldRunId);
    emit(worker, 'team.progress', { taskId: task.id, runId: oldRunId, tool: 'old-tool' });
    emit(worker, 'team.taskUpdate', { taskId: task.id, runId: oldRunId, status: 'completed', result: 'Stale result' });
    emit(worker, 'team.taskUpdate', { taskId: task.id, runId: undefined, status: 'completed', result: 'Missing run' });
    expect(task.status).toBe('in_progress');
    expect(task.output).toBeUndefined();
    expect(runStore.getSnapshot().runs.at(-1)?.activity).not.toBe('old-tool');
  });

  it('keeps profile-backed local teammates in the cancellable team source', () => {
    const runStore = new AgentRunStore();
    manager = new TeamManager({ leadSessionId: 'session', workspacePath: '/tmp', runStore });
    manager.createTeam('profile-team').sourceProfile = 'web-app';
    const worker = manager.addTeammate({ name: 'worker', agentName: 'tester' });
    manager.tasks.createTask({ subject: 'Verify', description: '' });
    emit(worker, 'team.ready', {});
    expect(runStore.getSnapshot().runs[0]).toMatchObject({ source: 'team', cancellable: true });
  });

  it('records crashed work as failed and lets a replacement reuse the teammate limit', () => {
    manager = new TeamManager({ leadSessionId: 'sess-123', workspacePath: '/tmp', maxTeammates: 1 });
    manager.createTeam('test');
    const worker = manager.addTeammate({ name: 'worker', agentName: 'tester' });
    const task = manager.tasks.createTask({ subject: 'Verify', description: '' });
    emit(worker, 'team.ready', {});
    exitTeammate(worker, 1);

    expect(manager.tasks.getTask(task.id)?.status).toBe('failed');
    expect(() => manager.addTeammate({ name: 'replacement', agentName: 'tester' })).not.toThrow();
    expect(manager.getStatus().memberCount).toBe(1);
  });

  it('dispatches an explicitly requested retry after the previous owner exits', () => {
    manager.createTeam('retry-after-exit');
    const worker = manager.addTeammate({ name: 'worker', agentName: 'tester' });
    const replacement = manager.addTeammate({ name: 'replacement', agentName: 'tester' });
    const task = manager.tasks.createTask({ subject: 'Verify', description: '' });
    emit(worker, 'team.ready', {});
    emit(replacement, 'team.ready', {});
    const oldRunId = task.runId;
    manager.updateTask(task.id, { status: 'pending' });
    exitTeammate(worker, 1);
    expect(task).toMatchObject({ status: 'in_progress', owner: 'replacement' });
    expect(task.runId).not.toBe(oldRunId);
  });

  it('resolves the real lead session when the team is created after startup', () => {
    const session = { id: 'before-startup' };
    manager = new TeamManager({
      leadSessionId: () => session.id,
      workspacePath: '/tmp',
    });
    session.id = 'session-current';
    expect(manager.createTeam('test').leadSessionId).toBe('session-current');
  });

  it('shares a cap across in-process delegates, teammates and nested child requests', () => {
    const budget = new SessionThreadBudget(() => 4);
    const delegatedLease = budget.tryAcquire('in-process-delegate');
    manager = new TeamManager({ leadSessionId: 'session', workspacePath: '/tmp', threadBudget: budget });
    manager.createTeam('mixed');
    const worker = manager.addTeammate({ name: 'worker', agentName: 'tester' });
    emit(worker, 'team.threadAcquire', { requestId: 'request-1', runId: 'nested-1' });
    expect(worker.send).toHaveBeenCalledWith({ method: 'team.threadResult', params: { requestId: 'request-1', granted: true } });
    expect(budget.activeChildren).toBe(3);
    emit(worker, 'team.threadAcquire', { requestId: 'request-2', runId: 'nested-2' });
    expect(worker.send).toHaveBeenCalledWith({ method: 'team.threadResult', params: expect.objectContaining({ requestId: 'request-2', granted: false }) });
    expect(() => manager.addTeammate({ name: 'extra', agentName: 'tester' })).toThrow('limited to 4');

    emit(worker, 'team.threadRelease', { requestId: 'request-1' });
    expect(budget.activeChildren).toBe(2);
    emit(worker, 'team.threadAcquire', { requestId: 'request-3', runId: 'nested-3' });
    emit(worker, 'team.shutdownAck', {});
    expect(budget.activeChildren).toBe(3);
    exitTeammate(worker, 1);
    expect(budget.activeChildren).toBe(1);
    delegatedLease.release();
    expect(budget.activeChildren).toBe(0);
  });

  it('brokers a real child IPC request against the same cap as in-process work', async () => {
    const budget = new SessionThreadBudget(() => 4);
    const delegate = budget.tryAcquire('in-process');
    manager = new TeamManager({ leadSessionId: 'session', workspacePath: '/tmp', threadBudget: budget });
    manager.createTeam('ipc');
    const worker = manager.addTeammate({ name: 'worker', agentName: 'tester' });
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    vi.mocked(worker.send).mockImplementation((message) => {
      stdin.write(JSON.stringify(message) + '\n');
      return true;
    });
    vi.mocked(worker.assignTask).mockImplementation((task) => {
      stdin.write(JSON.stringify({ method: 'team.assignTask', params: { task } }) + '\n');
    });
    stdout.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().trim().split('\n')) {
        const message = JSON.parse(line);
        emit(worker, message.method, message.params);
      }
    });
    const task = manager.tasks.createTask({ subject: 'Nested task', description: '' });
    const execute = vi.fn(async (_opts, _task, runtime) => {
      const lease = await runtime.threadBudget.tryAcquire('nested');
      try {
        expect(budget.activeChildren).toBe(3);
        await expect(runtime.threadBudget.tryAcquire('overflow')).rejects.toThrow('limited to 4');
        return 'Nested IPC completed';
      } finally {
        await lease.release();
      }
    });
    const running = runTeammateModeWithStreams({ teamName: 'ipc', name: 'worker', agentName: 'tester', leadSessionId: 'session' }, stdin, stdout, { execute });
    await vi.waitFor(() => expect(manager.tasks.getTask(task.id)).toMatchObject({ status: 'completed', output: 'Nested IPC completed' }));
    expect(budget.activeChildren).toBe(2);
    worker.send({ method: 'team.shutdown', params: {} });
    await running;
    expect(budget.activeChildren).toBe(2);
    exitTeammate(worker, 0);
    delegate.release();
    expect(budget.activeChildren).toBe(0);
  });

  it('does not start a retry until the cancelled child execution actually drains', async () => {
    manager.createTeam('drained-retry');
    const worker = manager.addTeammate({ name: 'worker', agentName: 'tester' });
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    vi.mocked(worker.send).mockImplementation((message) => { stdin.write(JSON.stringify(message) + '\n'); return true; });
    vi.mocked(worker.assignTask).mockImplementation((task) => {
      worker.send({ method: 'team.assignTask', params: { task } });
    });
    vi.mocked(worker.cancelTask).mockImplementation((taskId, reason, runId) => {
      worker.send({ method: 'team.cancelTask', params: { taskId, reason, runId } });
    });
    stdout.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().trim().split('\n')) {
        const message = JSON.parse(line);
        emit(worker, message.method, message.params);
      }
    });
    let drain!: (result: string) => void;
    let firstSignal: AbortSignal | undefined;
    const execute = vi.fn(async (_opts, _task, runtime) => {
      if (execute.mock.calls.length > 1) return 'Retried work completed';
      firstSignal = runtime.signal;
      return new Promise<string>((resolve) => { drain = resolve; });
    });
    const task = manager.tasks.createTask({ subject: 'Retry safely', description: '' });
    const running = runTeammateModeWithStreams({ teamName: 'drained-retry', name: 'worker', agentName: 'tester', leadSessionId: 'sess-123' }, stdin, stdout, { execute });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    const firstRunId = task.runId;

    manager.updateTask(task.id, { status: 'pending' });
    expect(firstSignal?.aborted).toBe(true);
    expect(task.status).toBe('in_progress');
    expect(execute).toHaveBeenCalledOnce();
    drain('Old execution returned after abort');

    await vi.waitFor(() => expect(task).toMatchObject({ status: 'completed', output: 'Retried work completed' }));
    expect(execute).toHaveBeenCalledTimes(2);
    expect(task.runId).not.toBe(firstRunId);
    worker.send({ method: 'team.shutdown', params: {} });
    await running;
    exitTeammate(worker, 0);
  });

  it('releases a reservation when spawning throws before a process starts', () => {
    const budget = new SessionThreadBudget(() => 2);
    manager = new TeamManager({ leadSessionId: 'session', workspacePath: '/tmp', threadBudget: budget });
    manager.createTeam('spawn-failure');
    spawnControl.error = new Error('spawn failed');
    expect(() => manager.addTeammate({ name: 'worker', agentName: 'tester' })).toThrow('spawn failed');
    expect(budget.activeChildren).toBe(0);
    expect(manager.getTeam()?.members).toEqual([]);
  });

  it('publishes cancellable task executions with live progress to the run inspector', async () => {
    const runStore = new AgentRunStore();
    manager = new TeamManager({ leadSessionId: 'session', workspacePath: '/tmp', runStore });
    manager.createTeam('inspect');
    const worker = manager.addTeammate({ name: 'worker', agentName: 'tester' });
    const task = manager.tasks.createTask({ subject: 'Check changes', description: '' });
    emit(worker, 'team.ready', {});
    const run = runStore.getSnapshot().runs[0];
    expect(run).toMatchObject({ parentId: 'session', source: 'team', task: 'Check changes', cancellable: true });
    emit(worker, 'team.progress', { taskId: task.id, status: 'tool', tool: 'read_file' });
    expect(runStore.getSnapshot().runs[0].activity).toBe('read_file');
    expect(await runStore.requestCancel(run.id)).toBe(true);
    expect(worker.cancelTask).toHaveBeenCalledWith(task.id, 'Task cancelled by the lead', task.runId);
    expect(runStore.getSnapshot().runs[0]).toMatchObject({ status: 'running', cancelRequested: true });
    emit(worker, 'team.taskUpdate', { taskId: task.id, status: 'cancelled' });
    expect(runStore.getSnapshot().runs[0].status).toBe('cancelled');
  });

  it('tracks nested child runs and fails their inspector entries when the process dies', async () => {
    const runStore = new AgentRunStore();
    manager = new TeamManager({ leadSessionId: 'session', workspacePath: '/tmp', runStore });
    manager.createTeam('nested');
    const worker = manager.addTeammate({ name: 'worker', agentName: 'tester' });
    const task = manager.tasks.createTask({ subject: 'Check changes', description: '' });
    emit(worker, 'team.ready', {});
    const parent = runStore.getSnapshot().runs[0];
    emit(worker, 'team.subagentStart', {
      taskId: task.id, subagentId: 'nested-run', subagentName: 'reviewer', task: 'Inspect code', parentId: parent.id, depth: 2,
    });
    emit(worker, 'team.subagentProgress', {
      taskId: task.id, subagentId: 'nested-run', tool: 'read_file', usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
    });
    expect(runStore.getSnapshot().runs[1]).toMatchObject({ parentId: parent.id, depth: 2, activity: 'read_file', usage: { totalTokens: 120 } });
    expect(await runStore.requestCancel('nested-run')).toBe(true);
    expect(worker.send).toHaveBeenCalledWith({ method: 'team.cancelRun', params: { runId: 'nested-run' } });
    exitTeammate(worker, 1);
    expect(runStore.getSnapshot().runs.map((run) => run.status)).toEqual(['failed', 'failed']);
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
      params: { taskId: task.id, runId: task.runId, status: 'completed', result: 'done' },
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
      params: { taskId, runId: manager.tasks.getTask(taskId)?.runId, status: 'completed', result: 'done' },
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

  it('retains leases and reports incomplete shutdown when a child will not stop', async () => {
    vi.useFakeTimers();
    const budget = new SessionThreadBudget(() => 2);
    manager = new TeamManager({ leadSessionId: 'session', workspacePath: '/tmp', threadBudget: budget });
    manager.createTeam('stuck-child');
    const worker = manager.addTeammate({ name: 'worker', agentName: 'tester' });
    vi.mocked(worker.kill).mockImplementation(() => {});
    const task = manager.tasks.createTask({ subject: 'Work', description: '' });
    emit(worker, 'team.ready', {});

    const rejected = expect(manager.shutdown()).rejects.toThrow('not stopped');
    await vi.runAllTimersAsync();
    await rejected;
    expect(budget.activeChildren).toBe(1);
    expect(manager.getTeam()?.status).toBe('active');
    expect(manager.tasks.getTask(task.id)).toMatchObject({ status: 'in_progress', cancelRequested: true });
    expect(() => manager.createTeam('replacement')).toThrow('shutting down');
    exitTeammate(worker, 1);
    expect(budget.activeChildren).toBe(0);
    expect(manager.tasks.getTask(task.id)?.status).toBe('cancelled');
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

function emit(teammate: unknown, method: string, params: Record<string, unknown>): void {
  if (typeof params.taskId === 'string' && !Object.hasOwn(params, 'runId')) {
    const mock = teammate as { assignTask: { mock: { calls: Array<[{ id: string; runId?: string }]> } } };
    const task = mock.assignTask.mock.calls.map(([entry]) => entry).findLast((entry) => entry.id === params.taskId);
    params = { ...params, runId: task?.runId };
  }
  (teammate as { emitMessage(message: { method: string; params: Record<string, unknown> }): void })
    .emitMessage({ method, params });
}

function exitTeammate(teammate: unknown, code: number): void {
  (teammate as { emitExit(code: number): void }).emitExit(code);
}
