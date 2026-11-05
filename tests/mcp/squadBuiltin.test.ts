import { describe, expect, it } from 'vitest';
import { ensureSquadMcpServer } from '../../src/squad/builtin.js';
import type { LoadedConfig } from '../../src/types.js';

describe('built-in Squad MCP', () => {
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
