/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  buildMessageTargets,
  parseLeadingTargetMessage,
  type MessageTarget,
} from '../../ui/messageTargets.js';
import type { AgentRun, AgentRunsSnapshot } from '../agents/AgentRunStore.js';
import type { TeamMember } from '../teams/types.js';
import type { ActiveAgentRecord } from '../../session/ActiveAgentRegistry.js';

export interface MessageTargetHost {
  agentRunStore?: { getSnapshot(): AgentRunsSnapshot | { runs: AgentRun[] }; sendMessage(id: string, message: string): Promise<boolean> } | null;
  teamManager?: { getTeam(): { members: TeamMember[] } | null; sendMessageTo(to: string, from: string, content: string): void } | null;
  peerAwareness?: { getPeers(): ActiveAgentRecord[] } | null;
}

export interface TargetMessageDelivery {
  ok: boolean;
  target: MessageTarget;
  receipt: string;
}

export function listAgentMessageTargets(host: MessageTargetHost): MessageTarget[] {
  return buildMessageTargets({
    runs: host.agentRunStore?.getSnapshot().runs ?? [],
    teammates: host.teamManager?.getTeam()?.members ?? [],
    peers: host.peerAwareness?.getPeers() ?? [],
  });
}

/**
 * Delivers a `:alias message` line to its recipient without involving the
 * model. Returns null when the text is not a direct send, so callers fall
 * through to their normal handling.
 */
export async function deliverAgentTargetMessage(host: MessageTargetHost, text: string): Promise<TargetMessageDelivery | null> {
  const parsed = parseLeadingTargetMessage(text, listAgentMessageTargets(host));
  if (!parsed) return null;
  const { target, message } = parsed;
  if (!target.messageable) {
    return { ok: false, target, receipt: `${target.label} cannot receive messages: ${target.reason ?? 'unavailable'}` };
  }
  if (!message) {
    return { ok: false, target, receipt: `Add the message after :${target.alias}.` };
  }
  if (target.kind === 'run') {
    const queued = await host.agentRunStore?.sendMessage(target.id, message);
    return queued
      ? { ok: true, target, receipt: `Message queued for ${target.label}; it is read on the next model request.` }
      : { ok: false, target, receipt: `${target.label} could not take the message; it may have finished.` };
  }
  if (target.kind === 'teammate') {
    try {
      host.teamManager?.sendMessageTo(target.id, 'lead', message);
      return { ok: true, target, receipt: `Message sent to teammate ${target.label}.` };
    } catch (error) {
      return { ok: false, target, receipt: error instanceof Error ? error.message : String(error) };
    }
  }
  return { ok: false, target, receipt: target.reason ?? 'unavailable' };
}
