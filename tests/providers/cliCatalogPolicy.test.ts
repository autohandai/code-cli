import { afterAll, describe, expect, it, vi } from 'vitest';
const previousCatalog = vi.hoisted(() => {
  const previous = { catalog: process.env.AUTOHAND_MODELS_CATALOG, home: process.env.AUTOHAND_HOME };
  process.env.AUTOHAND_MODELS_CATALOG = process.cwd() + '/src/providers/models.json';
  process.env.AUTOHAND_HOME = process.cwd() + '/.f0257-hermetic-home';
  return previous;
});
afterAll(() => {
  if (previousCatalog.catalog === undefined) delete process.env.AUTOHAND_MODELS_CATALOG;
  else process.env.AUTOHAND_MODELS_CATALOG = previousCatalog.catalog;
  if (previousCatalog.home === undefined) delete process.env.AUTOHAND_HOME;
  else process.env.AUTOHAND_HOME = previousCatalog.home;
});
import { getProviderModelOptions, getProviderRunnableModelOptions, getProviderDefaultModel, getProviderRuntimeDefaultModel } from '../../src/providers/modelCatalog.js';
import { getAutohandAICloudModelCliUnsupportedReason } from '../../src/providers/AutohandAIProvider.js';

describe('CLI hosted model availability', () => {
  it('does not list Weka even for clients that ignore cliSupported', () => {
    expect(getProviderModelOptions('autohandai').some(model => model.id === 'weka')).toBe(false);
    expect(getProviderRunnableModelOptions('autohandai').some(model => model.id === 'weka')).toBe(false);
  });
  it.each(['weka', 'autohand/weka', 'autohandai/weka'])('rejects %s without depending on a catalog entry', model => {
    expect(getAutohandAICloudModelCliUnsupportedReason(model)).toBe('Weka is available through the Autohand API, the Agent SDKs and the Console, not in the CLI. Pick another model with /model or --model.');
  });
  it.each(['anthropic', 'openrouter'])('offers the Claude 5 family with Sonnet 5.5 first on %s', provider => {
    const prefix = provider === 'openrouter' ? 'anthropic/' : '';
    const models = getProviderModelOptions(provider).map(model => model.id);
    expect(models.slice(0, 4)).toEqual(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'].map(id => prefix + id));
    expect(getProviderDefaultModel(provider)).toBe(prefix + 'claude-sonnet-5-5');
    expect(getProviderRuntimeDefaultModel(provider)).toBe(prefix + 'claude-sonnet-5-5');
  });
});
