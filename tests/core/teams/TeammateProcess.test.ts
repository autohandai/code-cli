import { describe, it, expect } from 'vitest';
import { TeammateProcess } from '../../../src/core/teams/TeammateProcess.js';

// We test the class logic without actually spawning processes
describe('TeammateProcess', () => {
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
});
