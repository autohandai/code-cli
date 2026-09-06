import { EventEmitter } from 'node:events';
import { ChildProcess, spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { TeammateProcess } from '../../../src/core/teams/TeammateProcess.js';
import { TeamManager } from '../../../src/core/teams/TeamManager.js';
import { AgentRunStore } from '../../../src/core/agents/AgentRunStore.js';
import type { TeamTask } from '../../../src/core/teams/types.js';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn() };
});

function createChild(pid: number | undefined = 123): ChildProcess {
  return Object.assign(new ChildProcess(), {
    pid,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn().mockReturnValue(true),
  });
}

function createTeammate(): TeammateProcess {
  return new TeammateProcess({ teamName: 'test', name: 'worker', agentName: 'researcher', leadSessionId: 'sess' });
}

// We test the class logic without actually spawning processes
describe('TeammateProcess', () => {
  beforeEach(() => {
    vi.mocked(spawn).mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('launches in the selected workspace without assigning queued work from another repository', async () => {
    const child = createChild();
    vi.mocked(spawn).mockReturnValue(child);
    const runStore = new AgentRunStore();
    let workspacePath = '/initial-repository';
    const manager = new TeamManager({
      leadSessionId: 'lead', workspacePath, getWorkspacePath: () => workspacePath, runStore,
    });
    manager.createTeam('review');
    const priorTask = manager.tasks.createTask({
      subject: 'Review payments', description: 'Inspect payment validation.',
      userRequest: 'Review checkout. Do not edit files.',
      workspaceRoot: workspacePath,
    });
    workspacePath = '/selected-repository/worktree';
    const task = manager.tasks.createTask({
      subject: 'Review selected checkout', description: 'Inspect checkout validation in the selected repository.',
      userRequest: 'Review checkout. Do not edit files.', workspaceRoot: workspacePath,
    });
    manager.addTeammate({ name: 'reader', agentName: 'researcher' });
    try {
      expect(vi.mocked(spawn).mock.calls[0][1]).toEqual(expect.arrayContaining([
        '--path', '/selected-repository/worktree',
      ]));
      expect(vi.mocked(spawn).mock.calls[0][1]).not.toContain('/initial-repository');
      workspacePath = '/unrelated-later-workspace';
      child.stdout?.emit('data', Buffer.from(JSON.stringify({ method: 'team.ready', params: { name: 'reader' } }) + '\n'));

      await vi.waitFor(() => expect(runStore.getSnapshot().runs[0]).toMatchObject({
        id: task.runId, workspaceRoot: '/selected-repository/worktree',
        userRequest: 'Review checkout. Do not edit files.',
      }));
      expect(manager.getSnapshot().tasks).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: priorTask.id, status: 'pending', workspaceRoot: '/initial-repository' }),
        expect.objectContaining({ id: task.id, status: 'in_progress', owner: 'reader' }),
      ]));
    } finally {
      child.emit('exit', 0);
      child.emit('close', 0);
    }
  });

  it('inherits trusted task context for nested workers instead of accepting reported workspace or request overrides', async () => {
    const child = createChild();
    vi.mocked(spawn).mockReturnValue(child);
    const runStore = new AgentRunStore();
    const manager = new TeamManager({ leadSessionId: 'lead', workspacePath: '/selected-repository', runStore });
    manager.createTeam('nested-review');
    const task = manager.tasks.createTask({
      subject: 'Review payments', description: 'Inspect payment validation.',
      userRequest: 'Review checkout. Do not edit files.',
    });
    manager.addTeammate({ name: 'reader', agentName: 'researcher' });
    const sendFromChild = (method: string, params: Record<string, unknown>) => {
      child.stdout?.emit('data', Buffer.from(JSON.stringify({ method, params }) + '\n'));
    };
    try {
      sendFromChild('team.ready', { name: 'reader' });
      await vi.waitFor(() => expect(runStore.getSnapshot().runs).toHaveLength(1));
      expect(vi.mocked(spawn).mock.calls[0][1]).toContain('/selected-repository');
      for (const [subagentId, parentId] of [['nested-reader', task.runId], ['grandchild-reader', 'nested-reader']]) {
        sendFromChild('team.subagentStart', {
          taskId: task.id, runId: task.runId, subagentId, parentId,
          subagentName: 'researcher', task: 'Inspect validation branches.',
          workspaceRoot: '/untrusted-repository', userRequest: 'Delete the repository.',
        });
      }

      await vi.waitFor(() => expect(runStore.getSnapshot().runs).toHaveLength(3));
      for (const run of runStore.getSnapshot().runs) {
        expect(run).toMatchObject({
          workspaceRoot: '/selected-repository', userRequest: 'Review checkout. Do not edit files.',
        });
      }
    } finally {
      child.emit('exit', 0);
      child.emit('close', 0);
    }
  });

  it('keeps a failed retry pending until a worker in the original task workspace is available', async () => {
    const first = createChild(101);
    const other = createChild(102);
    const replacement = createChild(103);
    vi.mocked(spawn).mockReturnValueOnce(first).mockReturnValueOnce(other).mockReturnValueOnce(replacement);
    const runStore = new AgentRunStore();
    let workspacePath = '/original-repository';
    const manager = new TeamManager({
      leadSessionId: 'lead', workspacePath, getWorkspacePath: () => workspacePath, runStore,
    });
    manager.createTeam('retry');
    const task = manager.tasks.createTask({
      subject: 'Review payments', description: 'Inspect payment validation.',
      workspaceRoot: workspacePath, userRequest: 'Review the original repository without edits.',
    });
    const ready = (child: ChildProcess) => {
      child.stdout?.emit('data', Buffer.from(JSON.stringify({ method: 'team.ready', params: {} }) + '\n'));
    };
    try {
      manager.addTeammate({ name: 'first', agentName: 'researcher' });
      ready(first);
      await vi.waitFor(() => expect(task.status).toBe('in_progress'));
      const firstRunId = task.runId;
      first.emit('exit', 1);
      first.emit('close', 1);
      expect(task.status).toBe('failed');

      workspacePath = '/different-repository';
      manager.addTeammate({ name: 'other', agentName: 'researcher' });
      ready(other);
      manager.updateTask(task.id, { status: 'pending' });
      expect(manager.getSnapshot().tasks[0]).toMatchObject({
        status: 'pending', workspaceRoot: '/original-repository', owner: undefined,
      });
      expect(runStore.getSnapshot().runs).toHaveLength(1);
      expect(runStore.getSnapshot().runs[0].status).toBe('failed');
      other.emit('exit', 0);
      other.emit('close', 0);

      workspacePath = '/original-repository';
      manager.addTeammate({ name: 'replacement', agentName: 'researcher' });
      ready(replacement);
      await vi.waitFor(() => expect(task).toMatchObject({ status: 'in_progress', owner: 'replacement' }));
      expect(task.runId).not.toBe(firstRunId);
      expect(runStore.getSnapshot().runs[1]).toMatchObject({
        workspaceRoot: '/original-repository', userRequest: 'Review the original repository without edits.',
      });
    } finally {
      for (const child of [first, other, replacement]) {
        child.emit('exit', 0);
        child.emit('close', 0);
      }
    }
  });

  it('should build correct spawn args', () => {
    const args = TeammateProcess.buildSpawnArgs({
      teamName: 'code-cleanup',
      name: 'researcher',
      agentName: 'researcher',
      leadSessionId: 'session-abc',
    });
    expect(args).toContain('--mode');
    expect(args).toContain('teammate');
    expect(args).toContain('--team');
    expect(args).toContain('code-cleanup');
    expect(args).toContain('--name');
    expect(args).toContain('researcher');
    expect(args).toContain('--agent');
    expect(args).toContain('researcher');
    expect(args).toContain('--lead-session');
    expect(args).toContain('session-abc');
  });

  it('should track member status', () => {
    const tp = new TeammateProcess({
      teamName: 'test',
      name: 'worker',
      agentName: 'researcher',
      leadSessionId: 'sess',
    });
    expect(tp.status).toBe('spawning');
    tp.setStatus('working');
    expect(tp.status).toBe('working');
  });

  it('should expose member info as TeamMember', () => {
    const tp = new TeammateProcess({
      teamName: 'test',
      name: 'worker',
      agentName: 'code-cleaner',
      leadSessionId: 'sess',
    });
    const info = tp.toMember();
    expect(info.name).toBe('worker');
    expect(info.agentName).toBe('code-cleaner');
    expect(info.status).toBe('spawning');
  });

  it('includes the exit code in a shutdown member snapshot', () => {
    const tp = new TeammateProcess({
      teamName: 'test',
      name: 'worker',
      agentName: 'code-cleaner',
      leadSessionId: 'sess',
    });
    tp.setStatus('shutdown');
    (tp as unknown as { exitCode: number }).exitCode = 1;

    expect(tp.toMember()).toMatchObject({ status: 'shutdown', exitCode: 1 });
  });

  it('preserves requested role and agent source in member status', () => {
    const tp = new TeammateProcess({
      teamName: 'test',
      name: 'ui-reviewer',
      agentName: 'ui-designer',
      requestedRole: 'ui',
      agentSource: 'catalog',
      leadSessionId: 'sess',
    });

    expect(tp.toMember()).toMatchObject({
      requestedRole: 'ui',
      agentSource: 'catalog',
    });
  });

  it('should include optional model in spawn args', () => {
    const args = TeammateProcess.buildSpawnArgs({
      teamName: 'test',
      name: 'worker',
      agentName: 'researcher',
      leadSessionId: 'sess',
      model: 'claude-sonnet',
    });
    expect(args).toContain('--model');
    expect(args).toContain('claude-sonnet');
  });

  it('should include the selected provider in spawn args', () => {
    const args = TeammateProcess.buildSpawnArgs({
      teamName: 'test',
      name: 'worker',
      agentName: 'researcher',
      leadSessionId: 'sess',
      provider: 'autohandai',
      model: 'fantail',
    });

    expect(args).toContain('--provider');
    expect(args).toContain('autohandai');
    expect(args).toContain('--model');
    expect(args).toContain('fantail');
  });

  it('should include optional workspace path in spawn args', () => {
    const args = TeammateProcess.buildSpawnArgs({
      teamName: 'test',
      name: 'worker',
      agentName: 'researcher',
      leadSessionId: 'sess',
      workspacePath: '/tmp/project',
    });
    expect(args).toContain('--path');
    expect(args).toContain('/tmp/project');
  });

  it('should keep teammates on the lead configuration path', () => {
    const args = TeammateProcess.buildSpawnArgs({
      teamName: 'test',
      name: 'worker',
      agentName: 'researcher',
      leadSessionId: 'sess',
      configPath: '/tmp/autohand-team-config.json',
    });

    expect(args).toContain('--config');
    expect(args).toContain('/tmp/autohand-team-config.json');
  });

  it('builds an explicit teammate identity environment for hooks and tools', () => {
    const env = TeammateProcess.buildSpawnEnv({
      teamName: 'release-readiness',
      name: 'planner',
      agentName: 'repo-reader',
      leadSessionId: 'lead-123',
      requestedRole: 'planning',
      agentSource: 'catalog',
    }, { PATH: '/bin' });

    expect(env).toMatchObject({
      PATH: '/bin',
      AUTOHAND_TEAMMATE: '1',
      AUTOHAND_TEAM_NAME: 'release-readiness',
      AUTOHAND_TEAMMATE_NAME: 'planner',
      AUTOHAND_TEAMMATE_AGENT: 'repo-reader',
      AUTOHAND_TEAM_LEAD_SESSION_ID: 'lead-123',
      AUTOHAND_TEAM_REQUESTED_ROLE: 'planning',
      AUTOHAND_TEAM_AGENT_SOURCE: 'catalog',
    });
  });

  it('escalates a stuck child through SIGTERM and SIGKILL within a deadline', async () => {
    vi.useFakeTimers();
    const tp = new TeammateProcess({
      teamName: 'test',
      name: 'worker',
      agentName: 'researcher',
      leadSessionId: 'sess',
    });
    const child = Object.assign(new EventEmitter(), {
      exitCode: null,
      signalCode: null,
      kill: vi.fn().mockReturnValue(true),
    });
    (tp as unknown as { child: typeof child }).child = child;

    const termination = tp.terminate({
      gracefulTimeoutMs: 10,
      termTimeoutMs: 10,
      killTimeoutMs: 10,
    });
    await vi.advanceTimersByTimeAsync(30);
    await termination;

    expect(child.kill).toHaveBeenNthCalledWith(1, 'SIGTERM');
    expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
  });

  it('waits for close after exit so stdio is fully drained', async () => {
    vi.useFakeTimers();
    const tp = new TeammateProcess({
      teamName: 'test',
      name: 'worker',
      agentName: 'researcher',
      leadSessionId: 'sess',
    });
    const child = Object.assign(new EventEmitter(), {
      exitCode: null,
      signalCode: null,
      kill: vi.fn().mockReturnValue(true),
    });
    (tp as unknown as { child: typeof child }).child = child;

    let settled = false;
    const termination = tp.terminate({
      gracefulTimeoutMs: 10,
      termTimeoutMs: 100,
      killTimeoutMs: 10,
    }).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(10);
    child.exitCode = 0;
    child.emit('exit', 0);
    await Promise.resolve();

    expect(settled).toBe(false);
    child.emit('close', 0);
    await termination;
    expect(settled).toBe(true);
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('reports asynchronous spawn failure exactly once without an unhandled error', async () => {
    const child = createChild();
    child.pid = undefined;
    vi.mocked(spawn).mockReturnValue(child);
    const tp = createTeammate();
    const onMessage = vi.fn();
    const onExit = vi.fn();
    tp.spawn(onMessage, onExit);

    expect(() => child.emit('error', new Error('spawn ENOENT'))).not.toThrow();
    expect(tp.isRunning).toBe(false);
    expect(tp.toMember()).toMatchObject({ status: 'shutdown', exitCode: null, error: 'spawn ENOENT' });
    expect(onExit).toHaveBeenCalledExactlyOnceWith(null);
    child.emit('close', -2);
    child.emit('exit', -2);
    expect(onExit).toHaveBeenCalledTimes(1);
    await tp.terminate();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('cleans terminal state when spawn throws and leaves callback cleanup to the caller', () => {
    const failure = new Error('invalid spawn arguments');
    vi.mocked(spawn).mockImplementation(() => { throw failure; });
    const tp = createTeammate();
    const onExit = vi.fn();

    expect(() => tp.spawn(vi.fn(), onExit)).toThrow(failure);
    expect(tp.toMember()).toMatchObject({ status: 'shutdown', pid: 0, error: failure.message });
    expect(tp.isRunning).toBe(false);
    expect(onExit).not.toHaveBeenCalled();
  });

  it.each(['exit', 'close'])('reports a child %s only once and cannot revive a terminal member', (event) => {
    const child = createChild();
    vi.mocked(spawn).mockReturnValue(child);
    const tp = createTeammate();
    const onExit = vi.fn();
    tp.spawn(vi.fn(), onExit);

    child.emit(event, 1);
    tp.setStatus('idle');
    child.emit('exit', 1);
    child.emit('close', 1);

    expect(onExit).toHaveBeenCalledExactlyOnceWith(1);
    expect(tp.isRunning).toBe(false);
    expect(tp.toMember()).toMatchObject({ status: 'shutdown', exitCode: 1 });
  });

  it('retains only the bounded stderr tail and flushes it once on close', () => {
    const child = createChild();
    vi.mocked(spawn).mockReturnValue(child);
    const tp = createTeammate();
    const onMessage = vi.fn();
    tp.spawn(onMessage, vi.fn());

    child.stderr?.emit('data', Buffer.from('discarded-prefix' + 'x'.repeat(32 * 1024)));
    child.stderr?.emit('data', Buffer.from('last diagnostic'));
    child.emit('close', 1);
    child.stderr?.emit('end');

    expect(onMessage).toHaveBeenCalledTimes(1);
    const message = onMessage.mock.calls[0][0];
    expect(message.method).toBe('team.log');
    expect(message.params.text).toContain('truncated');
    expect(message.params.text).not.toContain('discarded-prefix');
    expect(message.params.text).toContain('last diagnostic');
    expect(Buffer.byteLength(message.params.text)).toBeLessThan(17 * 1024);
  });

  it.each(['stdin', 'stdout', 'stderr'] as const)('handles %s errors without releasing a running child early', async (stream) => {
    vi.useFakeTimers();
    const child = createChild();
    vi.mocked(spawn).mockReturnValue(child);
    const tp = createTeammate();
    const onExit = vi.fn();
    tp.spawn(vi.fn(), onExit);

    expect(() => child[stream]?.emit('error', new Error('EPIPE'))).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(tp.isRunning).toBe(true);
    expect(onExit).not.toHaveBeenCalled();
    child.emit('exit', null, 'SIGTERM');
    child.emit('close', null);
    await vi.runAllTimersAsync();

    expect(onExit).toHaveBeenCalledExactlyOnceWith(null);
    expect(tp.toMember().error).toContain('EPIPE');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not release a child when a kill attempt emits an error', async () => {
    vi.useFakeTimers();
    const child = createChild();
    vi.mocked(spawn).mockReturnValue(child);
    const tp = createTeammate();
    const onExit = vi.fn();
    tp.spawn(vi.fn(), onExit);

    expect(() => child.emit('error', new Error('kill EPERM'))).not.toThrow();
    await vi.runAllTimersAsync();

    expect(tp.isRunning).toBe(true);
    expect(onExit).not.toHaveBeenCalled();
    child.emit('close', null);
    expect(onExit).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('handles synchronous pipe write failures and rejects subsequent writes', async () => {
    vi.useFakeTimers();
    const child = createChild();
    vi.mocked(spawn).mockReturnValue(child);
    const tp = createTeammate();
    tp.spawn(vi.fn(), vi.fn());
    const write = vi.spyOn(child.stdin!, 'write').mockImplementation(() => { throw new Error('write EPIPE'); });

    expect(() => tp.sendMessage('lead', 'hello')).not.toThrow();
    tp.sendMessage('lead', 'again');
    expect(write).toHaveBeenCalledTimes(1);
    child.emit('close', 1);
    await vi.runAllTimersAsync();
  });

  it('coalesces concurrent termination and cancels escalation after child close', async () => {
    vi.useFakeTimers();
    const child = createChild();
    vi.mocked(spawn).mockReturnValue(child);
    const tp = createTeammate();
    tp.spawn(vi.fn(), vi.fn());
    const options = { gracefulTimeoutMs: 10, termTimeoutMs: 10, killTimeoutMs: 10 };

    const first = tp.terminate(options);
    const second = tp.terminate(options);
    await vi.advanceTimersByTimeAsync(10);
    expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM');
    child.emit('close', null);
    await Promise.all([first, second]);
    await vi.runAllTimersAsync();

    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sends task cancellation and context updates using teammate protocol messages', () => {
    const tp = createTeammate();
    const send = vi.spyOn(tp, 'send');
    const tasks: TeamTask[] = [{ id: 'task-1', subject: 'review', description: '', status: 'pending', blockedBy: [], createdAt: '2026-09-05' }];

    tp.cancelTask('task-1', 'superseded');
    tp.updateContext(tasks);
    tp.sendContextUpdate(tasks);

    expect(send).toHaveBeenNthCalledWith(1, { method: 'team.cancelTask', params: { taskId: 'task-1', reason: 'superseded' } });
    expect(send).toHaveBeenNthCalledWith(2, { method: 'team.updateContext', params: { tasks } });
    expect(send).toHaveBeenNthCalledWith(3, { method: 'team.updateContext', params: { tasks } });
  });

  it('handles ENOENT from an actual child process without crashing the parent', async () => {
    const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
    vi.mocked(spawn).mockImplementation(() => actual.spawn('/nonexistent-autohand-teammate-binary', [], { stdio: 'pipe' }));
    const tp = createTeammate();
    const onExit = vi.fn();

    await new Promise<void>((resolve) => tp.spawn(vi.fn(), (code) => {
      onExit(code);
      resolve();
    }));
    await tp.terminate();

    expect(onExit).toHaveBeenCalledExactlyOnceWith(null);
    expect(tp.toMember().error).toContain('ENOENT');
    expect(tp.isRunning).toBe(false);
  });

  it('does not replace a living child with a second spawn', () => {
    const child = createChild();
    vi.mocked(spawn).mockReturnValue(child);
    const tp = createTeammate();
    tp.spawn(vi.fn(), vi.fn());

    expect(() => tp.spawn(vi.fn(), vi.fn())).toThrow('already been spawned');
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(tp.pid).toBe(child.pid);
  });

  it('does not reuse a failed process object while its old events can still arrive', () => {
    const child = createChild();
    child.pid = undefined;
    vi.mocked(spawn).mockReturnValue(child);
    const tp = createTeammate();
    tp.spawn(vi.fn(), vi.fn());
    child.emit('error', new Error('spawn ENOENT'));

    expect(() => tp.spawn(vi.fn(), vi.fn())).toThrow('already been spawned');
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('completes spawn failure notification when the diagnostic receiver throws', () => {
    const child = createChild();
    child.pid = undefined;
    vi.mocked(spawn).mockReturnValue(child);
    const tp = createTeammate();
    const onExit = vi.fn();
    tp.spawn(() => { throw new Error('receiver unavailable'); }, onExit);

    expect(() => child.emit('error', new Error('spawn ENOENT'))).not.toThrow();
    expect(onExit).toHaveBeenCalledExactlyOnceWith(null);
    expect(tp.isRunning).toBe(false);
  });

  it('drains buffered protocol messages between process exit and stdio close', () => {
    const child = createChild();
    vi.mocked(spawn).mockReturnValue(child);
    const tp = createTeammate();
    const onMessage = vi.fn();
    tp.spawn(onMessage, vi.fn());
    child.emit('exit', 0);

    child.stdout?.emit('data', Buffer.from('{"method":"team.taskUpdate","params":{"taskId":"task-1","status":"completed"}}\n'));
    child.emit('close', 0);

    expect(onMessage).toHaveBeenCalledExactlyOnceWith({ method: 'team.taskUpdate', params: { taskId: 'task-1', status: 'completed' } });
    expect(tp.status).toBe('shutdown');
  });

  it('settles pending termination immediately when the child fails to spawn', async () => {
    vi.useFakeTimers();
    const child = createChild();
    child.pid = undefined;
    vi.mocked(spawn).mockReturnValue(child);
    const tp = createTeammate();
    tp.spawn(vi.fn(), vi.fn());
    let settled = false;
    const termination = tp.terminate().then(() => { settled = true; });

    child.emit('error', new Error('spawn ENOENT'));
    await vi.advanceTimersByTimeAsync(0);

    expect(settled).toBe(true);
    await termination;
    expect(vi.getTimerCount()).toBe(0);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('continues termination after a synchronous kill failure without claiming exit', async () => {
    vi.useFakeTimers();
    const child = createChild();
    vi.mocked(child.kill).mockImplementation(() => { throw new Error('kill EPERM'); });
    vi.mocked(spawn).mockReturnValue(child);
    const tp = createTeammate();
    const onExit = vi.fn();
    tp.spawn(vi.fn(), onExit);

    const termination = tp.terminate({ gracefulTimeoutMs: 1, termTimeoutMs: 1, killTimeoutMs: 1 });
    await vi.advanceTimersByTimeAsync(3);
    await termination;

    expect(child.kill).toHaveBeenCalledTimes(2);
    expect(tp.isRunning).toBe(true);
    expect(onExit).not.toHaveBeenCalled();
    expect(tp.toMember().error).toBe('kill EPERM');
    child.emit('close', null);
  });
});
