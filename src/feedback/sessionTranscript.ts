/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import os from 'node:os';
import type { SessionMessage } from '../session/types.js';

export interface FeedbackTranscriptMessage {
  role: SessionMessage['role'];
  content: string;
  timestamp?: string;
  name?: string;
}

export interface FeedbackTranscript {
  sessionId?: string;
  /** Messages in the session, including the ones left out of `messages`. */
  messageCount: number;
  truncated: boolean;
  messages: FeedbackTranscriptMessage[];
}

export const TRANSCRIPT_MAX_MESSAGES = 200;
export const TRANSCRIPT_MAX_MESSAGE_CHARS = 4_000;
export const TRANSCRIPT_MAX_TOTAL_CHARS = 200_000;

const TRANSCRIPT_ROLES: ReadonlySet<string> = new Set(['user', 'assistant', 'tool']);

const SYSTEM_INJECTED_BLOCK =
  /<(system-reminder|environment_context|user_instructions)>[\s\S]*?<\/\1>/gu;

const SECRET_TOKEN =
  /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|ahc_[A-Za-z0-9_-]{12,}|AKIA[0-9A-Z]{16})\b/gu;
const BEARER_TOKEN = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gu;
const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu;
const SECRET_ASSIGNMENT =
  /\b([A-Za-z0-9_]*(?:API_?KEY|SECRET|TOKEN|PASSWORD|PASSWD)[A-Za-z0-9_]*)("?\s*[:=]\s*"?)([^\s"'&,;]{6,})/giu;
const SECRET_QUERY_PARAMETER = /([?&](?:token|key|secret|password|code|signature)=)[^&#\s]+/giu;

/** Removes credentials and user-identifying paths before text leaves the machine. */
export function redactSensitiveText(text: string): string {
  const home = os.homedir();
  return (home.length > 1 ? text.replaceAll(home, '~') : text)
    .replace(PRIVATE_KEY_BLOCK, '[REDACTED PRIVATE KEY]')
    .replace(SECRET_QUERY_PARAMETER, '$1[REDACTED]')
    .replace(SECRET_TOKEN, '[REDACTED]')
    .replace(BEARER_TOKEN, '$1[REDACTED]')
    .replace(SECRET_ASSIGNMENT, (match, name: string, separator: string, value: string) =>
      value.startsWith('[REDACTED') ? match : `${name}${separator}[REDACTED]`)
    .replace(/(?:\/Users|\/home)\/[^/\s:]+/gu, '~')
    .replace(/[A-Za-z]:\\Users\\[^\\\s:]+/gu, '~');
}

function toolCallNames(toolCalls: unknown): string[] {
  if (!Array.isArray(toolCalls)) {
    return [];
  }
  return toolCalls.flatMap((call: unknown) => {
    if (typeof call !== 'object' || call === null) {
      return [];
    }
    const { function: fn, name } = call as { function?: { name?: unknown }; name?: unknown };
    const resolved = typeof fn?.name === 'string' ? fn.name : name;
    return typeof resolved === 'string' && resolved ? [resolved] : [];
  });
}

function clip(content: string): { content: string; clipped: boolean } {
  if (content.length <= TRANSCRIPT_MAX_MESSAGE_CHARS) {
    return { content, clipped: false };
  }
  // The marker length depends on the digit count of the removed size; reserve the widest case.
  const reserve = `… [truncated ${content.length} chars]`.length;
  const kept = content.slice(0, TRANSCRIPT_MAX_MESSAGE_CHARS - reserve);
  return { content: `${kept}… [truncated ${content.length - kept.length} chars]`, clipped: true };
}

function toTranscriptMessage(raw: unknown): { message: FeedbackTranscriptMessage; clipped: boolean } | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const { role, content, timestamp, name, toolCalls } = raw as Partial<Record<keyof SessionMessage, unknown>>;
  if (typeof role !== 'string' || !TRANSCRIPT_ROLES.has(role) || typeof content !== 'string') {
    return null;
  }

  const tools = toolCallNames(toolCalls);
  const text = [
    content.replace(SYSTEM_INJECTED_BLOCK, '').trim(),
    tools.length > 0 ? `[tool calls: ${tools.join(', ')}]` : '',
  ].filter(Boolean).join('\n');
  if (!text) {
    return null;
  }

  const clipped = clip(redactSensitiveText(text));
  return {
    message: {
      role: role as SessionMessage['role'],
      content: clipped.content,
      ...(typeof timestamp === 'string' ? { timestamp } : {}),
      ...(typeof name === 'string' && name ? { name } : {}),
    },
    clipped: clipped.clipped,
  };
}

/**
 * Builds the bounded, redacted copy of a session that accompanies feedback and
 * bug reports. The most recent messages win when a budget is exceeded: the end
 * of a session is where the problem being reported happened.
 */
export function buildFeedbackTranscript(
  sessionMessages: readonly SessionMessage[] | undefined,
  options: { sessionId?: string } = {},
): FeedbackTranscript {
  const source = sessionMessages ?? [];
  const messages: FeedbackTranscriptMessage[] = [];
  let truncated = false;
  let totalChars = 0;

  for (let index = source.length - 1; index >= 0; index--) {
    const entry = toTranscriptMessage(source[index]);
    if (!entry) {
      continue;
    }
    if (
      messages.length >= TRANSCRIPT_MAX_MESSAGES ||
      totalChars + entry.message.content.length > TRANSCRIPT_MAX_TOTAL_CHARS
    ) {
      truncated = true;
      break;
    }
    totalChars += entry.message.content.length;
    truncated ||= entry.clipped;
    messages.push(entry.message);
  }

  return {
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    messageCount: source.length,
    truncated,
    messages: messages.reverse(),
  };
}
