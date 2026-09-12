/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { LLMMessage } from '../../types.js';
import type { LLMProvider } from '../../providers/LLMProvider.js';
import { MAX_SESSION_TITLE_LENGTH, normalizeSessionTitle } from '../../session/sessionTitle.js';

export const AUTO_TITLE_MAX_LENGTH = 48;
export const AUTO_TITLE_MAX_WORDS = 7;
const REFINE_TIMEOUT_MS = 8_000;
const REFINE_CONTEXT_CHARS = 500;

/**
 * A name derived from the first instruction without any model call, so the
 * session is labelled the moment it starts. Commands, shell lines, and
 * messages to other agents are not names.
 */
export function deriveSessionTitleFromInstruction(instruction: string): string | undefined {
  const text = instruction.replace(/\s+/g, ' ').trim();
  if (!text || /^[/!:#]/.test(text)) return undefined;
  const cleaned = text
    .replace(/[@$][\w./-]+/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return undefined;
  const words = cleaned.split(' ').slice(0, AUTO_TITLE_MAX_WORDS);
  let title = words.join(' ');
  if (title.length > AUTO_TITLE_MAX_LENGTH) {
    title = title.slice(0, AUTO_TITLE_MAX_LENGTH).replace(/\s+\S*$/, '').trim() || title.slice(0, AUTO_TITLE_MAX_LENGTH).trim();
  }
  if (!/\p{L}/u.test(title)) return undefined;
  return title.charAt(0).toUpperCase() + title.slice(1);
}

export interface SessionAutoNamerOptions {
  getProvider: () => LLMProvider | null | undefined;
  /** False disables the model refinement (offline, bare, suggestions off). */
  enabled: boolean;
  timeoutMs?: number;
}

const REFINE_SYSTEM_PROMPT = [
  'You name coding sessions for a terminal tab.',
  'Reply with only the name: three to six words, sentence case, no quotes, no trailing period.',
  'Describe the task, not the tool, for example "Fix caret after startup" or "Add session rename command".',
].join(' ');

/**
 * Asks the model for a short name once the first turn has an answer. Cheap
 * (a few dozen tokens), bounded by a timeout, and never required: on any
 * failure the derived name stays.
 */
export class SessionAutoNamer {
  constructor(private readonly options: SessionAutoNamerOptions) {}

  async refine(history: readonly LLMMessage[], signal?: AbortSignal): Promise<string | null> {
    if (!this.options.enabled) return null;
    const provider = this.options.getProvider();
    if (!provider) return null;
    const excerpt = history
      .filter((message) => (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string')
      .slice(0, 2)
      .map((message) => `${message.role}: ${(message.content as string).slice(0, REFINE_CONTEXT_CHARS)}`)
      .join('\n');
    if (!excerpt) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? REFINE_TIMEOUT_MS);
    timer.unref?.();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const response = await provider.complete({
        messages: [
          { role: 'system', content: REFINE_SYSTEM_PROMPT },
          { role: 'user', content: excerpt },
        ],
        maxTokens: 24,
        temperature: 0.2,
        signal: controller.signal,
      });
      return sanitizeModelTitle(response.content);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}

export function sanitizeModelTitle(raw: string | undefined): string | null {
  const firstLine = (raw ?? '').split('\n').map((line) => line.trim()).find(Boolean) ?? '';
  const cleaned = firstLine
    .replace(/^(?:name|title)\s*:\s*/i, '')
    .replace(/^["'`“”]+|["'`“”.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || !/\p{L}/u.test(cleaned)) return null;
  const words = cleaned.split(' ');
  if (words.length > 8 || cleaned.length > Math.min(AUTO_TITLE_MAX_LENGTH + 12, MAX_SESSION_TITLE_LENGTH)) return null;
  try {
    return normalizeSessionTitle(cleaned);
  } catch {
    return null;
  }
}
