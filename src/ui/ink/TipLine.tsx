/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { memo } from 'react';
import { Box, Text } from 'ink';
import stringWidth from 'string-width';
import { useTheme } from '../theme/ThemeContext.js';
import { getPromptBlockWidth } from '../inputPrompt.js';
import { truncateAnnouncementLine } from './AnnouncementLine.js';
import type { TipLineState } from './AgentUI.js';

export interface TipLineProps {
  tip: TipLineState | undefined;
  columns: number;
}

/** A pinned upgrade hint under the status line; it stays until the next turn starts. */
function TipLineComponent({ tip, columns }: TipLineProps): React.ReactNode {
  const { theme } = useTheme();
  if (tip?.kind !== 'upgrade') {
    return null;
  }
  const content = truncateAnnouncementLine(`⎿  Plan: ${tip.text}`, Math.max(1, columns));
  return (
    <Box height={1}>
      <Text>{theme.fg('warning', content)}</Text>
    </Box>
  );
}

export const TipLine = memo(TipLineComponent);

export const IDLE_TIP_PREFIX = 'Tip: ';
/** Below this many columns a tip would be cut to noise, so none is shown. */
export const MIN_IDLE_TIP_WIDTH = 24;
const IDLE_TIP_GAP = 2;

/** Columns left for an idle tip on the row above the composer, after the summary on its left. */
export function idleTipWidth(columns: number, summary?: string): number {
  const used = summary ? stringWidth(summary) + IDLE_TIP_GAP : 0;
  return Math.max(0, getPromptBlockWidth(columns) - used);
}

/** Whether a tip fits whole, prefix included, in `width` columns. */
export function fitsIdleTip(tip: string, width: number): boolean {
  return width >= MIN_IDLE_TIP_WIDTH && stringWidth(`${IDLE_TIP_PREFIX}${tip}`) <= width;
}

export interface IdleTipRowProps {
  /** The finished turn's "Completed in …" line, kept on the left. */
  summary?: string;
  tip?: string;
  columns: number;
}

/**
 * The row directly above the composer while no turn runs: the last turn's
 * summary on the left and a rotating tip aligned to the composer's right edge.
 */
function IdleTipRowComponent({ summary, tip, columns }: IdleTipRowProps): React.ReactNode {
  const { colors } = useTheme();
  const width = idleTipWidth(columns, summary);
  const tipText = tip && width >= MIN_IDLE_TIP_WIDTH
    ? truncateAnnouncementLine(`${IDLE_TIP_PREFIX}${tip}`, width)
    : '';

  if (!tipText) {
    return summary ? (
      <Box marginTop={1}>
        <Text color={colors.muted}>{summary}</Text>
      </Box>
    ) : null;
  }

  return (
    <Box
      marginTop={summary ? 1 : 0}
      width={getPromptBlockWidth(columns)}
      justifyContent={summary ? 'space-between' : 'flex-end'}
    >
      {summary ? <Text color={colors.muted}>{summary}</Text> : null}
      <Text color={colors.muted}>{tipText}</Text>
    </Box>
  );
}

export const IdleTipRow = memo(IdleTipRowComponent);
