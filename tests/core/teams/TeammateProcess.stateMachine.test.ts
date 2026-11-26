/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { ChildProcess, spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TEAMMATE_LIFECYCLE,
  TEAMMATE_TRANSPORT,
  TeammateProcess,
} from '../../../src/core/teams/TeammateProcess.js';
import { TeamManager } from '../../../src/core/teams/TeamManager.js';
import { reachableStates, StateMachine, terminalStates } from '../../../src/utils/stateMachine.js';
import { randomEventWalk } from '../../helpers/stateMachineProperties.js';

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

function spawnTeammate(child = createChild()): { tp: TeammateProcess; child: ChildProcess; onMessage: ReturnType<typeof vi.fn> } {
  vi.mocked(spawn).mockReturnValue(child);
  const tp = new TeammateProcess({ teamName: 'test', name: 'worker', agentName: 'researcher', leadSessionId: 'sess' });
  const onMessage = vi.fn();
  tp.spawn(onMessage, vi.fn());
  return { tp, child, onMessage };
}

function fromChild(child: ChildProcess, method: string, params: Record<string, unknown> = {}): void {
  child.stdout?.emit('data', Buffer.from(JSON.stringify({ method, params }) + '\n'));
}

describe('TEAMMATE_LIFECYCLE', () => {
  const events = ['spawn', 'idle', 'work', 'shutdownAck', 'transportFailed', 'exit'] as const;

  it('declares the allowed process lifecycle edges', () => {
    expect(TEAMMATE_LIFECYCLE.initial).toBe('created');
    expect(TEAMMATE_LIFECYCLE.transitions).toEqual({
      created: { spawn: 'spawning', idle: 'idle', work: 'working', shutdownAck: 'stopping' },
      spawning: { idle: 'idle', work: 'working', shutdownAck: 'stopping', transportFailed: 'stopping', exit: 'exited' },
      idle: { work: 'working', shutdownAck: 'stopping', transportFailed: 'stopping', exit: 'exited' },
      working: { idle: 'idle', shutdownAck: 'stopping', transportFailed: 'stopping', exit: 'exited' },
      stopping: { exit: 'exited' },
      exited: {},
    });
  });

  it('has a single terminal state and every state is reachable', () => {
    expect(terminalStates(TEAMMATE_LIFECYCLE)).toEqual(['exited']);
    expect(reachableStates(TEAMMATE_LIFECYCLE)).toEqual(new Set(Object.keys(TEAMMATE_LIFECYCLE.transitions)));
  });

  it.each([
    ['stopping', 'idle'],
    ['stopping', 'work'],
    ['exited', 'idle'],
    ['exited', 'spawn'],
    ['idle', 'spawn'],
    ['created', 'exit'],
    ['stopping', 'spawn'],
    ['working', 'work'],
  ] as const)('rejects %s --%s', (from, event) => {
    const machine = new StateMachine(TEAMMATE_LIFECYCLE, { initial: from });
    expect(machine.can(event)).toBe(false);
    expect(machine.trySend(event)).toBe(false);
    expect(machine.state).toBe(from);
  });

  it('accepts exactly its table for random event sequences', () => {
    randomEventWalk(TEAMMATE_LIFECYCLE, events, { seeds: 50, steps: 40 });
  });
});

describe('TEAMMATE_TRANSPORT', () => {
  it('declares the transport edges with closed as the only terminal state', () => {
    expect(TEAMMATE_TRANSPORT.transitions).toEqual({
      open: { fail: 'failed', close: 'closed' },
      failed: { close: 'closed' },
      closed: {},
    });
    expect(terminalStates(TEAMMATE_TRANSPORT)).toEqual(['closed']);
    expect(reachableStates(TEAMMATE_TRANSPORT).size).toBe(3);
  });

  it('accepts exactly its table for random event sequences', () => {
    randomEventWalk(TEAMMATE_TRANSPORT, ['fail', 'close'] as const, { seeds: 30, steps: 20 });
  });
});

describe('TeammateProcess lifecycle guards', () => {
  beforeEach(() => {
    vi.mocked(spawn).mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports spawning before and after launch, then follows lead status updates', () => {
    const tp = new TeammateProcess({ teamName: 'test', name: 'worker', agentName: 'researcher', leadSessionId: 'sess' });
    expect(tp.status).toBe('spawning');
    const child = createChild();
    vi.mocked(spawn).mockReturnValue(child);
    tp.spawn(vi.fn(), vi.fn());
    expect(tp.status).toBe('spawning');
    tp.setStatus('idle');
    expect(tp.status).toBe('idle');
    tp.setStatus('working');
    expect(tp.status).toBe('working');
    tp.setStatus('idle');
    expect(tp.status).toBe('idle');
    child.emit('exit', 0); child.emit('close', 0);
  });

  it('does not revive a teammate that acknowledged shutdown when a late idle arrives', () => {
    const { tp, child } = spawnTeammate();
    tp.setStatus('idle');
    tp.setStatus('shutdown');
    tp.setStatus('idle');
    tp.setStatus('working');

    expect(tp.status).toBe('shutdown');
    child.emit('exit', 0); child.emit('close', 0);
    expect(tp.toMember()).toMatchObject({ status: 'shutdown', exitCode: 0 });
  });

  it('marks a teammate whose transport failed as shutting down so it cannot be handed work', async () => {
    vi.useFakeTimers();
    const { tp, child } = spawnTeammate();
    tp.setStatus('idle');

    child.stdin?.emit('error', new Error('EPIPE'));
    tp.setStatus('idle');

    expect(tp.status).toBe('shutdown');
    expect(tp.isRunning).toBe(true);
    child.emit('exit', null, 'SIGTERM'); child.emit('close', null);
    await vi.runAllTimersAsync();
  });

  it('does not assign queued work to an idle teammate after its transport failed', async () => {
    vi.useFakeTimers();
    const child = createChild();
    vi.mocked(spawn).mockReturnValue(child);
    const manager = new TeamManager({ leadSessionId: 'lead', workspacePath: '/repo' });
    manager.createTeam('transport');
    const tp = manager.addTeammate({ name: 'worker', agentName: 'researcher' });
    fromChild(child, 'team.ready');
    expect(tp.status).toBe('idle');

    child.stdin?.emit('error', new Error('EPIPE'));
    const task = manager.tasks.createTask({ subject: 'Review', description: 'Inspect code' });
    manager.tryAssignIdleTeammate();

    expect(manager.tasks.getTask(task.id)).toMatchObject({ status: 'pending' });
    expect(manager.tasks.getTask(task.id)?.owner).toBeUndefined();
    child.emit('exit', null, 'SIGTERM'); child.emit('close', null);
    await vi.runAllTimersAsync();
  });

  it('refuses to respawn after a synchronous spawn failure', () => {
    const failure = new Error('invalid spawn arguments');
    vi.mocked(spawn).mockImplementationOnce(() => { throw failure; });
    const tp = new TeammateProcess({ teamName: 'test', name: 'worker', agentName: 'researcher', leadSessionId: 'sess' });
    expect(() => tp.spawn(vi.fn(), vi.fn())).toThrow(failure);

    vi.mocked(spawn).mockReturnValue(createChild());
    expect(() => tp.spawn(vi.fn(), vi.fn())).toThrow('already been spawned');
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(tp.toMember()).toMatchObject({ status: 'shutdown', pid: 0, error: failure.message });
  });

  it('drops child messages after a transport failure even between exit and close', async () => {
    vi.useFakeTimers();
    const { child, onMessage } = spawnTeammate();
    child.stdin?.emit('error', new Error('EPIPE'));
    onMessage.mockClear();
    child.emit('exit', 1);
    fromChild(child, 'team.taskUpdate', { taskId: 't', status: 'completed' });
    child.emit('close', 1);
    await vi.runAllTimersAsync();

    expect(onMessage).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'team.taskUpdate' }));
  });
});
