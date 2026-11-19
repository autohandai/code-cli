/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import stripAnsi from 'strip-ansi';
import type { ActiveAgentRecord } from './ActiveAgentRegistry.js';
import { sessionActivityAt } from './sessionActivity.js';
import type { SessionMetadata } from './types.js';

export type AgentSessionStatus = 'needs-you' | 'working' | 'ready' | 'inactive';
export type AgentSessionFilter = 'all' | AgentSessionStatus;

export const AGENT_SESSION_FILTERS: readonly AgentSessionFilter[] = ['all', 'needs-you', 'working', 'ready', 'inactive'];

export const AGENT_SESSION_STATUS_LABELS: Record<AgentSessionStatus, string> = {
  'needs-you': 'Needs you', working: 'Working', ready: 'Ready', inactive: 'Inactive',
};

export const AGENT_SESSION_FILTER_LABELS: Record<AgentSessionFilter, string> = { all: 'All', ...AGENT_SESSION_STATUS_LABELS };

export interface AgentSessionEntry {
  sessionId: string;
  title: string;
  projectPath: string;
  projectName: string;
  model: string;
  messageCount: number;
  activeAt: Date;
  status: AgentSessionStatus;
  /** The session this CLI process currently has open. */
  current: boolean;
  /** Whether a saved conversation exists to resume; live-only rows are other processes' unsaved sessions. */
  saved: boolean;
  /** Whether the session's directory is the directory this CLI is working in. */
  inCurrentWorkspace: boolean;
  /** The process that has the session open, when one does. */
  livePid?: number;
  phase?: string;
  instruction?: string;
}

export interface AgentSessionSources {
  sessions: Array<{ session: SessionMetadata; title: string }>;
  live: ActiveAgentRecord[];
  currentSessionId: string | undefined;
  pid: number;
  isCurrentWorkspace: (directory: string) => boolean;
}

export type OverviewLine =
  | { kind: 'group'; projectPath: string; count: number }
  | { kind: 'session'; entry: AgentSessionEntry }
  | { kind: 'more'; remaining: number };

/**
 * Working: a live process with a turn in flight. Needs you: a live process whose heartbeat reports it is
 * waiting for input. Ready: a live process sitting idle. Anything without a live process is inactive.
 */
export function liveSessionStatus(record: Pick<ActiveAgentRecord, 'status' | 'activity'>): Exclude<AgentSessionStatus, 'inactive'> {
  if (record.activity?.phase === 'waiting_input') return 'needs-you';
  return record.status === 'working' ? 'working' : 'ready';
}

function displayText(value: string | undefined): string {
  return stripAnsi(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/gu, ' ').replace(/\s+/gu, ' ').trim();
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function liveRecordFor(records: ActiveAgentRecord[], pid: number): ActiveAgentRecord | undefined {
  return records.find((record) => record.pid === pid)
    ?? [...records].sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt))[0];
}

export function buildAgentSessionEntries(sources: AgentSessionSources): AgentSessionEntry[] {
  const { sessions, live, currentSessionId, pid, isCurrentWorkspace } = sources;
  const liveBySession = new Map<string, ActiveAgentRecord[]>();
  for (const record of live) liveBySession.set(record.sessionId, [...liveBySession.get(record.sessionId) ?? [], record]);

  const entries: AgentSessionEntry[] = [];
  const seen = new Set<string>();
  for (const { session, title } of sessions) {
    if (seen.has(session.sessionId)) continue;
    seen.add(session.sessionId);
    const current = session.sessionId === currentSessionId;
    const record = liveRecordFor(liveBySession.get(session.sessionId) ?? [], pid);
    if (!current && !record && session.messageCount <= 0) continue;
    const ownRecord = current && record?.pid !== pid ? undefined : record;
    const livePid = current ? pid : record?.pid;
    entries.push({
      sessionId: session.sessionId,
      title: displayText(title) || '(no messages)',
      projectPath: session.projectPath,
      projectName: displayText(session.projectName),
      model: displayText(ownRecord?.model ?? session.model),
      messageCount: session.messageCount,
      activeAt: new Date(Math.max(sessionActivityAt(session).getTime(), ownRecord ? timestamp(ownRecord.updatedAt) : 0)),
      status: ownRecord ? liveSessionStatus(ownRecord) : current ? 'ready' : 'inactive',
      current,
      saved: true,
      inCurrentWorkspace: isCurrentWorkspace(session.projectPath),
      ...(livePid !== undefined ? { livePid } : {}),
      ...(ownRecord?.activity ? { phase: ownRecord.activity.phase } : {}),
      ...(displayText(ownRecord?.activity?.instruction) ? { instruction: displayText(ownRecord?.activity?.instruction) } : {}),
    });
  }

  for (const [sessionId, records] of liveBySession) {
    if (seen.has(sessionId)) continue;
    const record = liveRecordFor(records, pid);
    if (!record) continue;
    const instruction = displayText(record.activity?.instruction);
    entries.push({
      sessionId,
      title: instruction || `${displayText(record.projectName) || 'Autohand'} session`,
      projectPath: record.workspaceRoot,
      projectName: displayText(record.projectName),
      model: displayText(record.model),
      messageCount: record.messageCount,
      activeAt: new Date(timestamp(record.updatedAt)),
      status: liveSessionStatus(record),
      current: sessionId === currentSessionId,
      saved: false,
      inCurrentWorkspace: isCurrentWorkspace(record.workspaceRoot),
      livePid: record.pid,
      ...(record.activity ? { phase: record.activity.phase } : {}),
      ...(instruction ? { instruction } : {}),
    });
  }
  return entries;
}

/**
 * A session can have one writer. One that another process has open is shown and can be selected,
 * but opening it here is refused; there is no attach or take-over.
 */
export function openBlocker(entry: AgentSessionEntry, pid: number): string | undefined {
  if (entry.livePid !== undefined && entry.livePid !== pid) {
    return `This session is open in another Autohand process (PID ${entry.livePid}). Switch to that terminal, or close it there first.`;
  }
  if (!entry.saved && !entry.current) return 'This session has no saved conversation to open.';
  return undefined;
}

export function countByFilter(entries: AgentSessionEntry[]): Record<AgentSessionFilter, number> {
  const counts: Record<AgentSessionFilter, number> = { all: entries.length, 'needs-you': 0, working: 0, ready: 0, inactive: 0 };
  for (const entry of entries) counts[entry.status] += 1;
  return counts;
}

export function buildOverviewLines(entries: AgentSessionEntry[], filter: AgentSessionFilter, remaining: number): OverviewLine[] {
  const groups = new Map<string, AgentSessionEntry[]>();
  for (const entry of entries) {
    if (filter !== 'all' && entry.status !== filter) continue;
    groups.set(entry.projectPath, [...groups.get(entry.projectPath) ?? [], entry]);
  }
  const byRecency = (a: AgentSessionEntry, b: AgentSessionEntry) => b.activeAt.getTime() - a.activeAt.getTime() || a.sessionId.localeCompare(b.sessionId);
  const ordered = [...groups.entries()]
    .map(([projectPath, members]) => ({ projectPath, members: members.sort(byRecency) }))
    .sort((a, b) => byRecency(a.members[0]!, b.members[0]!));

  const lines: OverviewLine[] = ordered.flatMap(({ projectPath, members }) => [
    { kind: 'group' as const, projectPath, count: members.length },
    ...members.map((entry) => ({ kind: 'session' as const, entry })),
  ]);
  if (remaining > 0 && (filter === 'all' || filter === 'inactive')) lines.push({ kind: 'more', remaining });
  return lines;
}

/** `~`-relative path that fits `width`, eliding middle segments before the last one. */
export function abbreviatePath(target: string, home: string, width: number): string {
  const relative = home && (target === home || target.startsWith(`${home}/`)) ? `~${target.slice(home.length)}` : target;
  if (relative.length <= width) return relative;
  const segments = relative.split('/');
  const last = segments.at(-1) ?? '';
  const head = segments[0] ?? '';
  const elided = `${head}/…/${last}`;
  if (elided.length <= width) {
    let kept = elided;
    for (let index = segments.length - 2; index > 0; index -= 1) {
      const candidate = `${head}/…/${segments.slice(index).join('/')}`;
      if (candidate.length > width) break;
      kept = candidate;
    }
    return kept;
  }
  return width <= 1 ? '…'.slice(0, Math.max(0, width)) : `…${last.slice(-(width - 1))}`;
}
