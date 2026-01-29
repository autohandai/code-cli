/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Display utilities for smart content rendering
 */

export interface ContentDisplay {
  /** What to show in UI */
  visual: string;
  /** Full content for LLM */
  actual: string;
  /** Whether indicator was applied */
  isPasted: boolean;
  /** Total lines in content */
  lineCount: number;
}

/**
 * Determine how to display content based on line count.
 * Shows compact indicator for pastes with 5+ lines.
 */
export function getContentDisplay(text: string): ContentDisplay {
  if (!text) {
    return {
      visual: '',
      actual: '',
      isPasted: false,
      lineCount: 1
    };
  }

  const lines = text.split('\n');
  const lineCount = lines.length;

  if (lineCount >= 5) {
    return {
      visual: `[Text pasted: ${lineCount} lines]`,
      actual: text,
      isPasted: true,
      lineCount
    };
  }

  return {
    visual: text,
    actual: text,
    isPasted: false,
    lineCount
  };
}
