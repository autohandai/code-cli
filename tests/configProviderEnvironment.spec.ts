import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getProviderConfig, loadConfig, saveConfig } from '../src/config.js';

describe('process provider selection', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-provider-env-'));
    vi.stubEnv('AUTOHAND_PROVIDER', undefined);
    vi.stubEnv('AUTOHAND_AI_API_KEY', 'fixture-inference-key');
    vi.stubEnv('AUTOHAND_AI_BASE_URL', 'http://127.0.0.1:12345/v1');
    vi.stubEnv('AUTOHAND_AI_PLAN', 'cloud');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.remove(directory);
  });

  const formats = [
    ['json', '{"provider":"openrouter","auth":{"token":"fixture-account-token"}}'],
    ['yaml', 'provider: openrouter\nauth:\n  token: fixture-account-token\n'],
    ['toml', 'provider = "openrouter"\n[auth]\ntoken = "fixture-account-token"\n'],
  ] as const;

  it.each(formats)('selects Autohand AI over global and workspace %s settings without rewriting them', async (format, content) => {
    const configPath = path.join(directory, `config.${format}`);
    const workspace = path.join(directory, 'project');
    const localPath = path.join(workspace, '.autohand', 'settings.local.json');
    const localContent = '{"provider":"openai","permissions":{"mode":"restricted"}}';
    await fs.writeFile(configPath, content);
    await fs.outputFile(localPath, localContent);
    vi.stubEnv('AUTOHAND_PROVIDER', 'autohandai');

    const config = await loadConfig(configPath, workspace, { initializeTheme: false });

    expect(config.provider).toBe('autohandai');
    expect(config.auth?.token).toBe('fixture-account-token');
    expect(config.permissions?.mode).toBe('restricted');
    expect(getProviderConfig(config)).toMatchObject({
      apiKey: 'fixture-inference-key', baseUrl: 'http://127.0.0.1:12345/v1', model: 'fantail',
    });
    expect(await fs.readFile(configPath, 'utf8')).toBe(content);
    expect(await fs.readFile(localPath, 'utf8')).toBe(localContent);
  });

  it.each(['anthropic', 'custom:acme', 'extension:company-provider', 'vertex'])('accepts the existing provider contract for %s', async provider => {
    const configPath = path.join(directory, 'config.json');
    await fs.writeJson(configPath, { provider: 'openrouter' });
    vi.stubEnv('AUTOHAND_PROVIDER', provider);

    const config = await loadConfig(configPath, undefined, { initializeTheme: false });

    expect(config.provider).toBe(provider === 'vertex' ? 'vertexai' : provider);
  });

  it.each(['', '   ', 'unknown-provider', 'extension:'])('rejects invalid explicit selection %j instead of silently using a saved provider', async provider => {
    const configPath = path.join(directory, 'config.json');
    await fs.writeJson(configPath, { provider: 'openrouter' });
    vi.stubEnv('AUTOHAND_PROVIDER', provider);

    await expect(loadConfig(configPath, undefined, { initializeTheme: false }))
      .rejects.toThrow('AUTOHAND_PROVIDER');
  });

  it('keeps the saved provider when only inference credentials are supplied', async () => {
    const configPath = path.join(directory, 'config.json');
    await fs.writeJson(configPath, { provider: 'openrouter' });

    const config = await loadConfig(configPath, undefined, { initializeTheme: false });

    expect(config.provider).toBe('openrouter');
  });

  it('preserves an explicitly disabled inference feature', async () => {
    const configPath = path.join(directory, 'config.json');
    await fs.writeJson(configPath, { provider: 'openrouter', features: { autohand_inference: false } });
    vi.stubEnv('AUTOHAND_PROVIDER', 'autohandai');

    const config = await loadConfig(configPath, undefined, { initializeTheme: false });

    expect(config.provider).toBe('autohandai');
    expect(config.features?.autohand_inference).toBe(false);
    expect(getProviderConfig(config)).toBeNull();
  });

  it.each(formats)('does not persist process provider settings during an unrelated %s save', async (format, content) => {
    const configPath = path.join(directory, `config.${format}`);
    await fs.writeFile(configPath, content);
    vi.stubEnv('AUTOHAND_PROVIDER', 'autohandai');
    const config = await loadConfig(configPath, undefined, { initializeTheme: false });
    config.ui = { completionReportEnabled: false };

    await saveConfig(config);
    vi.stubEnv('AUTOHAND_PROVIDER', undefined);
    vi.stubEnv('AUTOHAND_AI_API_KEY', undefined);
    vi.stubEnv('AUTOHAND_AI_BASE_URL', undefined);
    vi.stubEnv('AUTOHAND_AI_PLAN', undefined);
    const saved = await loadConfig(configPath, undefined, { initializeTheme: false });

    expect(saved.provider).toBe('openrouter');
    expect(saved.autohandai).toBeUndefined();
    expect(saved.ui?.completionReportEnabled).toBe(false);
    expect(saved.auth?.token).toBe('fixture-account-token');
  });

  it('keeps the latest saved provider credentials when another process updates them', async () => {
    const configPath = path.join(directory, 'config.json');
    const original = {
      provider: 'openrouter',
      autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'saved-key', model: 'moa' },
    };
    await fs.writeJson(configPath, original);
    vi.stubEnv('AUTOHAND_PROVIDER', 'autohandai');
    const config = await loadConfig(configPath, undefined, { initializeTheme: false });
    const newer = { ...original, provider: 'ollama', autohandai: { ...original.autohandai, apiKey: 'newer-key' } };
    await fs.writeJson(configPath, newer);

    await saveConfig(config);

    const saved = await fs.readJson(configPath);
    expect(saved.provider).toBe('ollama');
    expect(saved.autohandai).toEqual(newer.autohandai);
    expect(config.autohandai?.apiKey).toBe('fixture-inference-key');
  });
});
