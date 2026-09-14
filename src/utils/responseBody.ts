/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Release a fetch response whose body will never be read.
 *
 * An unread body keeps its socket and buffers alive until garbage collection
 * and blocks connection reuse. Call this on every branch that returns or
 * throws without consuming the body (non-OK statuses, fire-and-forget posts).
 * Tolerates mocked or already-consumed bodies: releasing is best-effort.
 */
export function discardResponseBody(response: Pick<Response, 'body'>): void {
  const body = response.body;
  if (!body || typeof body.cancel !== 'function') return;
  try {
    void body.cancel().catch(() => {});
  } catch {
    // A locked or already-closed stream throws synchronously; nothing to release.
  }
}
