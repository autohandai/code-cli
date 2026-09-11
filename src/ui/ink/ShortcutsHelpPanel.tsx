/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { memo } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../theme/ThemeContext.js';
import { DEFAULT_KEYBINDINGS, type ResolvedKeybindings } from '../../keybindings/profiles.js';

export interface ShortcutsHelpPanelProps {
  visible: boolean;
  /** Active shortcut profile; the rows follow whatever it binds. */
  keybindings?: ResolvedKeybindings;
}

export const ShortcutsHelpPanel = memo(function ShortcutsHelpPanel({
  visible,
  keybindings = DEFAULT_KEYBINDINGS,
}: ShortcutsHelpPanelProps) {
  const { colors } = useTheme();

  if (!visible) {
    return null;
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={colors.accent} bold>{' ? shortcuts'}</Text>
      {keybindings.helpRows().map((row, i) => (
        <Box key={i} gap={2}>
          <Text color={colors.dim}>{`  ${row.left}`}</Text>
          <Text color={colors.dim}>{row.right}</Text>
        </Box>
      ))}
    </Box>
  );
});
