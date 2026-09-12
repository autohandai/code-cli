/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { MAX_STEERING_MESSAGES, SteeringQueue } from '../../../src/core/agent/SteeringQueue.js';

describe('SteeringQueue', () => {
  it('keeps trimmed messages in order and drains them once', () => {
    const queue = new SteeringQueue();
    expect(queue.push('  focus on tests  ')).toBe(true);
    expect(queue.push('skip docs')).toBe(true);
    expect(queue.size).toBe(2);
    expect(queue.drain()).toEqual(['focus on tests', 'skip docs']);
    expect(queue.drain()).toEqual([]);
  });

  it('rejects blank and oversized messages and bounds the backlog', () => {
    const queue = new SteeringQueue();
    expect(queue.push('   ')).toBe(false);
    expect(queue.push('x'.repeat(8_001))).toBe(false);
    for (let index = 0; index < MAX_STEERING_MESSAGES + 5; index += 1) queue.push(`message ${index}`);
    const drained = queue.drain();
    expect(drained).toHaveLength(MAX_STEERING_MESSAGES);
    expect(drained[0]).toBe('message 5');
  });
});
