/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  TASK_LIST_DESCRIPTION_BUDGET,
  buildTeamTaskPayload,
  parseTeamTaskPayload,
  taskToolTruncatesDescriptions,
} from '../../../src/core/teams/taskPayload.js';
import type { TeamTask } from '../../../src/core/teams/types.js';

function task(overrides: Partial<TeamTask> = {}): TeamTask {
  return {
    id: 'task-1',
    subject: 'Security review of idle-timeout and auth changes',
    description: 'Short description',
    status: 'in_progress',
    blockedBy: [],
    createdAt: '2026-08-24T09:19:10.132Z',
    owner: 'correctness-reviewer',
    ...overrides,
  };
}

describe('buildTeamTaskPayload', () => {
  it('emits a self-describing envelope', () => {
    const parsed = JSON.parse(buildTeamTaskPayload({ tasks: [task()] }));
    expect(parsed.kind).toBe('team_tasks');
    expect(parsed.tasks).toHaveLength(1);
    expect(parsed.tasks[0].id).toBe('task-1');
  });

  it('carries a headline for mutation results', () => {
    const parsed = JSON.parse(buildTeamTaskPayload({ tasks: [task()], headline: 'Task task-1 updated' }));
    expect(parsed.headline).toBe('Task task-1 updated');
  });

  it('carries the active filter for list results', () => {
    const parsed = JSON.parse(
      buildTeamTaskPayload({ tasks: [task()], filter: { status: 'in_progress', owner: 'auth-security' } }),
    );
    expect(parsed.filter).toEqual({ status: 'in_progress', owner: 'auth-security' });
  });

  it('omits an empty filter rather than emitting an empty object', () => {
    const parsed = JSON.parse(buildTeamTaskPayload({ tasks: [task()], filter: {} }));
    expect(parsed.filter).toBeUndefined();
  });

  it('leaves descriptions untouched by default', () => {
    const long = 'x'.repeat(900);
    const parsed = JSON.parse(buildTeamTaskPayload({ tasks: [task({ description: long })] }));
    expect(parsed.tasks[0].description).toBe(long);
    expect(parsed.tasks[0].descriptionTruncated).toBeUndefined();
    expect(parsed.descriptionsTruncated).toBeUndefined();
  });
});

describe('description budget', () => {
  it('truncates long descriptions when asked and flags the task', () => {
    const long = 'x'.repeat(900);
    const parsed = JSON.parse(
      buildTeamTaskPayload({ tasks: [task({ description: long })], truncateDescriptions: true }),
    );

    expect(parsed.tasks[0].description).toBe(`${'x'.repeat(TASK_LIST_DESCRIPTION_BUDGET)}…`);
    expect(parsed.tasks[0].descriptionTruncated).toBe(true);
    expect(parsed.descriptionsTruncated).toBe(true);
  });

  it('leaves a description exactly at the budget alone', () => {
    const exact = 'x'.repeat(TASK_LIST_DESCRIPTION_BUDGET);
    const parsed = JSON.parse(
      buildTeamTaskPayload({ tasks: [task({ description: exact })], truncateDescriptions: true }),
    );

    expect(parsed.tasks[0].description).toBe(exact);
    expect(parsed.tasks[0].descriptionTruncated).toBeUndefined();
    expect(parsed.descriptionsTruncated).toBeUndefined();
  });

  it('truncates a description one character over the budget', () => {
    const over = 'x'.repeat(TASK_LIST_DESCRIPTION_BUDGET + 1);
    const parsed = JSON.parse(
      buildTeamTaskPayload({ tasks: [task({ description: over })], truncateDescriptions: true }),
    );

    expect(parsed.tasks[0].descriptionTruncated).toBe(true);
  });

  it('does not flag the payload when every description fits', () => {
    const parsed = JSON.parse(
      buildTeamTaskPayload({ tasks: [task({ description: 'short' })], truncateDescriptions: true }),
    );
    expect(parsed.descriptionsTruncated).toBeUndefined();
  });
});

describe('parseTeamTaskPayload', () => {
  it('round-trips an envelope', () => {
    const payload = parseTeamTaskPayload(buildTeamTaskPayload({ tasks: [task()], headline: 'Task task-1 updated' }));
    expect(payload?.kind).toBe('team_tasks');
    expect(payload?.headline).toBe('Task task-1 updated');
    expect(payload?.tasks[0]?.subject).toBe('Security review of idle-timeout and auth changes');
  });

  it('tolerates a legacy bare array', () => {
    const payload = parseTeamTaskPayload(JSON.stringify([task(), task({ id: 'task-2' })], null, 2));
    expect(payload?.tasks).toHaveLength(2);
    expect(payload?.headline).toBeUndefined();
  });

  it('tolerates a legacy bare object', () => {
    const payload = parseTeamTaskPayload(JSON.stringify(task(), null, 2));
    expect(payload?.tasks).toHaveLength(1);
    expect(payload?.tasks[0]?.id).toBe('task-1');
  });

  it('tolerates a legacy prose prefix before the JSON body', () => {
    const payload = parseTeamTaskPayload(`Task task-1 updated.\n${JSON.stringify(task(), null, 2)}`);
    expect(payload?.tasks).toHaveLength(1);
    expect(payload?.headline).toBe('Task task-1 updated.');
  });

  it('parses an empty list', () => {
    const payload = parseTeamTaskPayload(buildTeamTaskPayload({ tasks: [] }));
    expect(payload?.tasks).toEqual([]);
  });

  it('returns null for output that is not a task payload', () => {
    expect(parseTeamTaskPayload('Task "task-9" not found.')).toBeNull();
    expect(parseTeamTaskPayload('')).toBeNull();
    expect(parseTeamTaskPayload('{ not json')).toBeNull();
    expect(parseTeamTaskPayload(JSON.stringify({ hello: 'world' }))).toBeNull();
    expect(parseTeamTaskPayload(JSON.stringify([1, 2, 3]))).toBeNull();
  });
});

describe('taskToolTruncatesDescriptions', () => {
  it('exempts only task_get, the full-detail view', () => {
    expect(taskToolTruncatesDescriptions('task_get')).toBe(false);
  });

  it('truncates for every other task tool', () => {
    for (const tool of ['task_list', 'create_task', 'task_update', 'task_stop', 'task_output']) {
      expect(taskToolTruncatesDescriptions(tool)).toBe(true);
    }
  });

  it('keeps create_task from echoing back the description the model just wrote', () => {
    const authored = 'y'.repeat(900);
    const parsed = JSON.parse(
      buildTeamTaskPayload({
        tasks: [task({ description: authored })],
        headline: 'Task task-1: "Security review" created (status: pending)',
        truncateDescriptions: taskToolTruncatesDescriptions('create_task'),
      }),
    );

    expect(parsed.tasks[0].description.length).toBeLessThan(authored.length);
    expect(parsed.tasks[0].descriptionTruncated).toBe(true);
  });
});
