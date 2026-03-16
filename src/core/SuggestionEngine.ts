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
/** Max characters per message to keep the suggestion prompt small and fast. */
const MAX_MESSAGE_CONTENT_LENGTH = 500;
/**
 * Internal timeout for the background LLM call. Set higher than the user-facing
 * deadline in promptForInstruction (3s) so the request can finish in the background
 * and be available for the next prompt cycle.
 */
const SUGGESTION_TIMEOUT_MS = 10_000;

export interface SuggestionEngineOptions {
  /** When provided, constrains suggestions to only actions achievable with these tools. */
  allowedTools?: string[];
}

export class SuggestionEngine {
  private suggestion: string | null = null;
  private abortController: AbortController | null = null;
  private readonly toolConstraint: string;

  constructor(
    private readonly llm: LLMProvider,
    options?: SuggestionEngineOptions,
  ) {
    if (options?.allowedTools?.length) {
      this.toolConstraint = `\n\nIMPORTANT: ONLY suggest actions achievable with these tools: ${options.allowedTools.join(', ')}. Do not suggest actions requiring tools the user cannot use.`;
    } else {
      this.toolConstraint = '';
    }
  }

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
      { role: 'system', content: STARTUP_SUGGESTION_PROMPT + this.toolConstraint },
      { role: 'user', content: contextParts.join('\n\n') },
    ]);
  }

  async generate(history: LLMMessage[]): Promise<void> {
    // Clear stale suggestion from previous turn immediately so that a lazy
    // provider (e.g., `() => engine.getSuggestion()`) won't return outdated text
    // while the new LLM call is in flight.
    this.suggestion = null;

    // Strip tool messages, empty assistant messages (tool-call-only turns),
    // and internal metadata (tool_calls, priority, etc.) to avoid breaking
    // the LLM API with orphaned tool responses or invalid sequences.
    const cleanHistory = history
      .filter(m => (m.role === 'user' || m.role === 'assistant') &&
                   typeof m.content === 'string' && m.content.trim().length > 0)
      .map(m => ({
        role: m.role,
        content: m.content.length > MAX_MESSAGE_CONTENT_LENGTH
          ? m.content.slice(0, MAX_MESSAGE_CONTENT_LENGTH) + '…'
          : m.content,
      }));
    const recentHistory = cleanHistory.slice(-MAX_HISTORY_MESSAGES);
    await this.executeWithTimeout([
      { role: 'system', content: SUGGESTION_SYSTEM_PROMPT + this.toolConstraint },
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
    const debug = process.env.AUTOHAND_DEBUG === '1';

    const timeout = setTimeout(() => controller.abort(), SUGGESTION_TIMEOUT_MS);
    const startTime = Date.now();

    try {
      const response = await this.llm.complete({
        messages,
        maxTokens: 60,
        temperature: 0.7,
        signal: controller.signal,
      });

      if (controller.signal.aborted) {
        if (debug) process.stderr.write(`[SUGGESTION] Aborted after ${Date.now() - startTime}ms\n`);
        return;
      }

      const raw = (response.content ?? '').trim();
      if (!raw) {
        this.suggestion = null;
        if (debug) process.stderr.write(`[SUGGESTION] Empty response after ${Date.now() - startTime}ms\n`);
        return;
      }

      this.suggestion = sanitizeSuggestion(raw);
      if (debug) process.stderr.write(`[SUGGESTION] Generated "${this.suggestion}" in ${Date.now() - startTime}ms\n`);
    } catch (err) {
      if (!controller.signal.aborted) {
        this.suggestion = null;
      }
      if (debug) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[SUGGESTION] Error after ${Date.now() - startTime}ms: ${msg}\n`);
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
