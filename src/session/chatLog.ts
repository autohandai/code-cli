/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SessionMessage } from './types.js';

export interface ChatLogMessage {
  role: 'user' | 'assistant' | 'tool' | 'completion' | 'notification';
  content: string;
  tool?: string;
  success?: boolean;
}

function decodeJsonStringLiteral(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value;
  }
}

function extractJsonStringField(raw: string, field: string): string | null {
  const match = raw.match(new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 's'));
  return match?.[1] ? decodeJsonStringLiteral(match[1]) : null;
}

export function getAssistantChatLogContent(content: string): string | null {
  const trimmed = content.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    for (const field of ['finalResponse', 'response', 'content', 'message']) {
      const value = parsed[field];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }

    return null;
  } catch {
    const finalResponse = extractJsonStringField(trimmed, 'finalResponse') ??
      extractJsonStringField(trimmed, 'response');
    if (finalResponse?.trim()) {
      return finalResponse.trim();
    }

    if (trimmed.startsWith('{') || trimmed.includes('"thought"')) {
      return null;
    }

    return trimmed;
  }
}

export function buildSessionChatLog(messages: SessionMessage[]): ChatLogMessage[] {
  const chatMessages: ChatLogMessage[] = [];

  for (const message of messages) {
    if (message.role === 'user') {
      const content = message.content.trim();
      if (content) {
        chatMessages.push({ role: 'user', content });
      }
      continue;
    }

    if (message.role === 'assistant') {
      const content = getAssistantChatLogContent(message.content);
      if (content) {
        chatMessages.push({ role: 'assistant', content });
      }
    }
  }

  return chatMessages;
}

export function formatChatLogPreview(content: string, maxLength = 100): string {
  const singleLine = content
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return singleLine.length > maxLength
    ? `${singleLine.slice(0, maxLength)}...`
    : singleLine;
}
