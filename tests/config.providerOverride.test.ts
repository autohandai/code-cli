import { describe, expect, it } from 'vitest';
import { applyCliProviderOverride } from '../src/config.js';
import type { LoadedConfig } from '../src/types.js';

describe('CLI provider override', () => {
  const config: LoadedConfig = { configPath: '/fixture/config.json', provider: 'openai', openai: { model: 'saved-model', apiKey: 'fixture-key' } };

  it('selects account inference for a transferred session without changing saved defaults', () => {
    const selected = applyCliProviderOverride(config, 'autohandai');
    expect(selected.provider).toBe('autohandai');
    expect(selected.autohandai).toMatchObject({ plan: 'cloud', authMode: 'account' });
    expect(config.provider).toBe('openai');
    expect(config.autohandai).toBeUndefined();
    expect(selected.openai).toEqual(config.openai);
  });

  it('preserves explicit provider settings and rejects invalid provider names', () => {
    const selected = applyCliProviderOverride(config, 'openai');
    expect(selected.openai).toEqual(config.openai);
    expect(applyCliProviderOverride(config, undefined)).toBe(config);
    expect(() => applyCliProviderOverride(config, 'not-a-provider')).toThrow('Unknown provider');
  });
});
