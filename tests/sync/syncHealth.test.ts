/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { resolveSyncHealth } from '../../src/sync/syncHealth.js';

describe('settings sync health', () => {
  const now = Date.parse('2026-11-03T00:00:00Z');
  it('keeps a new profile clear until a first attempt records its result', () => {
    expect(resolveSyncHealth({}, undefined, 300000, now)).toEqual({ lastSync: null });
  });
  it('retains the first failure and last successful time', () => {
    expect(resolveSyncHealth({ lastSync: '2026-11-02T23:30:00Z', lastError: '413 Payload too large', failingSince: '2026-11-02T23:35:00Z' }, now, 300000, now))
      .toMatchObject({ lastError: '413 Payload too large', failingSince: '2026-11-02T23:35:00Z', lastSync: '2026-11-02T23:30:00Z' });
  });
  it('marks a state file older than two intervals and clears after a fresh success', () => {
    const state = { lastSync: '2026-11-02T23:30:00Z' };
    expect(resolveSyncHealth(state, now - 600001, 300000, now).failingSince).toBe(state.lastSync);
    expect(resolveSyncHealth(state, now - 600000, 300000, now).lastError).toBeUndefined();
    expect(resolveSyncHealth(state, now, 300000, now).lastError).toBeUndefined();
  });
});
