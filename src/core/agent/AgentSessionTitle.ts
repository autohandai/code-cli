/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { getSessionDisplayName } from '../../session/sessionTitle.js';
import type { SessionMetadata } from '../../session/types.js';
import type { TerminalTitleController } from '../../ui/terminalTitle.js';
import { deriveSessionTitleFromInstruction, type SessionAutoNamer } from './SessionAutoNamer.js';
import type { LLMMessage } from '../../types.js';

interface SessionTitleManager {
  getCurrentSession(): { metadata: SessionMetadata } | null;
  renameCurrentSession(title: string, options?: { source?: 'user' | 'auto' }): Promise<SessionMetadata>;
}

/** Loose host shape, like the other agent runtime hosts; the fields below are the ones read. */
export interface AgentSessionTitleHost {
  [key: string]: any;
}

function manager(host: AgentSessionTitleHost): SessionTitleManager {
  return host.sessionManager as SessionTitleManager;
}

function currentMetadata(host: AgentSessionTitleHost): SessionMetadata | undefined {
  const sessionManager = host.sessionManager as Partial<SessionTitleManager> | undefined;
  return sessionManager?.getCurrentSession?.()?.metadata;
}

function title(host: AgentSessionTitleHost): Pick<TerminalTitleController, 'setName'> | undefined {
  return host.terminalTitle ?? undefined;
}

/** Pushes the current session's display name into the terminal title. */
export function syncAgentTerminalTitleName(host: AgentSessionTitleHost): void {
  const metadata = currentMetadata(host);
  title(host)?.setName(metadata ? getSessionDisplayName(metadata) : undefined);
}

/**
 * Names a still-unnamed session from its first instruction so the tab and
 * the session list read sensibly before any model has answered.
 */
export async function autoNameAgentSessionFromInstruction(host: AgentSessionTitleHost, instruction: string): Promise<void> {
  const metadata = currentMetadata(host);
  if (!metadata || metadata.title) return;
  const derived = deriveSessionTitleFromInstruction(instruction);
  if (!derived) return;
  try {
    await manager(host).renameCurrentSession(derived, { source: 'auto' });
    syncAgentTerminalTitleName(host);
  } catch (error) {
    host.writeDebugLine?.(`[DEBUG] auto session name skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * After the first answer, asks the model for a better name once. A name the
 * user typed with /rename is never replaced.
 */
export async function refineAgentSessionTitle(host: AgentSessionTitleHost, signal?: AbortSignal): Promise<void> {
  const namer = host.sessionAutoNamer as Pick<SessionAutoNamer, 'refine'> | null | undefined;
  if (host.sessionTitleRefined || !namer) return;
  const metadata = currentMetadata(host);
  if (!metadata || (metadata.title && metadata.titleSource === 'user')) return;
  const history = (host.conversation?.history?.() ?? []) as readonly LLMMessage[];
  if (history.length === 0) return;
  host.sessionTitleRefined = true;
  const refined = await namer.refine(history, signal);
  if (!refined) return;
  const latest = currentMetadata(host);
  if (!latest || latest.sessionId !== metadata.sessionId || (latest.title && latest.titleSource === 'user')) return;
  try {
    await manager(host).renameCurrentSession(refined, { source: 'auto' });
    syncAgentTerminalTitleName(host);
  } catch (error) {
    host.writeDebugLine?.(`[DEBUG] session name refinement skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
}
