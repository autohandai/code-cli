/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { memo, useEffect, useRef } from 'react';
import { Box, Text, measureElement, useBoxMetrics, type DOMElement } from 'ink';
import type { GoalSessionSnapshot } from '../../goals/types.js';
import { useTheme } from '../theme/ThemeContext.js';
import type { OutputLayout } from './mouseInput.js';

export interface GoalEditRequest {
  id: string;
  kind: 'active' | 'queued';
  objective: string;
}

export interface GoalPanelProps {
  snapshot: GoalSessionSnapshot;
  selectedIndex: number | null;
  onRowLayoutChange?: (target: GoalEditRequest, layout: OutputLayout | null) => void;
}

export function getEditableGoalItems(
  snapshot: GoalSessionSnapshot | undefined,
): GoalEditRequest[] {
  if (!snapshot) {
    return [];
  }

  return [
    ...(snapshot.goal ? [{
      id: snapshot.goal.goalId,
      kind: 'active' as const,
      objective: snapshot.goal.objective,
    }] : []),
    ...snapshot.queue.map((goal) => ({
      id: goal.queueId,
      kind: 'queued' as const,
      objective: goal.objective,
    })),
  ];
}

function goalTargetKey(target: GoalEditRequest): string {
  return `${target.kind}:${target.id}`;
}

const GoalRow = memo(function GoalRow({
  target,
  index,
  selected,
  status,
  onLayoutChange,
}: {
  target: GoalEditRequest;
  index: number;
  selected: boolean;
  status: string;
  onLayoutChange?: (target: GoalEditRequest, layout: OutputLayout | null) => void;
}) {
  const { colors } = useTheme();
  const rowRef = useRef<DOMElement | null>(null);
  const metrics = useBoxMetrics(rowRef);

  useEffect(() => {
    if (!onLayoutChange || !metrics.hasMeasured || !rowRef.current) {
      return;
    }
    const { x, y, width, height } = measureElement(rowRef.current);
    onLayoutChange(target, { x, y, width, height });
    return () => onLayoutChange(target, null);
  }, [metrics.hasMeasured, metrics.height, metrics.left, metrics.top, metrics.width, onLayoutChange, target]);

  return (
    <Box ref={rowRef} gap={1}>
      <Text color={selected ? colors.accent : colors.muted} bold={selected}>
        {selected ? '›' : ' '} {index + 1}.
      </Text>
      <Text color={selected ? colors.accent : colors.text} bold={selected}>
        {target.objective}
      </Text>
      <Text color={colors.muted}>{status}</Text>
    </Box>
  );
});

export const GoalPanel = memo(function GoalPanel({
  snapshot,
  selectedIndex,
  onRowLayoutChange,
}: GoalPanelProps) {
  const { colors } = useTheme();
  const editable = getEditableGoalItems(snapshot);
  const total = editable.length + snapshot.peers.length;
  const queueStartIndex = snapshot.goal ? 1 : 0;

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Box gap={1}>
        <Text bold>Goals · {total} total</Text>
        <Text color={colors.muted}>· Ctrl+G close</Text>
      </Box>

      {snapshot.goal ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={colors.muted}>Current</Text>
          <GoalRow
            target={editable[0]!}
            index={0}
            selected={selectedIndex === 0}
            status={snapshot.goal.status}
            onLayoutChange={onRowLayoutChange}
          />
        </Box>
      ) : null}

      {snapshot.queue.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={colors.muted}>Queue · {snapshot.queue.length} pending</Text>
          {snapshot.queue.map((goal, queueIndex) => {
            const index = queueStartIndex + queueIndex;
            return (
              <GoalRow
                key={goalTargetKey(editable[index]!)}
                target={editable[index]!}
                index={index}
                selected={selectedIndex === index}
                status="queued"
                onLayoutChange={onRowLayoutChange}
              />
            );
          })}
        </Box>
      ) : null}

      {snapshot.peers.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={colors.muted}>Other sessions</Text>
          {snapshot.peers.map((peer) => (
            <Box key={peer.sessionId} gap={1}>
              <Text color={peer.ownerAlive ? colors.warning : colors.muted}>
                {peer.ownerAlive ? '●' : '○'}
              </Text>
              <Text>{peer.objective}</Text>
              <Text color={colors.muted}>{peer.status}</Text>
            </Box>
          ))}
        </Box>
      ) : null}

      {editable.length === 0 && snapshot.peers.length === 0 ? (
        <Text color={colors.muted}>No active or queued goals.</Text>
      ) : null}

      {editable.length > 0 ? (
        <Text color={colors.muted}>
          ↑↓ navigate · enter edit · click edit · esc clear selection
        </Text>
      ) : null}
    </Box>
  );
});
