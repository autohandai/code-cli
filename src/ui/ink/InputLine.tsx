/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { memo } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../theme/ThemeContext.js';
import { buildPromptRenderState, getPromptBlockWidth } from '../inputPrompt.js';
import { drawInputBottomBorder, drawInputTopBorder } from '../box.js';

export interface InputLineProps {
  value: string;
  isActive: boolean;
}

function InputLineComponent({ value, isActive }: InputLineProps) {
  const { colors } = useTheme();
  const width = getPromptBlockWidth(process.stdout.columns);
  const topBorder = drawInputTopBorder(width);
  const bottomBorder = drawInputBottomBorder(width);
  const { lineText } = buildPromptRenderState(value, value.length, width);

  // Keep space stable when queue input is inactive.
  if (!isActive) {
    return (
      <Box marginTop={1} height={3}>
        <Text color={colors.dim}> </Text>
      </Box>
    );
  }

  // Active state mirrors the boxed prompt style from readline mode.
  return (
    <Box marginTop={1} flexDirection="column">
      <Text>{topBorder}</Text>
      <Text>{lineText}</Text>
      <Text>{bottomBorder}</Text>
    </Box>
  );
}

/**
 * Memoized InputLine - prevents unnecessary re-renders
 */
export const InputLine = memo(InputLineComponent, (prev, next) => {
  return prev.value === next.value && prev.isActive === next.isActive;
});
