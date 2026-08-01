/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import type { LoadedConfig } from '../../../src/types.js';
import {
  isPromptCachingEnabled,
  PROMPT_CACHING_FEATURE_ID,
  PROMPT_CACHING_KILL_SWITCH_ID,
} from '../../../src/core/agent/PromptCache.js';

function makeConfig(promptCaching?: boolean): LoadedConfig {
  return {
    features: promptCaching === undefined ? undefined : { promptCaching },
  } as LoadedConfig;
}

describe('prompt cache policy', () => {
  it('is disabled by default and requires the local experiment', () => {
    expect(isPromptCachingEnabled(makeConfig())).toBe(false);
    expect(isPromptCachingEnabled(makeConfig(true))).toBe(true);
  });

  it('honors the dedicated remote kill switch without a user override', () => {
    const config = {
      ...makeConfig(true),
      features: {
        promptCaching: true,
        remoteOverrides: {
          [PROMPT_CACHING_KILL_SWITCH_ID]: 'off' as const,
        },
      },
    } as LoadedConfig;
    const featureFlags = {
      isFeatureEnabled: vi.fn((key: string, localDefault: boolean) => {
        expect(key).toBe(PROMPT_CACHING_FEATURE_ID);
        return localDefault;
      }),
      getSnapshot: vi.fn(() => ({
        version: 1,
        fetchedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        flags: [{
          key: PROMPT_CACHING_KILL_SWITCH_ID,
          enabled: true,
          userOverridable: false,
        }],
      })),
    };

    expect(isPromptCachingEnabled(config, featureFlags)).toBe(false);
  });
});
