/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * `:alias` recipients for the composer. Pure: builds aliases from live runs,
 * teammates, and peer sessions, matches the trigger, ranks suggestions, and
 * parses a leading "send to" form. Every submit path uses the same parser.
 */
import { isAgentRunActive, type AgentRun } from '../core/agents/AgentRunStore.js';
import type { TeamMember } from '../core/teams/types.js';
import type { ActiveAgentRecord } from '../session/ActiveAgentRegistry.js';

export type MessageTargetKind = 'run' | 'teammate' | 'peer';

export interface MessageTarget {
  kind: MessageTargetKind;
  /** Opaque routing identity: run id, teammate name, or peer session id. */
  id: string;
  /** What the user types after `:`; unique across every kind. */
  alias: string;
  label: string;
  detail: string;
  messageable: boolean;
  reason?: string;
}

export interface MessageTargetSuggestion {
  /** Already prefixed with `:` so the composer can replace text directly. */
  alias: string;
  label: string;
  detail: string;
  kind: MessageTargetKind;
  messageable: boolean;
  reason?: string;
}

export interface MessageTargetSources {
  runs?: readonly AgentRun[];
  teammates?: readonly TeamMember[];
  peers?: readonly ActiveAgentRecord[];
}

export const PEER_MESSAGING_UNAVAILABLE = 'Peer sessions cannot receive messages yet; use /peers to inspect them.';
export const MESSAGE_TARGET_SUGGESTION_LIMIT = 8;

/**
 * `:` at the start of the input or after whitespace, followed by an alias
 * that begins with a letter. A backslash before the colon keeps it literal,
 * and times, drive letters, package scripts, and URLs never have whitespace
 * before their colon, so they never match.
 */
const TARGET_MENTION_RE = /(?:^|\s)(:([A-Za-z][A-Za-z0-9._-]*)?)$/;
const LEADING_TARGET_RE = /^:([A-Za-z][A-Za-z0-9._-]*)(?:[ \t]+([\s\S]*))?$/;

export function matchTargetMention(text: string, cursorOffset: number): { seed: string; startIndex: number } | null {
  const beforeCursor = text.slice(0, cursorOffset);
  const match = TARGET_MENTION_RE.exec(beforeCursor);
  if (!match) return null;
  const fullMatch = match[1]!;
  return {
    seed: match[2] ?? '',
    startIndex: match.index + (match[0]!.length - fullMatch.length),
  };
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-');
  return slug || 'agent';
}

function excerpt(value: string | undefined, max = 60): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function runUnavailableReason(run: AgentRun): string | undefined {
  if (!isAgentRunActive(run)) return 'finished';
  if (run.cancelRequested) return 'stopping';
  if (!run.messageable) return 'cannot receive messages';
  return undefined;
}

/**
 * Two runs with the same name get a short id suffix; a name shared across
 * kinds keeps its plain alias for the first kind and a kind suffix after.
 */
function uniqueAliases(targets: Array<Omit<MessageTarget, 'alias'> & { base: string }>): MessageTarget[] {
  const counts = new Map<string, number>();
  for (const target of targets) {
    const key = `${target.kind}:${target.base}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const taken = new Set<string>();
  return targets.map(({ base, ...target }) => {
    let alias = counts.get(`${target.kind}:${base}`)! > 1
      ? `${base}-${target.id.replace(/[^a-z0-9]/gi, '').slice(-4).toLowerCase()}`
      : base;
    while (taken.has(alias)) alias = `${alias}-${target.kind}`;
    taken.add(alias);
    return { ...target, alias };
  });
}

/** Every actor the user could address, in the order the picker shows them. */
export function buildMessageTargets(sources: MessageTargetSources): MessageTarget[] {
  const runs = (sources.runs ?? [])
    .filter((run) => run.source !== 'squad')
    .map((run) => {
      const reason = runUnavailableReason(run);
      return {
        kind: 'run' as const,
        id: run.id,
        base: slugify(run.name),
        label: run.name,
        detail: excerpt([run.agentType, run.task].filter(Boolean).join(' · ')),
        messageable: reason === undefined,
        ...(reason ? { reason } : {}),
      };
    });
  const teammates = (sources.teammates ?? []).map((member) => {
    const reason = member.status === 'shutdown' ? 'shut down' : undefined;
    return {
      kind: 'teammate' as const,
      id: member.name,
      base: slugify(member.name),
      label: member.name,
      detail: excerpt(`teammate · ${member.agentName} · ${member.status}`),
      messageable: reason === undefined,
      ...(reason ? { reason } : {}),
    };
  });
  const peers = (sources.peers ?? []).map((peer) => ({
    kind: 'peer' as const,
    id: peer.sessionId,
    base: `peer-${peer.sessionId.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase()}`,
    label: `Session ${peer.sessionId.slice(0, 8)}`,
    detail: excerpt(`peer session · ${peer.projectName} · ${peer.model}`),
    messageable: false,
    reason: PEER_MESSAGING_UNAVAILABLE,
  }));
  return uniqueAliases([...runs, ...teammates, ...peers]);
}

/** Rank aliases and labels by prefix, then substring; reachable targets first. */
export function buildTargetSuggestions(
  seed: string,
  targets: readonly MessageTarget[],
  limit = MESSAGE_TARGET_SUGGESTION_LIMIT,
): MessageTargetSuggestion[] {
  const query = seed.trim().toLowerCase();
  const scored = targets.flatMap((target) => {
    const alias = target.alias.toLowerCase();
    const label = target.label.toLowerCase();
    const rank = !query ? 0
      : alias.startsWith(query) ? 0
        : label.startsWith(query) ? 1
          : alias.includes(query) || label.includes(query) ? 2
            : -1;
    return rank < 0 ? [] : [{ target, rank: rank + (target.messageable ? 0 : 0.5) }];
  });
  return scored
    .sort((a, b) => a.rank - b.rank || a.target.alias.localeCompare(b.target.alias))
    .slice(0, limit)
    .map(({ target }) => ({
      alias: `:${target.alias}`,
      label: target.label,
      detail: target.detail,
      kind: target.kind,
      messageable: target.messageable,
      ...(target.reason ? { reason: target.reason } : {}),
    }));
}

export interface LeadingTargetMessage {
  target: MessageTarget;
  message: string;
}

/**
 * The direct-send form: the whole input is `:alias message` on one line and
 * the alias names exactly one known target. Anything else is an ordinary
 * prompt, so `:smile:` or a mid-sentence reference never sends.
 */
export function parseLeadingTargetMessage(text: string, targets: readonly MessageTarget[]): LeadingTargetMessage | null {
  const trimmed = text.trim();
  if (trimmed.includes('\n')) return null;
  const match = LEADING_TARGET_RE.exec(trimmed);
  if (!match) return null;
  const alias = match[1]!.toLowerCase();
  const candidates = targets.filter((target) => target.alias.toLowerCase() === alias);
  if (candidates.length !== 1) return null;
  return { target: candidates[0]!, message: (match[2] ?? '').trim() };
}
