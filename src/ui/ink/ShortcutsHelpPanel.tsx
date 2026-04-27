/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { memo } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../theme/ThemeContext.js';

export interface ShortcutsHelpPanelProps {
  visible: boolean;
}

const SHORTCUT_ROWS: Array<{ left: string; right: string }> = [
  { left: '/ for commands', right: '! for shell commands' },
  { left: '@ for file paths', right: 'tab accepts suggestion' },
  { left: '$ for skills', right: 'shift + tab toggles plan mode' },
  { left: 'shift + enter inserts newline', right: 'alt + enter inserts newline' },
  { left: 'enter submits prompt', right: 'ctrl + c clears input / exits' },
  { left: 'esc interrupts active turn', right: 'type /, @, or ! to switch mode' },
];

export const ShortcutsHelpPanel = memo(function ShortcutsHelpPanel({
  visible,
}: ShortcutsHelpPanelProps) {
  const { colors } = useTheme();

  if (!visible) {
    return null;
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color="cyan" bold>{' ? shortcuts'}</Text>
      {SHORTCUT_ROWS.map((row, i) => (
        <Box key={i} gap={2}>
          <Text color={colors.dim}>{`  ${row.left}`}</Text>
          <Text color={colors.dim}>{row.right}</Text>
        </Box>
      ))}
    </Box>
  );
});
