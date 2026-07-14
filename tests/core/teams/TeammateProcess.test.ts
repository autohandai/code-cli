import { EventEmitter } from 'node:events';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { TeammateProcess } from '../../../src/core/teams/TeammateProcess.js';

// We test the class logic without actually spawning processes
describe('TeammateProcess', () => {
  afterEach(() => {
    vi.useRealTimers();
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
});
