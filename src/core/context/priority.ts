/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Metadata extraction, priority scoring, sorting, and tool-call coherence.
 * Extracted from contextManager.ts for composability.
 */
import type { LLMMessage, MessagePriority, MessageMetadata } from '../../types.js';

/**
 * Extract critical context from a message (files, decisions, errors)
 */
export function extractMessageMetadata(message: LLMMessage): MessageMetadata {
  const content = message.content ?? '';
  const metadata: MessageMetadata = {};

  // Extract file paths (common patterns)
  const filePatterns = [
    /(?:^|\s)([\/\w.-]+\.[a-zA-Z]{1,5})(?:\s|$|:|\()/gm,
    /`([^`]+\.[a-zA-Z]{1,5})`/g,
    /["']([^"']+\.[a-zA-Z]{1,5})["']/g,
  ];

  const files = new Set<string>();
  for (const pattern of filePatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const file = match[1];
      if (file && !file.startsWith('http') && !file.includes('://')) {
        files.add(file);
      }
    }
  }
  if (files.size > 0) {
    metadata.files = [...files];
  }

  // Extract tool names from tool messages
  if (message.name) {
    metadata.tools = [message.name];
  }

  // Extract tool calls from assistant messages
  if (message.tool_calls && message.tool_calls.length > 0) {
    metadata.tools = message.tool_calls.map(tc => tc.function.name);
  }

  // Detect decision patterns
  const decisionPatterns = [
    /I('ll| will|'m going to| chose| decided| picked| selected)/i,
    /let's (use|go with|implement|create)/i,
    /we should (use|implement|create|add)/i,
    /the (best|better|recommended) (approach|option|choice)/i,
  ];
  metadata.isDecision = decisionPatterns.some(p => p.test(content));

  // Detect error patterns
  const errorPatterns = [
    /error:|failed:|exception:|crash|bug|issue:|problem:/i,
    /TypeError|SyntaxError|ReferenceError|Error:/,
    /❌|✗|FAIL|FAILED/,
  ];
  metadata.isError = errorPatterns.some(p => p.test(content));

  return metadata;
}

/**
 * Determine message priority based on content and role
 */
export function determineMessagePriority(message: LLMMessage): MessagePriority {
  const content = message.content ?? '';
  const metadata = message.metadata ?? extractMessageMetadata(message);

  // System messages are always critical
  if (message.role === 'system') {
    return 'critical';
  }

  // User messages with decisions/preferences are critical
  if (message.role === 'user') {
    if (metadata.isDecision) return 'critical';
    if (content.length < 100) return 'high';
    return 'high';
  }

  // Errors are high priority
  if (metadata.isError) {
    return 'high';
  }

  // Tool messages with file reads are medium-high
  if (message.role === 'tool' && metadata.files && metadata.files.length > 0) {
    return 'medium';
  }

  // Long tool outputs are lower priority (can be compressed)
  if (message.role === 'tool' && content.length > 2000) {
    return 'low';
  }

  // Assistant decisions are high
  if (message.role === 'assistant' && metadata.isDecision) {
    return 'high';
  }

  return 'medium';
}

/**
 * Sort messages by priority for selective removal.
 * Returns indices of messages sorted from lowest to highest priority.
 */
export function sortMessagesByPriority(messages: LLMMessage[]): number[] {
  const priorityOrder: Record<MessagePriority, number> = {
    'low': 0,
    'medium': 1,
    'high': 2,
    'critical': 3,
  };

  const indices = messages.map((msg, i) => ({
    index: i,
    priority: msg.priority ?? determineMessagePriority(msg),
    age: i,
  }));

  indices.sort((a, b) => {
    const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (priorityDiff !== 0) return priorityDiff;
    return a.age - b.age;
  });

  return indices.map(i => i.index);
}

/**
 * Ensure tool-call coherence when removing messages.
 * If a tool result is removed, its matching assistant tool_call must also go.
 * If an assistant with tool_calls is removed, all its tool results must also go.
 * This prevents API errors from dangling tool_call_ids.
 */
export function findCoherentRemovalIndices(
  messages: LLMMessage[],
  targetIndices: number[]
): number[] {
  const toRemove = new Set(targetIndices);

  // If removing a tool result, also remove the matching assistant tool_call
  for (const idx of [...toRemove]) {
    const msg = messages[idx];
    if (msg.role === 'tool' && msg.tool_call_id) {
      const assistantIdx = messages.findIndex(
        (m) =>
          m.role === 'assistant' &&
          m.tool_calls?.some((tc) => tc.id === msg.tool_call_id)
      );
      if (assistantIdx >= 0) toRemove.add(assistantIdx);
    }
  }

  // If removing an assistant with tool_calls, also remove all its tool results
  for (const idx of [...toRemove]) {
    const msg = messages[idx];
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        const toolIdx = messages.findIndex(
          (m) => m.role === 'tool' && m.tool_call_id === tc.id
        );
        if (toolIdx >= 0) toRemove.add(toolIdx);
      }
    }
  }

  return [...toRemove].sort((a, b) => a - b);
}
