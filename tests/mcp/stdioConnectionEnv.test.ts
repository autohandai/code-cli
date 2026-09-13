/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    const child = new EventEmitter() as EventEmitter & { stdin: { writable: boolean; write: () => void }; stdout: EventEmitter; stderr: EventEmitter; kill: () => void };
    child.stdin = { writable: true, write: () => {} };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    return child;
  }),
}));

describe('MCP stdio server environment', () => {
  afterEach(async () => {
    const { configureChildProcessEnvPolicy } = await import('../../src/utils/childProcessEnv.js');
    configureChildProcessEnvPolicy(undefined);
    delete process.env.ZZ_MCP_SECRET;
  });

  it('applies the shell.env policy and keeps server-specific variables on top', async () => {
    process.env.ZZ_MCP_SECRET = 'leak';
    const { configureChildProcessEnvPolicy } = await import('../../src/utils/childProcessEnv.js');
    configureChildProcessEnvPolicy({ exclude: ['ZZ_MCP_*'] });
    const { spawn } = await import('node:child_process');
    const { McpStdioConnection } = await import('../../src/mcp/McpClientManager.js');

    const connection = new McpStdioConnection({ name: 'fs', transport: 'stdio', command: 'mcp-fs', env: { MCP_TOKEN: 'server-only' } }, 'newline');
    await connection.start();

    const options = vi.mocked(spawn).mock.calls.at(-1)?.[2] as { env: NodeJS.ProcessEnv };
    expect(options.env.ZZ_MCP_SECRET).toBeUndefined();
    expect(options.env.MCP_TOKEN).toBe('server-only');
    expect(options.env.AUTOHAND_CLI).toBe('1');
    expect(options.env.PATH).toBe(process.env.PATH);
  });
});
