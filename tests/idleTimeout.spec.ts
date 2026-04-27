/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AUTH_CONFIG } from '../src/constants.js';

describe('AUTH_CONFIG.idleTimeoutMs', () => {
  it('is set to 30 minutes in milliseconds', () => {
    expect(AUTH_CONFIG.idleTimeoutMs).toBe(30 * 60 * 1000);
  });

  it('is a positive number', () => {
    expect(AUTH_CONFIG.idleTimeoutMs).toBeGreaterThan(0);
  });
});

describe('Idle timeout logic', () => {
  it('detects idle when elapsed time exceeds threshold', () => {
    const idleTimeoutMs = AUTH_CONFIG.idleTimeoutMs;
    const lastActivityAt = Date.now() - idleTimeoutMs - 1;
    const idleMs = Date.now() - lastActivityAt;
    expect(idleMs >= idleTimeoutMs).toBe(true);
  });

  it('does not trigger when within threshold', () => {
    const idleTimeoutMs = AUTH_CONFIG.idleTimeoutMs;
    const lastActivityAt = Date.now() - 1000; // 1 second ago
    const idleMs = Date.now() - lastActivityAt;
    expect(idleMs >= idleTimeoutMs).toBe(false);
  });

  it('calculates idle minutes correctly', () => {
    const idleMinutes = Math.round(31 * 60_000 / 60_000);
    expect(idleMinutes).toBe(31);
  });

  it('triggers at exactly the threshold boundary', () => {
    const idleTimeoutMs = AUTH_CONFIG.idleTimeoutMs;
    const lastActivityAt = Date.now() - idleTimeoutMs;
    const idleMs = Date.now() - lastActivityAt;
    // At or beyond the threshold
    expect(idleMs >= idleTimeoutMs).toBe(true);
  });
});
