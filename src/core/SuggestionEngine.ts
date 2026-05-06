/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { LLMProvider } from '../providers/LLMProvider.js';
import type { LLMMessage } from '../types.js';
import { isAutohandDebugEnabled } from '../utils/debugLog.js';

const SUGGESTION_SYSTEM_PROMPT = `You are a coding assistant suggestion engine. Based on the recent conversation, suggest ONE short next action the user might want to type next. Reply with ONLY the suggestion text — no quotes, no explanation, no markdown. Prefer 2-12 words.

Examples of good suggestions:
- Run the test suite
- Fix the failing import in auth.ts
- Add error handling to the API endpoint
- Commit the changes
- Review the diff before merging`;

const STARTUP_SUGGESTION_PROMPT = `You are a coding assistant suggestion engine. Based on the project context below, suggest ONE short action the developer might want to type next. Reply with ONLY the suggestion text — no quotes, no explanation, no markdown. Prefer 2-12 words.

Focus on what's most actionable: uncommitted changes, recent work, failing tests, or natural next steps.

Examples of good startup suggestions:
- Review the 3 uncommitted files
- Continue work on the auth refactor
- Run tests after recent changes
- Commit the staged changes
- Fix the merge conflict in config.ts`;

const MAX_SUGGESTION_LENGTH = 80;
const MAX_SUGGESTION_WORDS = 12;
/** Max conversation messages included in the suggestion prompt (system prompt added on top). */
const MAX_HISTORY_MESSAGES = 6; // 3 user+assistant pairs → 7 messages total sent to LLM
/** Max characters per message to keep the suggestion prompt small and fast. */
const MAX_MESSAGE_CONTENT_LENGTH = 500;
const STRUCTURED_AGENT_PAYLOAD_KEY_RE = /"?(thought|reflection|toolCalls|finalResponse|response)"?\s*:/i;
const ASSISTANT_ANSWER_PREFIX_RE = /^(?:i\b|i['\u2019](?:m|ll|ve|d)\b|i\s+(?:am|can|cannot|can't|do|don't|did|found|fixed|have|haven't|need|was|will|won't|would)\b|here(?:'s|\s+is|\s+are)\b|sorry\b|sure\b|unfortunately\b|could\s+you\b)/i;
const ASSISTANT_PLANNING_PREFIX_RE = /^(?:first,?\s+)?(?:let me|i['\u2019]ll|i will|i am going to|i['\u2019]m going to|now i['\u2019]ll|now i will)\b.{0,100}\b(?:start|begin|check|gather|inspect|analy[sz]e|review|perform|run|look at|read|find)\b/i;
const COMMON_ONE_WORD_ACTIONS = new Set(['yes', 'no', 'continue', 'commit', 'push', 'stop']);
const EVALUATIVE_TEXT_RE = /^(?:looks?\s+good|thanks?|thank\s+you|perfect|great|awesome|nice|cool|sounds\s+good|all\s+good|ok(?:ay)?)\.?$/i;
const META_SUGGESTION_RE = /^(?:no\s+suggestion|no\s+action|nothing|none|null|undefined|n\/a|stay\s+silent|silent|do\s+not\s+suggest|no\s+next\s+step)\.?$/i;
const API_OR_ERROR_OUTPUT_RE = /^(?:api\s+error|error|fatal|warning|traceback|stack\s+trace|http\s+\d{3}|[A-Z][A-Za-z]+Error:|cannot\s+read\s+properties|request\s+failed|response\s+status|status\s+\d{3})\b/i;
const ERROR_TOKEN_RE = /\b(?:TypeError|ReferenceError|SyntaxError|RangeError|ECONNRESET|ENOTFOUND|ETIMEDOUT|EACCES|ENOENT|HTTP\s*\d{3})\b/;
const MARKDOWN_RE = /(?:^|\n)\s*(?:[-*+]\s+|\d+\.\s+|#{1,6}\s+|>\s+)|```|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*\*|__/;
/**
 * Internal timeout for the background LLM call. Set higher than the user-facing
 * deadline in promptForInstruction (3s) so the request can finish in the background
 * and be available for the next prompt cycle.
 */
const SUGGESTION_TIMEOUT_MS = 10_000;

export interface SuggestionEngineOptions {
  /** When provided, constrains suggestions to only actions achievable with these tools. */
  allowedTools?: string[];
  /** Optional sink for debug lines so interactive UIs can render above composers. */
  debugLogger?: (message: string) => void;
}

export class SuggestionEngine {
  private suggestion: string | null = null;
  private abortController: AbortController | null = null;
  private readonly toolConstraint: string;
  private readonly debugLogger?: (message: string) => void;

  constructor(
    private readonly llm: LLMProvider,
    options?: SuggestionEngineOptions,
  ) {
    this.debugLogger = options?.debugLogger;
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
    // provider (e.g., `() => engine.getNextPromptSuggestion()`) won't return outdated text
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

  getNextPromptSuggestion(): string | null {
    return this.suggestion;
  }

  getSuggestion(): string | null {
    return this.getNextPromptSuggestion();
  }

  clear(): void {
    this.suggestion = null;
  }

  private async executeWithTimeout(messages: LLMMessage[]): Promise<void> {
    this.cancel();

    const controller = new AbortController();
    this.abortController = controller;
    const debug = isAutohandDebugEnabled();

    const timeout = setTimeout(() => controller.abort(), SUGGESTION_TIMEOUT_MS);
    const startTime = Date.now();
    let removeAbortListener = () => {};

    try {
      const abortPromise = new Promise<never>((_, reject) => {
        const onAbort = () => {
          const error = new Error('Suggestion request aborted');
          error.name = 'AbortError';
          reject(error);
        };

        if (controller.signal.aborted) {
          onAbort();
          return;
        }

        controller.signal.addEventListener('abort', onAbort, { once: true });
        removeAbortListener = () => controller.signal.removeEventListener('abort', onAbort);
      });

      const response = await Promise.race([
        this.llm.complete({
          messages,
          maxTokens: 60,
          temperature: 0.7,
          signal: controller.signal,
        }),
        abortPromise,
      ]);

      if (controller.signal.aborted) {
        if (debug) this.debugLogger?.(`[SUGGESTION] Aborted after ${Date.now() - startTime}ms`);
        return;
      }

      const raw = (response.content ?? '').trim();
      if (!raw) {
        this.suggestion = null;
        if (debug) this.debugLogger?.(`[SUGGESTION] Empty response after ${Date.now() - startTime}ms`);
        return;
      }

      this.suggestion = sanitizeSuggestion(raw);
      if (debug) this.debugLogger?.(`[SUGGESTION] Generated "${this.suggestion}" in ${Date.now() - startTime}ms`);
    } catch (err) {
      if (!controller.signal.aborted) {
        this.suggestion = null;
      }
      if (debug) {
        const msg = err instanceof Error ? err.message : String(err);
        this.debugLogger?.(`[SUGGESTION] Error after ${Date.now() - startTime}ms: ${msg}`);
      }
    } finally {
      removeAbortListener();
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

  const explicitSuggestion = extractExplicitSuggestion(cleaned);
  if (explicitSuggestion !== undefined) {
    return sanitizeSuggestion(explicitSuggestion);
  }

  if (STRUCTURED_AGENT_PAYLOAD_KEY_RE.test(cleaned) || looksLikeJsonPayload(cleaned)) {
    return null;
  }

  if (
    looksLikeAssistantAnswer(cleaned) ||
    looksLikeAssistantPlanning(cleaned) ||
    looksLikeQuestion(cleaned) ||
    looksLikeMarkdown(cleaned) ||
    looksLikeMultipleSentences(cleaned) ||
    looksLikeMetaSuggestion(cleaned) ||
    looksLikeApiOrErrorOutput(cleaned) ||
    looksLikeEvaluativeText(cleaned)
  ) {
    return null;
  }

  cleaned = cleaned.replace(/[.!]+$/g, '').replace(/\s+/g, ' ').trim();
  if (!hasAcceptedWordShape(cleaned)) {
    return null;
  }

  return cleaned.length > MAX_SUGGESTION_LENGTH ? null : cleaned;
}

function extractExplicitSuggestion(raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }

    const record = parsed as Record<string, unknown>;
    if (hasStructuredAgentPayloadKeys(record)) {
      return undefined;
    }

    for (const key of ['suggestion', 'nextAction', 'action']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) {
        return value;
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function hasStructuredAgentPayloadKeys(record: Record<string, unknown>): boolean {
  return ['thought', 'reflection', 'toolCalls', 'finalResponse', 'response'].some((key) =>
    Object.prototype.hasOwnProperty.call(record, key)
  );
}

function looksLikeJsonPayload(raw: string): boolean {
  const trimmed = raw.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.includes('}{') || trimmed.includes('{"');
}

function looksLikeAssistantAnswer(raw: string): boolean {
  return ASSISTANT_ANSWER_PREFIX_RE.test(raw);
}

function looksLikeAssistantPlanning(raw: string): boolean {
  return ASSISTANT_PLANNING_PREFIX_RE.test(raw);
}

function looksLikeQuestion(raw: string): boolean {
  return raw.includes('?');
}

function looksLikeMarkdown(raw: string): boolean {
  return MARKDOWN_RE.test(raw);
}

function looksLikeMultipleSentences(raw: string): boolean {
  return /[.!?]\s+["']?[A-Z0-9]/.test(raw.trim());
}

function looksLikeMetaSuggestion(raw: string): boolean {
  return META_SUGGESTION_RE.test(raw.trim());
}

function looksLikeApiOrErrorOutput(raw: string): boolean {
  return API_OR_ERROR_OUTPUT_RE.test(raw.trim()) || ERROR_TOKEN_RE.test(raw);
}

function looksLikeEvaluativeText(raw: string): boolean {
  return EVALUATIVE_TEXT_RE.test(raw.trim());
}

function hasAcceptedWordShape(raw: string): boolean {
  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > MAX_SUGGESTION_WORDS) {
    return false;
  }

  if (words.length === 1) {
    return COMMON_ONE_WORD_ACTIONS.has(words[0]?.toLowerCase() ?? '');
  }

  return true;
}
