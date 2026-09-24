/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Precision-biased intent detection for the built-in native computer control
 * skill. Source-code requests often contain words such as browser, desktop,
 * screenshot, or click, so each pattern also requires an interaction-shaped
 * phrase or a concrete desktop application target.
 */

const KNOWN_APP = '(?:browser|chrome|chromium|safari|firefox|edge|spotify|slack|discord|finder|explorer|notes|notepad|terminal|iterm|ghostty|vscode|visual studio code|figma|zoom|teams|outlook|mail|calendar|settings|system settings)';

const COMPUTER_CONTROL_PATTERNS: readonly RegExp[] = [
  /\b(?:use|control|drive|operate)\s+(?:my|the)\s+(?:computer|desktop|laptop|machine)\b/i,
  new RegExp(`\\b(?:open|launch|start|switch to|bring up|go to)\\s+(?:my\\s+|the\\s+)?${KNOWN_APP}\\b`, 'i'),
  new RegExp(`\\b(?:click|double[- ]?click|right[- ]?click|scroll|type|press|select|drag|focus|close)\\b.{0,80}\\b(?:in|inside|on)\\s+(?:the\\s+)?${KNOWN_APP}(?:\\s+(?:app|window))?\\b`, 'i'),
  /\b(?:click|double[- ]?click|right[- ]?click|scroll|type|press|select|drag|focus|close|dismiss)\b.{0,80}\b(?:app|window|dialog|desktop|screen)\b/i,
  /\b(?:play|pause|resume|skip)\b.{0,100}\b(?:on|in|with)\s+spotify\b/i,
  /\bgo\s+to\s+spotify\b/i,
  /\b(?:take|capture)\s+(?:a\s+)?screenshot\s+of\s+(?:my|the)\s+(?:desktop|screen|window)\b/i,
  /\bswitch\s+to\s+(?:the\s+)?(?:previous|next|other|\w+)\s+window\b/i,
  /\bopen\s+(?:the\s+)?[\w .'-]+\s+app\b/i,
];

/** True when the request asks Autohand to operate the host's native GUI. */
export function matchesComputerControlIntent(instruction: string): boolean {
  const text = instruction?.trim();
  if (!text) return false;
  return COMPUTER_CONTROL_PATTERNS.some((pattern) => pattern.test(text));
}

export interface ComputerControlAutoInjectionParams {
  instruction: string;
  /** True when `$computer-control` already activated the skill this turn. */
  alreadyInjected: boolean;
}

export function resolveComputerControlAutoInjection(
  params: ComputerControlAutoInjectionParams,
): boolean {
  return !params.alreadyInjected && matchesComputerControlIntent(params.instruction);
}
