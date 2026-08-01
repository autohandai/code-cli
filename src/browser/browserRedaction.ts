/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';

const SECRET_KEY_PATTERN =
  /(?:password|passcode|one[-_\s]?time|otp|verification[-_\s]?code|card(?:[-_\s]?number)?|cc[-_\s]?(?:number|csc|exp|name)|cvv|cvc|api[-_\s]?key|access[-_\s]?token|client[-_\s]?secret|authorization|cookie|secret)/i;
const SENSITIVE_QUERY_KEY =
  /^(?:code|token|access_token|refresh_token|id_token|api_key|key|secret|password|otp)$/i;
const FILE_KEYS = new Set(['file', 'files', 'path', 'paths']);

function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const key of url.searchParams.keys()) {
      if (SENSITIVE_QUERY_KEY.test(key)) url.searchParams.set(key, '[REDACTED]');
    }
    return url.toString();
  } catch {
    return value;
  }
}

function redactValue(value: unknown, key: string): unknown {
  if (SECRET_KEY_PATTERN.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) {
    return value.map((item) =>
      FILE_KEYS.has(key.toLowerCase()) && typeof item === 'string'
        ? path.basename(item)
        : redactValue(item, key));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
        childKey,
        redactValue(childValue, childKey),
      ]),
    );
  }
  if (typeof value === 'string' && FILE_KEYS.has(key.toLowerCase())) {
    return path.basename(value);
  }
  if (
    typeof value === 'string'
    && (key.toLowerCase().endsWith('url') || key.toLowerCase() === 'href')
  ) {
    return redactUrl(value);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function redactBrowserToolArguments(
  toolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (!toolName.startsWith('browser_')) return args;
  const redacted = redactValue(args, '');
  const safe = isRecord(redacted) ? redacted : {};
  if (toolName === 'browser_type' && typeof safe.text === 'string') {
    return { ...safe, text: '[REDACTED]' };
  }
  if (
    toolName === 'browser_handle_dialog'
    && typeof safe.promptText === 'string'
  ) {
    return { ...safe, promptText: '[REDACTED]' };
  }
  if (toolName === 'browser_wait_for' && isRecord(safe.condition)) {
    const condition = safe.condition;
    if (condition.kind === 'value' && typeof condition.value === 'string') {
      return {
        ...safe,
        condition: { ...condition, value: '[REDACTED]' },
      };
    }
  }
  if (toolName === 'browser_fill_form' && Array.isArray(safe.assignments)) {
    return {
      ...safe,
      assignments: safe.assignments.map((assignment) =>
        isRecord(assignment)
        && assignment.kind === 'text'
        && typeof assignment.text === 'string'
          ? { ...assignment, text: '[REDACTED]' }
          : assignment),
    };
  }
  return safe;
}
