/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import stringWidth from 'string-width';
import stripAnsi from 'strip-ansi';
import type { ModalOption } from '../ui/ink/components/Modal.js';
import { sessionActivityAt } from './sessionActivity.js';
import type { SessionMetadata } from './types.js';

export const SHOW_EMPTY_VALUE = '__show_empty__';

/**
 * Columns the modal reserves around every row before a single character of
 * label reaches the terminal: 2 for the "▸ " / "  " cursor gutter, and 2 more
 * for the `<Box paddingX={1}>` the modal wraps its list in (Modal.tsx). A row
 * built to fill exactly `columns` renders 2 columns past the terminal edge
 * and wraps mid-cell (e.g. a "36w ago" age splitting across two lines).
 */
const MODAL_CHROME = 4;
const COLUMN_GAP = 2;
const MIN_TITLE_WIDTH = 16;

export interface SessionPickerEntry { session: SessionMetadata; title: string; }

export interface SessionPickerInput {
  entries: SessionPickerEntry[];
  now: Date;
  columns: number;
  singleProject: boolean;
  includeEmpty?: boolean;
  /**
   * Rows the caller will append after this call returns (e.g. resume.ts's
   * "Newer sessions" / "Older sessions" paging rows) that the modal still
   * numbers alongside every session row. The number column must be wide
   * enough for the total row count the modal renders, not just the rows this
   * function returns, or a page whose session count is one digit short of a
   * digit boundary (e.g. 9 sessions + 1 paging row = 10 numbered rows) will
   * disagree with the modal about how wide the number column is. Over-
   * reserving is safe - rows stay mutually aligned, one column narrower;
   * under-reserving wraps.
   */
  extraRows?: number;
}

export interface SessionPickerRows { options: ModalOption[]; hiddenEmptyCount: number; }

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function sessionGroupLabel(activeAt: Date, now: Date): 'Today' | 'Yesterday' | 'Previous 7 days' | 'Earlier' {
  const today = startOfLocalDay(now);
  const day = startOfLocalDay(activeAt);
  const dayMs = 24 * 60 * 60 * 1000;
  if (day >= today) return 'Today';
  if (day >= today - dayMs) return 'Yesterday';
  if (day >= today - 7 * dayMs) return 'Previous 7 days';
  return 'Earlier';
}

/** Compact age: 2m, 5h, 3d, 2w — the picker sorts by recency, so precision past weeks adds nothing. */
export function formatAge(activeAt: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - activeAt.getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

function flatten(title: string): string {
  return stripAnsi(title).replace(/\s+/gu, ' ').trim();
}

function truncate(value: string, width: number): string {
  if (width <= 0) return '';
  if (stringWidth(value) <= width) return value;
  let out = '';
  for (const char of value) {
    if (stringWidth(out) + stringWidth(char) + 1 > width) break;
    out += char;
  }
  return `${out}…`;
}

function pad(value: string, width: number): string {
  return value + ' '.repeat(Math.max(0, width - stringWidth(value)));
}

function padStart(value: string, width: number): string {
  return ' '.repeat(Math.max(0, width - stringWidth(value))) + value;
}

export function buildSessionPickerRows(input: SessionPickerInput): SessionPickerRows {
  const { entries, now, columns, singleProject, includeEmpty = false, extraRows = 0 } = input;

  const ordered = [...entries].sort(
    (a, b) => sessionActivityAt(b.session).getTime() - sessionActivityAt(a.session).getTime(),
  );
  const visible = includeEmpty ? ordered : ordered.filter((entry) => entry.session.messageCount > 0);
  const hiddenEmptyCount = ordered.length - visible.length;

  const counts = visible.map((entry) => `${entry.session.messageCount} msgs`);
  const ages = visible.map((entry) => formatAge(sessionActivityAt(entry.session), now));
  const projects = singleProject ? [] : visible.map((entry) => entry.session.projectName);

  const countWidth = Math.max(0, ...counts.map((s) => stringWidth(s)));
  const ageWidth = Math.max(0, ...ages.map((s) => stringWidth(s)));
  const projectWidth = projects.length ? Math.max(...projects.map((s) => stringWidth(s))) : 0;
  // The modal right-aligns every row's number to a shared width (padStart),
  // sized off the total row count it renders - including the reveal row this
  // function appends below and any paging rows the caller appends after it
  // returns. Reserve the same total here so every row's title lands at the
  // same column regardless of how many digits its own number has.
  const reservedRows = Math.max(1, visible.length + (hiddenEmptyCount > 0 ? 1 : 0) + Math.max(0, extraRows));
  const numberWidth = `${reservedRows}. `.length;

  const meta = countWidth + COLUMN_GAP + ageWidth + (projectWidth ? projectWidth + COLUMN_GAP : 0);
  const titleWidth = Math.max(MIN_TITLE_WIDTH, columns - MODAL_CHROME - numberWidth - meta - COLUMN_GAP);

  let lastHeader: string | undefined;
  const options: ModalOption[] = visible.map((entry, index) => {
    const header = sessionGroupLabel(sessionActivityAt(entry.session), now);
    const withHeader = header !== lastHeader;
    lastHeader = header;

    // Every row's title is padded to the same width - the modal reserves its
    // own room for the row number (padStart to a shared width), so this
    // function must not add any further per-row slack on top of that.
    const title = pad(truncate(flatten(entry.title), titleWidth), titleWidth);
    const cells = [title];
    if (projectWidth) cells.push(pad(entry.session.projectName, projectWidth));
    cells.push(padStart(counts[index] ?? '', countWidth), padStart(ages[index] ?? '', ageWidth));

    const label = cells.join(' '.repeat(COLUMN_GAP)).trimEnd();
    return {
      label,
      value: entry.session.sessionId,
      ...(withHeader ? { header } : {}),
    };
  });

  if (hiddenEmptyCount > 0) {
    // The reveal row is an action, not a session row — it has no columns to
    // line up with, so its label is never padded to the session column widths.
    const revealLabel = `Show ${hiddenEmptyCount} empty session${hiddenEmptyCount === 1 ? '' : 's'}`;
    options.push({
      label: revealLabel,
      value: SHOW_EMPTY_VALUE,
    });
  }

  return { options, hiddenEmptyCount };
}
