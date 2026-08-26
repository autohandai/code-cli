/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Full-screen, scrollable view of the peers active in this workspace.
 *
 * Peer cards run to roughly fifteen lines each, so printing them into the
 * session log leaves anything past the viewport unreachable. This owns the
 * alternate screen instead, where it can scroll independently of the log.
 */
import React, { useMemo, useState } from 'react';
import { Box, Text, useInput, useStdout, render } from 'ink';

import { useTheme, ThemeProvider } from '../../theme/ThemeContext.js';
import { I18nProvider } from '../../i18n/index.js';
import { formatPeerCards } from '../../../session/peers/PeerFormatter.js';
import type { ActiveAgentRecord } from '../../../session/ActiveAgentRegistry.js';
import {
  applyPeersScroll,
  formatScrollPosition,
  windowPeerLines,
} from '../peersScreenModel.js';
import { cleanupModalRender, prepareModalRender } from './Modal.js';

/** Rows reserved for the header rule, title, footer rule and hint. */
const CHROME_ROWS = 5;
const MIN_BODY_ROWS = 3;
const FALLBACK_TERMINAL_ROWS = 24;

export interface PeersScreenProps {
  peers: ActiveAgentRecord[];
  onClose: () => void;
  /** Overrides the terminal height in tests. */
  rows?: number;
}

export function PeersScreen({ peers, onClose, rows }: PeersScreenProps) {
  const { colors } = useTheme();
  const { stdout } = useStdout();
  const [offset, setOffset] = useState(0);

  const lines = useMemo(() => formatPeerCards(peers).split('\n'), [peers]);

  const bodyHeight = Math.max(
    MIN_BODY_ROWS,
    (rows ?? stdout?.rows ?? FALLBACK_TERMINAL_ROWS) - CHROME_ROWS,
  );

  const view = useMemo(
    () => windowPeerLines(lines, offset, bodyHeight),
    [lines, offset, bodyHeight],
  );

  useInput((input, key) => {
    if (key.escape || input === 'q' || (key.ctrl && input === 'c')) {
      onClose();
      return;
    }

    const action =
      key.upArrow || input === 'k' ? 'up'
      : key.downArrow || input === 'j' ? 'down'
      : key.pageUp ? 'pageUp'
      : key.pageDown ? 'pageDown'
      : input === 'g' ? 'top'
      : input === 'G' ? 'bottom'
      : null;

    if (action) {
      setOffset((current) => applyPeersScroll(action, current, lines.length, bodyHeight));
    }
  });

  const peerCount = peers.length;
  const heading = peerCount === 1 ? '1 peer' : `${peerCount} peers`;
  const position = formatScrollPosition(view);

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color={colors.accent}>{' Peers '}</Text>
        <Text color={colors.muted}>{heading}</Text>
        {position ? <Text color={colors.muted}>{`  ·  ${position}`}</Text> : null}
      </Box>
      <Text color={colors.borderMuted}>{'─'.repeat(40)}</Text>

      {/* Exactly bodyHeight rows on every frame, so the frame never changes
          size and the alternate screen has nothing to flicker. */}
      {view.lines.map((line, index) => (
        <Text key={index} wrap="truncate">{line || ' '}</Text>
      ))}

      <Text color={colors.borderMuted}>{'─'.repeat(40)}</Text>
      <Text color={colors.muted}>
        {view.scrollable
          ? ' ↑↓ scroll · PgUp/PgDn page · g/G top/bottom · q close'
          : ' q close'}
      </Text>
    </Box>
  );
}

/**
 * Renders the screen on the alternate buffer and resolves once it is dismissed.
 * Callers must wrap this in the slash context's onBeforeModal/onAfterModal so
 * the main Ink app releases stdin first.
 */
export async function showPeersScreen(
  peers: ActiveAgentRecord[],
  output: NodeJS.WriteStream = process.stdout,
): Promise<void> {
  prepareModalRender(output);

  try {
    await new Promise<void>((resolve) => {
      let settled = false;
      const instance = render(
        <I18nProvider>
          <ThemeProvider>
            <PeersScreen
              peers={peers}
              onClose={() => {
                if (settled) return;
                settled = true;
                instance.unmount();
              }}
            />
          </ThemeProvider>
        </I18nProvider>,
        { exitOnCtrlC: false },
      );

      void instance.waitUntilExit().then(() => resolve());
    });
  } finally {
    cleanupModalRender(output);
  }
}
