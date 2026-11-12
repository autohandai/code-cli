/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHash } from 'node:crypto';
import packageJson from '../../package.json' with { type: 'json' };
import type { LLMRequest } from '../types.js';

const ANTHROPIC_GO_BASE_PATHS = new Set([
  '/inference/go/anthropic',
  '/inference/go/anthropic/v1',
  '/zen/go',
  '/zen/go/v1',
]);

export function buildOpenCodeGoHeaders(
  baseUrl: string,
  request: Pick<LLMRequest, 'sessionId' | 'promptCache'>,
  fallbackSessionId: string,
): Record<string, string> | undefined {
  try {
    const url = new URL(baseUrl);
    if (url.origin !== 'https://opencode.ai' || url.username || url.password
      || url.search || url.hash || !ANTHROPIC_GO_BASE_PATHS.has(url.pathname.replace(/\/+$/, ''))) return undefined;
  } catch {
    return undefined;
  }
  const identity = request.sessionId || request.promptCache?.key || fallbackSessionId;
  const digest = createHash('sha256').update('autohand/opencode-go-session/v1\0').update(identity).digest('hex');
  return {
    'User-Agent': `autohand-cli/${packageJson.version}`,
    'x-opencode-session': `autohand_${digest}`,
  };
}
