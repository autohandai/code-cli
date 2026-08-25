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
}

export async function peers(ctx: PeersCommandContext): Promise<string | null> {
  if (!ctx.peerAwareness) {
    return chalk.yellow('Peer awareness not available.');
  }

  const peers = ctx.peerAwareness.getPeers();
  return formatPeerCards(peers);
}
