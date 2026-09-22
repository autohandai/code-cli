/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fse from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyRunConfigOverlay,
  configureRunConfigOverlay,
  parseRunConfigSet,
  restoreRunConfigOverlay,
} from '../../src/runConfigOverlay.js';
import type { AutohandConfig } from '../../src/types.js';

const base = (): AutohandConfig => ({
  provider: 'openrouter',
  openrouter: { apiKey: 'k', model: 'gpt' },
  ui: { theme: 'dark', showThinking: false },
  agent: { maxIterations: 100 },
  profiles: {
    review: { provider: 'autohandai', autohandai: { model: 'moa' }, ui: { showThinking: true }, permissions: { mode: 'restricted' } },
  },
} as unknown as AutohandConfig);

afterEach(() => configureRunConfigOverlay(undefined));

describe('parseRunConfigSet', () => {
  it('parses dotted keys and JSON or literal values', () => {
    expect(parseRunConfigSet('ui.theme=aurora')).toEqual({ path: ['ui', 'theme'], value: 'aurora' });
    expect(parseRunConfigSet('agent.maxIterations=50')).toEqual({ path: ['agent', 'maxIterations'], value: 50 });
    expect(parseRunConfigSet('permissions.allowList=["read_file"]')).toEqual({ path: ['permissions', 'allowList'], value: ['read_file'] });
    expect(parseRunConfigSet('ui.showThinking=true')).toEqual({ path: ['ui', 'showThinking'], value: true });
  });

  it('rejects malformed keys and protected sections', () => {
    expect(() => parseRunConfigSet('novalue')).toThrow('expects key=value');
    expect(() => parseRunConfigSet('ui..theme=x')).toThrow('dotted path');
    expect(() => parseRunConfigSet('auth.token=x')).toThrow('cannot change "auth"');
    expect(() => parseRunConfigSet('profiles.review.ui.theme=x')).toThrow('cannot change "profiles"');
  });
});

describe('applyRunConfigOverlay', () => {
  it('leaves the config alone without a selection', () => {
    const config = base();
    expect(applyRunConfigOverlay(config, undefined)).toEqual({ config });
  });

  it('layers a profile then --set, recording what each path replaced', () => {
    const { config, snapshot } = applyRunConfigOverlay(base(), { profile: 'review', sets: ['ui.theme=aurora', 'autohandai.model=fantail'] });
    expect(config.provider).toBe('autohandai');
    expect(config.ui).toEqual({ theme: 'aurora', showThinking: true });
    expect(config.permissions).toEqual({ mode: 'restricted' });
    expect((config as { autohandai?: { model?: string } }).autohandai?.model).toBe('fantail');
    expect(snapshot?.profile).toBe('review');
    expect(snapshot?.entries).toContainEqual({ path: ['provider'], applied: 'autohandai', hadBase: true, base: 'openrouter' });
    expect(snapshot?.entries).toContainEqual({ path: ['permissions', 'mode'], applied: 'restricted', hadBase: false, base: undefined });
    // The original object is untouched.
    expect(base().provider).toBe('openrouter');
  });

  it('names the available profiles when the selected one is missing', () => {
    expect(() => applyRunConfigOverlay(base(), { profile: 'nope' })).toThrow('Profile "nope" is not defined in the config. Available profiles: review.');
    expect(() => applyRunConfigOverlay({ provider: 'openrouter' } as AutohandConfig, { profile: 'nope' })).toThrow('Add it under "profiles"');
  });

  it('refuses a profile that reaches into auth', () => {
    const config = { ...base(), profiles: { bad: { auth: { token: 'x' } } } } as unknown as AutohandConfig;
    expect(() => applyRunConfigOverlay(config, { profile: 'bad' })).toThrow('cannot change "auth"');
  });
});

describe('loadConfig run overlay control', () => {
  it('can read persisted settings without process-only profile or --set overrides', async () => {
    const root = await fse.mkdtemp(path.join(os.tmpdir(), 'autohand-run-overlay-persisted-'));
    try {
      const configPath = path.join(root, 'config.json');
      await fse.writeJson(configPath, {
        provider: 'openrouter',
        openrouter: { apiKey: 'k', model: 'm' },
        traces: { enabled: false },
      });
      configureRunConfigOverlay({ sets: ['traces.enabled=true'] });
      const { loadConfig } = await import('../../src/config.js');

      const loaded = await loadConfig(configPath, undefined, { applyRunConfigOverlay: false });

      expect(loaded.traces?.enabled).toBe(false);
      expect(loaded.runOverlay).toBeUndefined();
    } finally {
      await fse.remove(root);
    }
  });
});

describe('restoreRunConfigOverlay', () => {
  it('restores the file values for untouched paths and keeps values the user changed during the run', () => {
    const { config, snapshot } = applyRunConfigOverlay(base(), { profile: 'review', sets: ['ui.theme=aurora'] });
    const data = structuredClone(config) as unknown as Record<string, unknown>;
    // The user picked a new model during the run; that must survive the save.
    (data.autohandai as Record<string, unknown>).model = 'fantail';
    restoreRunConfigOverlay(data, snapshot!);
    expect(data.provider).toBe('openrouter');
    expect(data.ui).toEqual({ theme: 'dark', showThinking: false });
    expect(data.permissions).toEqual({});
    expect(data.autohandai).toEqual({ model: 'fantail' });
  });
});

describe('loadConfig with a profile', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fse.mkdtemp(path.join(os.tmpdir(), 'autohand-profile-'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    configureRunConfigOverlay(undefined);
    await fse.remove(dir);
  });

  it('applies the profile and overrides for the run and saves the file without them', async () => {
    const configPath = path.join(dir, 'config.json');
    const original = {
      provider: 'openrouter',
      openrouter: { apiKey: 'k', model: 'gpt' },
      ui: { theme: 'dark' },
      profiles: { quiet: { ui: { promptSuggestions: false, showThinking: true } } },
    };
    await fse.writeJson(configPath, original, { spaces: 2 });
    configureRunConfigOverlay({ profile: 'quiet', sets: ['agent.maxIterations=7'] });
    const { loadConfig, saveConfig } = await import('../../src/config.js');

    const loaded = await loadConfig(configPath);
    expect(loaded.ui).toMatchObject({ theme: 'dark', promptSuggestions: false, showThinking: true });
    expect(loaded.agent?.maxIterations).toBe(7);
    expect(loaded.runOverlay?.profile).toBe('quiet');

    loaded.ui = { ...loaded.ui, theme: 'aurora' };
    await saveConfig(loaded);
    const written = await fse.readJson(configPath);
    expect(written.ui).toEqual({ theme: 'aurora' });
    expect(written.agent).toEqual({});
    expect(written.profiles).toEqual(original.profiles);
    expect(written).not.toHaveProperty('runOverlay');
  });

  it('stops with the available profile names when the profile is unknown', async () => {
    const configPath = path.join(dir, 'config.json');
    await fse.writeJson(configPath, { provider: 'openrouter', openrouter: { apiKey: 'k', model: 'm' }, profiles: { a: {}, b: {} } });
    configureRunConfigOverlay({ profile: 'c' });
    const { loadConfig } = await import('../../src/config.js');
    await expect(loadConfig(configPath)).rejects.toThrow('Available profiles: a, b');
  });
});
