/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import fse from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { saveConfig } from '../config.js';
import { ActiveAgentRegistry, type ActiveAgentRecord } from '../session/ActiveAgentRegistry.js';
import { buildAgentSessionEntries } from '../session/agentSessionOverview.js';
import type { Session, SessionManager } from '../session/SessionManager.js';
import type { LoadedConfig } from '../types.js';
import type { AgentSessionChoice, AgentSessionsSnapshot, ResumeDirectoryPreference, ShowAgentSessionsScreenOptions } from '../ui/ink/components/AgentSessionsScreen.js';
import { readFirstUserMessage, resolveSessionTitle, resume } from './resume.js';

export interface AgentSessionCenterContext {
  sessionManager: SessionManager;
  workspaceRoot: string;
  config?: LoadedConfig;
  onBeforeModal?: () => Promise<void> | void;
  onAfterModal?: () => Promise<void> | void;
  restoreSession?: (sessionId: string) => Promise<void>;
  restoreLoadedSession?: (session: Session) => Promise<void>;
  /** Move this CLI's working directory; without it sessions always open in the current directory. */
  switchWorkspace?: (workspaceRoot: string) => Promise<void>;
}

export interface AgentSessionCenterDeps {
  registry?: Pick<ActiveAgentRegistry, 'listActive'>;
  showScreen?: (options: ShowAgentSessionsScreenOptions) => Promise<AgentSessionChoice | null>;
  resumeSession?: typeof resume;
  persistConfig?: (config: LoadedConfig) => Promise<void>;
  directoryExists?: (directory: string) => Promise<boolean>;
  pid?: number;
  home?: string;
}

async function canonical(directory: string): Promise<string> {
  return fse.realpath(directory).catch(() => path.resolve(directory));
}

async function isDirectory(directory: string): Promise<boolean> {
  return fse.stat(directory).then((stats) => stats.isDirectory(), () => false);
}

/**
 * The session command center behind bare `/agents`: every saved session joined with the live
 * heartbeats, and Enter switches this CLI to the chosen one through the same path as `/resume`.
 */
export async function agentSessions(ctx: AgentSessionCenterContext, deps: AgentSessionCenterDeps = {}): Promise<string | null> {
  const registry = deps.registry ?? new ActiveAgentRegistry();
  const pid = deps.pid ?? process.pid;
  const currentWorkspace = await canonical(ctx.workspaceRoot);
  const canSwitch = Boolean(ctx.switchWorkspace);
  const titles = new Map<string, string>();
  const directories = new Map<string, string>();
  const canonicalOnce = async (directory: string) => {
    if (!directories.has(directory)) directories.set(directory, await canonical(directory));
    return directories.get(directory)!;
  };

  const load = async (limit: number): Promise<AgentSessionsSnapshot> => {
    const [{ sessions, total }, live] = await Promise.all([
      ctx.sessionManager.listRecentSessions(undefined, limit, 0),
      registry.listActive().catch((): ActiveAgentRecord[] => []),
    ]);
    const titled = await Promise.all(sessions.map(async (session) => {
      const known = session.messageCount > 0 ? titles.get(session.sessionId) : undefined;
      const title = known ?? await resolveSessionTitle(session, () => readFirstUserMessage(session));
      if (session.messageCount > 0) titles.set(session.sessionId, title);
      return { session, title };
    }));
    await Promise.all([...titled.map(({ session }) => session.projectPath), ...live.map((record) => record.workspaceRoot)].map(canonicalOnce));
    return {
      entries: buildAgentSessionEntries({
        sessions: titled,
        live,
        currentSessionId: ctx.sessionManager.getCurrentSession()?.metadata.sessionId,
        pid,
        isCurrentWorkspace: (directory) => !canSwitch || directories.get(directory) === currentWorkspace,
      }),
      remaining: Math.max(0, total - sessions.length),
    };
  };

  const { showAgentSessionsScreen } = deps.showScreen ? { showAgentSessionsScreen: deps.showScreen } : await import('../ui/ink/components/AgentSessionsScreen.js');
  const preference: ResumeDirectoryPreference = ctx.config?.ui?.resumeDirectory ?? 'ask';

  await ctx.onBeforeModal?.();
  let choice: AgentSessionChoice | null;
  try {
    choice = await showAgentSessionsScreen({
      load,
      loadFirstPrompt: (sessionId) => readFirstUserMessage({ sessionId }),
      currentWorkspace,
      home: deps.home ?? os.homedir(),
      pid,
      directoryPreference: preference,
      mouse: ctx.config?.ui?.mouseComposerCursor !== false,
    });
  } finally {
    await ctx.onAfterModal?.();
  }
  if (!choice) return null;

  if (choice.remember && ctx.config) {
    ctx.config.ui = { ...ctx.config.ui, resumeDirectory: choice.remember };
    await (deps.persistConfig ?? saveConfig)(ctx.config).catch((error: unknown) => {
      console.log(chalk.yellow(`Could not save the directory preference: ${error instanceof Error ? error.message : String(error)}`));
    });
  }

  if (choice.directory === 'session' && ctx.switchWorkspace && await canonical(choice.projectPath) !== currentWorkspace) {
    if (await (deps.directoryExists ?? isDirectory)(choice.projectPath)) {
      await ctx.switchWorkspace(choice.projectPath);
      console.log(chalk.gray(`Working directory: ${choice.projectPath}`));
    } else {
      console.log(chalk.yellow(`The session directory ${choice.projectPath} no longer exists; staying in ${ctx.workspaceRoot}.`));
    }
  }

  return (deps.resumeSession ?? resume)({
    sessionManager: ctx.sessionManager,
    args: [choice.sessionId],
    restoreSession: ctx.restoreSession,
    restoreLoadedSession: ctx.restoreLoadedSession,
  });
}
