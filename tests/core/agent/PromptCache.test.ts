/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import type { LoadedConfig } from '../../../src/types.js';
import type { FunctionDefinition } from '../../../src/types.js';
import {
  getSessionPromptCacheDirective,
  isPromptCachingEnabled,
  PROMPT_CACHING_FEATURE_ID,
  PROMPT_CACHING_KILL_SWITCH_ID,
  PromptCacheToolSet,
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

describe('prompt cache policy for Autohand AI cloud', () => {
  const cloud = { autohandai: { plan: 'cloud' } } as LoadedConfig;
  const killSwitch = {
    isFeatureEnabled: (_key: string, localDefault?: boolean) => localDefault ?? false,
    getSnapshot: () => ({ flags: [{ key: PROMPT_CACHING_KILL_SWITCH_ID, enabled: true }] }),
  };

  it('is on by default for the cloud plan, where the gateway routes a keyed session to a warm backend', () => {
    expect(isPromptCachingEnabled(cloud, undefined, 'autohandai')).toBe(true);
  });

  it('follows the provider the session is actually using', () => {
    expect(isPromptCachingEnabled({ ...cloud, provider: 'autohandai' } as LoadedConfig)).toBe(true);
    expect(isPromptCachingEnabled({ ...cloud, provider: 'autohandai' } as LoadedConfig, undefined, 'openai')).toBe(false);
  });

  it('stays off for the local plan and for every other provider', () => {
    expect(isPromptCachingEnabled({ autohandai: { plan: 'local' } } as LoadedConfig, undefined, 'autohandai')).toBe(false);
    for (const provider of ['openai', 'openrouter', 'llmgateway', 'nvidia', 'cerebras'] as const) {
      expect(isPromptCachingEnabled(cloud, undefined, provider)).toBe(false);
    }
  });

  it('honours an explicit opt-out and the remote kill switch', () => {
    const optedOut = { ...cloud, features: { promptCaching: false } } as LoadedConfig;
    expect(isPromptCachingEnabled(optedOut, undefined, 'autohandai')).toBe(false);
    expect(isPromptCachingEnabled(cloud, killSwitch, 'autohandai')).toBe(false);
  });
});

describe('session prompt cache key', () => {
  it('is stable for a session, distinct across sessions, opaque, and within the gateway limit', () => {
    const first = getSessionPromptCacheDirective('session-a')?.key;
    expect(first).toBe(getSessionPromptCacheDirective('session-a')?.key);
    expect(first).not.toBe(getSessionPromptCacheDirective('session-b')?.key);
    expect(first).not.toContain('session-a');
    expect(first).toMatch(/^ahpc_[A-Za-z0-9_-]+$/);
    expect(first!.length).toBeLessThanOrEqual(256);
  });
});

describe('PromptCacheToolSet', () => {
  const tool = (name: string, description = name): FunctionDefinition => ({
    name,
    description,
    parameters: { type: 'object', properties: {} },
  });
  const names = (tools: FunctionDefinition[]) => tools.map((t) => t.name);

  it('keeps the advertised tools identical while the relevant set does not grow', () => {
    const set = new PromptCacheToolSet();
    const all = [tool('read_file'), tool('write_file'), tool('run_command'), tool('web_search')];

    const first = set.select('session-a', all, [all[0], all[2]]);
    const second = set.select('session-a', all, [all[2]]);
    const third = set.select('session-a', all, []);

    expect(names(first)).toEqual(['read_file', 'run_command']);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it('only appends newly relevant tools, so earlier tool definitions keep their position', () => {
    const set = new PromptCacheToolSet();
    const all = [tool('read_file'), tool('write_file'), tool('run_command'), tool('web_search')];

    set.select('session-a', all, [all[2]]);
    const grown = set.select('session-a', all, [all[0], all[3]]);

    expect(names(grown)).toEqual(['run_command', 'read_file', 'web_search']);
  });

  it('drops tools that are no longer available and serves their current definition otherwise', () => {
    const set = new PromptCacheToolSet();
    set.select('session-a', [tool('read_file'), tool('mcp__x__y')], [tool('read_file'), tool('mcp__x__y')]);

    const next = set.select('session-a', [tool('read_file', 'Read a file (updated)')], []);

    expect(next).toEqual([tool('read_file', 'Read a file (updated)')]);
  });

  it('starts again for a different session', () => {
    const set = new PromptCacheToolSet();
    const all = [tool('read_file'), tool('web_search')];
    set.select('session-a', all, [all[0]]);

    expect(names(set.select('session-b', all, [all[1]]))).toEqual(['web_search']);
  });
});
