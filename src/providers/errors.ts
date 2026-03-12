/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Centralized API error classification.
 *
 * Every provider (OpenRouter, Azure, MLX, Ollama, LLMGateway) and every
 * consumer (agent.ts, RPC adapter, ACP adapter) delegates to this module
 * so error handling logic lives in one place.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Exhaustive union of all known API error categories.
 */
export type ApiErrorCode =
  | 'context_overflow'
  | 'model_not_found'
  | 'invalid_request'
  | 'auth_failed'
  | 'payment_required'
  | 'access_denied'
  | 'rate_limited'
  | 'server_error'
  | 'network_error'
  | 'timeout'
  | 'cancelled'
  | 'unknown';

// ---------------------------------------------------------------------------
// ApiError
// ---------------------------------------------------------------------------

/**
 * Structured error that carries a machine-readable `code`, HTTP status,
 * retry semantics, and an optional `Retry-After` delay.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly rawDetail?: string;

  constructor(
    message: string,
    code: ApiErrorCode,
    httpStatus: number,
    retryable: boolean,
    retryAfterMs?: number,
    rawDetail?: string,
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
    this.rawDetail = rawDetail;
  }
}

// ---------------------------------------------------------------------------
// Friendly messages (one per code)
// ---------------------------------------------------------------------------

export const FRIENDLY_MESSAGES: Record<ApiErrorCode, string> = {
  context_overflow:
    'The conversation is too long for this model. Try /undo to remove recent turns or /new to start fresh.',
  model_not_found:
    'The requested model was not found. Use /model to select a different one.',
  invalid_request:
    'The request was malformed and could not be processed.',
  auth_failed:
    'Authentication failed. Please verify your API key in ~/.autohand/config.json.',
  payment_required:
    'Payment required. Please check your account balance or billing settings.',
  access_denied:
    'Access denied. Your API key may not have permission for this model.',
  rate_limited:
    'Rate limit exceeded. Please wait a moment and try again, or choose a different model.',
  server_error:
    'The AI service encountered an error. Please try again later.',
  network_error:
    'Unable to connect to the AI service. Please check your internet connection.',
  timeout:
    'The request timed out. The AI service may be experiencing high load.',
  cancelled:
    'Request cancelled.',
  unknown:
    'An unexpected error occurred. Please try again.',
};

// ---------------------------------------------------------------------------
// Body-pattern matchers (order matters — model checks BEFORE overflow)
// ---------------------------------------------------------------------------

/** Patterns that indicate a model-not-found error in a 400 body. */
const MODEL_NOT_FOUND_PATTERNS = [
  'invalid model',
  'model does not exist',
  'model not found',
  'no endpoints found for model',
  'does not exist or you do not have access',
  // Catch "model 'xyz' not found" where 'not found' is separate from 'model'
  "' not found",
  "\" not found",
] as const;

/**
 * Patterns that indicate a context/payload overflow in a 400 body.
 * These must be narrow enough to avoid false positives for generic errors
 * that happen to contain the word "context".
 */
const CONTEXT_OVERFLOW_PATTERNS = [
  'maximum context length',
  'context length exceeded',
  'context is too long',
  'prompt is too long',
  'reduce the length',
  'payload too large',
  'context window',
  'token limit',
  'tokens exceeds',
  'too many tokens',
] as const;

/** Patterns that indicate cancellation in status-0 / unknown errors. */
const CANCEL_PATTERNS = [
  'cancelled',
  'canceled',
  'aborted',
  'user force closed',
] as const;

/** Patterns that indicate a network error in status-0 / unknown errors. */
const NETWORK_PATTERNS = [
  'econnrefused',
  'econnreset',
  'enotfound',
  'etimedout',
  'fetch failed',
  'network',
  'unable to connect',
] as const;

/** Patterns that indicate a timeout in status-0 / unknown errors. */
const TIMEOUT_PATTERNS = [
  'timed out',
  'timeout',
] as const;

// ---------------------------------------------------------------------------
// Classifier (pure function)
// ---------------------------------------------------------------------------

/**
 * Classify an API error from its HTTP status, error body text, and optional
 * response headers.
 *
 * Classification order for 400s:
 *   1. Model-not-found patterns (MUST run before context overflow)
 *   2. Context overflow patterns
 *   3. Fallback to invalid_request
 *
 * Returns a fully-populated `ApiError`.
 */
export function classifyApiError(
  httpStatus: number,
  errorBody: string,
  headers?: Headers,
): ApiError {
  const lower = errorBody.toLowerCase();

  // -------------------------------------------------------------------
  // Status-first classification (non-400 codes are unambiguous)
  // -------------------------------------------------------------------

  if (httpStatus === 401) {
    return makeError('auth_failed', httpStatus, false, errorBody, headers);
  }

  if (httpStatus === 402) {
    return makeError('payment_required', httpStatus, false, errorBody, headers);
  }

  if (httpStatus === 403) {
    return makeError('access_denied', httpStatus, false, errorBody, headers);
  }

  if (httpStatus === 404) {
    return makeError('model_not_found', httpStatus, false, errorBody, headers);
  }

  if (httpStatus === 429) {
    return makeError('rate_limited', httpStatus, true, errorBody, headers);
  }

  if (httpStatus === 504) {
    return makeError('timeout', httpStatus, true, errorBody, headers);
  }

  if (httpStatus >= 500) {
    return makeError('server_error', httpStatus, true, errorBody, headers);
  }

  // -------------------------------------------------------------------
  // 400 — disambiguate via body patterns (order matters!)
  // -------------------------------------------------------------------

  if (httpStatus === 400) {
    // 1. Model-not-found check runs FIRST
    if (matchesAny(lower, MODEL_NOT_FOUND_PATTERNS)) {
      return makeError('model_not_found', httpStatus, false, errorBody, headers);
    }

    // 2. Context overflow
    if (matchesAny(lower, CONTEXT_OVERFLOW_PATTERNS)) {
      return makeError('context_overflow', httpStatus, true, errorBody, headers);
    }

    // 3. Fallback: generic invalid request
    return makeError('invalid_request', httpStatus, false, errorBody, headers);
  }

  // -------------------------------------------------------------------
  // Status 0 / unknown — heuristic classification from body text
  // -------------------------------------------------------------------

  if (matchesAny(lower, CANCEL_PATTERNS)) {
    return makeError('cancelled', httpStatus, false, errorBody, headers);
  }

  if (matchesAny(lower, TIMEOUT_PATTERNS)) {
    return makeError('timeout', httpStatus, true, errorBody, headers);
  }

  if (matchesAny(lower, NETWORK_PATTERNS)) {
    return makeError('network_error', httpStatus, true, errorBody, headers);
  }

  // Try to infer from body if status is unknown
  if (httpStatus === 0 || httpStatus === undefined) {
    // Check for context-overflow patterns even without a status code
    if (matchesAny(lower, CONTEXT_OVERFLOW_PATTERNS)) {
      return makeError('context_overflow', httpStatus, true, errorBody, headers);
    }
    if (matchesAny(lower, MODEL_NOT_FOUND_PATTERNS)) {
      return makeError('model_not_found', httpStatus, false, errorBody, headers);
    }
  }

  return makeError('unknown', httpStatus, true, errorBody, headers);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function matchesAny(lower: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => lower.includes(p));
}

function makeError(
  code: ApiErrorCode,
  httpStatus: number,
  retryable: boolean,
  rawBody: string,
  headers?: Headers,
): ApiError {
  const friendlyMessage = FRIENDLY_MESSAGES[code];
  const message = rawBody
    ? `${friendlyMessage}\n${rawBody}`
    : friendlyMessage;

  const retryAfterMs = parseRetryAfter(headers);

  return new ApiError(message, code, httpStatus, retryable, retryAfterMs, rawBody);
}

/**
 * Parse the `Retry-After` header which can be either a number of seconds
 * or an HTTP date string.
 */
function parseRetryAfter(headers?: Headers): number | undefined {
  if (!headers) return undefined;
  const value = headers.get('retry-after');
  if (!value) return undefined;

  // Try as integer seconds first
  const seconds = Number(value);
  if (!Number.isNaN(seconds) && seconds > 0) {
    return seconds * 1000;
  }

  // Try as HTTP date
  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) {
    const delayMs = dateMs - Date.now();
    return delayMs > 0 ? delayMs : undefined;
  }

  return undefined;
}
