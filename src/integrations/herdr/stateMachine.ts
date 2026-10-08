/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { HookContext } from '../../core/HookManager.js';

export type HerdrAgentState = 'idle' | 'working' | 'blocked';

export interface HerdrPaneState {
  state: HerdrAgentState | null;
  sessionId: string | null;
  message: string | null;
}

export interface HerdrStateReport {
  kind: 'state';
  state: HerdrAgentState;
  sessionId: string | null;
  message: string | null;
}

export interface HerdrReleaseReport {
  kind: 'release';
}

export type HerdrReport = HerdrStateReport | HerdrReleaseReport;

export interface HerdrTransition {
  next: HerdrPaneState;
  report: HerdrReport | null;
}

export const INITIAL_HERDR_PANE_STATE: HerdrPaneState = { state: null, sessionId: null, message: null };

const QUESTION_TOOL = 'ask_followup_question';
const MAX_MESSAGE_LENGTH = 120;

/** Events that only happen while a turn is running, so they end a blocked wait. */
const TURN_PROGRESS_PREFIXES = ['post-tool', 'file-modified', 'permission-denied', 'subagent-', 'computer-use-', 'context:'];

function isTurnProgress(event: string): boolean {
  return TURN_PROGRESS_PREFIXES.some((prefix) => event === prefix || event.startsWith(prefix));
}

/** Herdr shows the message next to a blocked pane; keep it one line and short. */
export function sanitizeHerdrMessage(message: string): string {
  const clean = message.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.length > MAX_MESSAGE_LENGTH ? `${clean.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : clean;
}

function blockedMessage(context: Readonly<HookContext>): string {
  if (context.event === 'pre-tool') return 'waiting for your answer';
  const subject = context.command ?? context.path ?? context.tool;
  return sanitizeHerdrMessage(subject ? `needs approval: ${subject}` : 'needs approval');
}

function unchanged(previous: HerdrPaneState): HerdrTransition {
  return { next: previous, report: null };
}

function moveTo(previous: HerdrPaneState, state: HerdrAgentState, message: string | null = null): HerdrTransition {
  if (previous.state === state && previous.message === message) return unchanged(previous);
  const next: HerdrPaneState = { ...previous, state, message };
  return { next, report: { kind: 'state', state, sessionId: next.sessionId, message } };
}

/**
 * Pure projection of Autohand lifecycle events onto Herdr's three pane states.
 * The reporter owns delivery; this function only decides what Herdr should hear.
 */
export function deriveHerdrTransition(previous: HerdrPaneState, context: Readonly<HookContext>): HerdrTransition {
  switch (context.event) {
    case 'session-start': {
      const sessionId = context.sessionId ?? previous.sessionId;
      const next: HerdrPaneState = { state: 'idle', sessionId, message: null };
      return { next, report: { kind: 'state', state: 'idle', sessionId, message: null } };
    }
    case 'session-end':
      // A cleared session is replaced in place; the following session-start reports it.
      if (context.sessionEndReason === 'clear') return unchanged(previous);
      return { next: INITIAL_HERDR_PANE_STATE, report: { kind: 'release' } };
    case 'pre-prompt':
      return moveTo(previous, 'working');
    case 'permission-request':
      return moveTo(previous, 'blocked', blockedMessage(context));
    case 'pre-tool':
      return context.tool === QUESTION_TOOL
        ? moveTo(previous, 'blocked', blockedMessage(context))
        : moveTo(previous, 'working');
    case 'stop':
    case 'rate-limit':
    case 'session-error':
      return moveTo(previous, 'idle');
    default:
      return previous.state === 'blocked' && isTurnProgress(context.event)
        ? moveTo(previous, 'working')
        : unchanged(previous);
  }
}
