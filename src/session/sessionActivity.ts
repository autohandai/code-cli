/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SessionMetadata } from './types.js';

/**
 * A session's most recent activity, falling back to creation time when
 * `lastActiveAt` is missing or unparseable. Session metadata is JSON read off
 * disk and can be written by older versions of the app, so `createdAt` is not
 * guaranteed valid either - if both are missing or unparseable, this returns
 * the epoch as a stable sentinel rather than an Invalid Date, which would
 * otherwise poison `formatAge` ("NaNw ago") and make sort order NaN-dependent
 * (and therefore engine-defined).
 */
export function sessionActivityAt(session: SessionMetadata): Date {
  const active = Date.parse(session.lastActiveAt ?? '');
  if (!Number.isNaN(active)) return new Date(active);
  const created = Date.parse(session.createdAt ?? '');
  if (!Number.isNaN(created)) return new Date(created);
  return new Date(0);
}
