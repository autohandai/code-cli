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
  | 'content_blocked'
  | 'storage_full'
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
  content_blocked:
    'The safety check blocked this request.',
  storage_full:
    'Local storage is full. Free disk space before continuing. Recent session data may not have been saved.',
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

const LEGACY_CONTENT_BLOCKED_MESSAGE = "This message was blocked by Autohand's safety check. Rephrase it and try again.";
const LEGACY_MANAGED_IDENTITY_FAILURE_MESSAGE = 'Managed Identity token acquisition failed. This auth method only works inside Azure VMs, App Service, or containers with managed identity enabled.';

function isLegacyContentBlockedMessage(message: unknown): boolean {
  return message === LEGACY_CONTENT_BLOCKED_MESSAGE
    || message === `${FRIENDLY_MESSAGES.invalid_request}\n${LEGACY_CONTENT_BLOCKED_MESSAGE}`;
}

export function readStorageCapacityError(value: unknown): ApiError | undefined {
  let current = value;
  for (let depth = 0; depth < 4; depth++) {
    if (current instanceof ApiError) {
      if (current.code === 'storage_full') return current;
      if (current.httpStatus !== 0) return undefined;
    }
    const record = current && typeof current === 'object'
      ? current as Record<string, unknown> : undefined;
    const message = typeof current === 'string'
      ? current : typeof record?.message === 'string' ? record.message : '';
    if (record?.code === 'ENOSPC' || record?.code === 'EDQUOT'
      || /^(?:Error:\s*)?(?:ENOSPC|EDQUOT):/.test(message)
      || message === FRIENDLY_MESSAGES.storage_full
      || message.startsWith(`${FRIENDLY_MESSAGES.storage_full}\n`)) {
      const display = message.startsWith(FRIENDLY_MESSAGES.storage_full)
        ? message : `${FRIENDLY_MESSAGES.storage_full}${message ? `\n${message}` : ''}`;
      return new ApiError(display, 'storage_full', 0, false, undefined, message);
    }
    current = record?.cause;
    if (!current) break;
  }
  return undefined;
}

export function readContentBlockedError(
  value: unknown,
  httpStatus: number,
  requestId?: string | null,
): ApiError | undefined {
  const error = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
  if (error?.type !== 'content_blocked'
    && !isLegacyContentBlockedMessage(typeof value === 'string' ? value : error?.message)) return undefined;
  const categories = Array.isArray(error?.categories)
    ? [...new Set(error.categories.filter((category): category is string =>
      typeof category === 'string' && /^S(?:[1-9]|1[0-4])$/.test(category)))].slice(0, 14)
    : [];
  const candidate = requestId ?? error?.requestId;
  const id = typeof candidate === 'string' && /^[a-zA-Z0-9._:-]{1,128}$/.test(candidate)
    ? candidate : undefined;
  const details = [
    FRIENDLY_MESSAGES.content_blocked,
    ...(categories.length ? [`Safety categories: ${categories.map(code => code === 'S7' ? 'S7 (Privacy)' : code).join(', ')}.`] : []),
    ...(id ? [`Request ID: ${id}.`, 'If this seems incorrect, include this ID when reporting it.'] : []),
  ];
  return new ApiError(details.join('\n'), 'content_blocked', httpStatus, false);
}

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
  // OpenRouter returns "X is not a valid model ID" for bad model names
  'is not a valid model',
  // Catch "model 'xyz' not found" where 'not found' is separate from 'model'
  "' not found",
  "\" not found",
  "' was not found",
  "\" was not found",
] as const;

function isUnconfiguredModel(body: string): boolean {
  const pattern = /^model (?:"[^"\r\n]+"|'[^'\r\n]+'|[a-z0-9][a-z0-9_./:@+-]*) is not configured\.?$/i;
  if (pattern.test(body.trim())) return true;
  if (!body.includes('autohand_router_error')) return false;
  try {
    const parsed: unknown = JSON.parse(body);
    const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : undefined;
    const error = record?.error && typeof record.error === 'object' && !Array.isArray(record.error)
      ? record.error as Record<string, unknown> : undefined;
    return error?.type === 'autohand_router_error'
      && typeof error.message === 'string' && pattern.test(error.message.trim());
  } catch {
    return false;
  }
}

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
  'request too large',
  'requested too many tokens',
  'context window',
  'token limit',
  'tokens exceeds',
  'too many tokens',
  'tokens per minute',
  '(tpm)',
  'prefill memory guard rejected',
  'exceed_context_size_error',
  'exceeds the available context size',
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

/** Patterns that indicate rate limiting in status-0 / unknown errors. */
const RATE_LIMIT_PATTERNS = [
  'rate limit',
  'rate limited',
  'too many requests',
  '429',
] as const;

/** Patterns that indicate a timeout in status-0 / unknown errors. */
const TIMEOUT_PATTERNS = [
  'timed out',
  'timeout',
] as const;

/** Patterns that indicate authentication or authorization setup failures. */
const AUTH_FAILED_PATTERNS = [
  'authentication failed',
  'unauthorized',
  'invalid api key',
  'incorrect api key',
  'bad api key',
  '401',
] as const;

const PAYMENT_REQUIRED_PATTERNS = [
  'payment required',
  'billing',
  'insufficient credits',
  'insufficient balance',
  '402',
] as const;

const ACCESS_DENIED_PATTERNS = [
  'access denied',
  'permission denied',
  'forbidden',
  'lacks permission',
  '403',
] as const;

const SERVER_ERROR_PATTERNS = [
  'internal server error',
  'bad gateway',
  'service unavailable',
  'provider error',
  'upstream error',
  'server error',
  '500',
  '502',
  '503',
  '599',
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
  if (httpStatus === 0) {
    const storage = readStorageCapacityError(errorBody);
    if (storage) return storage;
    if (errorBody === LEGACY_MANAGED_IDENTITY_FAILURE_MESSAGE) {
      return new ApiError(
        'Managed Identity token acquisition failed. Check the selected Azure identity configuration and endpoint connectivity before retrying.',
        'auth_failed', 0, false, undefined, errorBody,
      );
    }
  }
  if ((httpStatus === 0 || httpStatus === 400) && isLegacyContentBlockedMessage(errorBody)) {
    const blocked = readContentBlockedError(errorBody, httpStatus, headers?.get('x-autohand-request-id'));
    if (blocked) return blocked;
  }
  if (httpStatus === 0 && (errorBody === FRIENDLY_MESSAGES.content_blocked
    || errorBody.startsWith(`${FRIENDLY_MESSAGES.content_blocked}\n`))) {
    return new ApiError(errorBody, 'content_blocked', httpStatus, false);
  }

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

  if (httpStatus === 410) {
    const retiredModel = /\bmodel\b/.test(lower)
      && /\b(?:end of life|retired|no longer available)\b/.test(lower);
    return makeError(retiredModel ? 'model_not_found' : 'invalid_request', httpStatus, false, errorBody, headers);
  }

  if (httpStatus === 429) {
    if (matchesAny(lower, CONTEXT_OVERFLOW_PATTERNS)) {
      return makeError('context_overflow', httpStatus, false, errorBody, headers);
    }

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
    if (/\b(?:incorrect|invalid|bad) api[ _-]?key\b/.test(lower)) {
      return makeError('auth_failed', httpStatus, false, errorBody, headers);
    }

    // 1. Model-not-found check runs FIRST
    if (matchesAny(lower, MODEL_NOT_FOUND_PATTERNS) || isUnconfiguredModel(errorBody)) {
      return makeError('model_not_found', httpStatus, false, errorBody, headers);
    }

    // 2. Context overflow
    if (matchesAny(lower, CONTEXT_OVERFLOW_PATTERNS)) {
      return makeError('context_overflow', httpStatus, false, errorBody, headers);
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
    // Check model-not-found patterns before overflow. Some providers prepend
    // stale or generic friendly text ahead of the real "invalid model ID" body.
    if (matchesAny(lower, MODEL_NOT_FOUND_PATTERNS) || isUnconfiguredModel(errorBody)) {
      return makeError('model_not_found', httpStatus, false, errorBody, headers);
    }
    if (matchesAny(lower, RATE_LIMIT_PATTERNS)) {
      return makeError('rate_limited', httpStatus, true, errorBody, headers);
    }
    if (matchesAny(lower, AUTH_FAILED_PATTERNS)) {
      return makeError('auth_failed', httpStatus, false, errorBody, headers);
    }
    if (matchesAny(lower, PAYMENT_REQUIRED_PATTERNS)) {
      return makeError('payment_required', httpStatus, false, errorBody, headers);
    }
    if (matchesAny(lower, ACCESS_DENIED_PATTERNS)) {
      return makeError('access_denied', httpStatus, false, errorBody, headers);
    }
    if (matchesAny(lower, SERVER_ERROR_PATTERNS)) {
      return makeError('server_error', httpStatus, true, errorBody, headers);
    }
    // Check for context-overflow patterns even without a status code
    if (matchesAny(lower, CONTEXT_OVERFLOW_PATTERNS)) {
      return makeError('context_overflow', httpStatus, false, errorBody, headers);
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

/**
 * Strip HTML tags from error bodies (e.g. nginx 502 Bad Gateway pages).
 * Returns the original string if it doesn't look like HTML.
 */
function stripHtmlFromBody(body: string): string {
  if (!/<[a-z/][\s\S]*>/i.test(body)) {
    return body;
  }
  // Remove tags, collapse whitespace, trim
  return body
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function providerRetryDelay(error: unknown, baseDelay: number, attempt: number): number {
  return Math.max(baseDelay * 2 ** attempt, error instanceof ApiError ? error.retryAfterMs ?? 0 : 0);
}

export function waitForProviderRetry(ms: number, signal?: AbortSignal): Promise<void> {
  if (!Number.isFinite(ms) || ms > 2_147_483_647) {
    return Promise.reject(new ApiError('The provider requested a retry delay beyond the automatic timer limit.', 'rate_limited', 429, false));
  }
  if (signal?.aborted) return Promise.reject(new ApiError('Request cancelled.', 'cancelled', 0, false));
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(new ApiError('Request cancelled.', 'cancelled', 0, false));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export { makeError as createApiError };

function makeError(
  code: ApiErrorCode,
  httpStatus: number,
  retryable: boolean,
  rawBody: string,
  headers?: Headers,
): ApiError {
  const friendlyMessage = FRIENDLY_MESSAGES[code];
  const displayBody = rawBody ? stripHtmlFromBody(rawBody) : '';
  const message = displayBody
    ? `${friendlyMessage}\n${displayBody}`
    : friendlyMessage;

  const retryAfterMs = parseRetryAfter(headers) ?? inferRetryAfterFromBody(code, rawBody);

  return new ApiError(message, code, httpStatus, retryable, retryAfterMs, rawBody);
}

function inferRetryAfterFromBody(code: ApiErrorCode, rawBody: string): number | undefined {
  if (code !== 'rate_limited') {
    return undefined;
  }

  const rpmMatch = rawBody.match(/limited to\s+(\d+)\s+requests?\s+per\s+minute/i);
  if (rpmMatch) {
    const rpm = Number(rpmMatch[1]);
    if (Number.isFinite(rpm) && rpm > 0) {
      return Math.ceil(60_000 / rpm);
    }
  }

  const secondsMatch = rawBody.match(/retry (?:after|in)\s+(\d+)\s+seconds?/i);
  if (secondsMatch) {
    const seconds = Number(secondsMatch[1]);
    if (Number.isFinite(seconds) && seconds > 0) {
      return seconds * 1000;
    }
  }

  return undefined;
}

/**
 * Sanitize a model ID entered by the user.
 *
 * Strips bracketed-paste escape remnants (`[200~` / `[201~`), ESC prefixes,
 * control characters, and leading/trailing whitespace so that pasted model
 * IDs are clean before they hit the API.
 */
export function sanitizeModelId(raw: string): string {
  return raw
    // Strip ESC-prefixed bracketed paste markers (\x1b[200~ and \x1b[201~)
    .replace(/\x1b\[20[01]~/g, '')
    // Strip bare bracketed paste markers ([200~ and [201~)
    .replace(/\[20[01]~/g, '')
    // Strip remaining control characters (C0 range except printable)
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim();
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
