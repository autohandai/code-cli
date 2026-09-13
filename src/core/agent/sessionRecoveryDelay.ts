/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { ApiError, classifyApiError } from '../../providers/errors.js';

/** Provider outages the client has already retried on its own before the turn failed. */
const PROVIDER_OUTAGE_CODES = new Set(['server_error', 'network_error', 'timeout']);

/** First wait after a provider outage; each further recovery attempt triples it. */
export const PROVIDER_OUTAGE_RECOVERY_BASE_MS = 5_000;
export const PROVIDER_OUTAGE_RECOVERY_MAX_MS = 60_000;
const DEFAULT_RECOVERY_BASE_MS = 1_000;

export interface SessionRecoveryDelayInput {
  /** 1-based recovery attempt. */
  attempt: number;
  error: Error;
  /** `agent.sessionRetryDelay` when the user set it; undefined keeps the built-in schedule. */
  configuredDelayMs?: number;
}

/**
 * How long to wait before re-running a failed turn.
 *
 * The provider client already retries a request three times with short
 * back-off before the turn fails. Re-running the whole turn a second later
 * only re-sends the same prompt into the same outage; a fresh outage needs
 * seconds, not milliseconds, so provider failures back off from 5 s and
 * triple per attempt. A configured delay keeps the old 1.5× schedule, and a
 * retry-after from the provider is always honoured.
 */
export function resolveSessionRecoveryDelay({ attempt, error, configuredDelayMs }: SessionRecoveryDelayInput): number {
  const step = Math.max(0, attempt - 1);
  const retryAfterMs = error instanceof ApiError ? error.retryAfterMs ?? 0 : 0;
  let scheduled: number;
  if (configuredDelayMs !== undefined) {
    scheduled = configuredDelayMs * Math.pow(1.5, step);
  } else if (isProviderOutage(error)) {
    scheduled = Math.min(PROVIDER_OUTAGE_RECOVERY_MAX_MS, PROVIDER_OUTAGE_RECOVERY_BASE_MS * Math.pow(3, step));
  } else {
    scheduled = DEFAULT_RECOVERY_BASE_MS * Math.pow(1.5, step);
  }
  return Math.max(scheduled, retryAfterMs);
}

export function isProviderOutage(error: Error): boolean {
  const code = error instanceof ApiError ? error.code : classifyApiError(0, error.message).code;
  return PROVIDER_OUTAGE_CODES.has(code);
}

export function formatRecoveryWait(delayMs: number): string {
  return delayMs >= 1_000 ? `${Math.round(delayMs / 1_000)}s` : `${Math.round(delayMs)}ms`;
}
