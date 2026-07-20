/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { writeAutohandDebugLine } from '../../utils/debugLog.js';

const SAFE_ERROR_TYPES = new Set([
  'Error',
  'AggregateError',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
  'AbortError',
  'TimeoutError',
]);

/**
 * Emit opt-in RPC diagnostics. Callers must provide operational metadata only.
 */
export function writeRpcDebugLine(message: string): void {
  writeAutohandDebugLine(`[RPC DEBUG] ${message}`);
}

/**
 * Describe an error without exposing its message, stack, or attached payloads.
 */
export function getRpcErrorMetadata(error: unknown): string {
  const fallbackType = typeof error;
  let errorType: string = fallbackType;
  let messageLength = typeof error === 'string' ? error.length : 0;

  try {
    if (error instanceof Error) {
      errorType = SAFE_ERROR_TYPES.has(error.name) ? error.name : 'Error';
      messageLength = typeof error.message === 'string' ? error.message.length : 0;
    }
  } catch {
    errorType = fallbackType;
    messageLength = 0;
  }

  return `errorType=${errorType}, messageLength=${messageLength}`;
}

/**
 * Describe a JSON-RPC identifier without exposing a client-controlled value.
 */
export function getRpcIdMetadata(id: string | number | null): string {
  if (typeof id === 'string') {
    return `idType=string idLength=${id.length}`;
  }

  return `idType=${id === null ? 'null' : 'number'}`;
}
