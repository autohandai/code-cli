/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  buildTaskPanelModel,
  normalizeTaskPanelRow,
  taskStatusGlyph,
  type TaskPanelRow,
} from '../../src/ui/taskPanelModel.js';

function row(overrides: Partial<TaskPanelRow> & { title: string }): TaskPanelRow {
  return { status: 'pending', blockedBy: [], ...overrides };
}

describe('normalizeTaskPanelRow', () => {
  it('accepts the team task shape', () => {
    expect(
      normalizeTaskPanelRow({
        id: 'task-1',
        subject: 'Security review',
        status: 'in_progress',
        owner: 'correctness-reviewer',
        blockedBy: [],
      }),
    ).toEqual({
      id: 'task-1',
      title: 'Security review',
      status: 'in_progress',
      owner: 'correctness-reviewer',
      blockedBy: [],
    });
  });

  it('accepts the todo_write shape using title and content', () => {
    expect(normalizeTaskPanelRow({ title: 'Write tests', status: 'completed' })?.title).toBe('Write tests');
    expect(normalizeTaskPanelRow({ content: 'Ship it', status: 'pending' })?.title).toBe('Ship it');
  });

  it('accepts snake_case blocked_by', () => {
    expect(normalizeTaskPanelRow({ subject: 'A', status: 'pending', blocked_by: ['task-1'] })?.blockedBy).toEqual([
      'task-1',
    ]);
  });

  it('falls back to Untitled task when no usable title exists', () => {
    expect(normalizeTaskPanelRow({ status: 'pending' })?.title).toBe('Untitled task');
    expect(normalizeTaskPanelRow({ subject: '   ', status: 'pending' })?.title).toBe('Untitled task');
  });

  it('treats unknown or missing statuses as pending', () => {
    expect(normalizeTaskPanelRow({ subject: 'A', status: 'exploded' })?.status).toBe('pending');
    expect(normalizeTaskPanelRow({ subject: 'A' })?.status).toBe('pending');
  });

  it('treats a non-array blockedBy as empty', () => {
    expect(normalizeTaskPanelRow({ subject: 'A', blockedBy: 'task-1' })?.blockedBy).toEqual([]);
  });

  it('drops non-object entries', () => {
    expect(normalizeTaskPanelRow(null)).toBeNull();
    expect(normalizeTaskPanelRow('task-1')).toBeNull();
    expect(normalizeTaskPanelRow(42)).toBeNull();
  });
});

describe('buildTaskPanelModel', () => {
  it('summarizes totals and progress', () => {
    const model = buildTaskPanelModel([
      row({ title: 'A', status: 'completed' }),
      row({ title: 'B', status: 'completed' }),
      row({ title: 'C', status: 'in_progress' }),
      row({ title: 'D', status: 'pending' }),
    ]);

    expect(model.total).toBe(4);
    expect(model.done).toBe(2);
    expect(model.percent).toBe(50);
    expect(model.bar).toBe(`${'█'.repeat(10)}${'░'.repeat(10)}`);
  });

  it('orders groups active-first and elides empty groups', () => {
    const model = buildTaskPanelModel([
      row({ title: 'done', status: 'completed' }),
      row({ title: 'waiting', status: 'pending' }),
      row({ title: 'active', status: 'in_progress' }),
    ]);

    expect(model.groups.map((group) => group.status)).toEqual(['in_progress', 'pending', 'completed']);
    expect(model.groups.map((group) => group.label)).toEqual(['in progress', 'pending', 'completed']);
  });

  it('keeps insertion order within a group', () => {
    const model = buildTaskPanelModel([
      row({ title: 'second', status: 'pending' }),
      row({ title: 'first', status: 'pending' }),
    ]);

    expect(model.groups[0]!.rows.map((entry) => entry.title)).toEqual(['second', 'first']);
  });

  it('drops completed tasks first when collapsing overflow', () => {
    const rows = [
      ...Array.from({ length: 3 }, (_, i) => row({ title: `active-${i}`, status: 'in_progress' as const })),
      ...Array.from({ length: 4 }, (_, i) => row({ title: `done-${i}`, status: 'completed' as const })),
    ];

    const model = buildTaskPanelModel(rows, { maxRows: 4 });

    expect(model.hiddenCount).toBe(3);
    expect(model.groups.map((group) => group.status)).toEqual(['in_progress', 'completed']);
    expect(model.groups[0]!.rows).toHaveLength(3);
    expect(model.groups[1]!.rows).toHaveLength(1);
    expect(model.hiddenLabel).toBe('+3 completed');
  });

  it('labels mixed overflow generically', () => {
    const rows = [
      ...Array.from({ length: 3 }, (_, i) => row({ title: `p-${i}`, status: 'pending' as const })),
      ...Array.from({ length: 2 }, (_, i) => row({ title: `d-${i}`, status: 'completed' as const })),
    ];

    const model = buildTaskPanelModel(rows, { maxRows: 2 });

    expect(model.hiddenCount).toBe(3);
    expect(model.hiddenLabel).toBe('+3 more');
  });

  it('reports no overflow when everything fits', () => {
    const model = buildTaskPanelModel([row({ title: 'A' })], { maxRows: 12 });
    expect(model.hiddenCount).toBe(0);
    expect(model.hiddenLabel).toBeNull();
  });

  it('handles an empty task list without dividing by zero', () => {
    const model = buildTaskPanelModel([]);
    expect(model.total).toBe(0);
    expect(model.done).toBe(0);
    expect(model.percent).toBe(0);
    expect(model.groups).toEqual([]);
    expect(model.bar).toBe('░'.repeat(20));
  });

  it('preserves owner and blockedBy on rows', () => {
    const model = buildTaskPanelModel([
      row({ title: 'A', id: 'task-5', owner: 'auth-security', blockedBy: ['task-1', 'task-2'] }),
    ]);

    expect(model.groups[0]!.rows[0]).toMatchObject({
      id: 'task-5',
      owner: 'auth-security',
      blockedBy: ['task-1', 'task-2'],
    });
  });

  it('counts failed tasks separately from completed', () => {
    const model = buildTaskPanelModel([
      row({ title: 'A', status: 'failed' }),
      row({ title: 'B', status: 'completed' }),
    ]);

    expect(model.done).toBe(1);
    expect(model.failed).toBe(1);
    expect(model.groups.map((group) => group.status)).toEqual(['failed', 'completed']);
  });
});

describe('taskStatusGlyph', () => {
  it('maps every status to a distinct glyph', () => {
    expect(taskStatusGlyph('completed')).toBe('■');
    expect(taskStatusGlyph('in_progress')).toBe('▣');
    expect(taskStatusGlyph('pending')).toBe('□');
    expect(taskStatusGlyph('failed')).toBe('✕');
  });
});
