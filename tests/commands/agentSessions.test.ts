/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import os from 'node:os';
import path from 'node:path';
import fse from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentSessions, type AgentSessionCenterContext, type AgentSessionCenterDeps } from '../../src/commands/agentSessions.js';
import type { ActiveAgentRecord } from '../../src/session/ActiveAgentRegistry.js';
import type { SessionManager } from '../../src/session/SessionManager.js';
import type { SessionMetadata } from '../../src/session/types.js';
import type { LoadedConfig } from '../../src/types.js';
import type { AgentSessionChoice, AgentSessionsSnapshot, ShowAgentSessionsScreenOptions } from '../../src/ui/ink/components/AgentSessionsScreen.js';
import { SlashCommandHandler } from '../../src/core/slashCommandHandler.js';
import { SLASH_COMMANDS } from '../../src/core/slashCommands.js';
import type { SlashCommandContext } from '../../src/core/slashCommandTypes.js';

let root: string;
let here: string;
let elsewhere: string;

beforeEach(async () => {
  root = await fse.realpath(await fse.mkdtemp(path.join(os.tmpdir(), 'agent-sessions-')));
  here = path.join(root, 'here');
  elsewhere = path.join(root, 'elsewhere');
  await fse.ensureDir(here);
  await fse.ensureDir(elsewhere);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(async () => { vi.restoreAllMocks(); await fse.remove(root); });

function meta(sessionId: string, projectPath: string, overrides: Partial<SessionMetadata> = {}): SessionMetadata {
  return {
    sessionId, createdAt: '2026-03-01T10:00:00.000Z', lastActiveAt: '2026-03-01T11:00:00.000Z', projectPath,
    projectName: path.basename(projectPath), model: 'fantail', messageCount: 3, status: 'completed', title: `Title ${sessionId}`, ...overrides,
  };
}

function setup(options: {
  sessions?: SessionMetadata[];
  live?: ActiveAgentRecord[];
  config?: LoadedConfig;
  switchWorkspace?: AgentSessionCenterContext['switchWorkspace'] | null;
  choose?: (snapshot: AgentSessionsSnapshot, screen: ShowAgentSessionsScreenOptions) => AgentSessionChoice | null;
} = {}) {
  const sessions = options.sessions ?? [meta('current', here), meta('local', here), meta('remote', elsewhere)];
  const events: string[] = [];
  const listRecentSessions = vi.fn(async (_filter: unknown, limit = 20, offset = 0) => ({ sessions: sessions.slice(offset, offset + limit), total: sessions.length }));
  const sessionManager = { listRecentSessions, getCurrentSession: () => ({ metadata: { sessionId: 'current' } }) } as unknown as SessionManager;
  const snapshots: AgentSessionsSnapshot[] = [];
  const screens: ShowAgentSessionsScreenOptions[] = [];
  const showScreen = vi.fn(async (screen: ShowAgentSessionsScreenOptions) => {
    events.push('screen');
    screens.push(screen);
    const snapshot = await screen.load(30);
    snapshots.push(snapshot);
    return options.choose ? options.choose(snapshot, screen) : null;
  });
  const switchWorkspace = options.switchWorkspace === null ? undefined
    : options.switchWorkspace ?? vi.fn(async (directory: string) => { events.push(`switch:${directory}`); });
  const resumeSession = vi.fn(async (input: { args: string[] }) => { events.push(`resume:${input.args[0]}`); return null; });
  const persistConfig = vi.fn(async () => { events.push('persist'); });
  const ctx: AgentSessionCenterContext = {
    sessionManager, workspaceRoot: here, config: options.config,
    onBeforeModal: vi.fn(() => { events.push('before'); }), onAfterModal: vi.fn(() => { events.push('after'); }),
    restoreSession: vi.fn(), restoreLoadedSession: vi.fn(), switchWorkspace,
  };
  const deps: AgentSessionCenterDeps = {
    registry: { listActive: async () => options.live ?? [] }, showScreen, resumeSession: resumeSession as unknown as AgentSessionCenterDeps['resumeSession'],
    persistConfig, pid: 100, home: root,
  };
  return { ctx, deps, events, snapshots, screens, listRecentSessions, resumeSession, persistConfig, switchWorkspace, run: () => agentSessions(ctx, deps) };
}

const liveRecord = (sessionId: string, overrides: Partial<ActiveAgentRecord> = {}): ActiveAgentRecord => ({
  version: 1, pid: 900, sessionId, workspaceRoot: elsewhere, projectName: 'elsewhere', provider: 'autohandai', model: 'fantail',
  mode: 'interactive', status: 'working', startedAt: '2026-03-01T10:00:00.000Z', updatedAt: '2026-03-01T11:59:00.000Z',
  messageCount: 3, contextPercent: 10, tokensUsed: 10, ...overrides,
});

describe('agent session command center', () => {
  it('lists saved sessions from every project joined with live heartbeats', async () => {
    const center = setup({ live: [liveRecord('remote')] });
    await center.run();

    expect(center.listRecentSessions).toHaveBeenCalledWith(undefined, 30, 0);
    const byId = Object.fromEntries(center.snapshots[0]!.entries.map((entry) => [entry.sessionId, entry]));
    expect(byId.current).toMatchObject({ current: true, status: 'ready', inCurrentWorkspace: true, title: 'Title current' });
    expect(byId.local).toMatchObject({ status: 'inactive', inCurrentWorkspace: true });
    expect(byId.remote).toMatchObject({ status: 'working', livePid: 900, inCurrentWorkspace: false });
    expect(center.snapshots[0]!.remaining).toBe(0);
    expect(center.screens[0]).toMatchObject({ currentWorkspace: here, pid: 100, directoryPreference: 'ask' });
  });

  it('reports how many older sessions are not loaded yet', async () => {
    const center = setup({ sessions: Array.from({ length: 45 }, (_, index) => meta(`s${index}`, here)) });
    await center.run();
    expect(center.snapshots[0]!.entries).toHaveLength(30);
    expect(center.snapshots[0]!.remaining).toBe(15);
  });

  it('still lists saved sessions when the live registry cannot be read', async () => {
    const center = setup();
    center.deps.registry = { listActive: async () => { throw new Error('registry locked'); } };
    await center.run();
    expect(center.snapshots[0]!.entries.map((entry) => entry.status)).toEqual(['ready', 'inactive', 'inactive']);
  });

  it('leaves the current session untouched when the screen is dismissed', async () => {
    const center = setup();
    expect(await center.run()).toBeNull();
    expect(center.events).toEqual(['before', 'screen', 'after']);
    expect(center.resumeSession).not.toHaveBeenCalled();
  });

  it('restores the renderer even when the screen throws', async () => {
    const center = setup();
    center.deps.showScreen = async () => { throw new Error('render failed'); };
    await expect(center.run()).rejects.toThrow('render failed');
    expect(center.events).toEqual(['before', 'after']);
  });

  it('resumes the chosen session through the /resume path after the screen has closed', async () => {
    const center = setup({ choose: () => ({ sessionId: 'local', projectPath: here, directory: 'current' }) });
    await center.run();
    expect(center.events).toEqual(['before', 'screen', 'after', 'resume:local']);
    expect(center.resumeSession).toHaveBeenCalledWith({
      sessionManager: center.ctx.sessionManager, args: ['local'],
      restoreSession: center.ctx.restoreSession, restoreLoadedSession: center.ctx.restoreLoadedSession,
    });
    expect(center.switchWorkspace).not.toHaveBeenCalled();
  });

  it('moves to the session directory before resuming when asked to', async () => {
    const center = setup({ choose: () => ({ sessionId: 'remote', projectPath: elsewhere, directory: 'session' }) });
    await center.run();
    expect(center.events).toEqual(['before', 'screen', 'after', `switch:${elsewhere}`, 'resume:remote']);
  });

  it('stays in the current directory when asked to', async () => {
    const center = setup({ choose: () => ({ sessionId: 'remote', projectPath: elsewhere, directory: 'current' }) });
    await center.run();
    expect(center.events).toEqual(['before', 'screen', 'after', 'resume:remote']);
  });

  it('stays put and says so when the session directory no longer exists', async () => {
    const gone = path.join(root, 'gone');
    const center = setup({ sessions: [meta('current', here), meta('orphan', gone)], choose: () => ({ sessionId: 'orphan', projectPath: gone, directory: 'session' }) });
    await center.run();
    expect(center.switchWorkspace).not.toHaveBeenCalled();
    expect(center.events.at(-1)).toBe('resume:orphan');
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain('no longer exists');
  });

  it('treats a symlinked path to the current directory as the current directory', async () => {
    const link = path.join(root, 'link');
    await fse.symlink(here, link);
    const center = setup({ sessions: [meta('current', here), meta('linked', link)], choose: () => ({ sessionId: 'linked', projectPath: link, directory: 'session' }) });
    await center.run();
    expect(center.snapshots[0]!.entries.find((entry) => entry.sessionId === 'linked')?.inCurrentWorkspace).toBe(true);
    expect(center.switchWorkspace).not.toHaveBeenCalled();
  });

  it('never offers a directory change when the host cannot switch directories', async () => {
    const center = setup({ switchWorkspace: null, choose: () => ({ sessionId: 'remote', projectPath: elsewhere, directory: 'session' }) });
    await center.run();
    expect(center.snapshots[0]!.entries.every((entry) => entry.inCurrentWorkspace)).toBe(true);
    expect(center.events.at(-1)).toBe('resume:remote');
  });

  it.each(['session', 'current'] as const)('persists an "always %s" choice and passes the saved preference to the next screen', async (remember) => {
    const config: LoadedConfig = { ui: { theme: 'dark' } } as LoadedConfig;
    const center = setup({ config, choose: () => ({ sessionId: 'remote', projectPath: elsewhere, directory: remember, remember }) });
    await center.run();
    expect(config.ui).toMatchObject({ theme: 'dark', resumeDirectory: remember });
    expect(center.persistConfig).toHaveBeenCalledWith(config);
    expect(center.events.indexOf('persist')).toBeLessThan(center.events.indexOf('resume:remote'));

    await center.run();
    expect(center.screens[1]?.directoryPreference).toBe(remember);
  });

  it('still switches when saving the preference fails', async () => {
    const center = setup({ config: {} as LoadedConfig, choose: () => ({ sessionId: 'remote', projectPath: elsewhere, directory: 'session', remember: 'session' }) });
    center.deps.persistConfig = async () => { throw new Error('read-only config'); };
    await center.run();
    expect(center.events.slice(-2)).toEqual([`switch:${elsewhere}`, 'resume:remote']);
  });

  it('reads each session title once across refreshes', async () => {
    const center = setup({ choose: (_snapshot, screen) => { void screen; return null; } });
    const untitled = meta('untitled', here, { title: undefined, summary: 'Summary title' });
    center.listRecentSessions.mockImplementation(async () => ({ sessions: [untitled], total: 1 }));
    center.deps.showScreen = async (screen) => {
      const first = await screen.load(30);
      untitled.summary = 'Changed on disk';
      const second = await screen.load(30);
      expect(first.entries[0]?.title).toBe('Summary title');
      expect(second.entries[0]?.title).toBe('Summary title');
      return null;
    };
    await center.run();
  });
});

describe('/agents slash dispatch', () => {
  const tty = (value: boolean) => {
    const stdin = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    const stdout = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true });
    return () => {
      if (stdin) Object.defineProperty(process.stdin, 'isTTY', stdin); else delete (process.stdin as { isTTY?: boolean }).isTTY;
      if (stdout) Object.defineProperty(process.stdout, 'isTTY', stdout); else delete (process.stdout as { isTTY?: boolean }).isTTY;
    };
  };

  function handlerWith(overrides: Partial<SlashCommandContext> = {}) {
    const listRecentSessions = vi.fn(async () => ({ sessions: [], total: 0 }));
    const onBeforeModal = vi.fn();
    const ctx = {
      config: {}, workspaceRoot: here, onBeforeModal, onAfterModal: vi.fn(),
      sessionManager: { listRecentSessions, getCurrentSession: () => null }, ...overrides,
    } as unknown as SlashCommandContext;
    return { handler: new SlashCommandHandler(ctx, SLASH_COMMANDS), listRecentSessions, onBeforeModal };
  }

  it('keeps the heartbeat snapshot for bare /agents outside an interactive terminal', async () => {
    const restore = tty(false);
    try {
      const { handler, listRecentSessions } = handlerWith();
      await handler.handle('/agents', []);
      expect(listRecentSessions).not.toHaveBeenCalled();
    } finally { restore(); }
  });

  it('keeps /agents --once and non-interactive hosts on the heartbeat snapshot in a terminal', async () => {
    const restore = tty(true);
    try {
      const once = handlerWith();
      await once.handler.handle('/agents', ['--once']);
      expect(once.listRecentSessions).not.toHaveBeenCalled();
      const rpc = handlerWith({ isNonInteractive: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
      await rpc.handler.handle('/agents', []);
      expect(rpc.listRecentSessions).not.toHaveBeenCalled();
    } finally { restore(); }
  });
});
