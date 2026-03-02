/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { CATEGORY_LABELS } from './CategorySelector.js';
import type { ImportCategory, ImportError } from '../types.js';

/**
 * Per-category progress entry.
 */
export interface CategoryProgress {
  current: number;
  total: number;
  item: string;
  status: 'importing' | 'retrying' | 'skipped' | 'failed' | 'done';
}

/**
 * Props for the ImportProgressView component.
 */
export interface ImportProgressProps {
  /** Progress state per category */
  progress: Map<ImportCategory, CategoryProgress>;
  /** Accumulated errors across all categories */
  errors: ImportError[];
}

// ---------------------------------------------------------------
// Progress bar renderer
// ---------------------------------------------------------------

/** Filled block character. */
const FILLED = '\u2588';
/** Empty block character. */
const EMPTY = '\u2591';

/**
 * Renders a text-based progress bar.
 *
 * @param current - Current progress value
 * @param total   - Total items
 * @param width   - Character width of the bar (default 20)
 * @returns A string like `[████████░░░░░░░░░░░░]`
 */
export function renderProgressBar(current: number, total: number, width = 20): string {
  if (total <= 0) {
    return `[${EMPTY.repeat(width)}]`;
  }

  const ratio = Math.min(current / total, 1);
  const filled = Math.round(ratio * width);
  const empty = width - filled;

  return `[${FILLED.repeat(filled)}${EMPTY.repeat(empty)}]`;
}

// ---------------------------------------------------------------
// Status indicator helpers
// ---------------------------------------------------------------

function StatusIcon({ status }: { status: CategoryProgress['status'] }) {
  switch (status) {
    case 'done':
      return <Text color="green">{'\u2713'} </Text>;
    case 'failed':
      return <Text color="red">{'\u2717'} </Text>;
    case 'retrying':
      return <Text color="yellow">{'\u21BB'} </Text>;
    case 'importing':
      return (
        <Text color="cyan">
          <Spinner type="dots" />{' '}
        </Text>
      );
    case 'skipped':
      return <Text color="gray">{'- '}</Text>;
    default:
      return <Text>{'  '}</Text>;
  }
}

function StatusSuffix({ entry }: { entry: CategoryProgress }) {
  switch (entry.status) {
    case 'retrying':
      return <Text color="yellow"> retrying {entry.item}...</Text>;
    case 'importing':
      return entry.item ? <Text color="gray"> {entry.item}...</Text> : null;
    case 'failed':
      return <Text color="red"> failed{entry.item ? `: ${entry.item}` : ''}</Text>;
    case 'skipped':
      return <Text color="gray"> skipped</Text>;
    default:
      return null;
  }
}

// ---------------------------------------------------------------
// Main component
// ---------------------------------------------------------------

/**
 * Displays live import progress across all selected categories.
 *
 * Shows:
 * - A spinner / checkmark / cross per category
 * - A progress bar with current/total count
 * - Per-item status messages for active categories
 * - Error summary at the bottom
 */
export function ImportProgressView({ progress, errors }: ImportProgressProps) {
  const entries = Array.from(progress.entries());

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="cyan">Importing...</Text>
      <Text>{''}</Text>

      {entries.map(([cat, entry]) => {
        const label = (CATEGORY_LABELS[cat] ?? cat).padEnd(12);
        const bar = renderProgressBar(entry.current, entry.total);

        return (
          <Box key={cat}>
            <StatusIcon status={entry.status} />
            <Text>{label} </Text>
            <Text color={entry.status === 'done' ? 'green' : undefined}>
              {bar}
            </Text>
            <Text> {entry.current}/{entry.total}</Text>
            <StatusSuffix entry={entry} />
          </Box>
        );
      })}

      {errors.length > 0 && (
        <>
          <Text>{''}</Text>
          <Text color="red">
            {'  '}{errors.length} error{errors.length !== 1 ? 's' : ''} occurred (use --retry-failed to retry)
          </Text>
        </>
      )}
    </Box>
  );
}
