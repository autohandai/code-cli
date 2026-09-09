/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import type { SlashCommand } from '../core/slashCommandTypes.js';
import type { PeerAwarenessManager } from '../session/peers/PeerAwarenessManager.js';
import { formatPeerCards } from '../session/peers/PeerFormatter.js';
import type { PeerClient } from '../session/peers/PeerMessaging.js';
import { PeerError, type PeerScope } from '../session/peers/PeerProtocol.js';
import { safePeerLabel } from '../session/peers/PeerScope.js';
import type { PeerComposerDraft } from '../ui/peerMention.js';

export const metadata: SlashCommand = {
  command: '/peers',
  description: 'Discover local peers, send messages, and open your inbox',
  implemented: true,
};

interface PeersCommandContext {
  peerMessaging?: PeerClient;
  onPeerDraft?: (draft: PeerComposerDraft) => void;
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

const PEER_HELP = '/peers [list [workspace|repository|machine]]\n/peers send <peer-id> <message>\n/peers inbox\n/peers reply <message-id> <message>\n/peers status <message-id>\nUse : in the composer to select a peer. Enable with sessions.communication.enabled = true.';

export async function peers(ctx: PeersCommandContext, args: string[] = []): Promise<string | null> {
  const messaging = ctx.peerMessaging;
  if (args[0] === 'help' || args[0] === '--help') return PEER_HELP;
  if (messaging?.policy.enabled || args.length) {
    if (!messaging?.policy.enabled) return 'Local communication is disabled. Set sessions.communication.enabled to true.\n' + PEER_HELP;
    try {
      const operation = args[0] ?? 'list';
      if (operation === 'send' && args[1] && args.slice(2).join(' ').trim()) {
        const receipt = await messaging.send({ to: args[1], content: args.slice(2).join(' ') });
        return `To ${safePeerLabel(args[1])} · ${receipt.state} · ${receipt.messageId}`;
      }
      if (operation === 'reply' && args[1] && args.slice(2).join(' ').trim()) {
        const inbox = await messaging.messages({ consume: false, messageId: args[1] });
        if (inbox.messages.length !== 1) throw new PeerError(inbox.messages.length ? 'AMBIGUOUS_TARGET' : 'UNKNOWN_TARGET', 'Choose one original incoming message from the inbox.');
        const original = inbox.messages[0];
        const receipt = await messaging.send({ to: original.from, content: args.slice(2).join(' '), replyTo: original.messageId });
        return `Reply to :${safePeerLabel(original.senderAlias ?? original.from)} · ${receipt.state} · ${receipt.messageId}`;
      }
      if (operation === 'status' && args.length === 2) return JSON.stringify(await messaging.status(args[1]));
      if (operation === 'inbox' && args.length === 1) {
        if (!canRenderScreen() || !ctx.onPeerDraft) {
          const inbox = await messaging.messages({ consume: false });
          return inbox.messages.length ? inbox.messages.map(message => `From :${safePeerLabel(message.senderAlias ?? message.from)} · ${message.messageId}\n${safePeerLabel(message.content, 8_000)}`).join('\n\n') : 'Peer inbox is empty.';
        }
        await ctx.onBeforeModal?.();
        try {
          const draft = await (await import('../ui/ink/components/PeerInboxScreen.js')).showPeerInboxScreen(messaging);
          if (draft) {
            const scope = messaging.policy.scope;
            await messaging.list({ scope });
            ctx.onPeerDraft({ ...draft, scope });
          }
        }
        finally { await ctx.onAfterModal?.(); }
        return null;
      }
      if (operation === 'list' && args.length <= 2) {
        const scope = args[1] ?? 'workspace';
        if (!['workspace', 'repository', 'machine'].includes(scope)) return PEER_HELP;
        const listed = await messaging.list({ scope: scope as PeerScope });
        const self = `You: :${safePeerLabel(messaging.self.alias)} · ${messaging.self.peerId}`;
        return `${self}\n${listed.peers.length ? listed.peers.map(peer => `:${safePeerLabel(peer.alias)} · ${safePeerLabel(peer.project)} · ${peer.kind} · ${peer.availability}\n  ${peer.peerId}`).join('\n') : `No peers in ${scope} scope.`}`;
      }
      return PEER_HELP;
    } catch (error) { return error instanceof Error ? error.message : String(error); }
  }
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
