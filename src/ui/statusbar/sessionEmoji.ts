/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Deterministic session emoji.
 *
 * The same session name always maps to the same emoji (stable hash), so a
 * session keeps its identity across runs and across terminals. Distinct names
 * map to distinct emoji from a curated, monospace-safe set.
 */

/** Curated, distinct, monospace-safe emoji for sessions. */
export const SESSION_EMOJI = [
  '🦊', '🐙', '🦄', '🐬', '🦜', '🐢', '🦉', '🐺',
  '🦋', '🐝', '🦩', '🐳', '🦔', '🐿️', '🦭', '🐉',
] as const;

/**
 * Curated, distinct, monospace-safe emoji for projects.
 *
 * Disjoint from SESSION_EMOJI so a project emoji is never confused with a
 * session emoji at a glance. Objects/landmarks convey "place" (where am I),
 * while the session pool uses animals/creatures to convey "activity."
 */
export const PROJECT_EMOJI = [
  '📦', '🏗️', '🧩', '⚙️', '🔧', '🧱', '🚀', '🛠️',
  '🧪', '💡', '🔗', '🎯', '🏛️', '🚂', '🧭', '🔬',
] as const;

/** djb2-style string hash, normalized to a non-negative integer. */
export function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** The deterministic emoji for a session name (empty → ''). */
export function emojiForName(name: string): string {
  if (!name.trim()) {
    return '';
  }
  return SESSION_EMOJI[hashString(name) % SESSION_EMOJI.length];
}

/** The deterministic emoji for a project path (empty → ''). */
export function emojiForProject(projectPath: string): string {
  if (!projectPath.trim()) {
    return '';
  }
  return PROJECT_EMOJI[hashString(projectPath) % PROJECT_EMOJI.length];
}