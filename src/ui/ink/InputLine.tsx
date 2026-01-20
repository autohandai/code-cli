/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { memo } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../theme/ThemeContext.js';

export interface InputLineProps {
  value: string;
  isActive: boolean;
}

function InputLineComponent({ value, isActive }: InputLineProps) {
  const { colors } = useTheme();

  // When inactive, render minimal placeholder for layout stability
  // This prevents layout jumps but doesn't look like an active input
  if (!isActive) {
    return (
      <Box marginTop={1} height={1}>
        <Text color={colors.dim}> </Text>
      </Box>
    );
  }

  // Active state - show full input with cursor
  return (
    <Box marginTop={1}>
      <Text color={colors.muted}>› </Text>
      <Text color={colors.text}>{value}</Text>
      <Text color={colors.accent}>▊</Text>
    </Box>
  );
}

/**
 * Memoized InputLine - prevents unnecessary re-renders
 */
export const InputLine = memo(InputLineComponent, (prev, next) => {
  return prev.value === next.value && prev.isActive === next.isActive;
});
