/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import type { SlashCommand, SlashCommandContext } from '../core/slashCommandTypes.js';
import type { SessionMetadata } from '../session/types.js';

const FORK_FLAG = 'experimental_fork';
const CLONE_FLAG = 'experimental_clone';

export const forkMetadata: SlashCommand = {
  command: '/fork',
  description: 'branch a new session from the active session or an earlier user message',
  implemented: true,
};

export const cloneMetadata: SlashCommand = {
  command: '/clone',
  description: 'duplicate the active session branch into a new session',
  implemented: true,
};

export const treeMetadata: SlashCommand = {
  command: '/tree',
  description: 'show the fork and clone tree for this project',
  implemented: true,
};

export async function forkSession(ctx: SlashCommandContext, args: string[] = []): Promise<string> {
  if (!isEnabled(ctx, FORK_FLAG)) {
    return `The /fork command is behind ${FORK_FLAG}. Run /features enable ${FORK_FLAG}, then /fork again. No restart required.`;
  }

  await ctx.trackFeatureActivation?.(FORK_FLAG, { surface: 'slash_command' });
  const target = parseForkArgs(args);
  const sourceSessionId = target.sourceReference
    ? await ctx.sessionManager.resolveSessionReference(target.sourceReference)
    : requireCurrentSessionId(ctx, '/fork');
  const forked = await ctx.sessionManager.branchSession(sourceSessionId, {
    type: 'fork',
    userMessageOrdinal: target.userMessageOrdinal,
  });
  await ctx.restoreSession?.(forked.metadata.sessionId);

  const point = target.userMessageOrdinal
    ? ` at user message ${target.userMessageOrdinal}`
    : '';
  return chalk.green(`Forked session ${forked.metadata.sessionId}${point}. Continue typing to explore this branch.`);
}

export async function cloneSession(ctx: SlashCommandContext, args: string[] = []): Promise<string> {
  if (!isEnabled(ctx, CLONE_FLAG)) {
    return `The /clone command is behind ${CLONE_FLAG}. Run /features enable ${CLONE_FLAG}, then /clone again. No restart required.`;
  }

  await ctx.trackFeatureActivation?.(CLONE_FLAG, { surface: 'slash_command' });
  const sourceReference = args[0]
    ? await ctx.sessionManager.resolveSessionReference(args[0])
    : requireCurrentSessionId(ctx, '/clone');
  const cloned = await ctx.sessionManager.branchSession(sourceReference, { type: 'clone' });
  await ctx.restoreSession?.(cloned.metadata.sessionId);
  return chalk.green(`Cloned session ${cloned.metadata.sessionId}. Continue typing in the duplicate branch.`);
}

export async function sessionTree(ctx: SlashCommandContext): Promise<string> {
  if (!isEnabled(ctx, FORK_FLAG) && !isEnabled(ctx, CLONE_FLAG)) {
    return `The /tree command is behind ${FORK_FLAG} or ${CLONE_FLAG}. Enable one of those features first.`;
  }

  const sessions = await ctx.sessionManager.listSessions(
    ctx.workspaceRoot ? { project: ctx.workspaceRoot } : undefined
  );
  if (sessions.length === 0) {
    return 'No sessions found for this project.';
  }

  return formatSessionTree(sessions, ctx.currentSession?.metadata.sessionId);
}

export async function forkSessionReference(ctx: SlashCommandContext, sourceReference: string): Promise<string> {
  if (!isEnabled(ctx, FORK_FLAG)) {
    return `The --fork flag is behind ${FORK_FLAG}. Run /features enable ${FORK_FLAG}, then try again.`;
  }

  await ctx.trackFeatureActivation?.(FORK_FLAG, { surface: 'cli_flag' });
  const sourceSessionId = await ctx.sessionManager.resolveSessionReference(sourceReference);
  const forked = await ctx.sessionManager.branchSession(sourceSessionId, { type: 'fork' });
  await ctx.restoreSession?.(forked.metadata.sessionId);
  return forked.metadata.sessionId;
}

function isEnabled(ctx: SlashCommandContext, flag: string): boolean {
  const localDefault = flag === FORK_FLAG
    ? ctx.config?.features?.experimentalFork === true
    : ctx.config?.features?.experimentalClone === true;
  return ctx.isFeatureEnabled?.(flag, localDefault) ?? localDefault;
}

function requireCurrentSessionId(ctx: SlashCommandContext, command: string): string {
  const sessionId = ctx.currentSession?.metadata.sessionId
    ?? ctx.sessionManager.getCurrentSession()?.metadata.sessionId;
  if (!sessionId) {
    throw new Error(`${command} requires an active session.`);
  }
  return sessionId;
}

function parseForkArgs(args: string[]): { sourceReference?: string; userMessageOrdinal?: number } {
  const rest = [...args];
  let userMessageOrdinal: number | undefined;
  const messageFlagIndex = rest.findIndex((arg) => arg === '--message' || arg === '-m');
  if (messageFlagIndex >= 0) {
    const rawValue = rest[messageFlagIndex + 1];
    if (!rawValue) {
      throw new Error('Missing message number after --message.');
    }
    userMessageOrdinal = parseUserMessageOrdinal(rawValue);
    rest.splice(messageFlagIndex, 2);
  }

  if (rest.length === 1 && /^\d+$/.test(rest[0])) {
    userMessageOrdinal = parseUserMessageOrdinal(rest[0]);
    rest.length = 0;
  }

  return {
    sourceReference: rest[0],
    userMessageOrdinal,
  };
}

function parseUserMessageOrdinal(rawValue: string): number {
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('Fork message must be a positive user-message number.');
  }
  return parsed;
}

function formatSessionTree(sessions: SessionMetadata[], currentSessionId?: string): string {
  const byParent = new Map<string, SessionMetadata[]>();
  const roots: SessionMetadata[] = [];
  const ids = new Set(sessions.map((session) => session.sessionId));

  for (const session of sessions) {
    const parentId = session.branch?.sourceSessionId;
    if (parentId && ids.has(parentId)) {
      const siblings = byParent.get(parentId) ?? [];
      siblings.push(session);
      byParent.set(parentId, siblings);
    } else {
      roots.push(session);
    }
  }

  const sortByCreated = (items: SessionMetadata[]) =>
    [...items].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const lines = ['Session tree:'];
  const visit = (session: SessionMetadata, depth: number) => {
    const marker = session.sessionId === currentSessionId ? ' *' : '';
    const branch = formatBranchLabel(session);
    lines.push(`${'  '.repeat(depth)}- ${session.sessionId}${marker}${branch}`);
    for (const child of sortByCreated(byParent.get(session.sessionId) ?? [])) {
      visit(child, depth + 1);
    }
  };

  for (const root of sortByCreated(roots)) {
    visit(root, 0);
  }

  return lines.join('\n');
}

function formatBranchLabel(session: SessionMetadata): string {
  if (!session.branch) return '';
  if (session.branch.type === 'fork' && session.branch.sourceUserMessageOrdinal) {
    return ` (${session.branch.type} at user message ${session.branch.sourceUserMessageOrdinal})`;
  }
  return ` (${session.branch.type})`;
}
