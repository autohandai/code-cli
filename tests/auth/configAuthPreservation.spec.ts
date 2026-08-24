/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * `~/.autohand/config.json` is shared by every terminal tab. A tab that has
 * been open for hours still holds the credential it loaded at startup, so an
 * incidental save (a model switch, a settings change) must not rewrite the file
 * with that stale credential and sign the newer tab out.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { saveConfig } from '../../src/config.js';
import type { LoadedConfig } from '../../src/types.js';

let directory: string;
let configPath: string;

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-config-auth-'));
  configPath = path.join(directory, 'config.json');
});

afterEach(async () => {
  await fs.remove(directory);
});

function baseConfig(auth: LoadedConfig['auth']): LoadedConfig {
  return {
    configPath,
    provider: 'openrouter',
    openrouter: { apiKey: 'k', model: 'anthropic/claude-sonnet-5' },
    ...(auth ? { auth } : {}),
  } as LoadedConfig;
}

describe('saveConfig auth preservation', () => {
  it('keeps a credential another tab wrote while this one held a stale copy', async () => {
    await fs.writeJson(configPath, {
      provider: 'openrouter',
      auth: { token: 'new-token', user: { id: 'u1', email: 'a@b.c', name: 'A' } },
    });

    // This tab loaded before the other tab signed in again.
    await saveConfig(baseConfig({
      token: 'stale-token',
      user: { id: 'u1', email: 'a@b.c', name: 'A' },
    }));

    const persisted = await fs.readJson(configPath) as LoadedConfig;
    expect(persisted.auth?.token).toBe('new-token');
    // The rest of the incidental save still lands.
    expect(persisted.openrouter?.model).toBe('anthropic/claude-sonnet-5');
  });

  it('writes the credential when the caller is explicitly changing auth', async () => {
    await fs.writeJson(configPath, { provider: 'openrouter', auth: { token: 'old-token' } });

    await saveConfig(baseConfig({
      token: 'fresh-login-token',
      user: { id: 'u1', email: 'a@b.c', name: 'A' },
    }), { writeAuth: true });

    const persisted = await fs.readJson(configPath) as LoadedConfig;
    expect(persisted.auth?.token).toBe('fresh-login-token');
  });

  it('lets an explicit sign-out clear the stored credential', async () => {
    await fs.writeJson(configPath, { provider: 'openrouter', auth: { token: 'old-token' } });

    await saveConfig(baseConfig(undefined), { writeAuth: true });

    const persisted = await fs.readJson(configPath) as Record<string, unknown>;
    expect(persisted.auth).toBeUndefined();
  });

  it('still persists a credential when the file has none yet', async () => {
    await saveConfig(baseConfig({
      token: 'first-token',
      user: { id: 'u1', email: 'a@b.c', name: 'A' },
    }));

    const persisted = await fs.readJson(configPath) as LoadedConfig;
    expect(persisted.auth?.token).toBe('first-token');
  });

  it('does not resurrect a credential an incidental save never had', async () => {
    await fs.writeJson(configPath, { provider: 'openrouter' });

    await saveConfig(baseConfig(undefined));

    const persisted = await fs.readJson(configPath) as Record<string, unknown>;
    expect(persisted.auth).toBeUndefined();
  });
});
