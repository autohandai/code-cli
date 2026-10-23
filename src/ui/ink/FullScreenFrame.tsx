/** @license Apache-2.0 */
import React, { createContext, useMemo, useRef } from 'react';
import os from 'node:os';
import path from 'node:path';
import { Box, Text, useBoxMetrics, type DOMElement } from 'ink';
import stringWidth from 'string-width';
import { useTheme } from '../theme/ThemeContext.js';
import type { FullScreenMessage, FullScreenTranscript } from './fullScreenTranscript.js';
import { runtimeVersion } from '../../utils/runtimeVersion.js';

export const ComposerOriginContext = createContext({ left: 0, top: 0 });

interface FullScreenFrameProps {
  model: FullScreenTranscript;
  messages: readonly FullScreenMessage[];
  footer: React.ReactNode;
  workspaceRoot?: string;
  detailsId?: string;
  rows: number;
  columns: number;
}

export function FullScreenFrame({ model, messages, footer, workspaceRoot, rows, columns, detailsId }: FullScreenFrameProps) {
  const { colors, theme } = useTheme();
  const footerRef = useRef<DOMElement>(null);
  const metrics = useBoxMetrics(footerRef);
  const height = Math.max(1, rows - 1);
  const width = Math.max(1, columns - 1);
  const footerLimit = Math.max(1, height - 6);
  const footerHeight = Math.min(footerLimit, metrics.hasMeasured ? metrics.height : 8);
  const bodyHeight = Math.max(0, height - footerHeight - 5);
  const directory = workspaceRoot ?? process.cwd();
  const home = os.homedir();
  const displayDirectory = directory === home ? '~' : directory.startsWith(home + path.sep) ? `~${directory.slice(home.length)}` : directory;
  useMemo(() => model.update(messages, width), [model, messages, width]);
  model.focusDetails(detailsId);
  const view = model.view(Math.max(1, bodyHeight));
  const transcriptRows = view.rows.slice(0, bodyHeight);
  while (transcriptRows.length < bodyHeight) transcriptRows.push({ text: ' ' });
  const hint = model.searchQuery !== null
    ? `Find: ${model.searchQuery} · Enter next · Shift+Enter previous · Esc close${model.searchMatched ? '' : ' · No match'}`
    : `Full screen · ${view.following ? 'Latest' : 'Ctrl+End latest'} · PgUp/PgDn · Ctrl+F find`;
  return <Box flexDirection="column" width={width} height={height} overflow="hidden">
    <Box flexDirection="column" height={3} flexShrink={0} overflow="hidden">
      <Text wrap="truncate"><Text color={colors.accent}>{'>_ '}</Text><Text bold>Autohand Code</Text><Text color={colors.muted}>{` (v${runtimeVersion})`}</Text></Text>
      <Text color={colors.muted} wrap="truncate">{`   ${displayDirectory}`}</Text>
      <Text> </Text>
    </Box>
    <Box flexDirection="column" flexGrow={1} flexShrink={1} flexBasis={0} minHeight={0} overflow="hidden">
      {transcriptRows.map((row, index) => <Text key={index} wrap="truncate">{row.role === 'user'
        ? theme.bold(theme.fgBg('userMessageText', 'userMessageBg', row.text + ' '.repeat(Math.max(0, width - stringWidth(row.text)))))
        : row.text || ' '}</Text>)}
    </Box>
    <Text color={colors.accent} wrap="truncate">{view.following ? ' ' : `${view.newActivity ? 'New activity · ' : ''}↓ Back to bottom · Ctrl+End${detailsId ? '' : ' / Esc'}`}</Text>
    <Box ref={footerRef} flexDirection="column" flexShrink={0} maxHeight={footerLimit} overflow="hidden" justifyContent="flex-end">
      <ComposerOriginContext.Provider value={{ left: metrics.left, top: metrics.top }}>
        {footer}
      </ComposerOriginContext.Provider>
    </Box>
    <Box height={1} flexShrink={0}><Text color={colors.muted} wrap="truncate">{hint}</Text></Box>
  </Box>;
}
