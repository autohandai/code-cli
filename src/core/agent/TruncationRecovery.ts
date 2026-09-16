/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const MAX_CONSECUTIVE_TRUNCATION_REPAIRS = 3;

const CONCISE_REPLACEMENT_INSTRUCTION = ' Keep the complete replacement under 1,000 tokens.';

export type TruncationRecoveryDecision =
  | { type: 'retry'; note: string }
  | { type: 'exhausted'; summary: string };

/**
 * Counts consecutive provider truncations for one turn so both the main
 * loop and sub-agents stop at the same bound with the same wording.
 */
export class TruncationRecoveryTracker {
  private consecutiveTruncations = 0;

  observeCompleteResponse(): void {
    this.consecutiveTruncations = 0;
  }

  observeTruncation(instruction: string): TruncationRecoveryDecision {
    this.consecutiveTruncations += 1;
    if (this.consecutiveTruncations >= MAX_CONSECUTIVE_TRUNCATION_REPAIRS) {
      return {
        type: 'exhausted',
        summary: `truncated ${MAX_CONSECUTIVE_TRUNCATION_REPAIRS} consecutive responses`,
      };
    }
    const conciseInstruction = this.consecutiveTruncations > 1 ? CONCISE_REPLACEMENT_INSTRUCTION : '';
    return {
      type: 'retry',
      note: `${instruction} Recovery ${this.consecutiveTruncations}/${MAX_CONSECUTIVE_TRUNCATION_REPAIRS}.${conciseInstruction}`,
    };
  }
}
