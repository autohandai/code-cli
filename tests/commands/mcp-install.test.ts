/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitHubCommunityMcp, LoadedConfig } from '../../src/types.js';

vi.mock('../../src/config.js', () => ({
  saveConfig: vi.fn(),
}));

import { saveConfig } from '../../src/config.js';
import { installCommunityMcpServer } from '../../src/commands/mcp-install.js';

const filesystemServer: GitHubCommunityMcp = {
  id: 'filesystem',
  name: 'Filesystem',
  description: 'Read and write files within an approved directory.',
  category: 'developer-tools',
  transport: 'stdio',
  command: 'npx',
  args: ['@modelcontextprotocol/server-filesystem'],
  requiredArgs: ['directory'],
  directory: 'developer-tools/filesystem',
  files: ['README.md'],
};

function createConfig(): LoadedConfig {
  return {
    configPath: '/tmp/autohand-config.json',
    provider: 'openrouter',
    mcp: { servers: [] },
  } as LoadedConfig;
}

function createManager() {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    getToolsForServer: vi.fn().mockReturnValue([{ name: 'mcp__filesystem__read_file' }]),
  };
}

describe('community MCP installation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (saveConfig as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it('installs a complete stdio catalog entry without persisting inherited secrets', async () => {
    const config = createConfig();
    const manager = createManager();

    const result = await installCommunityMcpServer(
      { config, mcpManager: manager as any },
      filesystemServer,
      { requiredArgs: ['/workspace'] },
    );

    expect(result).toMatchObject({ success: true, connected: true });
    expect(saveConfig).toHaveBeenCalledWith(config);
    expect(config.mcp?.enabled).toBe(true);
    expect(config.mcp?.servers).toEqual([{
      name: 'filesystem',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/workspace'],
      autoConnect: true,
    }]);
    expect(manager.connect).toHaveBeenCalledWith(config.mcp?.servers?.[0]);
  });

  it('refuses incomplete catalog entries before changing config', async () => {
    const config = createConfig();
    const manager = createManager();

    const result = await installCommunityMcpServer(
      { config, mcpManager: manager as any },
      filesystemServer,
    );

    expect(result).toMatchObject({ success: false, kind: 'validation' });
    expect(result.message).toContain('directory');
    expect(saveConfig).not.toHaveBeenCalled();
    expect(manager.connect).not.toHaveBeenCalled();
    expect(config.mcp?.servers).toEqual([]);
  });

  it('installs HTTP catalog entries with their validated endpoint', async () => {
    const config = createConfig();
    const manager = createManager();
    const context7Server: GitHubCommunityMcp = {
      ...filesystemServer,
      id: 'context7',
      name: 'Context7',
      transport: 'http',
      command: undefined,
      url: 'https://mcp.context7.com/mcp',
      requiredArgs: undefined,
    };

    const result = await installCommunityMcpServer(
      { config, mcpManager: manager as any },
      context7Server,
    );

    expect(result).toMatchObject({ success: true, connected: true });
    expect(config.mcp?.servers).toEqual([{
      name: 'context7',
      transport: 'http',
      url: 'https://mcp.context7.com/mcp',
      autoConnect: true,
    }]);
    expect(manager.connect).toHaveBeenCalledWith(config.mcp?.servers?.[0]);
  });

  it('rejects HTTP catalog entries without an endpoint before writing config', async () => {
    const config = createConfig();
    const manager = createManager();
    const malformedHttp = {
      ...filesystemServer,
      id: 'bad-http',
      transport: 'http' as const,
      command: undefined,
    };

    const result = await installCommunityMcpServer(
      { config, mcpManager: manager as any },
      malformedHttp,
    );

    expect(result).toMatchObject({ success: false, kind: 'validation' });
    expect(result.message).toContain('URL');
    expect(saveConfig).not.toHaveBeenCalled();
    expect(manager.connect).not.toHaveBeenCalled();
  });
});
