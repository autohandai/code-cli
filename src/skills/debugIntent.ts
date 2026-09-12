/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Debugging intent detection for auto-injecting the built-in
 * `systematic-debugging` skill. Precision-biased like the brainstorm matcher:
 * it fires on failure-shaped requests ("this test fails", "why does X crash",
 * a pasted stack trace) and stays silent on ordinary edits or on the word
 * "bug" used as a noun in feature work ("add a bug report form").
 */

const DEBUG_PATTERNS: readonly RegExp[] = [
  /\b(?:debug|troubleshoot|diagnose)\b/i,
  /\b(?:tests?|build|ci|pipeline|command|script|deploy|it|this|that|which)\s+(?:is\s+|are\s+|keeps?\s+|still\s+)?(?:failing|fails|failed|crashing|crashes|crashed|hanging|hangs|broken|breaks|timing out|times out|flaky)\b/i,
  /\b(?:why|what)\s+(?:does|did|is|are|do)\s+(?:\w+\s+){0,4}?(?:fail|failing|crash|crashing|throw|throwing|hang|hanging|break|breaking|not\s+work(?:ing)?|wrong)\b/i,
  /\b(?:not|isn'?t|doesn'?t|won'?t|stopped)\s+work(?:ing)?\b/i,
  /\b(?:stack\s*trace|traceback|segfault|core dumped|unhandled (?:exception|rejection)|uncaught)\b/i,
  /\b(?:fix|investigate|look into)\s+(?:the|this|a|an)\s+(?:bug|crash|error|exception|failure|regression|flake)\b/i,
  /\b(?:error|exception|regression)\b.*\b(?:fix|investigate|why|happens?|occurs?)\b/i,
  /\b[A-Z][A-Za-z]*(?:Error|Exception)\b(?::|\s)/,
];

/** True when the instruction reads as a request to find out why something fails. */
export function matchesDebugIntent(instruction: string): boolean {
  const text = instruction?.trim();
  if (!text) return false;
  return DEBUG_PATTERNS.some((pattern) => pattern.test(text));
}

export interface DebugAutoInjectionParams {
  instruction: string;
  /** True when the skill was already injected this turn (e.g. via `$systematic-debugging`). */
  alreadyInjected: boolean;
  /** Brainstorming wins when both match; a design conversation is not a debugging session. */
  brainstormInjected: boolean;
}

export function resolveDebugAutoInjection(params: DebugAutoInjectionParams): boolean {
  if (params.alreadyInjected || params.brainstormInjected) return false;
  return matchesDebugIntent(params.instruction);
}
