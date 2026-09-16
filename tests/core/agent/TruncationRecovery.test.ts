/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_CONSECUTIVE_TRUNCATION_REPAIRS,
  TruncationRecoveryTracker,
} from '../../../src/core/agent/TruncationRecovery.js';

describe('TruncationRecoveryTracker', () => {
  it('asks for a replacement and counts the attempt on the first truncation', () => {
    const tracker = new TruncationRecoveryTracker();

    const decision = tracker.observeTruncation('[System] Truncated.');

    expect(decision).toEqual({
      type: 'retry',
      note: `[System] Truncated. Recovery 1/${MAX_CONSECUTIVE_TRUNCATION_REPAIRS}.`,
    });
  });

  it('tightens the replacement budget from the second consecutive truncation onward', () => {
    const tracker = new TruncationRecoveryTracker();
    tracker.observeTruncation('[System] Truncated.');

    const decision = tracker.observeTruncation('[System] Truncated.');

    expect(decision.type).toBe('retry');
    expect(decision.type === 'retry' && decision.note).toContain(`Recovery 2/${MAX_CONSECUTIVE_TRUNCATION_REPAIRS}.`);
    expect(decision.type === 'retry' && decision.note).toContain('under 1,000 tokens');
  });

  it('reports exhaustion at the configured limit with wording derived from that limit', () => {
    const tracker = new TruncationRecoveryTracker();
    for (let attempt = 1; attempt < MAX_CONSECUTIVE_TRUNCATION_REPAIRS; attempt += 1) {
      tracker.observeTruncation('[System] Truncated.');
    }

    const decision = tracker.observeTruncation('[System] Truncated.');

    expect(decision.type).toBe('exhausted');
    expect(decision.type === 'exhausted' && decision.summary).toBe(
      `truncated ${MAX_CONSECUTIVE_TRUNCATION_REPAIRS} consecutive responses`,
    );
  });

  it('starts counting again after a complete response arrives', () => {
    const tracker = new TruncationRecoveryTracker();
    tracker.observeTruncation('[System] Truncated.');
    tracker.observeTruncation('[System] Truncated.');

    tracker.observeCompleteResponse();
    const decision = tracker.observeTruncation('[System] Truncated.');

    expect(decision).toEqual({
      type: 'retry',
      note: `[System] Truncated. Recovery 1/${MAX_CONSECUTIVE_TRUNCATION_REPAIRS}.`,
    });
  });
});
