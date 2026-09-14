/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * A budget for one run: model requests, reported tokens, and wall time,
 * shared by the lead and every in-process sub-agent. A request that would
 * exceed it is refused before it is sent, so an exhausted budget costs
 * nothing more.
 */
import { ApiError } from '../../providers/errors.js';
import type { LLMUsage } from '../../types.js';

export interface RunBudgetLimits {
  /** Model requests across the lead and in-process sub-agents. */
  maxRequests?: number;
  /** Reported prompt plus completion tokens; unreported usage does not count. */
  maxTokens?: number;
  /** Wall time since the budget was created. */
  maxDurationMs?: number;
}

export interface RunBudgetStatus extends RunBudgetLimits {
  requests: number;
  tokens: number;
  /** Requests whose provider reported no usage; their tokens are unknown. */
  unreportedRequests: number;
  elapsedMs: number;
}

/** Non-retryable: the run must stop, not try the same request again. */
export class RunBudgetExceededError extends ApiError {
  constructor(message: string, readonly status: RunBudgetStatus) {
    super(message, 'unknown', 0, false);
    this.name = 'RunBudgetExceededError';
  }
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

export class RunBudget {
  private requests = 0;
  private tokens = 0;
  private unreportedRequests = 0;
  private readonly startedAt: number;

  constructor(readonly limits: RunBudgetLimits, now: () => number = Date.now) {
    this.now = now;
    this.startedAt = now();
  }

  private readonly now: () => number;

  /** CLI flags win over `agent.budget`; a budget without any limit is no budget. */
  static fromSettings(
    options: { maxRequests?: number; maxTokens?: number; maxDuration?: number } | undefined,
    settings: { maxRequests?: number; maxTokens?: number; maxDurationSeconds?: number } | undefined,
    now?: () => number,
  ): RunBudget | undefined {
    const limits: RunBudgetLimits = {
      maxRequests: positiveInteger(options?.maxRequests) ?? positiveInteger(settings?.maxRequests),
      maxTokens: positiveInteger(options?.maxTokens) ?? positiveInteger(settings?.maxTokens),
      maxDurationMs: (positiveInteger(options?.maxDuration) ?? positiveInteger(settings?.maxDurationSeconds)) !== undefined
        ? (positiveInteger(options?.maxDuration) ?? positiveInteger(settings?.maxDurationSeconds))! * 1_000
        : undefined,
    };
    return Object.values(limits).some((limit) => limit !== undefined) ? new RunBudget(limits, now) : undefined;
  }

  status(): RunBudgetStatus {
    return { ...this.limits, requests: this.requests, tokens: this.tokens, unreportedRequests: this.unreportedRequests, elapsedMs: this.now() - this.startedAt };
  }

  /** The limit the next request would break, if any. */
  exhaustedReason(): string | undefined {
    const { maxRequests, maxTokens, maxDurationMs } = this.limits;
    const elapsed = this.now() - this.startedAt;
    if (maxRequests !== undefined && this.requests >= maxRequests) return `${this.requests} of ${maxRequests} model requests used`;
    if (maxTokens !== undefined && this.tokens >= maxTokens) return `${this.tokens.toLocaleString()} of ${maxTokens.toLocaleString()} tokens used`;
    if (maxDurationMs !== undefined && elapsed >= maxDurationMs) return `${Math.round(elapsed / 1_000)}s of ${Math.round(maxDurationMs / 1_000)}s elapsed`;
    return undefined;
  }

  /** Throws before a request that the budget no longer covers. */
  assertRequestAllowed(): void {
    const reason = this.exhaustedReason();
    if (!reason) return;
    const note = this.unreportedRequests > 0 ? ` (${this.unreportedRequests} request${this.unreportedRequests === 1 ? '' : 's'} reported no token usage)` : '';
    throw new RunBudgetExceededError(`Run budget exhausted: ${reason}${note}. Raise the limit with --max-requests, --max-tokens, or --max-duration, or agent.budget in the config.`, this.status());
  }

  recordRequest(): void {
    this.requests += 1;
  }

  recordUsage(usage: LLMUsage | undefined): void {
    if (!usage) {
      this.unreportedRequests += 1;
      return;
    }
    this.tokens += usage.totalTokens || (usage.promptTokens + usage.completionTokens);
  }

  describe(): string {
    const parts: string[] = [];
    if (this.limits.maxRequests !== undefined) parts.push(`${this.requests}/${this.limits.maxRequests} requests`);
    if (this.limits.maxTokens !== undefined) parts.push(`${this.tokens.toLocaleString()}/${this.limits.maxTokens.toLocaleString()} tokens`);
    if (this.limits.maxDurationMs !== undefined) parts.push(`${Math.round((this.now() - this.startedAt) / 1_000)}/${Math.round(this.limits.maxDurationMs / 1_000)}s`);
    return parts.join(' · ');
  }
}

/** The subset a model caller needs. */
export type RunBudgetGate = Pick<RunBudget, 'assertRequestAllowed' | 'recordRequest' | 'recordUsage'>;
