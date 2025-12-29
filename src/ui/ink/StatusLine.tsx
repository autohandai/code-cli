/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
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

export function StatusLine({ isWorking, status, elapsed, tokens, queueCount = 0 }: StatusLineProps) {
  const { colors } = useTheme();

  if (!isWorking) {
    return null;
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
