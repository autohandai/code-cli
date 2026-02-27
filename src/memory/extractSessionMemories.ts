/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LLMProvider } from '../providers/LLMProvider.js';
import type { MemoryManager } from './MemoryManager.js';
import type { MemoryLevel } from './types.js';
import type { LLMMessage } from '../types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ExtractedMemory {
  content: string;
  level: MemoryLevel;
  tags: string[];
}

export interface ExtractionDeps {
  llm: LLMProvider;
  memoryManager: MemoryManager;
  conversationHistory: LLMMessage[];
  workspaceRoot: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_LEVELS: ReadonlySet<string> = new Set<MemoryLevel>(['user', 'project']);

const MIN_USER_MESSAGES = 2;

const EXTRACTION_PROMPT = `Analyze this conversation and extract patterns, preferences, and insights worth remembering for future sessions.

Rules:
- Only extract genuinely useful patterns: coding style, tool preferences, workflow habits, project conventions, architectural decisions
- Classify as "user" (personal preferences that apply across all projects) or "project" (specific to this codebase/workspace)
- Be concise: each memory should be 1-2 sentences max
- Skip trivial, one-off, or context-specific observations
- If nothing is worth saving, return an empty array

Return ONLY a JSON array (no markdown, no explanation):
[{ "content": "...", "level": "user" | "project", "tags": ["..."] }]`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Count the number of messages with role 'user' */
function countUserMessages(messages: LLMMessage[]): number {
  return messages.filter((m) => m.role === 'user').length;
}

/** Strip markdown code fences (```json ... ```) from LLM output */
function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  // Match ```json ... ``` or ``` ... ```
  const fenceRegex = /^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/;
  const match = fenceRegex.exec(trimmed);
  return match ? match[1].trim() : trimmed;
}

/** Validate and type-narrow a single parsed entry */
function isValidMemory(entry: unknown): entry is ExtractedMemory {
  if (typeof entry !== 'object' || entry === null) return false;
  const obj = entry as Record<string, unknown>;
  return (
    typeof obj.content === 'string' &&
    obj.content.length > 0 &&
    typeof obj.level === 'string' &&
    VALID_LEVELS.has(obj.level)
  );
}

/** Normalise tags to a string array, falling back to empty */
function normaliseTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((t): t is string => typeof t === 'string');
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Extract session memories from conversation history via LLM and persist them.
 *
 * This function **never throws** -- all errors are caught and result in an
 * empty (or partial) return array so callers do not need to handle failures.
 */
export async function extractAndSaveSessionMemories(
  deps: ExtractionDeps,
): Promise<ExtractedMemory[]> {
  const { llm, memoryManager, conversationHistory } = deps;

  // Gate: need at least MIN_USER_MESSAGES user messages
  if (countUserMessages(conversationHistory) < MIN_USER_MESSAGES) {
    return [];
  }

  // Build the LLM request
  let rawContent: string;
  try {
    const response = await llm.complete({
      messages: [
        { role: 'system', content: EXTRACTION_PROMPT },
        ...conversationHistory,
      ],
      temperature: 0.3,
      maxTokens: 1024,
    });
    rawContent = response.content;
  } catch {
    // Network / provider error -- return gracefully
    return [];
  }

  // Parse the response JSON
  let parsed: unknown[];
  try {
    const cleaned = stripCodeFences(rawContent);
    const json = JSON.parse(cleaned);
    if (!Array.isArray(json)) return [];
    parsed = json;
  } catch {
    // Invalid JSON -- return gracefully
    return [];
  }

  if (parsed.length === 0) return [];

  // Validate, store, and collect results
  const saved: ExtractedMemory[] = [];

  for (const raw of parsed) {
    if (!isValidMemory(raw)) continue;

    // `raw` is narrowed to ExtractedMemory by the guard, but tags may be any
    // shape from the LLM -- normalise defensively via the untyped object.
    const rawObj = raw as unknown as Record<string, unknown>;

    const memory: ExtractedMemory = {
      content: raw.content,
      level: raw.level,
      tags: normaliseTags(rawObj.tags),
    };

    try {
      await memoryManager.store(
        memory.content,
        memory.level,
        memory.tags,
        'session-extraction',
      );
      saved.push(memory);
    } catch {
      // Individual store failure -- skip and continue
    }
  }

  return saved;
}
