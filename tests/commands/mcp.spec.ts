/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadedConfig } from '../../src/types.js';

vi.mock('../../src/config.js', () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
}));

import { mcp } from '../../src/commands/mcp.js';
import { loadConfig, saveConfig } from '../../src/config.js';

function makeConfig(configPath: string): LoadedConfig {
  return {
    configPath,
    provider: 'openrouter',
    mcp: {
      servers: [],
    },
  } as LoadedConfig;
}

function createManagerMock() {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    getToolsForServer: vi.fn().mockReturnValue([]),
    getAllTools: vi.fn().mockReturnValue([]),
    listServers: vi.fn().mockReturnValue([]),
  };
}

describe('/mcp slash command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses --scope in /mcp add without treating it as the executable', async () => {
    const manager = createManagerMock();
    const scopedConfig = makeConfig('/tmp/user-config.json');
    (loadConfig as ReturnType<typeof vi.fn>).mockResolvedValue(scopedConfig);
    (saveConfig as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const result = await mcp(
      {
        mcpManager: manager as any,
        config: makeConfig('/tmp/runtime-config.json'),
        workspaceRoot: '/tmp/workspace',
      },
      ['add', 'chrome-devtools', '--scope', 'user', 'npx', 'chrome-devtools-mcp@latest']
    );

    expect(loadConfig).toHaveBeenCalledTimes(1);
    expect(manager.connect).toHaveBeenCalledWith(expect.objectContaining({
      name: 'chrome-devtools',
      transport: 'stdio',
      command: 'npx',
      args: expect.arrayContaining(['-y', 'chrome-devtools-mcp@latest']),
    }));
    expect(result).toContain('Added and connected');
  });

  it('returns a clear error for invalid scope values', async () => {
    const manager = createManagerMock();
    const result = await mcp(
      {
        mcpManager: manager as any,
        config: makeConfig('/tmp/runtime-config.json'),
        workspaceRoot: '/tmp/workspace',
      },
      ['add', 'chrome-devtools', '--scope', 'workspace', 'npx', 'chrome-devtools-mcp@latest']
    );

    expect(result).toContain('Invalid scope');
    expect(manager.connect).not.toHaveBeenCalled();
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it('parses --scope in /mcp remove and removes from that scoped config', async () => {
    const manager = createManagerMock();
    const scopedConfig = makeConfig('/tmp/user-config.json');
    scopedConfig.mcp = {
      servers: [{
        name: 'chrome-devtools',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'chrome-devtools-mcp@latest'],
        autoConnect: true,
      }],
    };
    (loadConfig as ReturnType<typeof vi.fn>).mockResolvedValue(scopedConfig);
    (saveConfig as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const result = await mcp(
      {
        mcpManager: manager as any,
        config: makeConfig('/tmp/runtime-config.json'),
        workspaceRoot: '/tmp/workspace',
      },
      ['remove', '--scope', 'user', 'chrome-devtools']
    );

    expect(loadConfig).toHaveBeenCalledTimes(1);
    expect(manager.disconnect).toHaveBeenCalledWith('chrome-devtools');
    expect(result).toContain('Removed "chrome-devtools"');
  });
});
