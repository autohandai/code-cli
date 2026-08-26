/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { initI18n } from '../../src/i18n/index.js';
import type { ProviderName } from '../../src/types.js';
import { buildProviderSelectionOptions } from '../../src/ui/providerSelectionOptions.js';

const labels: Record<string, string> = {
  autohandai: 'Autohand AI',
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
  zai: 'Z.ai',
  'custom:alpha-gateway': 'Alpha Gateway',
};

function toOption(provider: ProviderName) {
  return { label: labels[provider] ?? provider, value: provider };
}

const sortKey = (provider: ProviderName): string => labels[provider] ?? provider;

describe('buildProviderSelectionOptions', () => {
  beforeAll(async () => {
    await initI18n('en');
  });

  it('marks the first option of each group with its localized section header', () => {
    const options = buildProviderSelectionOptions({
      providers: ['autohandai', 'zai', 'anthropic', 'custom:alpha-gateway'],
      toOption,
      sortKey,
    });

    expect(options.map((option) => option.value)).toEqual([
      'autohandai',
      'anthropic',
      'zai',
      'custom:alpha-gateway',
    ]);
    expect(options[0].header).toBe('Autohand AI');
    expect(options[1].header).toBe('Third-party providers');
    expect(options[2].header).toBeUndefined();
    expect(options[3].header).toBe('Custom providers');
  });

  it('appends extra rows to the custom group and keeps them selectable', () => {
    const options = buildProviderSelectionOptions({
      providers: ['autohandai', 'anthropic'],
      toOption,
      sortKey,
      customGroupExtras: [{ label: '+ New provider', value: 'new-custom-provider' }],
    });

    const last = options[options.length - 1];
    expect(last.value).toBe('new-custom-provider');
    expect(last.header).toBe('Custom providers');
  });

  it('puts the section header on the first configured custom provider, not on the add row', () => {
    const options = buildProviderSelectionOptions({
      providers: ['anthropic', 'custom:alpha-gateway'],
      toOption,
      sortKey,
      customGroupExtras: [{ label: '+ New provider', value: 'new-custom-provider' }],
    });

    expect(options.map((option) => option.value)).toEqual([
      'anthropic',
      'custom:alpha-gateway',
      'new-custom-provider',
    ]);
    expect(options[1].header).toBe('Custom providers');
    expect(options[2].header).toBeUndefined();
  });

  it('preserves every property produced by the option factory', () => {
    const options = buildProviderSelectionOptions({
      providers: ['anthropic'],
      toOption: (provider) => ({
        label: labels[provider],
        value: provider,
        description: 'Native Anthropic Messages API',
      }),
    });

    expect(options[0]).toMatchObject({
      value: 'anthropic',
      description: 'Native Anthropic Messages API',
      header: 'Third-party providers',
    });
  });

  it('returns an empty list when there is nothing to show', () => {
    expect(buildProviderSelectionOptions({ providers: [], toOption })).toEqual([]);
  });
});
