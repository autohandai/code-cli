/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { FileActionManager } from '../../src/actions/filesystem.js';
import { killProcessGroup, runCommand } from '../../src/actions/command.js';
import { ActionExecutor } from '../../src/core/actionExecutor.js';
import { runTeammateModeWithStreams, type TeammateTaskRuntime } from '../../src/modes/teammate.js';

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('teammate background process ownership', () => {
  it.each(['shutdown', 'disconnect', 'interrupt'] as const)('stops its own background command on %s while preserving unrelated processes', async (reason) => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const controller = new AbortController();
    let output = '';
    stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    const unrelated = await runCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], process.cwd(), { background: true });
    const unrelatedPid = unrelated.backgroundPid;
    if (!unrelatedPid) throw new Error('Expected unrelated fixture process to start');
    let ownedPid: number | undefined;
    const running = runTeammateModeWithStreams({
      teamName: 'background-cleanup', name: 'worker', agentName: 'tester', leadSessionId: 'lead',
    }, stdin, stdout, {
      signal: controller.signal,
      execute: async (_opts, _task, runtime) => {
        const executor = new ActionExecutor({
          runtime: { workspaceRoot: process.cwd(), config: { configPath: '' }, options: {} },
          files: new FileActionManager(process.cwd()),
          resolveWorkspacePath: (relative) => relative,
          confirmDangerousAction: async () => true,
          backgroundProcessRegistry: runtime?.backgroundProcessRegistry,
        });
        const result = await executor.execute({
          type: 'run_command',
          command: JSON.stringify(process.execPath),
          args: ['-e', "'setInterval(() => {}, 1000)'"],
          background: true,
        });
        ownedPid = Number(/Background PID: (\d+)/.exec(result)?.[1]);
        return result;
      },
    });
    try {
      stdin.write(`${JSON.stringify({ method: 'team.assignTask', params: { task: {
        id: 'task-1', subject: 'Start a background server', description: '', status: 'pending', blockedBy: [], createdAt: '',
      } } })}\n`);
      await vi.waitFor(() => expect(output).toContain('"status":"completed"'));
      expect(ownedPid).toBeGreaterThan(0);
      expect(isAlive(ownedPid!)).toBe(true);
      if (reason === 'disconnect') stdin.end();
      else if (reason === 'interrupt') controller.abort();
      else stdin.write(`${JSON.stringify({ method: 'team.shutdown', params: {} })}\n`);
      await running;

      await vi.waitFor(() => expect(isAlive(ownedPid!)).toBe(false), { timeout: 2_000 });
      expect(isAlive(unrelatedPid)).toBe(true);
      expect(output).toContain('team.shutdownAck');
    } finally {
      stdin.end();
      await running;
      if (ownedPid) await killProcessGroup(ownedPid, 100);
      await killProcessGroup(unrelatedPid, 100);
      stdout.destroy();
    }
  }, 10_000);

  it.each(['cancelled', 'failed'] as const)('cleans a %s attempt before its next assignment and permits fresh background work', async (outcome) => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    let output = '';
    stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    const ownedPids: number[] = [];
    let ready = false;
    const running = runTeammateModeWithStreams({
      teamName: 'background-cancellation', name: 'worker', agentName: 'tester', leadSessionId: 'lead',
    }, stdin, stdout, {
      execute: async (_opts, task, runtime) => {
        const child = await runCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], process.cwd(), { background: true });
        if (!child.backgroundPid) throw new Error('Expected background child');
        ownedPids.push(child.backgroundPid);
        runtime?.backgroundProcessRegistry?.register(child.backgroundPid, 'attempt child');
        if (task.id === 'first') {
          ready = true;
          if (outcome === 'failed') throw new Error('Task failed after starting a command');
          return new Promise((_resolve, reject) => {
            runtime?.signal?.addEventListener('abort', () => reject(runtime.signal?.reason), { once: true });
          });
        }
        return 'Second task finished';
      },
    });
    const assign = (id: string) => stdin.write(`${JSON.stringify({ method: 'team.assignTask', params: { task: {
      id, subject: id, description: '', status: 'pending', blockedBy: [], createdAt: '',
    } } })}\n`);
    try {
      assign('first');
      await vi.waitFor(() => expect(ready).toBe(true));
      if (outcome === 'cancelled') stdin.write(`${JSON.stringify({ method: 'team.cancelTask', params: { taskId: 'first' } })}\n`);
      await vi.waitFor(() => expect(output).toContain(`"status":"${outcome}"`));
      expect(isAlive(ownedPids[0]!)).toBe(false);
      assign('second');
      await vi.waitFor(() => expect(output).toContain('Second task finished'));
      expect(isAlive(ownedPids[1]!)).toBe(true);
      stdin.end();
      await running;
      await vi.waitFor(() => expect(ownedPids.some(isAlive)).toBe(false));
    } finally {
      stdin.end();
      await running;
      await Promise.all(ownedPids.map((pid) => killProcessGroup(pid, 100)));
      stdout.destroy();
    }
  }, 10_000);

  it('stops a late background process while an abort-ignoring execution is still draining', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    let runtime: TeammateTaskRuntime | undefined;
    let finish: (result: string) => void = () => {};
    let ownedPid: number | undefined;
    const running = runTeammateModeWithStreams({
      teamName: 'late-background', name: 'worker', agentName: 'tester', leadSessionId: 'lead',
    }, stdin, stdout, {
      execute: async (_opts, _task, taskRuntime) => {
        runtime = taskRuntime;
        return new Promise<string>((resolve) => { finish = resolve; });
      },
    });
    try {
      stdin.write(`${JSON.stringify({ method: 'team.assignTask', params: { task: {
        id: 'late-task', subject: 'Late task', description: '', status: 'pending', blockedBy: [], createdAt: '',
      } } })}\n`);
      await vi.waitFor(() => expect(runtime?.backgroundProcessRegistry).toBeDefined());
      stdin.write(`${JSON.stringify({ method: 'team.shutdown', params: {} })}\n`);
      await vi.waitFor(() => expect(runtime?.signal?.aborted).toBe(true));

      const child = await runCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], process.cwd(), { background: true });
      ownedPid = child.backgroundPid;
      if (!ownedPid) throw new Error('Expected late background child');
      runtime?.backgroundProcessRegistry?.register(ownedPid, 'late child');

      await vi.waitFor(() => expect(isAlive(ownedPid!)).toBe(false));
    } finally {
      finish('Execution finally drained');
      stdin.end();
      await running;
      if (ownedPid) await killProcessGroup(ownedPid, 100);
      stdout.destroy();
    }
  }, 10_000);
});
