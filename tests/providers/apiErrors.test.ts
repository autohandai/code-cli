/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  classifyApiError,
  ApiError,
  FRIENDLY_MESSAGES,
  type ApiErrorCode,
} from '../../src/providers/errors.js';

describe('classifyApiError', () => {
  // =========================================================================
  // 400 — model_not_found (must be checked BEFORE context_overflow)
  // =========================================================================
  describe('400 — model not found', () => {
    it('classifies "invalid model ID" as model_not_found', () => {
      const err = classifyApiError(400, 'invalid model ID');
      expect(err.code).toBe('model_not_found');
      expect(err.retryable).toBe(false);
    });

    it('classifies "model does not exist" as model_not_found', () => {
      const err = classifyApiError(400, 'model does not exist');
      expect(err.code).toBe('model_not_found');
      expect(err.retryable).toBe(false);
    });

    it('classifies "model \'xyz\' not found" as model_not_found', () => {
      const err = classifyApiError(400, "model 'xyz' not found");
      expect(err.code).toBe('model_not_found');
      expect(err.retryable).toBe(false);
    });

    it('classifies "No endpoints found for model" as model_not_found', () => {
      const err = classifyApiError(400, 'No endpoints found for model openai/gpt-99');
      expect(err.code).toBe('model_not_found');
      expect(err.retryable).toBe(false);
    });
  });

  // =========================================================================
  // 400 — context_overflow
  // =========================================================================
  describe('400 — context overflow', () => {
    it('classifies "maximum context length exceeded" as context_overflow', () => {
      const err = classifyApiError(400, 'maximum context length exceeded');
      expect(err.code).toBe('context_overflow');
      expect(err.retryable).toBe(true);
    });

    it('classifies "prompt is too long" as context_overflow', () => {
      const err = classifyApiError(400, 'prompt is too long');
      expect(err.code).toBe('context_overflow');
      expect(err.retryable).toBe(true);
    });

    it('classifies "reduce the length of the messages" as context_overflow', () => {
      const err = classifyApiError(400, 'Please reduce the length of the messages');
      expect(err.code).toBe('context_overflow');
      expect(err.retryable).toBe(true);
    });

    it('classifies "context window" overflow message as context_overflow', () => {
      const err = classifyApiError(400, 'This request exceeds the context window for this model');
      expect(err.code).toBe('context_overflow');
      expect(err.retryable).toBe(true);
    });

    it('classifies "payload too large" as context_overflow', () => {
      const err = classifyApiError(400, 'Request payload too large (3.5MB)');
      expect(err.code).toBe('context_overflow');
      expect(err.retryable).toBe(true);
    });
  });

  // =========================================================================
  // 400 — generic invalid_request
  // =========================================================================
  describe('400 — invalid_request (generic)', () => {
    it('classifies generic 400 message as invalid_request', () => {
      const err = classifyApiError(400, 'something went wrong');
      expect(err.code).toBe('invalid_request');
      expect(err.retryable).toBe(false);
    });

    it('classifies malformed request as invalid_request', () => {
      const err = classifyApiError(400, 'malformed JSON in request body');
      expect(err.code).toBe('invalid_request');
      expect(err.retryable).toBe(false);
    });
  });

  // =========================================================================
  // 401 — auth_failed
  // =========================================================================
  describe('401 — auth_failed', () => {
    it('classifies 401 as auth_failed', () => {
      const err = classifyApiError(401, 'Unauthorized');
      expect(err.code).toBe('auth_failed');
      expect(err.retryable).toBe(false);
    });

    it('classifies 401 with any message as auth_failed', () => {
      const err = classifyApiError(401, 'Invalid API key provided');
      expect(err.code).toBe('auth_failed');
      expect(err.retryable).toBe(false);
    });
  });

  // =========================================================================
  // 402 — payment_required
  // =========================================================================
  describe('402 — payment_required', () => {
    it('classifies 402 as payment_required', () => {
      const err = classifyApiError(402, 'Payment required');
      expect(err.code).toBe('payment_required');
      expect(err.retryable).toBe(false);
    });
  });

  // =========================================================================
  // 403 — access_denied
  // =========================================================================
  describe('403 — access_denied', () => {
    it('classifies 403 as access_denied', () => {
      const err = classifyApiError(403, 'Forbidden');
      expect(err.code).toBe('access_denied');
      expect(err.retryable).toBe(false);
    });
  });

  // =========================================================================
  // 404 — model_not_found
  // =========================================================================
  describe('404 — model_not_found', () => {
    it('classifies 404 as model_not_found', () => {
      const err = classifyApiError(404, 'Not Found');
      expect(err.code).toBe('model_not_found');
      expect(err.retryable).toBe(false);
    });
  });

  // =========================================================================
  // 429 — rate_limited
  // =========================================================================
  describe('429 — rate_limited', () => {
    it('classifies 429 as rate_limited', () => {
      const err = classifyApiError(429, 'Too many requests');
      expect(err.code).toBe('rate_limited');
      expect(err.retryable).toBe(true);
    });

    it('extracts Retry-After header in seconds', () => {
      const headers = new Headers({ 'Retry-After': '30' });
      const err = classifyApiError(429, 'Rate limited', headers);
      expect(err.code).toBe('rate_limited');
      expect(err.retryable).toBe(true);
      expect(err.retryAfterMs).toBe(30_000);
    });

    it('extracts Retry-After header as date string', () => {
      const futureDate = new Date(Date.now() + 60_000).toUTCString();
      const headers = new Headers({ 'Retry-After': futureDate });
      const err = classifyApiError(429, 'Rate limited', headers);
      expect(err.code).toBe('rate_limited');
      expect(err.retryAfterMs).toBeGreaterThan(0);
      expect(err.retryAfterMs).toBeLessThanOrEqual(61_000);
    });

    it('handles missing Retry-After header gracefully', () => {
      const headers = new Headers();
      const err = classifyApiError(429, 'Rate limited', headers);
      expect(err.code).toBe('rate_limited');
      expect(err.retryAfterMs).toBeUndefined();
    });
  });

  // =========================================================================
  // 5xx — server_error
  // =========================================================================
  describe('5xx — server_error', () => {
    it.each([500, 502, 503])('classifies %i as server_error', (status) => {
      const err = classifyApiError(status, 'Internal Server Error');
      expect(err.code).toBe('server_error');
      expect(err.retryable).toBe(true);
    });

    it('classifies 504 as timeout', () => {
      const err = classifyApiError(504, 'Gateway Timeout');
      expect(err.code).toBe('timeout');
      expect(err.retryable).toBe(true);
    });

    it('classifies unknown 5xx as server_error', () => {
      const err = classifyApiError(599, 'Unknown server issue');
      expect(err.code).toBe('server_error');
      expect(err.retryable).toBe(true);
    });
  });

  // =========================================================================
  // 0 / unknown status — heuristic classification
  // =========================================================================
  describe('0 / unknown status — heuristic fallback', () => {
    it('classifies status 0 with network-like message as network_error', () => {
      const err = classifyApiError(0, 'fetch failed: ECONNREFUSED');
      expect(err.code).toBe('network_error');
      expect(err.retryable).toBe(true);
    });

    it('classifies status 0 with timeout message as timeout', () => {
      const err = classifyApiError(0, 'Request timed out');
      expect(err.code).toBe('timeout');
      expect(err.retryable).toBe(true);
    });

    it('classifies status 0 with cancellation message as cancelled', () => {
      const err = classifyApiError(0, 'Request cancelled.');
      expect(err.code).toBe('cancelled');
      expect(err.retryable).toBe(false);
    });

    it('classifies status 0 with unknown message as unknown', () => {
      const err = classifyApiError(0, 'something weird happened');
      expect(err.code).toBe('unknown');
      expect(err.retryable).toBe(true);
    });
  });

  // =========================================================================
  // 400 — "context is too long" regression (Issue 2: missing pattern)
  // =========================================================================
  describe('400 — context is too long (regression)', () => {
    it('classifies "context is too long" as context_overflow', () => {
      const err = classifyApiError(400, 'The context is too long for this model');
      expect(err.code).toBe('context_overflow');
      expect(err.retryable).toBe(true);
    });

    it('classifies "context is too long" case-insensitively', () => {
      const err = classifyApiError(400, 'ERROR: Context Is Too Long');
      expect(err.code).toBe('context_overflow');
      expect(err.retryable).toBe(true);
    });
  });

  // =========================================================================
  // classifyApiError delegation for non-ApiError errors (Issue 1 regression)
  // =========================================================================
  describe('classifyApiError delegation for non-ApiError errors', () => {
    it('classifies retryable errors correctly via classifyApiError when status is 0', () => {
      // Simulate what isRetryableSessionError should do for non-ApiError:
      // delegate to classifyApiError(0, error.message)
      const classified = classifyApiError(0, 'fetch failed: ECONNREFUSED');
      expect(classified.retryable).toBe(true);
      expect(classified.code).toBe('network_error');
    });

    it('classifies non-retryable cancellation via classifyApiError when status is 0', () => {
      const classified = classifyApiError(0, 'Request cancelled.');
      expect(classified.retryable).toBe(false);
      expect(classified.code).toBe('cancelled');
    });

    it('classifies unknown errors as retryable via classifyApiError when status is 0', () => {
      // Generic errors should be retryable (unknown defaults to retryable)
      const classified = classifyApiError(0, 'some random error');
      expect(classified.retryable).toBe(true);
      expect(classified.code).toBe('unknown');
    });

    it('classifies auth-like messages via body pattern when status is 0', () => {
      // When there's no HTTP status, the body alone can't identify auth errors
      // since there's no 401 status — this should fall through to unknown
      const classified = classifyApiError(0, 'authentication failed');
      // Without 401 status, the classifier should treat this as unknown
      expect(classified.code).toBe('unknown');
    });
  });

  // =========================================================================
  // FALSE-POSITIVE REGRESSION TESTS (the actual bugs)
  // =========================================================================
  describe('false-positive regressions', () => {
    it('400 + "invalid model ID" must NOT be context_overflow', () => {
      const err = classifyApiError(400, 'invalid model ID: gpt-nonexistent');
      expect(err.code).not.toBe('context_overflow');
      expect(err.code).toBe('model_not_found');
    });

    it('400 + error containing "context" in non-overflow sense must NOT be context_overflow', () => {
      // The word "context" appears but not in an overflow context
      const err = classifyApiError(400, 'invalid parameter in the context of this request');
      expect(err.code).not.toBe('context_overflow');
      expect(err.code).toBe('invalid_request');
    });

    it('400 + "invalid parameter: token format" must NOT be context_overflow', () => {
      const err = classifyApiError(400, 'invalid parameter: token format is wrong');
      expect(err.code).not.toBe('context_overflow');
      expect(err.code).toBe('invalid_request');
    });

    it('400 + message with "context" alone does NOT match context_overflow', () => {
      // This is the RPC adapter bug — matching 'context' alone
      const err = classifyApiError(400, 'Error: security context violation');
      expect(err.code).not.toBe('context_overflow');
    });

    it('400 + "model" in error body correctly routes to model_not_found, not context_overflow', () => {
      const err = classifyApiError(400, "The model 'abc/def' does not exist or you do not have access");
      expect(err.code).toBe('model_not_found');
    });

    it('400 + "file not found" does NOT match model_not_found', () => {
      const err = classifyApiError(400, 'Configuration file not found: config.yaml');
      expect(err.code).not.toBe('model_not_found');
      expect(err.code).toBe('invalid_request');
    });

    it('400 + "is not a valid model ID" must be model_not_found, not context_overflow (GH #29)', () => {
      const err = classifyApiError(400, 'anthropic/claude-sonnet-4.6 is not a valid model ID');
      expect(err.code).toBe('model_not_found');
      expect(err.retryable).toBe(false);
    });

    it('400 + "is not a valid model ID" with bracketed paste remnants (GH #29)', () => {
      const err = classifyApiError(400, '[200~anthropic/claude-sonnet-4.6[201~ is not a valid model ID');
      expect(err.code).toBe('model_not_found');
      expect(err.retryable).toBe(false);
    });

    it('400 + model without provider prefix "is not a valid model ID" (GH #23, #25, #28)', () => {
      const err = classifyApiError(400, 'qwen3-coder:free is not a valid model ID');
      expect(err.code).toBe('model_not_found');
      expect(err.retryable).toBe(false);
    });

    it('400 + natural language as model ID (GH #17)', () => {
      const err = classifyApiError(400, 'list all models is not a valid model ID');
      expect(err.code).toBe('model_not_found');
      expect(err.retryable).toBe(false);
    });
  });

  // =========================================================================
  // ApiError class
  // =========================================================================
  describe('ApiError', () => {
    it('extends Error', () => {
      const err = new ApiError('test', 'unknown', 0, true);
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(ApiError);
    });

    it('stores all properties correctly', () => {
      const err = new ApiError('some detail', 'rate_limited', 429, true, 5000, 'raw body');
      expect(err.message).toBe('some detail');
      expect(err.code).toBe('rate_limited');
      expect(err.httpStatus).toBe(429);
      expect(err.retryable).toBe(true);
      expect(err.retryAfterMs).toBe(5000);
      expect(err.rawDetail).toBe('raw body');
    });

    it('has correct name property', () => {
      const err = new ApiError('test', 'auth_failed', 401, false);
      expect(err.name).toBe('ApiError');
    });
  });

  // =========================================================================
  // FRIENDLY_MESSAGES
  // =========================================================================
  describe('FRIENDLY_MESSAGES', () => {
    it('has a message for every ApiErrorCode', () => {
      const codes: ApiErrorCode[] = [
        'context_overflow',
        'model_not_found',
        'invalid_request',
        'auth_failed',
        'payment_required',
        'access_denied',
        'rate_limited',
        'server_error',
        'network_error',
        'timeout',
        'cancelled',
        'unknown',
      ];
      for (const code of codes) {
        expect(FRIENDLY_MESSAGES[code]).toBeDefined();
        expect(typeof FRIENDLY_MESSAGES[code]).toBe('string');
        expect(FRIENDLY_MESSAGES[code].length).toBeGreaterThan(0);
      }
    });
  });
});
