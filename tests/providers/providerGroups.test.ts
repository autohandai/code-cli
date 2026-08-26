/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { ProviderName } from '../../src/types.js';
import {
  PROVIDER_GROUP_TITLE_KEYS,
  groupProviders,
  resolveProviderGroupId,
} from '../../src/providers/providerGroups.js';

describe('resolveProviderGroupId', () => {
  it('places the first-party Autohand AI provider in its own group', () => {
    expect(resolveProviderGroupId('autohandai')).toBe('autohand');
  });

  it('places custom OpenAI-compatible providers in the custom group', () => {
    expect(resolveProviderGroupId('custom:my-gateway')).toBe('custom');
  });

  it('places every other provider in the third-party group', () => {
    for (const provider of ['openrouter', 'anthropic', 'ollama', 'mlx', 'bedrock'] as ProviderName[]) {
      expect(resolveProviderGroupId(provider)).toBe('thirdParty');
    }
  });

  it('treats extension and blueprint runtime providers as third-party', () => {
    expect(resolveProviderGroupId('blueprint-local' as ProviderName)).toBe('thirdParty');
    expect(resolveProviderGroupId('acme-extension' as ProviderName)).toBe('thirdParty');
  });
});

describe('groupProviders', () => {
  const providers: ProviderName[] = [
    'autohandai',
    'zai',
    'openrouter',
    'anthropic',
    'custom:zeta-gateway',
    'custom:alpha-gateway',
  ];

  it('emits Autohand AI, then third-party, then custom providers', () => {
    const groups = groupProviders(providers);

    expect(groups.map((group) => group.id)).toEqual(['autohand', 'thirdParty', 'custom']);
    expect(groups[0].providers).toEqual(['autohandai']);
    expect(groups[1].providers).toEqual(['zai', 'openrouter', 'anthropic']);
    expect(groups[2].providers).toEqual(['custom:zeta-gateway', 'custom:alpha-gateway']);
  });

  it('exposes the i18n title key for each group', () => {
    const groups = groupProviders(providers);

    expect(groups.map((group) => group.titleKey)).toEqual([
      PROVIDER_GROUP_TITLE_KEYS.autohand,
      PROVIDER_GROUP_TITLE_KEYS.thirdParty,
      PROVIDER_GROUP_TITLE_KEYS.custom,
    ]);
  });

  it('sorts third-party and custom entries by the supplied sort key, leaving Autohand AI alone', () => {
    const labels: Record<string, string> = {
      autohandai: 'Autohand AI',
      zai: 'Z.ai',
      openrouter: 'OpenRouter',
      anthropic: 'Anthropic',
      'custom:zeta-gateway': 'Zeta Gateway',
      'custom:alpha-gateway': 'Alpha Gateway',
    };

    const groups = groupProviders(providers, { sortKey: (provider) => labels[provider] ?? provider });

    expect(groups[0].providers).toEqual(['autohandai']);
    expect(groups[1].providers).toEqual(['anthropic', 'openrouter', 'zai']);
    expect(groups[2].providers).toEqual(['custom:alpha-gateway', 'custom:zeta-gateway']);
  });

  it('sorts case-insensitively so lowercase provider labels are not pushed to the end', () => {
    const labels: Record<string, string> = {
      llamacpp: 'llama.cpp',
      mlx: 'MLX (Apple Silicon)',
      anthropic: 'Anthropic',
    };
    const groups = groupProviders(['mlx', 'llamacpp', 'anthropic'], {
      sortKey: (provider) => labels[provider] ?? provider,
    });

    expect(groups[0].providers).toEqual(['anthropic', 'llamacpp', 'mlx']);
  });

  it('omits groups with no providers', () => {
    const groups = groupProviders(['openrouter', 'anthropic']);

    expect(groups.map((group) => group.id)).toEqual(['thirdParty']);
  });

  it('keeps the Autohand AI group out of the list when the provider is unavailable', () => {
    const groups = groupProviders(['openrouter', 'custom:alpha-gateway']);

    expect(groups.map((group) => group.id)).toEqual(['thirdParty', 'custom']);
  });

  it('emits requested groups even when empty so callers can host affordance rows', () => {
    const groups = groupProviders(['openrouter'], { alwaysInclude: ['custom'] });

    expect(groups.map((group) => group.id)).toEqual(['thirdParty', 'custom']);
    expect(groups[1].providers).toEqual([]);
  });

  it('returns no groups for an empty provider list', () => {
    expect(groupProviders([])).toEqual([]);
  });
});
