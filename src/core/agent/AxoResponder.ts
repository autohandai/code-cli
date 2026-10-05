/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { LLMProvider } from '../../providers/LLMProvider.js';

/**
 * Axo's whole personality. Kept tiny so a reply costs a few dozen tokens, and worded
 * exactly like the desktop app's so both Axos sound alike.
 */
export const AXO_PERSONA =
  'You are Axo, a small pink axolotl who lives inside Autohand, a coding app. ' +
  'Reply to the user in one short, friendly sentence (under 25 words). ' +
  'Be playful and kind. No markdown, no code blocks. If you are unsure, say so cheerfully.';

export const AXO_QUESTION_MAX_CHARS = 500;
export const AXO_REPLY_MAX_CHARS = 200;
const AXO_TIMEOUT_MS = 15_000;

export interface AxoResponderOptions {
  getProvider: () => LLMProvider | null | undefined;
  /** False keeps Axo quiet (bare runs). */
  enabled: boolean;
  timeoutMs?: number;
}

/** One line, no wrapping quotes, bounded — a reply fit for a speech bubble. */
export function normalizeAxoReply(raw: string | undefined): string | null {
  const flat = (raw ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim();
  if (!flat) return null;
  return flat.length > AXO_REPLY_MAX_CHARS ? `${flat.slice(0, AXO_REPLY_MAX_CHARS - 1).trimEnd()}…` : flat;
}

/**
 * Answers `~axo <question>` with a single small completion. Nothing reaches the
 * conversation, the session, memory, or turn token totals, and every failure is
 * a quiet `null` the UI turns into a shrug.
 */
export class AxoResponder {
  constructor(private readonly options: AxoResponderOptions) {}

  async ask(question: string, signal?: AbortSignal): Promise<string | null> {
    if (!this.options.enabled) return null;
    const provider = this.options.getProvider();
    if (!provider || provider.getName() === 'unconfigured') return null;
    const trimmed = question.trim().slice(0, AXO_QUESTION_MAX_CHARS);
    if (!trimmed) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? AXO_TIMEOUT_MS);
    timer.unref?.();
    const onAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const response = await provider.complete({
        messages: [
          { role: 'system', content: AXO_PERSONA },
          { role: 'user', content: trimmed },
        ],
        maxTokens: 80,
        temperature: 0.7,
        signal: controller.signal,
      });
      return normalizeAxoReply(response.content);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}
