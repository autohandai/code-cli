/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The one answer to "may stored memories reach the model?". Every path that reads memories for a
 * prompt, a context note or a tool result asks here, so the `agent.useMemories` switch cannot be
 * honoured in one place and missed in another.
 */

interface MemoryUseConfig {
  agent?: { useMemories?: boolean };
}

/** `agent.useMemories`, on unless explicitly disabled. Read it per use: the setting is live. */
export function areMemoriesUsed(config: MemoryUseConfig | undefined): boolean {
  return config?.agent?.useMemories !== false;
}

/** Tools whose results hand stored memories back to the model. Writing tools are not listed. */
export const MEMORY_READ_TOOLS: ReadonlySet<string> = new Set(['recall_memory', 'inspect_memory']);

/** A memory-reading tool is neither advertised nor runnable while memories are not used. */
export function isMemoryReadToolWithheld(toolName: string, config: MemoryUseConfig | undefined): boolean {
  return MEMORY_READ_TOOLS.has(toolName) && !areMemoriesUsed(config);
}

export const MEMORY_USE_OFF_MESSAGE =
  'Memory use is turned off (agent.useMemories is false), so stored memories are not available in this session.';
