/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fse from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('shell.env config validation', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fse.mkdtemp(path.join(os.tmpdir(), 'autohand-shell-settings-'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    const { configureChildProcessEnvPolicy } = await import('../../src/utils/childProcessEnv.js');
    configureChildProcessEnvPolicy(undefined);
    await fse.remove(testDir);
  });

  async function load(shell: unknown) {
    const configPath = path.join(testDir, 'config.json');
    await fse.writeJson(configPath, { provider: 'openrouter', openrouter: { apiKey: 'k', model: 'm' }, shell });
    const { loadConfig } = await import('../../src/config.js');
    return loadConfig(configPath);
  }

  it('installs a valid policy for child processes', async () => {
    await load({ env: { inherit: 'essential', include: ['NODE_*'], exclude: ['*_TOKEN'], set: { CI: '1' } } });
    const { getChildProcessEnvPolicy } = await import('../../src/utils/childProcessEnv.js');
    expect(getChildProcessEnvPolicy()).toEqual({ inherit: 'essential', include: ['NODE_*'], exclude: ['*_TOKEN'], set: { CI: '1' } });
  });

  it.each([
    [{ env: { inherit: 'some' } }, 'shell.env.inherit must be "all", "essential", or "none"'],
    [{ env: { exclude: 'PATH' } }, 'shell.env.exclude must be a list of variable names or globs'],
    [{ env: { set: { CI: 1 } } }, 'shell.env.set must map variable names to strings'],
    [{ env: 'none' }, 'shell.env must be an object'],
    ['none', 'shell must be an object'],
  ])('rejects %j with a message naming the field', async (shell, message) => {
    await expect(load(shell)).rejects.toThrow(message);
  });
});
