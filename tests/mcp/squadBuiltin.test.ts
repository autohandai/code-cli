import { describe, expect, it, vi } from 'vitest';
import { createRpcHandler, createTools } from '../../src/squad/vendor/runtime.mjs';
import { ensureSquadMcpServer } from '../../src/squad/builtin.js';
import type { LoadedConfig } from '../../src/types.js';

describe('built-in Squad MCP', () => {
  it('advertises and calls the bundled profile, directory, channel and routine tools', async () => {
    const get = vi.fn(async (path: string) => path.startsWith('/api/control-plane/') ? { id: 'kai', revision: 7 } : {});
    const patch = vi.fn(async (_path: string, body?: Record<string, unknown>) => body);
    const tools = createTools({ get, patch, post: vi.fn(), put: vi.fn() });
    const handle = createRpcHandler(tools);
    const listed = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    expect(listed).toEqual(expect.objectContaining({ result: expect.objectContaining({ tools: expect.arrayContaining(['get_member_profile', 'add_member_directory', 'send_channel_message', 'set_member_skills', 'run_routine'].map(name => expect.objectContaining({ name }))) }) }));
    await tools.update_member_profile({ member_id: 'kai', personality: 'Precise' });
    expect(patch).toHaveBeenCalledWith('/api/control-plane/members/kai', { personality: 'Precise', expectedRevision: 7 });
  });

  it('adds a runtime connection using this installed Node CLI without persisting config', () => {
    const config: LoadedConfig = { configPath: '/fixture/config.json' };
    expect(ensureSquadMcpServer(config, { env: {}, execPath: '/runtime/node', entryPath: '/package/dist/index.js' })).toEqual(expect.objectContaining({ name: 'autohand-squad', command: '/runtime/node', args: ['/package/dist/index.js', 'squad', 'mcp'], autoConnect: true }));
    expect(config.mcp).toBeUndefined();
  });

  it('launches a compiled binary directly, without passing its virtual entrypoint', () => {
    expect(ensureSquadMcpServer({ configPath: '/fixture/config.json' }, { env: {}, execPath: '/usr/local/bin/autohand', entryPath: '/$bunfs/root/autohand', compiled: true })?.args).toEqual(['squad', 'mcp']);
  });

  it('honors disabled, bare, offline and managed-member boundaries', () => {
    for (const options of [{ bare: true }, { offline: true }, { env: { AUTOHAND_DISABLE_SQUAD: '1' } }, { env: { AUTOHAND_SQUAD_TEAM_TOKEN: 'private-member-token' } }]) {
      expect(ensureSquadMcpServer({ configPath: '/fixture/config.json' }, options)).toBeUndefined();
    }
    expect(ensureSquadMcpServer({ configPath: '/fixture/config.json', mcp: { enabled: false } }, { env: {} })).toBeUndefined();
    expect(ensureSquadMcpServer({ configPath: '/fixture/config.json', mcp: { servers: [{ name: 'autohand_squad', transport: 'stdio', command: 'managed-proxy' }] } }, { env: {} })).toBeUndefined();
  });
});
