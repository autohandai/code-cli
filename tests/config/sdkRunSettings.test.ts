import { afterEach, describe, expect, it } from 'vitest';
import { applyRunConfigOverlay, configureRunConfigOverlay, consumeSdkRunSettings, getRunConfigOverlaySelection, parseRunConfigSet, restoreRunConfigOverlay } from '../../src/runConfigOverlay.js';
import type { AutohandConfig } from '../../src/types.js';

afterEach(() => configureRunConfigOverlay(undefined, undefined));

const config = (): AutohandConfig => ({ provider: 'openai', openai: { apiKey: 'saved', model: 'saved-model' }, features: { awsBedrockProvider: false, slashGoal: true } });

describe('SDK run settings', () => {
  it('applies typed startup settings before explicit overrides without replacing saved fields', () => {
    configureRunConfigOverlay({ sets: ['features.awsBedrockProvider=false'] }, JSON.stringify({ openai: { apiKey: 'true', baseUrl: 'https://model.test' }, features: { awsBedrockProvider: true } }));
    const original = config();
    const result = applyRunConfigOverlay(original);
    expect(result.config.openai).toEqual({ apiKey: 'true', model: 'saved-model', baseUrl: 'https://model.test' });
    expect(result.config.features).toEqual({ awsBedrockProvider: false, slashGoal: true });
    expect(original.openai?.apiKey).toBe('saved');
    const restored = structuredClone(result.config) as Record<string, unknown>;
    restoreRunConfigOverlay(restored, result.snapshot!);
    expect(restored).toEqual(original);
  });

  it.each(['[]', 'null', 'true', '"secret"', '{invalid'])('rejects malformed settings without exposing their contents', (input) => {
    expect(() => configureRunConfigOverlay(undefined, input)).toThrow('AUTOHAND_RUN_SETTINGS');
    try { configureRunConfigOverlay(undefined, input); } catch (error) { expect(String(error)).not.toContain(input); }
  });

  it.each(['auth.token', '__proto__.polluted', 'constructor.prototype.polluted', 'openai.__proto__.polluted'])('rejects unsafe or protected overlay paths', (path) => {
    expect(() => parseRunConfigSet(path + '=credential-secret')).toThrow();
    const segments = path.split('.');
    let value: unknown = 'credential-secret';
    for (const segment of segments.reverse()) value = { [segment]: value };
    expect(() => configureRunConfigOverlay(undefined, JSON.stringify(value))).toThrow();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it.each([false, null, {}, { enabled: false }, 'invalid'])('rejects unsupported session awareness values (%j)', (awareness) => {
    expect(() => configureRunConfigOverlay(undefined, JSON.stringify({ sessions: { awareness } }))).toThrow('sessions.awareness');
  });

  it('retains false, null, arrays and empty objects as typed values', () => {
    configureRunConfigOverlay(undefined, JSON.stringify({ features: { slashGoal: false }, openai: { apiKey: 'null', baseUrl: null }, customProviders: { "id.v1": { headers: {}, models: [] } } }));
    const result = applyRunConfigOverlay(config()).config;
    expect(result.openai?.apiKey).toBe('null');
    expect(result.openai?.baseUrl).toBeNull();
    expect(result.features?.slashGoal).toBe(false);
    expect(getRunConfigOverlaySelection()).toBeDefined();
  });
});

describe('SDK settings compatibility guard', () => {
  it('consumes the envelope before tool children can inherit it', () => {
    const environment = { AUTOHAND_RUN_SETTINGS: '{"features":{"slashGoal":false}}' };
    expect(consumeSdkRunSettings('1', environment)).toEqual({ features: { slashGoal: false } });
    expect(environment).toEqual({});
  });
  it.each([undefined, '0', '2'])('rejects an unsupported or absent version before runtime construction', (version) => {
    const environment = { AUTOHAND_RUN_SETTINGS: '{"openai":{"apiKey":"provider-secret"}}' };
    expect(() => consumeSdkRunSettings(version, environment)).toThrow('sdk-settings-version 1');
    expect(environment).toEqual({});
  });
  it('rejects a version without settings and rejects restricted profiles', () => {
    expect(() => consumeSdkRunSettings('1', {})).toThrow();
    expect(() => consumeSdkRunSettings('1', { AUTOHAND_RUN_SETTINGS: '{}' }, true)).toThrow('restricted');
  });
});
