/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { SquadConnection, type SquadMember } from '../squad/SquadConnection.js';
import { redactSecrets } from '../squad/vendor/control-plane.mjs';

export interface DesktopSquadContext {
  squadConnection: SquadConnection;
  pickMember?: (members: SquadMember[]) => Promise<string | null>;
  onBeforeModal?: () => Promise<void> | void;
  onAfterModal?: () => Promise<void> | void;
  isNonInteractive?: boolean;
}

const HELP = '/squad agents\n/squad select [agent-id|name]\n/squad message <agent-id> <text>\n/squad history [agent-id]\n/squad queue [agent-id]\n/squad clear\n/squad app\n/message <text> (selected Squad agent)\n/message squad <agent-id> <text>\n/message team <name> <text> (local CLI team)';

export async function runDesktopSquadCommand(ctx: DesktopSquadContext, args: string[]): Promise<string> {
  const [action = 'select', ...rest] = args;
  const connection = ctx.squadConnection;
  if (action === 'help') return HELP;
  if (action === 'message') {
    const { sendSquadMessage } = await import('./message.js');
    return sendSquadMessage(connection, ['squad', ...rest]);
  }
  if (action === 'clear') { connection.clearSelection(); return 'Squad recipient cleared. /message now uses your local CLI team.'; }
  if (action === 'agents') {
    const members = await connection.listMembers();
    return members.length ? members.map(member => `${member.id === connection.selectedMemberId ? '› ' : '  '}${member.name || member.id} · ${member.id} · ${member.presence}${member.role ? ` · ${member.role}` : ''}`).join('\n') : 'No agents found. Create an agent in Autohand Squad first.';
  }
  if (action === 'history') {
    const data = await connection.history(rest[0]);
    return data.messages.map(message => `${message.role}: ${redactSecrets(message.body)}`).join('\n') || 'No direct messages yet.';
  }
  if (action === 'queue') return redactSecrets(JSON.stringify(await connection.queue(rest[0]), null, 2));
  if (action !== 'select') return HELP;
  let target = rest.join(' ');
  if (!target) {
    const members = await connection.listMembers();
    if (!members.length) return 'No agents found. Create an agent in Autohand Squad first.';
    if (ctx.isNonInteractive || (!ctx.pickMember && (!process.stdin.isTTY || !process.stdout.isTTY))) return `Choose an agent with /squad select <agent-id>.\n${await runDesktopSquadCommand(ctx, ['agents'])}`;
    await ctx.onBeforeModal?.();
    try {
      if (ctx.pickMember) target = await ctx.pickMember(members) || '';
      else {
        const { showModal } = await import('../ui/ink/components/Modal.js');
        const choice = await showModal({ title: 'Select a Squad agent', filterable: true, options: members.map(member => ({ label: member.name || member.id, value: member.id, description: `${member.presence} · ${member.role || member.id}` })) });
        target = choice?.value || '';
      }
    } finally { await ctx.onAfterModal?.(); }
    if (!target) return 'Squad selection cancelled.';
  }
  const member = await connection.select(target);
  return `Selected Squad agent ${member.name || member.id} (${member.id}).\n/message <text> sends to this agent. Use /message team <name> <text> for a local teammate, or /squad clear to clear the selection.`;
}
