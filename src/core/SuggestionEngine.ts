/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { LLMProvider } from '../providers/LLMProvider.js';
import type { LLMMessage } from '../types.js';

const SUGGESTION_SYSTEM_PROMPT = `You are a coding assistant suggestion engine. Based on the recent conversation, suggest ONE short next action the user might want to take. Reply with ONLY the suggestion text — no quotes, no explanation, no markdown. Keep it under 60 characters.

Examples of good suggestions:
- Run the test suite
- Fix the failing import in auth.ts
- Add error handling to the API endpoint
- Commit the changes
- Review the diff before merging`;

const MAX_SUGGESTION_LENGTH = 80;
const MAX_HISTORY_MESSAGES = 6; // 3 turns (user + assistant pairs)
const SUGGESTION_TIMEOUT_MS = 3000;

export class SuggestionEngine {
  private suggestion: string | null = null;
  private abortController: AbortController | null = null;

  constructor(private readonly llm: LLMProvider) {}

  async generate(history: LLMMessage[]): Promise<void> {
    this.cancel();

    const controller = new AbortController();
    this.abortController = controller;

    const timeout = setTimeout(() => controller.abort(), SUGGESTION_TIMEOUT_MS);

    try {
      const recentHistory = history.slice(-MAX_HISTORY_MESSAGES);

      const response = await this.llm.complete({
        messages: [
          { role: 'system', content: SUGGESTION_SYSTEM_PROMPT },
          ...recentHistory,
        ],
        maxTokens: 60,
        temperature: 0.7,
        tools: undefined,
        signal: controller.signal,
      });

      if (controller.signal.aborted) {
        return;
      }

      const raw = (response.content ?? '').trim();
      if (!raw) {
        this.suggestion = null;
        return;
      }

      this.suggestion = sanitizeSuggestion(raw);
    } catch {
      if (!controller.signal.aborted) {
        this.suggestion = null;
      }
    } finally {
      clearTimeout(timeout);
      if (this.abortController === controller) {
        this.abortController = null;
      }
    }
  }

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  getSuggestion(): string | null {
    return this.suggestion;
  }

  clear(): void {
    this.suggestion = null;
  }
}

function sanitizeSuggestion(raw: string): string | null {
  let cleaned = raw.replace(/^["'`]+|["'`]+$/g, '').trim();
  cleaned = cleaned.replace(/^(suggestion|next[: ]|try[: ])/i, '').trim();

  if (!cleaned) {
    return null;
  }

  if (cleaned.length > MAX_SUGGESTION_LENGTH) {
    cleaned = cleaned.slice(0, MAX_SUGGESTION_LENGTH - 1) + '\u2026';
  }

  return cleaned;
}
