/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { memo, useEffect, useRef } from 'react';
import { stripVTControlCharacters } from 'node:util';
import { Box, Text, measureElement, useBoxMetrics, type DOMElement } from 'ink';
import type { CompletedGoal, GoalSessionSnapshot } from '../../goals/types.js';
import { UNSCOPED_GOAL_SESSION_KEY } from '../../goals/types.js';
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

export function goalTargetKey(target: GoalEditRequest): string {
  return `${target.kind}:${target.id}`;
}

function summarizeObjective(objective: string): string {
  const normalized = stripVTControlCharacters(objective).trim();
  const firstLine = normalized.split(/\r?\n/u, 1)[0]!.replace(/\s+/gu, ' ');
  const characters = Array.from(firstLine);
  const preview = characters.slice(0, 96).join('').trimEnd();
  return characters.length > 96 || normalized.includes('\n') ? `${preview}…` : preview;
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
    <Box ref={rowRef}>
      <Box flexShrink={0}>
        <Text color={selected ? colors.accent : colors.muted} bold={selected}>
          {selected ? '›' : ' '} {index + 1}.{' '}
        </Text>
      </Box>
      <Box flexShrink={1} minWidth={0}>
        <Text color={selected ? colors.accent : colors.text} bold={selected} wrap="truncate-end">
          {summarizeObjective(target.objective)}
        </Text>
      </Box>
      <Box flexShrink={0}>
        <Text color={colors.muted}> {status}</Text>
      </Box>
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
  let lastCompleted: CompletedGoal | undefined;
  for (const goal of snapshot.completed) {
    const belongsToSession = (goal.sessionId ?? UNSCOPED_GOAL_SESSION_KEY) === (snapshot.sessionId ?? UNSCOPED_GOAL_SESSION_KEY);
    if (belongsToSession && goal.completionReceipt
      && goal.completionReceipt.recordedAt >= (lastCompleted?.completionReceipt?.recordedAt ?? 0)) {
      lastCompleted = goal;
    }
  }
  const receipt = snapshot.goal?.completionReceipt ?? lastCompleted?.completionReceipt;
  const receiptObjective = snapshot.goal?.completionReceipt ? snapshot.goal.objective : lastCompleted?.objective;

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Box gap={1}>
        <Text bold>Goals · {total} total</Text>
        <Text color={colors.muted}>· Ctrl+G close</Text>
      </Box>

      {snapshot.storageError ? (
        <Text color={colors.warning}>Live updates unavailable. {snapshot.storageError}</Text>
      ) : null}

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
          <Text color={colors.muted}>Owner: {snapshot.sessionId ?? 'unscoped'}</Text>
          <Text color={colors.muted}>
            Tokens: {snapshot.goal.tokensUsed} / {snapshot.goal.tokenBudget ?? 'no limit'}
            {' · '}Time: {Math.floor(snapshot.goal.timeUsedSeconds)}s / {snapshot.goal.timeBudgetSeconds === undefined ? 'no limit' : `${snapshot.goal.timeBudgetSeconds}s`}
          </Text>
          {snapshot.goal.stopReason ? <Text wrap="truncate-end">Stopped: {snapshot.goal.stopReason}</Text> : null}
          {snapshot.goal.resumeWhen ? <Text wrap="truncate-end">Resume when: {snapshot.goal.resumeWhen}</Text> : null}
          {snapshot.goal.checkpoint ? (
            <Box flexDirection="column">
              <Text wrap="truncate-end">Checkpoint: {snapshot.goal.checkpoint.summary}</Text>
              {snapshot.goal.checkpoint.nextStep ? <Text wrap="truncate-end">Next: {snapshot.goal.checkpoint.nextStep}</Text> : null}
              {snapshot.goal.checkpoint.artifacts?.length ? (
                <Text color={colors.muted} wrap="truncate-end">Artifacts: {snapshot.goal.checkpoint.artifacts.join(' · ')}</Text>
              ) : null}
            </Box>
          ) : null}
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
            <Box key={peer.sessionId}>
              <Box flexShrink={0}>
                <Text color={peer.ownerAlive ? colors.warning : colors.muted}>
                  {peer.ownerAlive ? '●' : '○'}{' '}
                </Text>
              </Box>
              <Box flexShrink={1} minWidth={0}>
                <Text wrap="truncate-end">{summarizeObjective(peer.objective)}</Text>
              </Box>
              <Box flexShrink={0}>
                <Text color={colors.muted}> {peer.status}</Text>
              </Box>
            </Box>
          ))}
        </Box>
      ) : null}

      {receipt ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={colors.muted} wrap="truncate-end">Completed · {receiptObjective}</Text>
          <Text wrap="truncate-end">Reported completion: {receipt.summary}</Text>
        </Box>
      ) : null}

      {editable.length === 0 && snapshot.peers.length === 0 && !snapshot.storageError ? (
        <Text color={colors.muted}>No active or queued goals.</Text>
      ) : null}

      <Text color={colors.muted}>
        <Text color={colors.text}>Ctrl+G close</Text>
        {editable.length > 0 ? ' · ↑↓ navigate · enter edit · click edit · esc clear selection' : ''}
      </Text>
      <Text color={colors.muted}>
        Manage: /goals pause · resume · complete · clear · queue
      </Text>
    </Box>
  );
});
