/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, saveConfig } from '../../src/config.js';
import { setConfigSetting } from '../../src/commands/settings.js';

const settingKey = 'features.multi_agent_v2.max_concurrent_threads_per_session';
let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-thread-settings-'));
});

afterEach(async () => {
  await fs.remove(tempRoot);
});

describe('session thread configuration', () => {
  it('defaults new configurations to nine threads including the main agent', async () => {
    const config = await loadConfig(path.join(tempRoot, 'config.json'), undefined, { initializeTheme: false });

    expect(config.features?.multi_agent_v2?.max_concurrent_threads_per_session).toBe(9);
  });

  it.each(['json', 'yaml', 'toml'])('persists the nested setting in %s without changing teammate limits', async (extension) => {
    const configPath = path.join(tempRoot, `config.${extension}`);
    await saveConfig({ configPath, provider: 'openrouter', teams: { maxTeammates: 3 }, features: { automaticSpecialists: false } });
    const config = await loadConfig(configPath, undefined, { initializeTheme: false });
    setConfigSetting(config, settingKey, '4');
    await saveConfig(config);

    const reloaded = await loadConfig(configPath, undefined, { initializeTheme: false });

    expect(reloaded.features?.multi_agent_v2?.max_concurrent_threads_per_session).toBe(4);
    expect(reloaded.features?.automaticSpecialists).toBe(false);
    expect(reloaded.teams?.maxTeammates).toBe(3);
  });

  it.each([0, -1, 1.5, 65, '4', null, true])('rejects an invalid persisted thread limit %j', async (limit) => {
    const configPath = path.join(tempRoot, 'config.json');
    await fs.writeJson(configPath, { features: { multi_agent_v2: { max_concurrent_threads_per_session: limit } } });

    await expect(loadConfig(configPath, undefined, { initializeTheme: false })).rejects.toThrow(
      `${settingKey} must be an integer between 1 and 64`,
    );
  });

  it.each([false, null, 'enabled', []].map(value => ({ value })))('rejects malformed multi-agent configuration $value', async ({ value }) => {
    const configPath = path.join(tempRoot, 'config.json');
    await fs.writeJson(configPath, { features: { multi_agent_v2: value } });

    await expect(loadConfig(configPath, undefined, { initializeTheme: false })).rejects.toThrow(
      'features.multi_agent_v2 must be an object',
    );
  });

  it.each([1, 64])('accepts boundary thread limit %i', async (limit) => {
    const configPath = path.join(tempRoot, 'config.json');
    await fs.writeJson(configPath, { features: { multi_agent_v2: { max_concurrent_threads_per_session: limit } } });

    const config = await loadConfig(configPath, undefined, { initializeTheme: false });

    expect(config.features?.multi_agent_v2?.max_concurrent_threads_per_session).toBe(limit);
  });
});
