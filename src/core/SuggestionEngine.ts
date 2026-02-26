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

const STARTUP_SUGGESTION_PROMPT = `You are a coding assistant suggestion engine. Based on the project context below, suggest ONE short action the developer might want to start with. Reply with ONLY the suggestion text — no quotes, no explanation, no markdown. Keep it under 60 characters.

Focus on what's most actionable: uncommitted changes, recent work, failing tests, or natural next steps.

Examples of good startup suggestions:
- Review the 3 uncommitted files
- Continue work on the auth refactor
- Run tests after recent changes
- Commit the staged changes
- Fix the merge conflict in config.ts`;

const MAX_SUGGESTION_LENGTH = 80;
/** Max conversation messages included in the suggestion prompt (system prompt added on top). */
const MAX_HISTORY_MESSAGES = 6; // 3 user+assistant pairs → 7 messages total sent to LLM
const SUGGESTION_TIMEOUT_MS = 3000;

export class SuggestionEngine {
  private suggestion: string | null = null;
  private abortController: AbortController | null = null;

  constructor(private readonly llm: LLMProvider) {}

  async generateFromProjectContext(context: {
    gitStatus?: string;
    recentFiles: string[];
    recentCommits?: string;
  }): Promise<void> {
    const contextParts: string[] = [];
    if (context.gitStatus) {
      contextParts.push(`Git status:\n${context.gitStatus}`);
    }
    if (context.recentCommits) {
      contextParts.push(`Recent commits:\n${context.recentCommits}`);
    }
    if (context.recentFiles.length > 0) {
      contextParts.push(`Project files: ${context.recentFiles.join(', ')}`);
    }

    if (contextParts.length === 0) {
      this.suggestion = null;
      return;
    }

    await this.executeWithTimeout([
      { role: 'system', content: STARTUP_SUGGESTION_PROMPT },
      { role: 'user', content: contextParts.join('\n\n') },
    ]);
  }

  async generate(history: LLMMessage[]): Promise<void> {
    const recentHistory = history.slice(-MAX_HISTORY_MESSAGES);
    await this.executeWithTimeout([
      { role: 'system', content: SUGGESTION_SYSTEM_PROMPT },
      ...recentHistory,
    ]);
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

  private async executeWithTimeout(messages: LLMMessage[]): Promise<void> {
    this.cancel();

    const controller = new AbortController();
    this.abortController = controller;

    const timeout = setTimeout(() => controller.abort(), SUGGESTION_TIMEOUT_MS);

    try {
      const response = await this.llm.complete({
        messages,
        maxTokens: 60,
        temperature: 0.7,
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
