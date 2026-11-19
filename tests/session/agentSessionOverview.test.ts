/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  abbreviatePath, buildAgentSessionEntries, buildOverviewLines, countByFilter, liveSessionStatus, openBlocker,
  type AgentSessionEntry,
} from '../../src/session/agentSessionOverview.js';
import type { ActiveAgentRecord } from '../../src/session/ActiveAgentRegistry.js';
import type { SessionMetadata } from '../../src/session/types.js';

const NOW = Date.parse('2026-03-01T12:00:00.000Z');

function saved(sessionId: string, overrides: Partial<SessionMetadata> = {}): { session: SessionMetadata; title: string } {
  return {
    title: overrides.title ?? `Title of ${sessionId}`,
    session: {
      sessionId, createdAt: new Date(NOW - 3_600_000).toISOString(), lastActiveAt: new Date(NOW - 600_000).toISOString(),
      projectPath: '/work/alpha', projectName: 'alpha', model: 'fantail', messageCount: 4, status: 'completed', ...overrides,
    },
  };
}

function live(sessionId: string, overrides: Partial<ActiveAgentRecord> = {}): ActiveAgentRecord {
  return {
    version: 1, pid: 500, sessionId, workspaceRoot: '/work/alpha', projectName: 'alpha', provider: 'autohandai', model: 'fantail',
    mode: 'interactive', status: 'idle', startedAt: new Date(NOW - 3_600_000).toISOString(), updatedAt: new Date(NOW - 2_000).toISOString(),
    messageCount: 4, contextPercent: 10, tokensUsed: 100, ...overrides,
  };
}

function build(input: Partial<Parameters<typeof buildAgentSessionEntries>[0]> = {}): AgentSessionEntry[] {
  return buildAgentSessionEntries({
    sessions: [], live: [], currentSessionId: undefined, pid: 100, isCurrentWorkspace: (dir) => dir === '/work/alpha', ...input,
  });
}

describe('agent session status', () => {
  it.each([
    [{ status: 'working' as const, activity: { phase: 'waiting_input' as const, pathsWritten: [] } }, 'needs-you'],
    [{ status: 'idle' as const, activity: { phase: 'waiting_input' as const, pathsWritten: [] } }, 'needs-you'],
    [{ status: 'working' as const, activity: { phase: 'thinking' as const, pathsWritten: [] } }, 'working'],
    [{ status: 'working' as const }, 'working'],
    [{ status: 'idle' as const, activity: { phase: 'idle' as const, pathsWritten: [] } }, 'ready'],
    [{ status: 'idle' as const }, 'ready'],
  ])('maps a live heartbeat %j to %s', (record, expected) => {
    expect(liveSessionStatus(record)).toBe(expected);
  });

  it('marks saved sessions without a live process inactive and joins live heartbeats by session id', () => {
    const entries = build({
      sessions: [saved('a'), saved('b'), saved('c'), saved('d')],
      live: [
        live('b'), live('c', { status: 'working', pid: 501 }),
        live('d', { pid: 502, activity: { phase: 'waiting_input', instruction: 'Deploy?', pathsWritten: [] } }),
      ],
    });
    expect(Object.fromEntries(entries.map((entry) => [entry.sessionId, entry.status]))).toEqual({
      a: 'inactive', b: 'ready', c: 'working', d: 'needs-you',
    });
    expect(entries.find((entry) => entry.sessionId === 'a')?.livePid).toBeUndefined();
    expect(entries.find((entry) => entry.sessionId === 'c')?.livePid).toBe(501);
    expect(countByFilter(entries)).toEqual({ all: 4, 'needs-you': 1, working: 1, ready: 1, inactive: 1 });
  });

  it('treats the session this process has open as ready and current even before its first heartbeat', () => {
    const [entry] = build({ sessions: [saved('mine', { messageCount: 0 })], currentSessionId: 'mine' });
    expect(entry).toMatchObject({ sessionId: 'mine', current: true, status: 'ready', livePid: 100 });
  });

  it('prefers this process over another process that publishes the same session', () => {
    const [entry] = build({ sessions: [saved('shared')], currentSessionId: 'shared', live: [live('shared', { pid: 900, status: 'working' }), live('shared', { pid: 100 })] });
    expect(entry).toMatchObject({ livePid: 100, status: 'ready', current: true });
  });

  it('hides empty saved sessions but keeps live sessions that have no saved record', () => {
    const entries = build({
      sessions: [saved('empty', { messageCount: 0 }), saved('kept')],
      live: [live('unsaved', { pid: 700, workspaceRoot: '/work/beta', projectName: 'beta', activity: { phase: 'thinking', instruction: 'Port the parser', pathsWritten: [] } })],
    });
    expect(entries.map((entry) => entry.sessionId).sort()).toEqual(['kept', 'unsaved']);
    expect(entries.find((entry) => entry.sessionId === 'unsaved')).toMatchObject({
      title: 'Port the parser', projectPath: '/work/beta', saved: false, inCurrentWorkspace: false, livePid: 700,
    });
  });

  it('uses the freshest of the saved activity time and the heartbeat, and survives unparseable timestamps', () => {
    const entries = build({
      sessions: [saved('fresh'), saved('broken', { lastActiveAt: 'nope', createdAt: 'nope' })],
      live: [live('fresh')],
    });
    expect(entries.find((entry) => entry.sessionId === 'fresh')?.activeAt.getTime()).toBe(NOW - 2_000);
    expect(entries.find((entry) => entry.sessionId === 'broken')?.activeAt.getTime()).toBe(0);
  });

  it('strips terminal control sequences from titles read off disk', () => {
    const [entry] = build({ sessions: [saved('x', { title: 'Fix\u001b[2J login\n flow' })] });
    expect(entry?.title).toBe('Fix login flow');
  });
});

describe('agent session open rule', () => {
  const entry = (overrides: Partial<AgentSessionEntry>) => ({ ...build({ sessions: [saved('s')] })[0]!, ...overrides });

  it('allows opening an inactive saved session', () => {
    expect(openBlocker(entry({}), 100)).toBeUndefined();
  });
  it('refuses a session that is open in another process and names it', () => {
    expect(openBlocker(entry({ livePid: 4242, status: 'working' }), 100)).toContain('PID 4242');
  });
  it('does not block the session this process already has open', () => {
    expect(openBlocker(entry({ livePid: 100, current: true, status: 'ready' }), 100)).toBeUndefined();
  });
});

describe('agent session overview lines', () => {
  const entries = () => build({
    sessions: [
      saved('a1', { lastActiveAt: new Date(NOW - 3 * 3_600_000).toISOString() }),
      saved('a2', { lastActiveAt: new Date(NOW - 60_000).toISOString() }),
      saved('b1', { projectPath: '/work/beta', projectName: 'beta', lastActiveAt: new Date(NOW - 30_000).toISOString() }),
    ],
    live: [live('b1', { pid: 600, workspaceRoot: '/work/beta', status: 'working' })],
  });

  const shape = (lines: ReturnType<typeof buildOverviewLines>) => lines.map((line) =>
    line.kind === 'group' ? `${line.projectPath} ${line.count}` : line.kind === 'session' ? line.entry.sessionId : `more ${line.remaining}`);

  it('groups sessions by directory, most recently active group and session first', () => {
    expect(shape(buildOverviewLines(entries(), 'all', 0))).toEqual(['/work/beta 1', 'b1', '/work/alpha 2', 'a2', 'a1']);
  });
  it('filters by status and drops groups that end up empty', () => {
    expect(shape(buildOverviewLines(entries(), 'working', 0))).toEqual(['/work/beta 1', 'b1']);
    expect(shape(buildOverviewLines(entries(), 'inactive', 0))).toEqual(['/work/alpha 2', 'a2', 'a1']);
    expect(buildOverviewLines(entries(), 'needs-you', 0)).toEqual([]);
  });
  it('offers older saved sessions only where they can appear', () => {
    expect(shape(buildOverviewLines(entries(), 'all', 7)).at(-1)).toBe('more 7');
    expect(shape(buildOverviewLines(entries(), 'inactive', 7)).at(-1)).toBe('more 7');
    expect(shape(buildOverviewLines(entries(), 'working', 7))).not.toContain('more 7');
    expect(shape(buildOverviewLines([], 'all', 7))).toEqual(['more 7']);
  });
});

describe('abbreviatePath', () => {
  it('replaces the home directory and keeps short paths whole', () => {
    expect(abbreviatePath('/Users/me/code/app', '/Users/me', 40)).toBe('~/code/app');
    expect(abbreviatePath('/Users/me', '/Users/me', 40)).toBe('~');
    expect(abbreviatePath('/Users/merlin/app', '/Users/me', 40)).toBe('/Users/merlin/app');
  });
  it('elides the middle of a long path and keeps the last segment', () => {
    const short = abbreviatePath('/Users/me/Documents/projects/clients/acme/workspace', '/Users/me', 22);
    expect(short.length).toBeLessThanOrEqual(22);
    expect(short.startsWith('~/')).toBe(true);
    expect(short.endsWith('/workspace')).toBe(true);
    expect(short).toContain('…');
  });
  it('never exceeds a width smaller than the last segment', () => {
    expect(abbreviatePath('/a/very-long-directory-name', '/home/x', 8).length).toBeLessThanOrEqual(8);
  });
});
