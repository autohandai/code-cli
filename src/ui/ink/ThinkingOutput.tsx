/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { memo } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../theme/ThemeContext.js';
import { useTranslation } from '../i18n/index.js';

export interface ThinkingOutputProps {
  thought: string | null;
}

function ThinkingOutputComponent({ thought }: ThinkingOutputProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();

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
      <Text color={colors.dim} dimColor>{t('ui.thinking')}: {thought}</Text>
    </Box>
  );
}

/**
 * Memoized ThinkingOutput - only re-renders when thought changes
 */
export const ThinkingOutput = memo(ThinkingOutputComponent, (prev, next) => {
  return prev.thought === next.thought;
});
