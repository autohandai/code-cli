/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { Box, Text } from 'ink';
import stringWidth from 'string-width';

export interface AnnouncementLineProps {
  text: string;
  hint: string;
  visible: boolean;
  columns: number;
}

const MINIMUM_HINT_COLUMNS = 40;
const CONTENT_HINT_GAP = 2;

function graphemes(value: string): string[] {
  if (typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(value), (part) => part.segment);
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

export function AnnouncementLine({
  text,
  hint,
  visible,
  columns,
}: AnnouncementLineProps): React.ReactNode {
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
      <Text>{content}</Text>
      {showHint ? <Text>{hint}</Text> : null}
    </Box>
  );
}
