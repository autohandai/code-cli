/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SessionMetadata } from './types.js';

export const MAX_SESSION_TITLE_LENGTH = 80;

/** Collapses whitespace and rejects names that would not read as a label. */
export function normalizeSessionTitle(input: string): string {
  const title = input.replace(/\s+/g, ' ').trim();
  if (!title) {
    throw new Error('Session name cannot be empty.');
  }
  if (title.length > MAX_SESSION_TITLE_LENGTH) {
    throw new Error(`Session name must be ${MAX_SESSION_TITLE_LENGTH} characters or fewer.`);
  }
  return title;
}

/** The label a session is listed under: the user's name first, then the summary. */
export function getSessionDisplayName(
  metadata: Pick<SessionMetadata, 'title' | 'summary'>,
): string | undefined {
  return metadata.title?.trim() || metadata.summary?.trim() || undefined;
}
