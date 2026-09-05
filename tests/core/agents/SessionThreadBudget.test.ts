/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  getSessionThreadBudget,
  isValidSessionThreadLimit,
  SessionThreadBudget,
  SessionThreadLimitError,
} from '../../../src/core/agents/SessionThreadBudget.js';

describe('SessionThreadBudget', () => {
  it('reserves the lead thread and admits eight children by default', () => {
    const budget = new SessionThreadBudget();
    expect(budget.maxThreads).toBe(9);
    for (let i = 0; i < 8; i++) budget.tryAcquire(`child-${i}`);
    expect(budget.activeChildren).toBe(8);
    expect(budget.availableChildren).toBe(0);
    expect(() => budget.tryAcquire('ninth-child')).toThrow(SessionThreadLimitError);
  });

  it('shares capacity across direct, team, and nested runs without waiting on parents', () => {
    const budget = new SessionThreadBudget(() => 4);
    const direct = budget.tryAcquire('direct');
    budget.tryAcquire('team');
    budget.tryAcquire('team-child');
    expect(() => budget.tryAcquire('direct-child')).toThrow('4 concurrent threads');
    direct.release();
    expect(() => budget.tryAcquire('direct-child')).not.toThrow();
  });

  it('releases a lease at most once, even after its id is reused', () => {
    const budget = new SessionThreadBudget(() => 2);
    const prior = budget.tryAcquire('child');
    prior.release();
    const next = budget.tryAcquire('child');
    prior.release();
    expect(budget.activeChildren).toBe(1);
    expect(() => budget.tryAcquire('other')).toThrow(SessionThreadLimitError);
    next.release();
    expect(budget.availableChildren).toBe(1);
  });

  it('rejects duplicate active identifiers without releasing the original lease', () => {
    const budget = new SessionThreadBudget();
    budget.tryAcquire('same');
    expect(() => budget.tryAcquire('same')).toThrow('already registered');
    expect(budget.activeChildren).toBe(1);
  });

  it('applies live reductions without terminating existing children', () => {
    let limit = 4;
    const budget = new SessionThreadBudget(() => limit);
    const first = budget.tryAcquire('first');
    const second = budget.tryAcquire('second');
    limit = 2;
    expect(budget.activeChildren).toBe(2);
    expect(budget.availableChildren).toBe(0);
    expect(() => budget.tryAcquire('third')).toThrow(SessionThreadLimitError);
    first.release();
    expect(() => budget.tryAcquire('third')).toThrow(SessionThreadLimitError);
    second.release();
    expect(() => budget.tryAcquire('third')).not.toThrow();
  });

  it('supports lead-only sessions', () => {
    const budget = new SessionThreadBudget(() => 1);
    expect(() => budget.tryAcquire('child')).toThrow('Delegation is disabled');
  });

  it.each([0, -1, 1.5, 65, NaN, Infinity, '9', null])('rejects an invalid limit %s', (value) => {
    expect(isValidSessionThreadLimit(value)).toBe(false);
  });

  it.each([1, 2, 9, 64])('accepts a valid limit %s', (value) => {
    expect(isValidSessionThreadLimit(value)).toBe(true);
  });

  it('fails closed if a runtime limit becomes invalid', () => {
    const budget = new SessionThreadBudget(() => NaN);
    expect(() => budget.tryAcquire('child')).toThrow('integer between 1 and 64');
    expect(budget.activeChildren).toBe(0);
  });

  it('reuses a budget for one config identity and resolves the latest setting', () => {
    const config = { features: { multi_agent_v2: { max_concurrent_threads_per_session: 2 } } };
    const budget = getSessionThreadBudget(config);
    budget.tryAcquire('child');
    expect(getSessionThreadBudget(config)).toBe(budget);
    expect(getSessionThreadBudget({ ...config })).not.toBe(budget);
    config.features.multi_agent_v2.max_concurrent_threads_per_session = 4;
    expect(budget.availableChildren).toBe(2);
  });

  it('does not share sessionless budgets globally', () => {
    expect(getSessionThreadBudget()).not.toBe(getSessionThreadBudget());
  });
});
