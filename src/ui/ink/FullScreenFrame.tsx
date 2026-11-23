/** @license Apache-2.0 */
import React, { createContext, useContext, useMemo, useRef } from 'react';
import os from 'node:os';
import path from 'node:path';
import { Box, Text, useBoxMetrics, type DOMElement } from 'ink';
import stringWidth from 'string-width';
import stripAnsi from 'strip-ansi';
import { useTheme } from '../theme/ThemeContext.js';
import type { FullScreenMessage, FullScreenTranscript } from './fullScreenTranscript.js';
import { runtimeVersion } from '../../utils/runtimeVersion.js';
import { getPromptBlockWidth } from '../inputPrompt.js';
import { useTerminalWindowSize } from './useTerminalWindowSize.js';

export const ComposerOriginContext = createContext({ left: 0, top: 0 });

/**
 * True while the full-screen view keeps terminal mouse reporting on for its whole life. The
 * composer then leaves reporting alone: switching it off with the caret (a running turn hides
 * it) handed the wheel back to the terminal, which sends arrow keys on the alternate screen.
 */
export const FullScreenMouseContext = createContext(false);

/** Rows above the transcript body: title, workspace and a spacer. Mouse rows are mapped against it. */
export const FULL_SCREEN_HEADER_ROWS = 3;

/**
 * Blank columns between the window edge and the header, transcript and hint. Transcript columns
 * start after it: wrap widths and mouse columns are mapped against it. The footer (composer,
 * menus, status) starts on the window edge.
 */
export const FULL_SCREEN_GUTTER = 2;

/** Columns the transcript can draw in: the terminal less the gutter and the last column, which stays free. */
export function fullScreenContentWidth(columns: number): number {
  return Math.max(1, columns - FULL_SCREEN_GUTTER - 1);
}

/** Columns the footer can draw in: the terminal less the last column, which stays free. */
export function fullScreenFooterWidth(columns: number): number {
  return Math.max(1, columns - 1);
}

/** The frame's footer width for whatever it renders in its footer; null outside the frame. */
const FullScreenFooterWidthContext = createContext<number | null>(null);

/**
 * Columns one footer row may fill: the frame's footer width inside the full-screen frame, the
 * classic prompt block otherwise. Both follow a resize, the frame through its `columns` prop.
 */
export function useFooterRowWidth(): number {
  const frameWidth = useContext(FullScreenFooterWidthContext);
  const promptWidth = getPromptBlockWidth(useTerminalWindowSize().columns);
  return frameWidth ?? promptWidth;
}

const INSET_ORIGIN = { left: FULL_SCREEN_GUTTER, top: 0 };

/** A view that takes the frame's place on the alternate screen, on the frame's left edge. */
export function FullScreenInset({ rows, children }: { rows: number; children: React.ReactNode }) {
  return <Box height={Math.max(1, rows - 1)} paddingLeft={FULL_SCREEN_GUTTER} overflow="hidden">
    <ComposerOriginContext.Provider value={INSET_ORIGIN}>{children}</ComposerOriginContext.Provider>
  </Box>;
}

/**
 * Reverse video written as its own SGR pair. Ink's `inverse` goes through chalk, which emits
 * nothing when it detects no colour support (no TERM, as `bun run dev` starts under `env -i`),
 * while the theme detects colour on its own and still paints: text was copied but never shown selected.
 */
const INVERSE_ON = '\x1b[7m';
const INVERSE_OFF = '\x1b[27m';

function SelectableRow({ text, selected }: { text: string; selected: [number, number] }) {
  let column = 0;
  let before = '';
  let inside = '';
  let after = '';
  for (const character of stripAnsi(text)) {
    if (column < selected[0]) before += character;
    else if (column < selected[1]) inside += character;
    else after += character;
    column += stringWidth(character);
  }
  return <Text wrap="truncate">{`${before}${INVERSE_ON}${inside || ' '}${INVERSE_OFF}${after}`}</Text>;
}

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
  const width = fullScreenContentWidth(columns);
  const footerLimit = Math.max(1, height - 6);
  const footerHeight = Math.min(footerLimit, metrics.hasMeasured ? metrics.height : 8);
  const bodyHeight = Math.max(0, height - footerHeight - 4);
  const directory = workspaceRoot ?? process.cwd();
  const home = os.homedir();
  const displayDirectory = directory === home ? '~' : directory.startsWith(home + path.sep) ? `~${directory.slice(home.length)}` : directory;
  useMemo(() => model.update(messages, width), [model, messages, width]);
  model.focusDetails(detailsId);
  const view = model.view(Math.max(1, bodyHeight));
  // Until the footer is measured the body height is a guess, not rows the footer gave back.
  if (!metrics.hasMeasured) model.settleTail();
  const transcriptRows = view.rows.slice(0, bodyHeight);
  while (transcriptRows.length < bodyHeight) transcriptRows.push({ text: ' ' });
  const hint = model.copiedSelection && model.searchQuery === null
    ? 'Copied selection'
    : model.searchQuery !== null
    ? `Find: ${model.searchQuery} · Enter next · Shift+Enter previous · Esc close${model.searchMatched ? '' : ' · No match'}`
    : view.following ? ' ' : `${view.newActivity ? 'New activity · ' : ''}↓ Back to bottom · Ctrl+End${detailsId ? '' : ' / Esc'}`;
  return <Box flexDirection="column" width="100%" paddingRight={1} height={height} overflow="hidden">
    <Box flexDirection="column" height={FULL_SCREEN_HEADER_ROWS} flexShrink={0} paddingLeft={FULL_SCREEN_GUTTER} overflow="hidden">
      <Text wrap="truncate"><Text color={colors.accent}>{'>_ '}</Text><Text bold>Autohand Code</Text><Text color={colors.muted}>{` (v${runtimeVersion})`}</Text></Text>
      <Text color={colors.muted} wrap="truncate">{`   ${displayDirectory}`}</Text>
      <Text> </Text>
    </Box>
    <Box flexDirection="column" flexGrow={1} flexShrink={1} flexBasis={0} minHeight={0} paddingLeft={FULL_SCREEN_GUTTER} overflow="hidden">
      {transcriptRows.map((row, index) => {
        const selected = model.selectionColumns(index);
        if (selected) return <SelectableRow key={index} text={row.text} selected={selected} />;
        return <Text key={index} wrap="truncate">{row.role === 'user'
          ? theme.bold(theme.fgBg('userMessageText', 'userMessageBg', row.text + ' '.repeat(Math.max(0, width - stringWidth(row.text)))))
          : row.text || ' '}</Text>;
      })}
    </Box>
    <Box flexShrink={0} paddingLeft={FULL_SCREEN_GUTTER}><Text color={model.searchQuery !== null ? colors.muted : colors.accent} wrap="truncate">{hint}</Text></Box>
    <Box ref={footerRef} flexDirection="column" flexShrink={0} maxHeight={footerLimit} overflow="hidden" justifyContent="flex-end">
      <ComposerOriginContext.Provider value={{ left: metrics.left, top: metrics.top }}>
        <FullScreenFooterWidthContext.Provider value={fullScreenFooterWidth(columns)}>{footer}</FullScreenFooterWidthContext.Provider>
      </ComposerOriginContext.Provider>
    </Box>
  </Box>;
}
