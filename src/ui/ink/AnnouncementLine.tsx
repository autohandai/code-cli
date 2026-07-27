/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { memo } from 'react';
import { Box, Text } from 'ink';
import stringWidth from 'string-width';
import { useTheme } from '../theme/ThemeContext.js';

export interface AnnouncementLineProps {
  text: string;
  hint: string;
  visible: boolean;
  columns: number;
}

const MINIMUM_HINT_COLUMNS = 40;
const CONTENT_HINT_GAP = 2;

// Built once. This runs inside the bottom region, which re-renders on every
// spinner frame, and constructing an ICU segmenter per frame is not free.
const GRAPHEME_SEGMENTER = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;

function graphemes(value: string): string[] {
  if (GRAPHEME_SEGMENTER) {
    return Array.from(GRAPHEME_SEGMENTER.segment(value), (part) => part.segment);
  }
  return Array.from(value);
}

export function truncateAnnouncementLine(value: string, maxWidth: number): string {
  if (maxWidth <= 0) {
    return '';
  }
  if (stringWidth(value) <= maxWidth) {
    return value;
  }
  if (maxWidth === 1) {
    return '…';
  }

  const ellipsisWidth = stringWidth('…');
  let output = '';
  let outputWidth = 0;
  for (const grapheme of graphemes(value)) {
    const graphemeWidth = stringWidth(grapheme);
    if (outputWidth + graphemeWidth + ellipsisWidth > maxWidth) {
      break;
    }
    output += grapheme;
    outputWidth += graphemeWidth;
  }
  return `${output}…`;
}

function AnnouncementLineComponent({
  text,
  hint,
  visible,
  columns,
}: AnnouncementLineProps): React.ReactNode {
  const { theme } = useTheme();

  if (!visible) {
    return null;
  }

  const normalizedColumns = Math.max(1, columns);
  const showHint = normalizedColumns >= MINIMUM_HINT_COLUMNS;
  const hintWidth = showHint ? stringWidth(hint) : 0;
  const contentWidth = showHint
    ? Math.max(1, normalizedColumns - hintWidth - CONTENT_HINT_GAP)
    : normalizedColumns;
  const content = truncateAnnouncementLine(text, contentWidth);

  return (
    <Box width={normalizedColumns} justifyContent={showHint ? 'space-between' : 'flex-start'}>
      <Text>{theme.fg('accent', content)}</Text>
      {showHint ? <Text>{theme.fg('muted', hint)}</Text> : null}
    </Box>
  );
}

export const AnnouncementLine = memo(AnnouncementLineComponent);
