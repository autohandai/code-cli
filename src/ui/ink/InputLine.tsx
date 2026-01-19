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

  // Always render to maintain stable layout - use visibility styling instead of null
  return (
    <Box marginTop={1}>
      <Text color={isActive ? colors.muted : colors.dim}>› </Text>
      <Text color={isActive ? colors.text : colors.dim}>{isActive ? value : ''}</Text>
      {isActive && <Text color={colors.accent}>▊</Text>}
    </Box>
  );
}

/**
 * Memoized InputLine - prevents unnecessary re-renders
 */
export const InputLine = memo(InputLineComponent, (prev, next) => {
  return prev.value === next.value && prev.isActive === next.isActive;
});
