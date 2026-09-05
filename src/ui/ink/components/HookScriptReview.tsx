import React, { useMemo, useState } from 'react';
import { Box, Text, useInput, useStdout, render } from 'ink';
import { stripVTControlCharacters } from 'node:util';
import stringWidth from 'string-width';
import { ThemeProvider, useTheme } from '../../theme/ThemeContext.js';
import { cleanupModalRender, prepareModalRender, resumeModalInput } from './Modal.js';
import { applyPeersScroll, windowPeerLines } from '../peersScreenModel.js';

export interface HookScriptReviewProps {
  preview: string;
  onConfirm: (save: boolean) => void;
  rows?: number;
  columns?: number;
}

export function HookScriptReview({ preview, onConfirm, rows, columns }: HookScriptReviewProps) {
  const { stdout } = useStdout();
  const { colors } = useTheme();
  const [offset, setOffset] = useState(0);
  const width = Math.max(20, (columns ?? stdout.columns ?? 80) - 2);
  const height = Math.max(3, (rows ?? stdout.rows ?? 24) - 5);
  const lines = useMemo(() => stripVTControlCharacters(preview).replace(/\t/g, '  ').split('\n').flatMap(line => {
    const wrapped: string[] = [];
    let current = '';
    let length = 0;
    for (const character of line) {
      const size = stringWidth(character);
      if (length + size > width) { wrapped.push(current); current = ''; length = 0; }
      current += character;
      length += size;
    }
    return [...wrapped, current];
  }), [preview, width]);
  const view = windowPeerLines(lines, offset, height);
  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === 'c')) { onConfirm(false); return; }
    if (input === 's') { onConfirm(true); return; }
    const action = key.upArrow ? 'up' : key.downArrow ? 'down' : key.pageUp ? 'pageUp'
      : key.pageDown ? 'pageDown' : input === 'g' ? 'top' : input === 'G' ? 'bottom' : null;
    if (action) setOffset(current => applyPeersScroll(action, current, lines.length, height));
  });
  return <Box flexDirection="column" paddingX={1}>
    <Text bold color={colors.accent}>Review lifecycle hook</Text>
    <Text color={colors.muted}>{view.offset + 1}–{Math.min(view.offset + height, lines.length)} of {lines.length} lines</Text>
    {view.lines.map((line, index) => <Text key={index} wrap="truncate">{line || ' '}</Text>)}
    <Text color={colors.muted}>↑↓ scroll · PgUp/PgDn · g/G top/bottom</Text>
    <Text>s save and enable · Esc cancel</Text>
  </Box>;
}

export async function showHookScriptReview(preview: string): Promise<boolean> {
  prepareModalRender(process.stdout);
  resumeModalInput();
  await new Promise<void>(resolve => setImmediate(resolve));
  try {
    return await new Promise<boolean>((resolve, reject) => {
      let saved = false;
      const instance = render(<ThemeProvider><HookScriptReview preview={preview} onConfirm={value => {
        saved = value;
        instance.unmount();
      }} /></ThemeProvider>, { exitOnCtrlC: false });
      void instance.waitUntilExit().then(() => resolve(saved), reject);
    });
  } finally {
    cleanupModalRender(process.stdout);
  }
}
