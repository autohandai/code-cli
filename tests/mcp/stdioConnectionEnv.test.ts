/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    const child = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: EventEmitter; stderr: EventEmitter; kill: () => void };
    child.stdin = new PassThrough();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {
      child.stdin.destroy();
      child.emit('close', 0);
    };
    queueMicrotask(() => child.emit('spawn'));
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

    try {
      const options = vi.mocked(spawn).mock.calls.at(-1)?.[2] as { env: NodeJS.ProcessEnv };
      expect(options.env.ZZ_MCP_SECRET).toBeUndefined();
      expect(options.env.MCP_TOKEN).toBe('server-only');
      expect(options.env.AUTOHAND_CLI).toBe('1');
      expect(options.env.PATH).toBe(process.env.PATH);
    } finally {
      await connection.stop();
    }
  });
});

describe('MCP stdio startup and response framing', () => {
  it('settles startup on the child spawn event without an artificial timer', async () => {
    vi.useFakeTimers();
    const { McpStdioConnection } = await import('../../src/mcp/McpClientManager.js');
    const connection = new McpStdioConnection({ name: 'fixture', transport: 'stdio', command: 'fixture' }, 'newline');
    let started = false;
    try {
      const startup = connection.start().then(() => { started = true; });
      await vi.advanceTimersByTimeAsync(0);
      expect(started).toBe(true);
      await startup;
    } finally {
      await connection.stop();
      vi.useRealTimers();
    }
  });

  it('preserves a Unicode app title when its UTF-8 bytes span stdout chunks', async () => {
    const { spawn } = await import('node:child_process');
    const { McpStdioConnection } = await import('../../src/mcp/McpClientManager.js');
    const connection = new McpStdioConnection({ name: 'fixture', transport: 'stdio', command: 'fixture' }, 'newline');
    await connection.start();
    try {
      const response = connection.request('tools/call');
      const child = vi.mocked(spawn).mock.results.at(-1)?.value;
      const title = '音乐 🎵 — café';
      const frame = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { title } }) + '\n');
      const split = frame.indexOf(Buffer.from('🎵')) + 1;
      child.stdout.emit('data', frame.subarray(0, split));
      child.stdout.emit('data', frame.subarray(split));
      await expect(response).resolves.toEqual({ title });
    } finally {
      await connection.stop();
    }
  });

  it('handles a fragmented large image followed by coalesced replies and CRLF', async () => {
    const { spawn } = await import('node:child_process');
    const { McpStdioConnection } = await import('../../src/mcp/McpClientManager.js');
    const connection = new McpStdioConnection({ name: 'fixture', transport: 'stdio', command: 'fixture' }, 'newline');
    await connection.start();
    try {
      const first = connection.request('tools/call');
      const second = connection.request('tools/call');
      const third = connection.request('tools/call');
      const child = vi.mocked(spawn).mock.results.at(-1)?.value;
      const result = { content: [{ type: 'image', data: 'a'.repeat(2 * 1024 * 1024), mimeType: 'image/png' }] };
      const frame = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, result }) + '\r\n');
      for (let offset = 0; offset < frame.length; offset += 4096) {
        child.stdout.emit('data', frame.subarray(offset, offset + 4096));
      }
      child.stdout.emit('data', Buffer.from('\nserver log\n' + JSON.stringify({ id: 2, result: 'two' }) + '\n' + JSON.stringify({ id: 3, result: '三' }) + '\n'));
      await expect(first).resolves.toEqual(result);
      await expect(second).resolves.toBe('two');
      await expect(third).resolves.toBe('三');
    } finally {
      await connection.stop();
    }
  });
});
