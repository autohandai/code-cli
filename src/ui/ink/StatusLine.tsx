/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { memo } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { useTheme } from '../theme/ThemeContext.js';

export interface StatusLineProps {
  isWorking: boolean;
  status: string;
  elapsed?: string;
  tokens?: string;
  queueCount?: number;
}

function StatusLineComponent({ isWorking, status, elapsed, tokens, queueCount = 0 }: StatusLineProps) {
  const { colors } = useTheme();

  // Always render to maintain stable layout - show placeholder when not working
  if (!isWorking) {
    return (
      <Box height={1}>
        <Text color={colors.dim}> </Text>
      </Box>
    );
  }

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
      <Text color={colors.muted}> · esc to cancel</Text>
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
           prev.queueCount === next.queueCount;
  }
  // When both are not working, can safely skip
  return true;
});
