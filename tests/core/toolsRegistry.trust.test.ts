/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { createToolsRegistry } from '../../src/core/toolsRegistry.js';

const definition = (name: string, scope: 'project' | 'user') => ({
  name,
  description: `${scope} ${name}`,
  parameters: { type: 'object', properties: {} },
  handler: `echo ${scope}`,
});

const SCRATCH_DIR = path.join(os.homedir(), 'Documents/autohand/digital-team/charlie-cox/scratch');

let root: string;
let userDir: string;

beforeEach(async () => {
  await fs.ensureDir(SCRATCH_DIR);
  root = await fs.mkdtemp(path.join(SCRATCH_DIR, 'tools-trust-'));
  userDir = path.join(root, 'user-tools');
  await fs.ensureDir(path.join(root, 'workspace', '.autohand', 'tools'));
  await fs.ensureDir(userDir);
});

afterEach(async () => {
  await fs.remove(root);
});

describe('project meta-tools and workspace trust', () => {
  it('loads no project meta-tools from an untrusted workspace', async () => {
    await fs.writeJson(path.join(root, 'workspace', '.autohand', 'tools', 'deploy.json'), definition('deploy', 'project'));
    const registry = createToolsRegistry(path.join(root, 'workspace'), userDir, { projectToolsTrusted: false });
    await registry.initialize();
    await registry.listTools([]);
    expect(registry.getMetaTool('deploy')).toBeUndefined();
    expect(registry.getDiagnostics().map((d) => d.reason)).toContain('project tools require a trusted workspace');
  });

  it('loads project meta-tools from a trusted workspace', async () => {
    await fs.writeJson(path.join(root, 'workspace', '.autohand', 'tools', 'deploy.json'), definition('deploy', 'project'));
    const registry = createToolsRegistry(path.join(root, 'workspace'), userDir, { projectToolsTrusted: true });
    await registry.initialize();
    await registry.listTools([]);
    expect(registry.getMetaTool('deploy')?.scope).toBe('project');
  });

  it('lets a user tool win over a project tool of the same name', async () => {
    await fs.writeJson(path.join(root, 'workspace', '.autohand', 'tools', 'lint.json'), definition('lint', 'project'));
    await fs.writeJson(path.join(userDir, 'lint.json'), definition('lint', 'user'));
    const registry = createToolsRegistry(path.join(root, 'workspace'), userDir, { projectToolsTrusted: true });
    await registry.initialize();
    await registry.listTools([]);
    expect(registry.getMetaTool('lint')?.scope).toBe('user');
    expect(registry.getDiagnostics().map((d) => d.reason)).toContain('project tool shadows user tool "lint"');
  });

  it('never lets a project tool take a built-in tool name', async () => {
    await fs.writeJson(path.join(root, 'workspace', '.autohand', 'tools', 'run_command.json'), definition('run_command', 'project'));
    const registry = createToolsRegistry(path.join(root, 'workspace'), userDir, { projectToolsTrusted: true });
    registry.reserveBuiltInNames(['run_command']);
    await registry.initialize();
    await registry.listTools([{ name: 'run_command', description: 'built in', parameters: { type: 'object', properties: {} } } as never]);
    expect(registry.getMetaTool('run_command')).toBeUndefined();
    expect(registry.getDiagnostics().map((d) => d.reason)).toContain('project tool shadows built-in tool "run_command"');
  });
});
