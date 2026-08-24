/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { formatToolCallLogDetail } from '../../../src/core/agent/ReactLoopRunner.js';
import type { ToolCallRequest } from '../../../src/types.js';

function call(tool: string, args: Record<string, unknown>): ToolCallRequest {
  return { tool, args } as unknown as ToolCallRequest;
}

describe('formatToolCallLogDetail — humanized tool arguments', () => {
  it('renders sleep as a duration and reason instead of JSON', () => {
    const detail = formatToolCallLogDetail(
      call('sleep', { reason: 'Specialists still working; waiting for reviews', seconds: 180 }),
    );
    expect(detail).toBe('180s · Specialists still working; waiting for reviews');
    expect(detail).not.toContain('{');
  });

  it('renders sleep without a reason as a bare duration', () => {
    expect(formatToolCallLogDetail(call('sleep', { seconds: 30 }))).toBe('30s');
  });

  it('renders task_list filters', () => {
    expect(formatToolCallLogDetail(call('task_list', { status: 'in_progress' }))).toBe('in_progress');
    expect(formatToolCallLogDetail(call('task_list', { owner: 'auth-security' }))).toBe('auth-security');
    expect(formatToolCallLogDetail(call('task_list', { status: 'pending', owner: 'auth-security' }))).toBe(
      'pending · auth-security',
    );
  });

  it('renders an unfiltered task_list as empty', () => {
    expect(formatToolCallLogDetail(call('task_list', {}))).toBe('');
  });

  it('renders create_task by subject, not by its long description', () => {
    const detail = formatToolCallLogDetail(
      call('create_task', { subject: 'Security review of auth changes', description: 'x'.repeat(900) }),
    );
    expect(detail).toBe('Security review of auth changes');
  });

  it('renders single-task tools by task id', () => {
    expect(formatToolCallLogDetail(call('task_get', { task_id: 'task-3' }))).toBe('task-3');
    expect(formatToolCallLogDetail(call('task_stop', { task_id: 'task-3' }))).toBe('task-3');
    expect(formatToolCallLogDetail(call('task_output', { task_id: 'task-3', output: 'done' }))).toBe('task-3');
  });

  it('renders task_update with its status transition', () => {
    expect(formatToolCallLogDetail(call('task_update', { task_id: 'task-3', status: 'completed' }))).toBe(
      'task-3 → completed',
    );
    expect(formatToolCallLogDetail(call('task_update', { task_id: 'task-3' }))).toBe('task-3');
  });

  it('renders todo_write as a task count', () => {
    expect(
      formatToolCallLogDetail(
        call('todo_write', {
          tasks: [
            { content: 'a', status: 'pending', activeForm: 'a' },
            { content: 'b', status: 'pending', activeForm: 'b' },
          ],
        }),
      ),
    ).toBe('2 tasks');
    expect(formatToolCallLogDetail(call('todo_write', { tasks: [{ content: 'a' }] }))).toBe('1 task');
  });

  it('renders add_teammate by name', () => {
    expect(formatToolCallLogDetail(call('add_teammate', { name: 'auth-security', agent_name: 'code-reviewer' }))).toBe(
      'auth-security',
    );
  });
});

describe('formatToolCallLogDetail — generic fallback', () => {
  it('keeps prioritizing path over other arguments', () => {
    expect(formatToolCallLogDetail(call('read_file', { path: 'src/index.ts' }))).toBe('src/index.ts');
  });

  it('summarizes unknown tools as scalar key=value pairs', () => {
    expect(formatToolCallLogDetail(call('mystery_tool', { level: 'user', count: 3, enabled: true }))).toBe(
      'level=user, count=3, enabled=true',
    );
  });

  it('never leaks nested objects or arrays into the status line', () => {
    const detail = formatToolCallLogDetail(
      call('mystery_tool', { nested: { deep: 'value' }, list: [1, 2, 3], kept: 'yes' }),
    );
    expect(detail).toBe('kept=yes');
    expect(detail).not.toContain('{');
    expect(detail).not.toContain('[');
  });

  it('returns empty when a tool has only non-scalar arguments', () => {
    expect(formatToolCallLogDetail(call('mystery_tool', { nested: { deep: 'value' } }))).toBe('');
  });

  it('returns empty when a tool has no arguments', () => {
    expect(formatToolCallLogDetail(call('mystery_tool', {}))).toBe('');
  });

  it('truncates very long details', () => {
    const detail = formatToolCallLogDetail(call('read_file', { path: `src/${'x'.repeat(400)}.ts` }));
    expect(detail).toHaveLength(160);
    expect(detail.endsWith('...')).toBe(true);
  });
});
