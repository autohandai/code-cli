/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { memo } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { useTheme } from '../theme/ThemeContext.js';
import { useTranslation } from '../i18n/index.js';

export interface StatusLineProps {
  isWorking: boolean;
  status: string;
  elapsed?: string;
  tokens?: string;
  queueCount?: number;
  /** Context percentage remaining (0-100) */
  contextPercent?: number;
  /** Total tokens used (for display like "45K/128K") */
  contextTokens?: { used: number; total: number };
}

/**
 * Render ASCII progress bar for context usage
 * @param contextPercent - Percentage of context REMAINING (0-100)
 * @param contextTokens - Token counts for display
 * @param colors - Theme colors
 * @returns Progress bar element or null
 */
function renderContextProgressBar(
  contextPercent: number | undefined,
  contextTokens: { used: number; total: number } | undefined,
  colors: ReturnType<typeof useTheme>['colors']
): React.ReactNode {
  if (contextPercent === undefined) return null;

  const BAR_WIDTH = 10;
  const FILLED_CHAR = '\u2588'; // █ Full block
  const EMPTY_CHAR = '\u2591';  // ░ Light shade

  // contextPercent is REMAINING, so used = 100 - remaining
  const usedPercent = 100 - contextPercent;
  const filledCount = Math.round((usedPercent / 100) * BAR_WIDTH);
  const emptyCount = BAR_WIDTH - filledCount;

  const filledBar = FILLED_CHAR.repeat(filledCount);
  const emptyBar = EMPTY_CHAR.repeat(emptyCount);

  // Color coding based on USED percentage
  // Green: < 50% used, Yellow: 50-80% used, Red: > 80% used
  let barColor: string;
  if (usedPercent < 50) {
    barColor = colors.success ?? 'green';
  } else if (usedPercent <= 80) {
    barColor = colors.warning ?? 'yellow';
  } else {
    barColor = colors.error ?? 'red';
  }

  // Format token counts (e.g., "45K/128K")
  const formatTokens = (n: number): string => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${Math.round(n / 1000)}K`;
    return String(n);
  };

  const tokenDisplay = contextTokens
    ? ` ${formatTokens(contextTokens.used)}/${formatTokens(contextTokens.total)}`
    : '';

  return (
    <>
      <Text color={colors.muted}> · Context: </Text>
      <Text color={colors.muted}>[</Text>
      <Text color={barColor}>{filledBar}</Text>
      <Text color={colors.dim}>{emptyBar}</Text>
      <Text color={colors.muted}>]</Text>
      <Text color={colors.muted}>{tokenDisplay} ({Math.round(usedPercent)}%)</Text>
    </>
  );
}

function StatusLineComponent({ isWorking, status, elapsed, tokens, queueCount = 0, contextPercent, contextTokens }: StatusLineProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();

  // Always render to maintain stable layout - show placeholder when not working
  if (!isWorking) {
    return (
      <Box height={1}>
        <Text color={colors.dim}> </Text>
      </Box>
    );
  }

  const contextBar = renderContextProgressBar(contextPercent, contextTokens, colors);

  return (
    <Box>
      <Text color={colors.accent}>
        <Spinner type="dots" />
      </Text>
      <Text> {status}</Text>
      {elapsed && <Text color={colors.muted}> ({elapsed}</Text>}
      {tokens && <Text color={colors.muted}> · {tokens}</Text>}
      {elapsed && <Text color={colors.muted}>)</Text>}
      {queueCount > 0 && (
        <Text color={colors.accent}> [{queueCount} queued]</Text>
      )}
      {contextBar}
      <Text color={colors.muted}> · {t('ui.escToCancel')}</Text>
    </Box>
  );
}

/**
 * Memoized StatusLine - prevents unnecessary re-renders
 * Note: We don't memoize too strictly since spinner animation needs updates
 */
export const StatusLine = memo(StatusLineComponent, (prev, next) => {
  // Don't skip re-render when working (spinner needs animation updates)
  if (prev.isWorking || next.isWorking) {
    // Only skip if all values are identical
    return prev.isWorking === next.isWorking &&
           prev.status === next.status &&
           prev.elapsed === next.elapsed &&
           prev.tokens === next.tokens &&
           prev.queueCount === next.queueCount &&
           prev.contextPercent === next.contextPercent &&
           prev.contextTokens?.used === next.contextTokens?.used &&
           prev.contextTokens?.total === next.contextTokens?.total;
  }
  // When both are not working, can safely skip
  return true;
});
