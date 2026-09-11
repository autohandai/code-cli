/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isWorkspaceTrusted } from '../../src/permissions/workspaceTrust.js';
import {
  formatWorkspaceTrustSummary,
  resolveWorkspaceTrust,
} from '../../src/startup/workspaceTrustPrompt.js';
import type { LoadedConfig, WorkspaceTrustState } from '../../src/types.js';

let tempDir: string;
let storePath: string;
let workspaceRoot: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-trust-prompt-'));
  storePath = path.join(tempDir, 'home', 'trusted-workspaces.json');
  workspaceRoot = path.join(tempDir, 'workspace');
  await fs.ensureDir(workspaceRoot);
});

afterEach(async () => {
  await fs.remove(tempDir);
});

function untrustedConfig(): LoadedConfig {
  const workspaceTrust: WorkspaceTrustState = {
    workspaceRoot,
    fingerprint: 'a'.repeat(64),
    trusted: false,
    hooks: [
      { event: 'session-start', command: 'node scripts/record.cjs start' },
      { event: 'pre-prompt', command: 'node scripts/check-prompt.cjs' },
    ],
    mcpServers: [
      { name: 'project-tools', transport: 'stdio', command: 'npx', args: ['project-tools-mcp', '--stdio'] },
      { name: 'project-docs', transport: 'http', url: 'https://docs.example.test/mcp' },
    ],
  };
  return {
    configPath: path.join(tempDir, 'home', 'config.json'),
    provider: 'anthropic',
    hooks: { hooks: [{ event: 'stop', command: 'echo global' }] },
    mcp: { servers: [] },
    workspaceTrust,
  } as LoadedConfig;
}

describe('resolveWorkspaceTrust', () => {
  it('does nothing when the workspace declares no project hooks or servers, or is already trusted', async () => {
    const prompt = vi.fn();
    const write = vi.fn();
    const trusted = untrustedConfig();
    trusted.workspaceTrust = { ...trusted.workspaceTrust!, trusted: true };

    expect(await resolveWorkspaceTrust({ configPath: 'x' } as LoadedConfig, { interactive: true, prompt, write, storePath })).toBe('not-needed');
    expect(await resolveWorkspaceTrust(trusted, { interactive: true, prompt, write, storePath })).toBe('not-needed');
    expect(prompt).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('records trust and applies the project entries when the user trusts the workspace', async () => {
    const config = untrustedConfig();
    const prompt = vi.fn().mockResolvedValue('trust');
    const write = vi.fn();

    const outcome = await resolveWorkspaceTrust(config, { interactive: true, prompt, write, storePath });

    expect(outcome).toBe('trusted');
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ workspaceRoot, trusted: false }));
    expect(await isWorkspaceTrusted(workspaceRoot, 'a'.repeat(64), storePath)).toBe(true);
    expect(config.workspaceTrust?.trusted).toBe(true);
    expect(config.hooks?.hooks?.map(hook => hook.command)).toEqual([
      'echo global',
      'node scripts/record.cjs start',
      'node scripts/check-prompt.cjs',
    ]);
    expect(config.mcp?.servers?.map(server => server.name)).toEqual(['project-tools', 'project-docs']);
  });

  it.each([
    ['chooses not now', 'skip'],
    ['cancels the prompt', null],
  ])('starts without project entries and says it will ask again when the user %s', async (_label, answer) => {
    const config = untrustedConfig();
    const write = vi.fn();

    const outcome = await resolveWorkspaceTrust(config, {
      interactive: true,
      prompt: vi.fn().mockResolvedValue(answer),
      write,
      storePath,
    });

    expect(outcome).toBe('skipped');
    expect(await isWorkspaceTrusted(workspaceRoot, 'a'.repeat(64), storePath)).toBe(false);
    expect(config.hooks?.hooks?.map(hook => hook.command)).toEqual(['echo global']);
    expect(write).toHaveBeenCalledWith(expect.stringContaining('2 project hooks and 2 MCP servers'));
    expect(write).toHaveBeenCalledWith(expect.stringContaining('ask again next time'));
  });

  it('warns without prompting when nobody can answer, and leaves project entries out', async () => {
    const config = untrustedConfig();
    const prompt = vi.fn();
    const write = vi.fn();

    const outcome = await resolveWorkspaceTrust(config, { interactive: false, prompt, write, storePath });

    expect(outcome).toBe('skipped');
    expect(prompt).not.toHaveBeenCalled();
    expect(config.hooks?.hooks?.map(hook => hook.command)).toEqual(['echo global']);
    const message = write.mock.calls.map(([text]) => text).join('');
    expect(message).toContain('Skipped 2 project hooks and 2 MCP servers');
    expect(message).toContain(workspaceRoot);
    expect(message).toContain('not trusted');
    expect(message).toContain('interactively');
  });

  it('uses singular wording for a single hook and no servers', async () => {
    const config = untrustedConfig();
    config.workspaceTrust = { ...config.workspaceTrust!, hooks: config.workspaceTrust!.hooks.slice(0, 1), mcpServers: [] };
    const write = vi.fn();

    await resolveWorkspaceTrust(config, { interactive: false, write, storePath });

    expect(write.mock.calls.map(([text]) => text).join('')).toContain('Skipped 1 project hook from');
  });
});

describe('formatWorkspaceTrustSummary', () => {
  it('lists the workspace, every hook command, and how each MCP server starts', () => {
    const summary = formatWorkspaceTrustSummary(untrustedConfig().workspaceTrust!);

    expect(summary).toContain(workspaceRoot);
    expect(summary).toMatch(/session-start\s+node scripts\/record\.cjs start/);
    expect(summary).toMatch(/pre-prompt\s+node scripts\/check-prompt\.cjs/);
    expect(summary).toMatch(/project-tools\s+npx project-tools-mcp --stdio/);
    expect(summary).toMatch(/project-docs\s+https:\/\/docs\.example\.test\/mcp/);
  });
});
