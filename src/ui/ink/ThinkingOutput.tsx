/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../theme/ThemeContext.js';

export interface ThinkingOutputProps {
  thought: string | null;
}

export function ThinkingOutput({ thought }: ThinkingOutputProps) {
  const { colors } = useTheme();

  if (!thought) {
    return null;
  }

  // Don't display if it looks like raw JSON
  const trimmed = thought.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return null;
  }

  return (
    <Box marginBottom={1}>
      <Text color={colors.dim} dimColor>Thinking: {thought}</Text>
    </Box>
  );
}
