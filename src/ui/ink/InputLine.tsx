/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../theme/ThemeContext.js';

export interface InputLineProps {
  value: string;
  isActive: boolean;
}

export function InputLine({ value, isActive }: InputLineProps) {
  const { colors } = useTheme();

  if (!isActive) {
    return null;
  }

  return (
    <Box marginTop={1}>
      <Text color={colors.muted}>› </Text>
      <Text>{value}</Text>
      <Text color={colors.accent}>▊</Text>
    </Box>
  );
}
