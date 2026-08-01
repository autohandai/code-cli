/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHash } from 'node:crypto';
import { getFeatureState } from '../../features/featureRegistry.js';
import type { LoadedConfig, PromptCacheDirective } from '../../types.js';

const PROMPT_CACHE_KEY_PREFIX = 'ahpc_';
const PROMPT_CACHE_KEY_DOMAIN = 'autohand-prompt-cache:v1\0agent\0';

export const PROMPT_CACHING_FEATURE_ID = 'prompt_caching';
export const PROMPT_CACHING_KILL_SWITCH_ID = 'prompt_caching_controls_kill_switch';

export interface PromptCacheFeatureFlagReader {
  isFeatureEnabled(key: string, localDefault?: boolean): boolean;
  getSnapshot(): { flags: Array<{ key: string; enabled: boolean }> } | null;
}

export function isPromptCachingEnabled(
  config: LoadedConfig,
  featureFlags?: PromptCacheFeatureFlagReader,
): boolean {
  const localEnabled = getFeatureState(config, PROMPT_CACHING_FEATURE_ID)?.enabled ?? false;
  const enabled = featureFlags?.isFeatureEnabled(PROMPT_CACHING_FEATURE_ID, localEnabled)
    ?? localEnabled;
  const remotelyDisabled = featureFlags?.getSnapshot()?.flags.some(
    (flag) => flag.key === PROMPT_CACHING_KILL_SWITCH_ID && flag.enabled,
  ) ?? false;
  return enabled && !remotelyDisabled;
}

export function getSessionPromptCacheDirective(
  sessionId: string | undefined,
): PromptCacheDirective | undefined {
  if (!sessionId) return undefined;

  const digest = createHash('sha256')
    .update(PROMPT_CACHE_KEY_DOMAIN)
    .update(sessionId)
    .digest('base64url');
  return { key: `${PROMPT_CACHE_KEY_PREFIX}${digest}` };
}
