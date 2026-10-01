import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { McpClientManager } from '../../src/mcp/McpClientManager.js';
import { COMPUTER_USE_CURSOR_THEME } from '../../src/generated/computerUseCursorTheme.js';

describe('managed Computer Use cursor', () => {
  it('ships the exact compiled theme inside standalone builds', async () => {
    const compiled = await readFile('assets/computer-use/autohand.light-gray.cua-theme');
    expect(Buffer.from(COMPUTER_USE_CURSOR_THEME, 'base64')).toEqual(compiled);
  });

  it('leaves other MCP servers and cancelled requests untouched', async () => {
    const manager = new McpClientManager();
    try {
      for (const name of ['another-computer-use', 'autohand-computer-use']) {
        await manager.connect({ name, transport: 'stdio', stdioFraming: 'newline',
          command: process.execPath, args: [path.resolve('src/testing/scenarios/computer-use-driver.mjs')],
        });
      }
      expect(await manager.callTool('another-computer-use', 'get_agent_cursor_state', {}))
        .toEqual({ structuredContent: { theme: 'default', starts: 0 } });
      await expect(manager.callTool('autohand-computer-use', 'get_agent_cursor_state', {}, { signal: AbortSignal.abort() }))
        .rejects.toThrow();
      expect(await manager.callTool('autohand-computer-use', 'get_agent_cursor_state', {}))
        .toEqual({ structuredContent: { theme: 'default', starts: 0 } });
    } finally {
      await manager.disconnectAll();
    }
  });
  it('does not cache failed initialization and recovers on a later request', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'autohand-gray-retry-'));
    const manager = new McpClientManager();
    try {
      await manager.connect({ name: 'autohand-computer-use', transport: 'stdio', stdioFraming: 'newline',
        command: process.execPath, args: [path.resolve('src/testing/scenarios/computer-use-driver.mjs')],
        env: { CUA_DRIVER_CURSOR_THEME_DIR: root, CUA_TEST_REJECT_START: '1' },
      });
      await expect(manager.callTool('autohand-computer-use', 'get_agent_cursor_state', {}, { signal: AbortSignal.abort() })).rejects.toThrow();
      await expect(manager.callTool('autohand-computer-use', 'get_agent_cursor_state', {})).rejects.toThrow('light-gray cursor session');
      expect(await manager.callTool('autohand-computer-use', 'get_agent_cursor_state', {}))
        .toEqual({ structuredContent: { theme: 'autohand.light-gray', starts: 2 } });
    } finally {
      await manager.disconnectAll();
      await rm(root, { recursive: true, force: true });
    }
  });
  it('installs and selects light gray before the first action and after an ended session', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'autohand-gray-cursor-'));
    const manager = new McpClientManager();
    try {
      await manager.connect({ name: 'autohand-computer-use', transport: 'stdio', stdioFraming: 'newline',
        command: process.execPath, args: [path.resolve('src/testing/scenarios/computer-use-driver.mjs')],
        env: { CUA_DRIVER_CURSOR_THEME_DIR: root },
      });
      const call = (name: string, args = {}) => manager.callTool('autohand-computer-use', name, args);
      const first = await Promise.all([call('get_agent_cursor_state'), call('get_agent_cursor_state')]);
      expect(first).toEqual([
        { structuredContent: { theme: 'autohand.light-gray', starts: 1 } },
        { structuredContent: { theme: 'autohand.light-gray', starts: 1 } },
      ]);
      const asset = await readFile(path.join(root, 'autohand.light-gray.cua-theme'));
      expect(asset.subarray(0, 8).toString()).toBe('CUATHEM3');
      await call('end_session');
      expect(await call('get_agent_cursor_state')).toEqual({ structuredContent: { theme: 'autohand.light-gray', starts: 2 } });
      await call('start_session', { cursor_theme: { theme_id: 'custom.theme', reduced_motion: 'on' } });
      expect(await call('get_agent_cursor_state')).toEqual({ structuredContent: { theme: 'custom.theme', starts: 3 } });
    } finally {
      await manager.disconnectAll();
      await rm(root, { recursive: true, force: true });
    }
  });
});
