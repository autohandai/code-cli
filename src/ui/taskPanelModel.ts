/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Layout model shared by every task surface: the Ink team-task panel, the Ink
 * todo panel, and the chalk `/tasks` output. Pure by design — no React, no
 * chalk, no theme — so the grouping and overflow rules are tested once and
 * painted three ways.
 */

export type TaskPanelStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface TaskPanelRow {
  id?: string;
  title: string;
  status: TaskPanelStatus;
  owner?: string;
  blockedBy: string[];
}

export interface TaskPanelGroup {
  status: TaskPanelStatus;
  label: string;
  rows: TaskPanelRow[];
}

export interface TaskPanelModel {
  total: number;
  done: number;
  failed: number;
  percent: number;
  bar: string;
  groups: TaskPanelGroup[];
  hiddenCount: number;
  /** Rendered overflow note, e.g. "+3 completed". Null when nothing is hidden. */
  hiddenLabel: string | null;
}

export interface TaskPanelOptions {
  /** Rows rendered before overflow collapses into `hiddenLabel`. */
  maxRows?: number;
  barWidth?: number;
}

const DEFAULT_MAX_ROWS = 12;
const DEFAULT_BAR_WIDTH = 20;

/**
 * Active work sorts first because that is what an operator scans for; completed
 * work sorts last and is therefore the first thing dropped on overflow.
 */
const GROUP_ORDER: readonly TaskPanelStatus[] = ['in_progress', 'pending', 'failed', 'completed'];

const GROUP_LABEL: Record<TaskPanelStatus, string> = {
  in_progress: 'in progress',
  pending: 'pending',
  failed: 'failed',
  completed: 'completed',
};

const STATUS_GLYPH: Record<TaskPanelStatus, string> = {
  completed: '■',
  in_progress: '▣',
  pending: '□',
  failed: '✕',
};

export function taskStatusGlyph(status: TaskPanelStatus): string {
  return STATUS_GLYPH[status];
}

export function taskGroupLabel(status: TaskPanelStatus): string {
  return GROUP_LABEL[status];
}

function isTaskPanelStatus(value: unknown): value is TaskPanelStatus {
  return value === 'pending' || value === 'in_progress' || value === 'completed' || value === 'failed';
}

function readString(source: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

/**
 * Normalizes the several task shapes this codebase carries — team tasks
 * (`subject`/`blockedBy`), todo_write tasks (`title`/`content`), and raw tool
 * JSON (`blocked_by`) — into one row. Returns null for entries that are not
 * objects at all.
 */
export function normalizeTaskPanelRow(input: unknown): TaskPanelRow | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }

  const source = input as Record<string, unknown>;
  const rawBlockedBy = source.blockedBy ?? source.blocked_by;
  const blockedBy = Array.isArray(rawBlockedBy)
    ? rawBlockedBy.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];

  return {
    id: readString(source, 'id'),
    title: readString(source, 'subject', 'title', 'content') ?? 'Untitled task',
    status: isTaskPanelStatus(source.status) ? source.status : 'pending',
    owner: readString(source, 'owner'),
    blockedBy,
  };
}

export function normalizeTaskPanelRows(input: unknown): TaskPanelRow[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((entry) => normalizeTaskPanelRow(entry))
    .filter((row): row is TaskPanelRow => row !== null);
}

function renderProgressBar(percent: number, barWidth: number): string {
  const filled = Math.round((barWidth * percent) / 100);
  return '█'.repeat(filled) + '░'.repeat(barWidth - filled);
}

function describeHidden(hidden: TaskPanelRow[]): string | null {
  if (hidden.length === 0) {
    return null;
  }
  const statuses = new Set(hidden.map((row) => row.status));
  const suffix = statuses.size === 1 ? GROUP_LABEL[hidden[0]!.status] : 'more';
  return `+${hidden.length} ${suffix}`;
}

export function buildTaskPanelModel(rows: TaskPanelRow[], options: TaskPanelOptions = {}): TaskPanelModel {
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  const barWidth = options.barWidth ?? DEFAULT_BAR_WIDTH;

  const total = rows.length;
  const done = rows.filter((row) => row.status === 'completed').length;
  const failed = rows.filter((row) => row.status === 'failed').length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);

  // Flatten in group order so slicing from the front naturally drops completed
  // work first — the least operationally useful rows.
  const ordered = GROUP_ORDER.flatMap((status) => rows.filter((row) => row.status === status));
  const visible = ordered.slice(0, Math.max(0, maxRows));
  const hidden = ordered.slice(visible.length);

  const groups = GROUP_ORDER.map((status) => ({
    status,
    label: GROUP_LABEL[status],
    rows: visible.filter((row) => row.status === status),
  })).filter((group) => group.rows.length > 0);

  return {
    total,
    done,
    failed,
    percent,
    bar: renderProgressBar(percent, barWidth),
    groups,
    hiddenCount: hidden.length,
    hiddenLabel: describeHidden(hidden),
  };
}
