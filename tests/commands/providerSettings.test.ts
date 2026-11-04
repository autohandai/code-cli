import { describe, expect, it } from 'vitest';
import { setConfigSetting } from '../../src/commands/settings.js';
import { BUILT_IN_PROVIDER_NAMES, type LoadedConfig } from '../../src/types.js';

const providers = BUILT_IN_PROVIDER_NAMES.filter(provider => provider !== 'autohandai');

describe('built-in provider config commands', () => {
  it.each(providers)('accepts %s and its saved API key', provider => {
    const config: LoadedConfig = { provider: 'openrouter', configPath: 'unused.json' };
    expect(setConfigSetting(config, `${provider}.apiKey`, 'test-key')).toEqual({ key: `${provider}.apiKey`, value: 'test-key' });
    expect(setConfigSetting(config, 'provider', provider)).toEqual({ key: 'provider', value: provider });
    expect(config[provider]?.apiKey).toBe('test-key');
  });
  it('preserves mandatory Autohand authentication', () => {
    const config: LoadedConfig = { provider: 'autohandai', configPath: 'unused.json' };
    expect(() => setConfigSetting(config, 'autohandai.apiKey', 'test-key')).toThrow();
  });
});
