/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { RunBudget, RunBudgetExceededError } from '../../../src/core/agent/RunBudget.js';

describe('RunBudget', () => {
  it('is absent without limits and prefers CLI flags over config', () => {
    expect(RunBudget.fromSettings(undefined, undefined)).toBeUndefined();
    expect(RunBudget.fromSettings({ maxTokens: 0 }, { maxTokens: -5 })).toBeUndefined();
    const budget = RunBudget.fromSettings({ maxRequests: 3 }, { maxRequests: 10, maxTokens: 500, maxDurationSeconds: 60 })!;
    expect(budget.limits).toEqual({ maxRequests: 3, maxTokens: 500, maxDurationMs: 60_000 });
  });

  it('refuses the request that would exceed the request limit and names the limit', () => {
    const budget = new RunBudget({ maxRequests: 2 });
    budget.assertRequestAllowed(); budget.recordRequest();
    budget.assertRequestAllowed(); budget.recordRequest();
    expect(() => budget.assertRequestAllowed()).toThrow(RunBudgetExceededError);
    expect(() => budget.assertRequestAllowed()).toThrow('Run budget exhausted: 2 of 2 model requests used');
    try { budget.assertRequestAllowed(); } catch (error) {
      expect((error as RunBudgetExceededError).retryable).toBe(false);
      expect((error as RunBudgetExceededError).status).toMatchObject({ requests: 2, maxRequests: 2 });
    }
  });

  it('counts reported tokens, notes unreported requests, and stops at the token limit', () => {
    const budget = new RunBudget({ maxTokens: 100 });
    budget.recordRequest(); budget.recordUsage({ promptTokens: 40, completionTokens: 20, totalTokens: 60 });
    budget.recordRequest(); budget.recordUsage(undefined);
    budget.assertRequestAllowed();
    budget.recordRequest(); budget.recordUsage({ promptTokens: 30, completionTokens: 10, totalTokens: 40 });
    expect(() => budget.assertRequestAllowed()).toThrow('100 of 100 tokens used (1 request reported no token usage)');
    expect(budget.describe()).toBe('100/100 tokens');
  });

  it('stops once the wall-time limit has passed', () => {
    let now = 1_000;
    const budget = new RunBudget({ maxDurationMs: 5_000 }, () => now);
    budget.assertRequestAllowed();
    now = 6_500;
    expect(() => budget.assertRequestAllowed()).toThrow('6s of 5s elapsed');
    expect(budget.status()).toMatchObject({ elapsedMs: 5_500, requests: 0 });
  });
});
