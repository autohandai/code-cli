/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface SequencedQueuedWork {
  text: string;
  sequence: number;
}

let nextSequence = 1;

/**
 * Allocate one process-local FIFO ordinal.
 *
 * JavaScript enqueue callbacks are serialized, so a monotonic counter gives
 * every interactive source a strict ordering without timestamp collisions.
 */
export function nextQueuedWorkSequence(): number {
  const sequence = nextSequence;
  nextSequence += 1;
  return sequence;
}

export function createSequencedQueuedWork(text: string): SequencedQueuedWork {
  return {
    text,
    sequence: nextQueuedWorkSequence(),
  };
}
