/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  formatDoctorReport,
  probeMcpServersWithManager,
  registerDoctorCommand,
  runDoctor,
  type DoctorProbes,
} from '../../src/startup/doctorCommand.js';
import type { LoadedConfig } from '../../src/types.js';

function probes(overrides: Partial<DoctorProbes> = {}): DoctorProbes {
  return {
    version: () => '1.2.3 (abc123)',
    loadConfig: async () => ({ configPath: '/home/me/.autohand/config.json', provider: 'openrouter', openrouter: { apiKey: 'k', model: 'gpt' } } as unknown as LoadedConfig),
    runStartupChecks: async (workspaceRoot) => ({
      tools: [
        { name: 'git', installed: true, version: '2.45', required: true, description: 'git' },
        { name: 'rg', installed: false, required: false, description: 'ripgrep', installHint: 'brew install ripgrep' },
      ],
      workspace: { path: workspaceRoot, writable: true, isGitRepo: true, branch: 'main' },
      allRequiredMet: true,
      warnings: [],
    }),
    loadNodePty: async () => ({}),
    checkAuthenticated: async () => true,
    getProviderConfig: (config, provider) => ((config as unknown as Record<string, unknown>)[provider] as { model?: string } | undefined) ?? null,
    probeMcpServers: async (servers) => servers.map((server) => ({ name: server.name, ok: true, toolCount: 3 })),
    extensionDoctor: async () => ({ healthy: true, extensions: 2, diagnostics: [] }),
    runtime: { node: '22.0.0', platform: 'darwin arm64', execPath: '/usr/local/bin/autohand' },
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
});

describe('runDoctor', () => {
  it('reports a healthy installation with optional tools as warnings', async () => {
    const report = await runDoctor(probes(), { path: '/work' });
    expect(report.ok).toBe(true);
    expect(report.version).toBe('1.2.3 (abc123)');
    expect(report.sections.map((section) => section.title)).toEqual([
      'Runtime', 'Configuration', 'Tools', 'Workspace', 'Terminal', 'Authentication', 'MCP servers', 'Extensions',
    ]);
    const tools = report.sections.find((section) => section.title === 'Tools')!.items;
    expect(tools).toEqual([
      { name: 'git', status: 'ok', detail: '2.45' },
      { name: 'rg', status: 'warn', detail: 'missing (optional)', hint: 'brew install ripgrep' },
    ]);
    expect(report.sections.find((section) => section.title === 'Authentication')!.items[0]).toMatchObject({ status: 'ok', detail: 'signed in' });
    expect(formatDoctorReport(report)).toContain('Ready with 1 warning.');
  });

  it('fails on an unreadable config, a missing required tool, and an unreachable MCP server', async () => {
    const report = await runDoctor(probes({
      loadConfig: async () => { throw new Error('config.json: Unexpected token'); },
      runStartupChecks: async (workspaceRoot) => ({
        tools: [{ name: 'git', installed: false, required: true, description: 'git', installHint: 'brew install git' }],
        workspace: { path: workspaceRoot, writable: false, isGitRepo: false, error: 'read-only' },
        allRequiredMet: false,
        warnings: [],
      }),
    }));
    expect(report.ok).toBe(false);
    expect(report.sections.find((section) => section.title === 'Configuration')!.items[0]).toMatchObject({ status: 'fail', detail: 'config.json: Unexpected token' });
    expect(report.sections.find((section) => section.title === 'Tools')!.items[0]).toMatchObject({ status: 'fail', hint: 'brew install git' });
    expect(report.sections.find((section) => section.title === 'Workspace')!.items[1]).toMatchObject({ status: 'fail', detail: 'read-only' });
    // Without a config there is nothing to authenticate or probe.
    expect(report.sections.map((section) => section.title)).not.toContain('MCP servers');
    expect(formatDoctorReport(report)).toContain('3 problems need attention');
  });

  it('marks a signed-out account as a failure for any provider and probes configured MCP servers', async () => {
    const report = await runDoctor(probes({
      loadConfig: async () => ({ configPath: '/c.json', provider: 'openrouter', openrouter: { model: 'gpt' }, mcp: { servers: [{ name: 'fs', transport: 'stdio', command: 'x' }, { name: 'web', transport: 'http', url: 'http://x' }] } } as unknown as LoadedConfig),
      checkAuthenticated: async () => false,
      probeMcpServers: async () => [{ name: 'fs', ok: true, toolCount: 4 }, { name: 'web', ok: false, error: 'ECONNREFUSED' }],
    }));
    expect(report.ok).toBe(false);
    expect(report.sections.find((section) => section.title === 'Authentication')!.items[0]).toMatchObject({ status: 'fail', detail: 'not signed in', hint: 'Run autohand login.' });
    expect(report.sections.find((section) => section.title === 'MCP servers')!.items).toEqual([
      { name: 'fs', status: 'ok', detail: 'connected · 4 tools' },
      { name: 'web', status: 'fail', detail: 'ECONNREFUSED', hint: 'Check the command, URL, or credentials with autohand mcp connect <name>.' },
    ]);
  });

  it('skips MCP connections on request and warns under Bun where node-pty is not used', async () => {
    const probeMcpServers = vi.fn();
    const report = await runDoctor(probes({
      loadConfig: async () => ({ configPath: '/c.json', provider: 'openrouter', openrouter: {}, mcp: { servers: [{ name: 'fs', transport: 'stdio', command: 'x' }] } } as unknown as LoadedConfig),
      probeMcpServers,
      runtime: { node: '22', bun: '1.2.0', platform: 'linux x64', execPath: '/opt/autohand' },
    }), { skipMcp: true });
    expect(probeMcpServers).not.toHaveBeenCalled();
    expect(report.sections.find((section) => section.title === 'MCP servers')!.items[0]).toMatchObject({ status: 'ok', detail: 'configured (connection skipped)' });
    expect(report.sections.find((section) => section.title === 'Terminal')!.items[0]).toMatchObject({ status: 'warn' });
    expect(report.sections.find((section) => section.title === 'Runtime')!.items[2]).toEqual({ name: 'Bun', status: 'ok', detail: '1.2.0' });
  });
});

describe('runDoctor provider resolution', () => {
  it('resolves custom and extension providers through the injected resolver', async () => {
    const report = await runDoctor(probes({
      loadConfig: async () => ({ configPath: '/c.json', provider: 'custom:acme', customProviders: { acme: { model: 'acme-1' } } } as unknown as LoadedConfig),
      getProviderConfig: (config, provider) => (provider === 'custom:acme' ? (config as unknown as { customProviders: Record<string, { model: string }> }).customProviders.acme : null),
    }), { skipMcp: true });
    const configuration = report.sections.find((section) => section.title === 'Configuration')!.items;
    expect(configuration).toEqual([
      { name: 'Config file', status: 'ok', detail: '/c.json' },
      { name: 'Provider', status: 'ok', detail: 'custom:acme · acme-1' },
    ]);
    expect(report.ok).toBe(true);
  });
});

describe('probeMcpServersWithManager', () => {
  it('bounds each connection, reads the manager state, and always disconnects', async () => {
    const disconnectAll = vi.fn(async () => {});
    const results = await probeMcpServersWithManager(
      [{ name: 'fast', transport: 'stdio', command: 'a' }, { name: 'slow', transport: 'stdio', command: 'b' }, { name: 'broken', transport: 'stdio', command: 'c' }],
      () => ({
        connect: async (config) => {
          if (config.name === 'slow') await new Promise(() => {});
          if (config.name === 'broken') throw new Error('spawn c ENOENT');
        },
        listServers: () => [{ name: 'fast', status: 'connected', toolCount: 2 }],
        disconnectAll,
      }),
      20,
    );
    expect(results).toEqual([
      { name: 'fast', ok: true, toolCount: 2 },
      { name: 'slow', ok: false, error: 'no response within 20 ms' },
      { name: 'broken', ok: false, error: 'spawn c ENOENT' },
    ]);
    expect(disconnectAll).toHaveBeenCalledOnce();
  });
});

describe('doctor command', () => {
  it('prints JSON and sets a nonzero exit code when something fails', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = new Command().exitOverride();
    registerDoctorCommand(program, probes({ loadConfig: async () => { throw new Error('bad config'); } }));
    await program.parseAsync(['doctor', '--json', '--path', '/work'], { from: 'user' });
    const printed = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(printed.ok).toBe(false);
    expect(printed.sections[1].items[0].detail).toBe('bad config');
    expect(process.exitCode).toBe(1);
  });

  it('prints the human report and exits zero when healthy', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = new Command().exitOverride();
    registerDoctorCommand(program, probes());
    await program.parseAsync(['doctor', '--skip-mcp'], { from: 'user' });
    expect(String(log.mock.calls[0]?.[0])).toContain('Autohand doctor');
    expect(process.exitCode).toBe(0);
  });
});
