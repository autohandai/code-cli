import { describe, it, expect } from 'vitest';
import type { HookEvent } from '../../src/types.js';
import type { HookContext } from '../../src/core/HookManager.js';

describe('Team hook events', () => {
  it('should accept team-created as a valid HookEvent', () => {
    const event: HookEvent = 'team-created';
    expect(event).toBe('team-created');
  });

  it('should accept teammate-spawned as a valid HookEvent', () => {
    const event: HookEvent = 'teammate-spawned';
    expect(event).toBe('teammate-spawned');
  });

  it('should accept teammate-idle as a valid HookEvent', () => {
    const event: HookEvent = 'teammate-idle';
    expect(event).toBe('teammate-idle');
  });

  it('should accept task-assigned as a valid HookEvent', () => {
    const event: HookEvent = 'task-assigned';
    expect(event).toBe('task-assigned');
  });

  it('should accept task-completed as a valid HookEvent', () => {
    const event: HookEvent = 'task-completed';
    expect(event).toBe('task-completed');
  });

  it('should accept team-shutdown as a valid HookEvent', () => {
    const event: HookEvent = 'team-shutdown';
    expect(event).toBe('team-shutdown');
  });

  it('should accept team context fields in HookContext', () => {
    const ctx: HookContext = {
      event: 'team-created',
      workspace: '/tmp/test',
      teamName: 'code-cleanup',
      teamMemberCount: 3,
    };
    expect(ctx.teamName).toBe('code-cleanup');
    expect(ctx.teamMemberCount).toBe(3);
  });

  it('should accept teammate context fields in HookContext', () => {
    const ctx: HookContext = {
      event: 'teammate-spawned',
      workspace: '/tmp/test',
      teamName: 'cleanup',
      teammateName: 'hunter',
      teammateAgentName: 'code-cleaner',
      teammatePid: 12345,
    };
    expect(ctx.teammateName).toBe('hunter');
    expect(ctx.teammatePid).toBe(12345);
  });

  it('should accept task context fields in HookContext', () => {
    const ctx: HookContext = {
      event: 'task-completed',
      workspace: '/tmp/test',
      teamName: 'cleanup',
      teamTaskId: 'task-001',
      teamTaskOwner: 'hunter',
      teamTaskResult: 'Removed 5 dead exports',
    };
    expect(ctx.teamTaskId).toBe('task-001');
    expect(ctx.teamTaskResult).toBe('Removed 5 dead exports');
  });
});
