/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHash } from 'node:crypto';
import { usesAutohandAICloud } from '../../providers/AutohandAIProvider.js';
import type { FunctionDefinition, LoadedConfig, PromptCacheDirective, ProviderName } from '../../types.js';

const PROMPT_CACHE_KEY_PREFIX = 'ahpc_';
const PROMPT_CACHE_KEY_DOMAIN = 'autohand-prompt-cache:v1\0agent\0';

export const PROMPT_CACHING_FEATURE_ID = 'prompt_caching';
export const PROMPT_CACHING_KILL_SWITCH_ID = 'prompt_caching_controls_kill_switch';

export interface PromptCacheFeatureFlagReader {
  isFeatureEnabled(key: string, localDefault?: boolean): boolean;
  getSnapshot(): { flags: Array<{ key: string; enabled: boolean }> } | null;
}

/**
 * Autohand AI cloud routes a keyed session to the backend that already holds its
 * prefix, so caching is on there unless the user opts out. Everywhere else it
 * stays the opt-in experiment. The remote kill switch applies to both.
 */
export function isPromptCachingEnabled(
  config: LoadedConfig,
  featureFlags?: PromptCacheFeatureFlagReader,
  provider: ProviderName | undefined = config.provider,
): boolean {
  const configured = config.features?.promptCaching;
  const localEnabled = typeof configured === 'boolean'
    ? configured
    : usesAutohandAICloud(config, provider);
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

/**
 * The tool block precedes the conversation in every request, so a tool list that
 * changes between iterations invalidates the provider's whole cached prefix.
 * Relevance filtering picks tools from the last few messages and would do exactly
 * that; this keeps the first selection for the session and only appends tools as
 * they become relevant, in first-seen order, so each growth costs one cache miss.
 */
export class PromptCacheToolSet {
  private sessionId: string | undefined;
  private names: string[] = [];

  select(
    sessionId: string | undefined,
    available: readonly FunctionDefinition[],
    relevant: readonly FunctionDefinition[],
  ): FunctionDefinition[] {
    if (sessionId !== this.sessionId) {
      this.sessionId = sessionId;
      this.names = [];
    }
    const selected = new Set(this.names);
    for (const tool of relevant) {
      if (!selected.has(tool.name)) {
        selected.add(tool.name);
        this.names.push(tool.name);
      }
    }
    // Serve the current definitions; a tool that disappeared (an MCP server went
    // away, permissions changed) cannot be advertised whatever the cache cost.
    const byName = new Map(available.map((tool) => [tool.name, tool]));
    return this.names.flatMap((name) => byName.get(name) ?? []);
  }
}
