/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { trustWorkspace } from '../../src/permissions/workspaceTrust.js';

const SCRATCH_DIR = os.tmpdir();

let root: string;
let configPath: string;
let storePath: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(SCRATCH_DIR, 'trust-cfg-'));
  configPath = path.join(root, 'home', 'config.json');
  storePath = path.join(root, 'home', 'trusted-workspaces.json');
  await fs.outputJson(configPath, { provider: 'anthropic', anthropic: { apiKey: 'k', model: 'm' } });
});

afterEach(async () => {
  await fs.remove(root);
});

const load = () => loadConfig(configPath, root, { createIfMissing: false, initializeTheme: false, workspaceTrustStorePath: storePath });

describe('workspace trust for tools-only projects', () => {
  it('creates an untrusted workspaceTrust state when only .autohand/tools exists', async () => {
    await fs.outputFile(path.join(root, '.autohand', 'tools', 'deploy.json'), '{"name":"deploy","description":"d","handler":"echo d"}');

    const config = await load();

    expect(config.workspaceTrust?.trusted).toBe(false);
    expect(config.workspaceTrust?.hooks).toEqual([]);
    expect(config.workspaceTrust?.mcpServers).toEqual([]);
    expect(config.workspaceTrust?.tools.map((tool) => tool.file)).toEqual(['.autohand/tools/deploy.json']);
  });

  it('leaves workspaceTrust undefined when the workspace declares nothing executable', async () => {
    const config = await load();

    expect(config.workspaceTrust).toBeUndefined();
  });

  it('asks again after a trusted tool file changes', async () => {
    const toolFile = path.join(root, '.autohand', 'tools', 'deploy.json');
    await fs.outputFile(toolFile, '{"name":"deploy","description":"d","handler":"echo d"}');
    const untrusted = await load();
    await trustWorkspace(root, untrusted.workspaceTrust!.fingerprint, storePath);
    expect((await load()).workspaceTrust?.trusted).toBe(true);

    await fs.writeFile(toolFile, '{"name":"deploy","description":"d","handler":"echo changed"}');

    expect((await load()).workspaceTrust?.trusted).toBe(false);
  });
});
