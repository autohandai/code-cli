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
export function idleTipWidth(columns: number): number {
  return getPromptBlockWidth(columns);
}

/** Whether a tip fits whole, prefix included, in `width` columns. */
export function fitsIdleTip(tip: string, width: number): boolean {
  return width >= MIN_IDLE_TIP_WIDTH && stringWidth(`${IDLE_TIP_PREFIX}${tip}`) <= width;
}

export interface IdleTipRowProps {
  summary?: string;
  tip?: string;
  columns: number;
}

function IdleTipRowComponent({ summary, tip, columns }: IdleTipRowProps): React.ReactNode {
  const { colors } = useTheme();
  const width = idleTipWidth(columns);
  const tipText = tip && width >= MIN_IDLE_TIP_WIDTH
    ? truncateAnnouncementLine(`${IDLE_TIP_PREFIX}${tip}`, width)
    : '';

  if (!summary && !tipText) return null;

  return (
    <Box
      marginTop={summary ? 1 : 0}
      width={width}
      flexDirection="column"
    >
      {summary ? <Text color={colors.muted}>{summary}</Text> : null}
      {tipText ? <Text color={colors.muted} dimColor italic>{tipText}</Text> : null}
    </Box>
  );
}

export const IdleTipRow = memo(IdleTipRowComponent);
