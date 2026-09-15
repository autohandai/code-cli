/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SessionMetadata } from './types.js';

/** A session's most recent activity, falling back to creation time when `lastActiveAt` is missing or unparseable. */
export function sessionActivityAt(session: SessionMetadata): Date {
  const active = Date.parse(session.lastActiveAt ?? '');
  return Number.isNaN(active) ? new Date(session.createdAt) : new Date(active);
}
