/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Wire format for the team task tools. The result string has two consumers —
 * the LLM, which needs ids and statuses to drive the next turn, and the TUI,
 * which needs enough structure to paint a panel. It therefore stays JSON and
 * the TUI gains a parser, mirroring the `todo_write` precedent.
 */

import type { TeamTask } from './types.js';

/**
 * Per-task description budget for multi-task results. A listing exists to show
 * status; full descriptions belong to `task_get`.
 */
export const TASK_LIST_DESCRIPTION_BUDGET = 200;

export interface TeamTaskPayloadTask {
  id: string;
  subject: string;
  description: string;
  status: string;
  owner?: string;
  blockedBy: string[];
  createdAt?: string;
  completedAt?: string;
  output?: string;
  /** Set when `description` was cut to the budget; full text is on `task_get`. */
  descriptionTruncated?: boolean;
}

export interface TeamTaskPayload {
  kind: 'team_tasks';
  headline?: string;
  tasks: TeamTaskPayloadTask[];
  filter?: { status?: string; owner?: string };
  descriptionsTruncated?: boolean;
}

export interface BuildTeamTaskPayloadInput {
  tasks: TeamTask[];
  headline?: string;
  filter?: { status?: string; owner?: string };
  /** Enabled for multi-task listings, never for single-task detail results. */
  truncateDescriptions?: boolean;
}

/**
 * `task_get` is the only full-detail view. Every other task tool either lists
 * many tasks or echoes back a description the model supplied moments earlier,
 * so re-emitting it in full costs context and buys nothing.
 */
export function taskToolTruncatesDescriptions(tool: string): boolean {
  return tool !== 'task_get';
}

function truncateDescription(task: TeamTask): TeamTaskPayloadTask {
  const description = typeof task.description === 'string' ? task.description : '';
  if (description.length <= TASK_LIST_DESCRIPTION_BUDGET) {
    return { ...task };
  }
  return {
    ...task,
    description: `${description.slice(0, TASK_LIST_DESCRIPTION_BUDGET)}…`,
    descriptionTruncated: true,
  };
}

export function buildTeamTaskPayload(input: BuildTeamTaskPayloadInput): string {
  const tasks: TeamTaskPayloadTask[] = input.truncateDescriptions
    ? input.tasks.map(truncateDescription)
    : input.tasks.map((task) => ({ ...task }));

  const payload: TeamTaskPayload = { kind: 'team_tasks', tasks };

  if (input.headline) {
    payload.headline = input.headline;
  }

  const filter = input.filter;
  if (filter && (filter.status || filter.owner)) {
    payload.filter = filter;
  }

  if (tasks.some((task) => task.descriptionTruncated)) {
    payload.descriptionsTruncated = true;
  }

  return JSON.stringify(payload, null, 2);
}

function looksLikeTask(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && typeof record.subject === 'string';
}

function coerceTasks(value: unknown): TeamTaskPayloadTask[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  if (value.length === 0) {
    return [];
  }
  return value.every(looksLikeTask) ? (value as unknown as TeamTaskPayloadTask[]) : null;
}

/**
 * Tolerant on purpose: resumed sessions hold pre-envelope strings in scrollback
 * (a bare array, a bare object, or either behind a prose prefix), and those must
 * still render as a panel rather than falling back to raw JSON.
 */
export function parseTeamTaskPayload(output: string): TeamTaskPayload | null {
  if (!output) {
    return null;
  }

  const bodyStart = (() => {
    const brace = output.indexOf('{');
    const bracket = output.indexOf('[');
    if (brace === -1) return bracket;
    if (bracket === -1) return brace;
    return Math.min(brace, bracket);
  })();

  if (bodyStart === -1) {
    return null;
  }

  const prefix = output.slice(0, bodyStart).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(output.slice(bodyStart));
  } catch {
    return null;
  }

  const headline = prefix.length > 0 ? prefix : undefined;

  const fromArray = coerceTasks(parsed);
  if (fromArray) {
    return headline ? { kind: 'team_tasks', headline, tasks: fromArray } : { kind: 'team_tasks', tasks: fromArray };
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const record = parsed as Record<string, unknown>;

  if (record.kind === 'team_tasks') {
    const tasks = coerceTasks(record.tasks);
    if (!tasks) {
      return null;
    }
    return {
      kind: 'team_tasks',
      tasks,
      ...(typeof record.headline === 'string' ? { headline: record.headline } : headline ? { headline } : {}),
      ...(record.filter && typeof record.filter === 'object'
        ? { filter: record.filter as TeamTaskPayload['filter'] }
        : {}),
      ...(record.descriptionsTruncated === true ? { descriptionsTruncated: true } : {}),
    };
  }

  if (looksLikeTask(record)) {
    const task = record as unknown as TeamTaskPayloadTask;
    return headline ? { kind: 'team_tasks', headline, tasks: [task] } : { kind: 'team_tasks', tasks: [task] };
  }

  return null;
}
