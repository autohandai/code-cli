/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fse from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('command model output configuration', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await fse.mkdtemp(path.join(os.tmpdir(), 'autohand-tools-settings-'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fse.remove(directory);
  });

  async function load(tools: unknown) {
    const configPath = path.join(directory, 'config.json');
    await fse.writeJson(configPath, { provider: 'openrouter', openrouter: { apiKey: 'fixture-key', model: 'fixture-model' }, tools });
    return loadConfig(configPath);
  }

  it.each([1024, 30000, 100000])('accepts a safe character limit of %s', async limit => {
    expect((await load({ maxCommandOutputChars: limit })).tools?.maxCommandOutputChars).toBe(limit);
  });

  it.each([0, 1023, -1, 1024.5, '30000', null, Number.MAX_SAFE_INTEGER + 1])('rejects an invalid character limit of %j', async limit => {
    await expect(load({ maxCommandOutputChars: limit })).rejects.toThrow('tools.maxCommandOutputChars must be an integer of at least 1024');
  });

  it.each([false, [], '30000'])('rejects a non-object tools setting %j', async tools => {
    await expect(load(tools)).rejects.toThrow('tools must be an object');
  });
});
