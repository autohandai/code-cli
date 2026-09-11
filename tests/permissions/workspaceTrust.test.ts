/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  computeWorkspaceTrustFingerprint,
  isWorkspaceTrusted,
  trustWorkspace,
} from '../../src/permissions/workspaceTrust.js';

let tempDir: string;
let storePath: string;
let workspaceRoot: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-workspace-trust-'));
  storePath = path.join(tempDir, 'home', 'trusted-workspaces.json');
  workspaceRoot = path.join(tempDir, 'workspace');
  await fs.ensureDir(workspaceRoot);
});

afterEach(async () => {
  await fs.remove(tempDir);
});

const entries = {
  hooks: [{ event: 'session-start' as const, command: 'echo project', description: 'Project hook' }],
  mcpServers: [{ name: 'project-server', transport: 'stdio' as const, command: 'project-mcp', args: ['--port', '1'] }],
};

describe('computeWorkspaceTrustFingerprint', () => {
  it('ignores object key order', () => {
    const reordered = {
      mcpServers: [{ args: ['--port', '1'], command: 'project-mcp', transport: 'stdio' as const, name: 'project-server' }],
      hooks: [{ description: 'Project hook', command: 'echo project', event: 'session-start' as const }],
    };

    expect(computeWorkspaceTrustFingerprint(reordered)).toBe(computeWorkspaceTrustFingerprint(entries));
  });

  it('changes when a hook command or a server command changes', () => {
    const original = computeWorkspaceTrustFingerprint(entries);
    const changedHook = computeWorkspaceTrustFingerprint({
      ...entries,
      hooks: [{ ...entries.hooks[0], command: 'echo changed' }],
    });
    const changedServer = computeWorkspaceTrustFingerprint({
      ...entries,
      mcpServers: [{ ...entries.mcpServers[0], args: ['--port', '2'] }],
    });

    expect(changedHook).not.toBe(original);
    expect(changedServer).not.toBe(original);
    expect(changedHook).not.toBe(changedServer);
  });
});

describe('workspace trust store', () => {
  it('reports a workspace as untrusted until it is trusted for that fingerprint', async () => {
    const fingerprint = computeWorkspaceTrustFingerprint(entries);

    expect(await isWorkspaceTrusted(workspaceRoot, fingerprint, storePath)).toBe(false);
    await trustWorkspace(workspaceRoot, fingerprint, storePath);

    expect(await isWorkspaceTrusted(workspaceRoot, fingerprint, storePath)).toBe(true);
    expect(await isWorkspaceTrusted(workspaceRoot, 'different-fingerprint', storePath)).toBe(false);
    expect(await isWorkspaceTrusted(path.join(tempDir, 'other'), fingerprint, storePath)).toBe(false);
  });

  it('treats a symlink to a trusted workspace as the same workspace', async () => {
    const fingerprint = computeWorkspaceTrustFingerprint(entries);
    const alias = path.join(tempDir, 'alias');
    await fs.symlink(workspaceRoot, alias);

    await trustWorkspace(alias, fingerprint, storePath);

    expect(await isWorkspaceTrusted(workspaceRoot, fingerprint, storePath)).toBe(true);
  });

  it('keeps other workspaces when trusting a new one', async () => {
    const other = path.join(tempDir, 'other');
    await fs.ensureDir(other);

    await trustWorkspace(workspaceRoot, 'first', storePath);
    await trustWorkspace(other, 'second', storePath);

    expect(await isWorkspaceTrusted(workspaceRoot, 'first', storePath)).toBe(true);
    expect(await isWorkspaceTrusted(other, 'second', storePath)).toBe(true);
  });

  it('treats an unreadable store as untrusted and replaces it on the next trust', async () => {
    await fs.outputFile(storePath, '{ not json');

    expect(await isWorkspaceTrusted(workspaceRoot, 'fingerprint', storePath)).toBe(false);
    await trustWorkspace(workspaceRoot, 'fingerprint', storePath);

    expect(await isWorkspaceTrusted(workspaceRoot, 'fingerprint', storePath)).toBe(true);
    expect((await fs.readJson(storePath)).version).toBe(1);
  });
});
