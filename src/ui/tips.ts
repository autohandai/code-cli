/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const DEFAULT_TIPS: string[] = [
  'Use @filename to give the agent context about specific files',
  'Press Shift+Tab to toggle plan mode for read-only exploration',
  'Type /undo to revert the last change the agent made',
  'Use /memory to save and recall project-specific notes',
  'Press Shift+Enter to add newlines in your prompt',
  'Type /sessions to list and /resume to continue a past session',
  'Prefix with ! to run shell commands without leaving autohand',
  'Drag and drop images into the prompt for visual context',
  'Use /new to reset conversation context when switching topics',
  'Be specific in your instructions for better results',
  'Mention multiple @files in one prompt to give broader context',
  'Use /model to switch LLM models mid-session',
  'Press ESC to cancel an in-flight LLM request',
  'Use /help to see all available slash commands',
  'Type /init to scaffold an AGENTS.md template in your workspace',
  'Review diffs carefully before approving destructive operations',
  'Use /feedback to report issues or suggest improvements',
  'Ctrl+C once clears input, twice exits autohand',
  'Use /agents to manage sub-agents for parallel tasks',
  'Pin important context with @file so the model always sees it',
];

/**
 * Shuffle-bag random tip selector.
 * Returns each tip once before reshuffling, preventing repeats.
 */
export class TipsBag {
  private pool: string[];
  private remaining: string[] = [];

  constructor(tips?: string[]) {
    this.pool = tips ?? DEFAULT_TIPS;
  }

  get size(): number {
    return this.pool.length;
  }

  next(): string {
    if (this.remaining.length === 0) {
      this.remaining = [...this.pool];
      // Fisher-Yates shuffle
      for (let i = this.remaining.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.remaining[i], this.remaining[j]] = [this.remaining[j], this.remaining[i]];
      }
    }
    return this.remaining.pop()!;
  }
}
