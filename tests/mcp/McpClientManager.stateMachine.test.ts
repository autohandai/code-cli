/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MCP_CONNECT_ATTEMPT_LIFECYCLE,
  MCP_STDIO_CONNECTION_LIFECYCLE,
  McpStdioConnection,
} from '../../src/mcp/McpClientManager.js';
import { reachableStates, StateMachine, terminalStates } from '../../src/utils/stateMachine.js';
import { randomEventWalk } from '../helpers/stateMachineProperties.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: PassThrough; stdout: EventEmitter; stderr: EventEmitter; kill: () => boolean;
    };
    child.stdin = new PassThrough();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {
      child.stdin.destroy();
      child.emit('close', 0);
      return true;
    };
    queueMicrotask(() => child.emit('spawn'));
    return child;
  }),
}));

const config = { name: 'fixture', transport: 'stdio', command: 'fixture' } as const;

async function spawnMock() {
  const { spawn } = await import('node:child_process');
  return vi.mocked(spawn);
}

afterEach(async () => {
  (await spawnMock()).mockClear();
});

describe('MCP_STDIO_CONNECTION_LIFECYCLE transition table', () => {
  const events = ['start', 'spawned', 'exit', 'stop', 'stopped'] as const;

  it('declares the child process lifecycle edges', () => {
    expect(MCP_STDIO_CONNECTION_LIFECYCLE.initial).toBe('idle');
    expect(MCP_STDIO_CONNECTION_LIFECYCLE.transitions).toEqual({
      idle: { start: 'starting', stop: 'stopping' },
      starting: { spawned: 'running', exit: 'closed', stop: 'stopping' },
      running: { exit: 'closed', stop: 'stopping' },
      closed: { stop: 'stopping' },
      stopping: { stopped: 'stopped' },
      stopped: {},
    });
  });

  it('rejects a second start from every state after idle', () => {
    const machine = new StateMachine(MCP_STDIO_CONNECTION_LIFECYCLE);
    machine.send('start');
    expect(machine.can('start')).toBe(false);
    machine.send('spawned');
    expect(machine.can('start')).toBe(false);
    machine.send('exit');
    expect(machine.can('start')).toBe(false);
    machine.send('stop');
    expect(machine.can('start')).toBe(false);
    machine.send('stopped');
    expect(machine.can('start')).toBe(false);
  });

  it('has stopped as its only terminal state and reaches every state', () => {
    expect(terminalStates(MCP_STDIO_CONNECTION_LIFECYCLE)).toEqual(['stopped']);
    expect(reachableStates(MCP_STDIO_CONNECTION_LIFECYCLE))
      .toEqual(new Set(Object.keys(MCP_STDIO_CONNECTION_LIFECYCLE.transitions)));
  });

  it('accepts exactly the declared edges under random event walks', () => {
    randomEventWalk(MCP_STDIO_CONNECTION_LIFECYCLE, events, { seeds: 50, steps: 40 });
  });
});

describe('MCP_CONNECT_ATTEMPT_LIFECYCLE transition table', () => {
  const events = ['connected', 'fail', 'cancel'] as const;

  it('declares the connect attempt edges', () => {
    expect(MCP_CONNECT_ATTEMPT_LIFECYCLE.initial).toBe('connecting');
    expect(MCP_CONNECT_ATTEMPT_LIFECYCLE.transitions).toEqual({
      connecting: { connected: 'connected', fail: 'failed', cancel: 'cancelled' },
      connected: {},
      failed: {},
      cancelled: {},
    });
  });

  it('cannot cancel an attempt that already registered or failed', () => {
    for (const settle of ['connected', 'fail'] as const) {
      const machine = new StateMachine(MCP_CONNECT_ATTEMPT_LIFECYCLE);
      machine.send(settle);
      expect(machine.can('cancel')).toBe(false);
    }
  });

  it('settles in exactly one terminal state and reaches every state', () => {
    expect(terminalStates(MCP_CONNECT_ATTEMPT_LIFECYCLE).sort()).toEqual(['cancelled', 'connected', 'failed']);
    expect(reachableStates(MCP_CONNECT_ATTEMPT_LIFECYCLE))
      .toEqual(new Set(Object.keys(MCP_CONNECT_ATTEMPT_LIFECYCLE.transitions)));
  });

  it('accepts exactly the declared edges under random event walks', () => {
    randomEventWalk(MCP_CONNECT_ATTEMPT_LIFECYCLE, events, { seeds: 50, steps: 20 });
  });
});

describe('McpStdioConnection lifecycle behaviour', () => {
  it('spawns one child when start is called concurrently or again after spawning', async () => {
    const spawn = await spawnMock();
    const connection = new McpStdioConnection(config, 'newline');
    try {
      await Promise.all([connection.start(), connection.start()]);
      await connection.start();
      expect(spawn).toHaveBeenCalledOnce();
      expect(connection.lifecycleState).toBe('running');
    } finally {
      await connection.stop();
    }
    expect(connection.lifecycleState).toBe('stopped');
  });

  it('refuses to spawn after stop so no child outlives the connection', async () => {
    const spawn = await spawnMock();
    const connection = new McpStdioConnection(config, 'newline');
    await connection.stop();

    await expect(connection.start()).rejects.toThrow(/cannot start/i);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('refuses to respawn a connection whose child already exited', async () => {
    const spawn = await spawnMock();
    const connection = new McpStdioConnection(config, 'newline');
    await connection.start();
    spawn.mock.results.at(-1)?.value.emit('close', 1);
    expect(connection.lifecycleState).toBe('closed');

    await expect(connection.start()).rejects.toThrow(/cannot start/i);
    expect(spawn).toHaveBeenCalledOnce();
    await connection.stop();
  });

  it('stops a child that is still starting', async () => {
    const spawn = await spawnMock();
    const connection = new McpStdioConnection(config, 'newline');
    const startup = connection.start();
    const failure = expect(startup).rejects.toThrow('before spawning');
    expect(connection.lifecycleState).toBe('starting');

    await connection.stop();
    await failure;
    expect(spawn).toHaveBeenCalledOnce();
    expect(connection.lifecycleState).toBe('stopped');
  });
});
