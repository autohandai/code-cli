/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fse from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

const directories: string[] = [];

async function configFile(features: Record<string, unknown>): Promise<string> {
  const directory = await fse.mkdtemp(path.join(os.tmpdir(), 'autohand-cli-lanes-'));
  directories.push(directory);
  const file = path.join(directory, 'config.json');
  await fse.writeJson(file, { provider: 'openrouter', openrouter: { apiKey: 'test', model: 'test/model' }, features });
  return file;
}

afterEach(async () => {
  for (const directory of directories.splice(0)) await fse.remove(directory);
});

describe('features.cliLanes config validation', () => {
  it.each([true, false])('accepts %s', async (value) => {
    const config = await loadConfig(await configFile({ cliLanes: value }));
    expect(config.features?.cliLanes).toBe(value);
  });

  it('accepts a config that omits the flag', async () => {
    const config = await loadConfig(await configFile({}));
    expect(config.features?.cliLanes).toBeUndefined();
  });

  it.each(['yes', 1, null, {}])('rejects the non-boolean value %j', async (value) => {
    await expect(loadConfig(await configFile({ cliLanes: value }))).rejects.toThrow('features.cliLanes must be a boolean');
  });
});
