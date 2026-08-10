/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Brainstorm intent detection for auto-injecting the built-in `brainstorm`
 * skill. The playbook is large, so the matcher is precision-biased: it fires on
 * intent-shaped phrasing ("let's design", "how should we build", "brainstorm")
 * and stays silent on ordinary work ("fix the bug", "the design is broken").
 */

/**
 * Ordered patterns that signal the user wants to explore a design rather than
 * execute a concrete change. Each requires an intent verb next to the design
 * noun so bare mentions ("the design is broken") never match.
 */
const BRAINSTORM_PATTERNS: readonly RegExp[] = [
  /\bbrainstorm/i,
  /\b(?:let'?s|lets|help me|can we|should we|shall we|why don'?t we)\s+(?:\w+\s+){0,2}?(?:design|architect|structure|plan|model|spec|approach)\b/i,
  /\bhow\s+(?:should|would|do|can|might)\s+(?:we|i|you)\s+(?:\w+\s+){0,2}?(?:design|architect|build|structure|approach|model|implement)\b/i,
  /\bwhat(?:'?s| is)\s+the\s+best\s+(?:approach|architecture|design|way)\b/i,
  /\bthink\s+through\b/i,
  /\bspec(?:\s+it)?\s+out\b/i,
  /\bweigh\s+(?:the\s+)?(?:options|trade-?offs|alternatives|pros)\b/i,
  /\b(?:explore|compare|evaluate)\s+(?:the\s+)?(?:options|approaches|alternatives|designs?|architectures?)\b/i,
  /\b(?:design|architect)\s+(?:a|an|the)\s+new\b/i,
];

/**
 * True when the instruction reads as a request to brainstorm/design rather than
 * to carry out a specific edit.
 */
export function matchesBrainstormIntent(instruction: string): boolean {
  const text = instruction?.trim();
  if (!text) {
    return false;
  }
  return BRAINSTORM_PATTERNS.some((pattern) => pattern.test(text));
}

export interface BrainstormAutoInjectionParams {
  /** The user's instruction for this turn. */
  instruction: string;
  /**
   * Whether plan mode is active in its planning phase. The executing phase is
   * deliberately excluded: once a plan is accepted the user wants it built, not
   * re-brainstormed.
   */
  planModeActive: boolean;
  /** Whether the brainstorm skill was already injected this turn (e.g. via `$brainstorm`). */
  alreadyInjected: boolean;
}

/**
 * Decide whether to auto-inject the brainstorm playbook for this turn. Planning-
 * phase plan mode always injects; normal mode injects only on intent match.
 * Never double-injects.
 */
export function resolveBrainstormAutoInjection(params: BrainstormAutoInjectionParams): boolean {
  if (params.alreadyInjected) {
    return false;
  }
  return params.planModeActive || matchesBrainstormIntent(params.instruction);
}
