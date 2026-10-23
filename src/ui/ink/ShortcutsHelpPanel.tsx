/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { memo } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../theme/ThemeContext.js';
import { DEFAULT_KEYBINDINGS, formatChord, type KeybindingAction, type ResolvedKeybindings } from '../../keybindings/profiles.js';

export interface ShortcutsHelpPanelProps {
  visible: boolean;
  keybindings?: ResolvedKeybindings;
  columns?: number;
  fullScreen?: boolean;
}

interface ShortcutGroup {
  title: string;
  rows: [string, string][];
}

export const ShortcutsHelpPanel = memo(function ShortcutsHelpPanel({
  visible,
  keybindings = DEFAULT_KEYBINDINGS,
  columns = 80,
  fullScreen = false,
}: ShortcutsHelpPanelProps) {
  const { colors } = useTheme();
  if (!visible) return null;

  const bindingRows = (action: KeybindingAction, description: string): [string, string][] =>
    keybindings.bindings[action].map(chord => [formatChord(chord), description]);
  const groups: ShortcutGroup[] = [
    { title: 'Compose', rows: [
      ['/', 'Commands'], ['@', 'Mention files'], ['$', 'Skills'], ['!', 'Shell command'],
      ...bindingRows('newline', 'New line'), ['tab', 'Accept suggestion'], ['enter', 'Send prompt'],
    ] },
    { title: 'Session', rows: [
      ...bindingRows('cycleMode', 'Change mode'), ['enter', 'Queue while working'],
      ['↑ / ↓', 'Select queued message'], ['enter', 'Steer selected message'],
      ['ctrl+enter', 'Steer queued input'],
      ['esc', 'Interrupt'], ['ctrl+c', 'Clear input / exit'],
      ...bindingRows('exit', 'Exit'), ...bindingRows('toggleShortcutsHelp', 'Close shortcuts'),
    ] },
    { title: fullScreen ? 'Transcript' : 'History', rows: [
      ['/whatityped', 'Typed history'], ...bindingRows('openHistory', 'Typed history'),
      ...bindingRows('toggleLiveOutput', 'Expand output'),
      ...(fullScreen ? [['pgup / pgdn', 'Scroll'], ['ctrl+f', 'Find text'], ['ctrl+home', 'First message'], ['ctrl+end / esc', 'Back to bottom']] as [string, string][] : []),
      ['↑ / ↓', 'Recall prompt'],
    ] },
  ];
  const width = Math.max(1, columns - 2);
  const count = width >= 110 ? 3 : width >= 74 ? 2 : 1;
  const columnWidth = Math.floor(width / count);
  return (
    <Box flexDirection="column" marginBottom={1} flexShrink={1} overflow="hidden" width={width}>
      <Text bold>Keyboard shortcuts</Text>
      <Box flexWrap="wrap" marginTop={1} flexShrink={0}>
        {groups.map(group => <Box key={group.title} width={columnWidth} flexDirection="column" paddingRight={2}>
          <Text bold>{group.title}</Text>
          {group.rows.map(([key, label], index) => <Box key={index}>
            <Box width={Math.min(18, Math.max(...group.rows.map(row => row[0].length)) + 2)} flexShrink={0}><Text color={colors.accent}>{key}</Text></Box>
            <Box flexGrow={1} flexShrink={1}><Text>{label}</Text></Box>
          </Box>)}
        </Box>)}
      </Box>
    </Box>
  );
});
