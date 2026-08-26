/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import type { SlashCommand } from '../core/slashCommandTypes.js';
import type { PeerAwarenessManager } from '../session/peers/PeerAwarenessManager.js';
import { formatPeerCards } from '../session/peers/PeerFormatter.js';

export const metadata: SlashCommand = {
  command: '/peers',
  description: 'Show active peer sessions in this workspace',
  implemented: true,
};

interface PeersCommandContext {
  peerAwareness?: PeerAwarenessManager;
  onBeforeModal?: () => Promise<void> | void;
  onAfterModal?: () => Promise<void> | void;
}

/**
 * A peer card runs to roughly fifteen lines, so several peers overflow the
 * viewport. Printing that into the session log leaves the top unreachable,
 * hence the scrollable screen when there is a terminal to draw on.
 */
function canRenderScreen(): boolean {
  return Boolean(process.stdout.isTTY && process.stdin.isTTY);
}

export async function peers(ctx: PeersCommandContext): Promise<string | null> {
  if (!ctx.peerAwareness) {
    return chalk.yellow('Peer awareness not available.');
  }

  const activePeers = ctx.peerAwareness.getPeers();

  // An empty state is one line. Taking over the screen to say "nothing here"
  // costs the reader a keystroke and tells them less than the line does.
  if (activePeers.length === 0 || !canRenderScreen()) {
    return formatPeerCards(activePeers);
  }

  const { showPeersScreen } = await import('../ui/ink/components/PeersScreen.js');

  await ctx.onBeforeModal?.();
  try {
    await showPeersScreen(activePeers);
  } finally {
    await ctx.onAfterModal?.();
  }

  return null;
}
