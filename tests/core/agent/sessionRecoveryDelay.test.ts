/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../src/providers/errors.js';
import { formatRecoveryWait, isProviderOutage, resolveSessionRecoveryDelay } from '../../../src/core/agent/sessionRecoveryDelay.js';

const outage = new ApiError('The Autohand AI service is temporarily unavailable.', 'server_error', 503, true);
const other = new Error('Tool loop stalled');

describe('resolveSessionRecoveryDelay', () => {
  it('backs off provider outages from seconds and triples per attempt, capped at a minute', () => {
    expect([1, 2, 3, 4].map((attempt) => resolveSessionRecoveryDelay({ attempt, error: outage }))).toEqual([5_000, 15_000, 45_000, 60_000]);
    const network = new ApiError('Unable to connect.', 'network_error', 0, true);
    expect(resolveSessionRecoveryDelay({ attempt: 2, error: network })).toBe(15_000);
  });

  it('keeps the short schedule for errors that are not provider outages', () => {
    expect([1, 2, 3].map((attempt) => resolveSessionRecoveryDelay({ attempt, error: other }))).toEqual([1_000, 1_500, 2_250]);
  });

  it('honours a configured delay with the 1.5x schedule even for outages', () => {
    expect(resolveSessionRecoveryDelay({ attempt: 1, error: outage, configuredDelayMs: 0 })).toBe(0);
    expect(resolveSessionRecoveryDelay({ attempt: 3, error: outage, configuredDelayMs: 2_000 })).toBe(4_500);
  });

  it('never waits less than the provider retry-after', () => {
    const throttled = new ApiError('Capacity.', 'server_error', 503, true, 30_000);
    expect(resolveSessionRecoveryDelay({ attempt: 1, error: throttled })).toBe(30_000);
    expect(resolveSessionRecoveryDelay({ attempt: 1, error: throttled, configuredDelayMs: 0 })).toBe(30_000);
  });

  it('classifies outages from messages when the error is not an ApiError', () => {
    expect(isProviderOutage(new Error('Request timed out. The service may be experiencing high load.'))).toBe(true);
    expect(isProviderOutage(other)).toBe(false);
    expect(formatRecoveryWait(15_000)).toBe('15s');
    expect(formatRecoveryWait(250)).toBe('250ms');
  });
});
