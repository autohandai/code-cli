/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { memo } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../theme/ThemeContext.js';
import { truncateAnnouncementLine } from './AnnouncementLine.js';
import type { TipLineState } from './AgentUI.js';

export interface TipLineProps {
  tip: TipLineState | undefined;
  isWorking: boolean;
  columns: number;
}

const PREFIXES: Record<TipLineState['kind'], string> = {
  tip: '⎿  Tip: ',
  upgrade: '⎿  Plan: ',
};

/**
 * One muted row under the status line. A rotating tip only exists while the
 * agent works; an upgrade hint stays until the next turn starts.
 */
function TipLineComponent({ tip, isWorking, columns }: TipLineProps): React.ReactNode {
  const { theme } = useTheme();
  if (!tip || (tip.kind === 'tip' && !isWorking)) {
    return null;
  }
  const content = truncateAnnouncementLine(`${PREFIXES[tip.kind]}${tip.text}`, Math.max(1, columns));
  return (
    <Box height={1}>
      <Text>{theme.fg(tip.kind === 'upgrade' ? 'warning' : 'muted', content)}</Text>
    </Box>
  );
}

export const TipLine = memo(TipLineComponent);
