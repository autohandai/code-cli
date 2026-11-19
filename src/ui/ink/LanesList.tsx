/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { memo, useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type { Lane, LaneStatus } from '../../core/lanes/LaneManager.js';
import { formatLaneElapsed, formatLaneTokens } from '../../core/lanes/laneFormat.js';
import { useTheme } from '../theme/ThemeContext.js';

const MARKERS: Record<LaneStatus, string> = {
  running: '○', completed: '✓', partial: '◐', failed: '✗', cancelled: '⊘',
};
const MARKER_WIDTH = 2;
const GAP = 2;
const MIN_DESCRIPTION_WIDTH = 4;

export interface LaneRowLayout {
  marker: string;
  name: string;
  description: string;
  meta: string;
}

/** Lane text comes from a model: keep it to one line of printable characters. */
function printable(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/ +/g, ' ').trim();
}

function truncate(value: string, width: number): string {
  if (value.length <= width) return value;
  return width <= 1 ? '…' : `${value.slice(0, width - 1)}…`;
}

/**
 * Fits one lane into `width` columns. The name is kept longest, then elapsed time,
 * then tokens; the description takes whatever is left.
 */
export function layoutLaneRow(lane: Lane, width: number, now: number): LaneRowLayout {
  const name = printable(lane.name);
  const description = printable(lane.description);
  const elapsed = formatLaneElapsed((lane.finishedAt ?? now) - lane.startedAt);
  const tokens = formatLaneTokens(lane.totalTokens);
  const room = width - MARKER_WIDTH;
  const meta = [tokens ? `${elapsed} · ${tokens}` : elapsed, elapsed]
    .find(candidate => name.length + GAP + candidate.length <= room) ?? '';
  const afterName = room - name.length - (meta ? GAP + meta.length : 0) - GAP;
  return {
    marker: MARKERS[lane.status],
    name: truncate(name, Math.max(1, room)),
    description: description.length <= afterName || afterName >= MIN_DESCRIPTION_WIDTH ? truncate(description, Math.max(0, afterName)) : '',
    meta,
  };
}

/**
 * Chooses the lanes that fit in `capacity` rows. When they do not all fit, the last
 * row is given to the overflow count; running lanes win, then the latest to finish.
 */
export function selectVisibleLanes(lanes: readonly Lane[], capacity: number): { visible: Lane[]; hidden: number } {
  if (lanes.length <= capacity) return { visible: [...lanes], hidden: 0 };
  const byPriority = [...lanes].sort((left, right) =>
    Number(right.status === 'running') - Number(left.status === 'running')
    || (right.finishedAt ?? 0) - (left.finishedAt ?? 0));
  const kept = new Set(byPriority.slice(0, Math.max(0, capacity - 1)));
  const visible = lanes.filter(lane => kept.has(lane));
  return { visible, hidden: lanes.length - visible.length };
}

/** Rows the lanes list may take, including `main`, so it never crowds a short terminal. */
export function lanesRowBudget(terminalRows: number | undefined): number {
  if (terminalRows === undefined) return 5;
  if (terminalRows < 10) return 2;
  return Math.min(6, Math.max(3, Math.floor(terminalRows / 6)));
}

export interface LanesListProps {
  lanes: readonly Lane[];
  width: number;
  /** Total rows available, counting the `main` row and the overflow row. */
  maxRows: number;
  clock?: () => number;
}

/** The main conversation and its lanes, listed underneath the composer. */
export const LanesList = memo(function LanesList({ lanes, width, maxRows, clock = Date.now }: LanesListProps) {
  const { colors } = useTheme();
  const [now, setNow] = useState(clock);
  const running = lanes.some(lane => lane.status === 'running');

  useEffect(() => {
    if (!running) return undefined;
    setNow(clock());
    const timer = setInterval(() => setNow(clock()), 1000);
    return () => clearInterval(timer);
  }, [running, clock]);

  if (lanes.length === 0) return null;

  const { visible, hidden } = selectVisibleLanes(lanes, Math.max(1, maxRows - 1));
  const markerColor: Record<LaneStatus, string | undefined> = {
    running: undefined, completed: colors.success, partial: colors.warning, failed: colors.error, cancelled: colors.muted,
  };

  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      <Text bold wrap="truncate">● main</Text>
      {visible.map((lane) => {
        const row = layoutLaneRow(lane, width, now);
        return (
          <Box key={lane.id} width={width} justifyContent="space-between">
            <Text wrap="truncate">
              <Text color={markerColor[lane.status]}>{row.marker}</Text> {row.name}
              {row.description ? <Text color={colors.muted}>{'  '}{row.description}</Text> : null}
            </Text>
            {row.meta ? <Box flexShrink={0} marginLeft={GAP}><Text color={colors.muted}>{row.meta}</Text></Box> : null}
          </Box>
        );
      })}
      {hidden > 0 ? <Text color={colors.muted} wrap="truncate">{`  +${hidden} more`}</Text> : null}
    </Box>
  );
});
