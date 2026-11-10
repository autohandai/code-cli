/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

beforeEach(async () => {
  const { spawn } = await import('node:child_process');
  vi.mocked(spawn).mockReset();
});

describe('MCP stdio server environment', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    const { configureChildProcessEnvPolicy } = await import('../../src/utils/childProcessEnv.js');
    configureChildProcessEnvPolicy(undefined);
    delete process.env.ZZ_MCP_SECRET;
  });

  it('does not retry a Docker image pull failure as a framing error and explains registry recovery', async () => {
    vi.useFakeTimers();
    const baseline = vi.getTimerCount();
    const { spawn } = await import('node:child_process');
    vi.mocked(spawn).mockClear();
    vi.mocked(spawn).mockImplementation(() => {
      const child = new EventEmitter() as ChildProcess;
      Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
        kill: () => { child.emit('close', 125); return true; } });
      queueMicrotask(() => child.emit('spawn'));
      child.stdin!.on('data', () => {
        child.stderr!.emit('data', Buffer.from('docker: Head ghcr.io/github/github-mcp-server/manifests/latest: denied: denied'));
        child.emit('close', 125);
      });
      return child;
    });
    const { McpClientManager } = await import('../../src/mcp/McpClientManager.js');
    const manager = new McpClientManager();
    try {
      let failure: unknown;
      const failed = manager.connect({ name: 'github', transport: 'stdio', command: 'docker',
        args: ['run', '-i', '--rm', 'ghcr.io/github/github-mcp-server'] }).catch(error => { failure = error; });
      await vi.advanceTimersByTimeAsync(200);
      await failed;
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain('GitHub MCP image pull was denied');
      expect(spawn).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(baseline);
    } finally { await manager.disconnectAll(); }
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
    const baseline = vi.getTimerCount();
    const { spawn } = await import('node:child_process');
    const { McpStdioConnection } = await import('../../src/mcp/McpClientManager.js');
    const connection = new McpStdioConnection({ name: 'fixture', transport: 'stdio', command: 'fixture' }, 'newline');
    let started = false;
    try {
      const startup = connection.start().then(() => { started = true; });
      await vi.advanceTimersByTimeAsync(0);
      expect(started).toBe(true);
      await startup;
      expect(vi.getTimerCount()).toBe(baseline);
      expect(vi.mocked(spawn).mock.results.at(-1)?.value.listenerCount('spawn')).toBe(0);
    } finally {
      await connection.stop();
      expect(vi.getTimerCount()).toBe(baseline);
      vi.useRealTimers();
    }
  });

  it('rejects a child closing before spawn and detaches the startup listener', async () => {
    const { spawn } = await import('node:child_process');
    const { McpStdioConnection } = await import('../../src/mcp/McpClientManager.js');
    const connection = new McpStdioConnection({ name: 'fixture', transport: 'stdio', command: 'fixture' }, 'newline');
    const startup = connection.start();
    const failure = expect(startup).rejects.toThrow('before spawning');
    const child = vi.mocked(spawn).mock.results.at(-1)?.value;
    child.emit('close', 0);
    await failure;
    expect(child.listenerCount('spawn')).toBe(0);
    await connection.stop();
  });

  it('detaches the startup listener after a spawn error', async () => {
    const { spawn } = await import('node:child_process');
    const { McpStdioConnection } = await import('../../src/mcp/McpClientManager.js');
    vi.mocked(spawn).mockImplementationOnce(() => {
      const child = new EventEmitter() as ChildProcess;
      Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
        kill: () => { child.emit('close', 1); return true; } });
      return child;
    });
    const connection = new McpStdioConnection({ name: 'fixture', transport: 'stdio', command: 'fixture' }, 'newline');
    connection.on('error', () => {});
    const startup = connection.start();
    const failure = expect(startup).rejects.toThrow('fixture spawn failed');
    const child = vi.mocked(spawn).mock.results.at(-1)?.value;
    child.emit('error', new Error('fixture spawn failed'));
    await failure;
    expect(child.listenerCount('spawn')).toBe(0);
    await connection.stop();
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

  it.each(['unterminated', 'newline-terminated'] as const)('closes an oversized %s frame and settles pending resources', async framing => {
    vi.useFakeTimers();
    const baseline = vi.getTimerCount();
    const frameLimitBytes = 64 * 1024 * 1024;
    const { spawn } = await import('node:child_process');
    const { McpStdioConnection } = await import('../../src/mcp/McpClientManager.js');
    const connection = new McpStdioConnection({ name: 'fixture', transport: 'stdio', command: 'fixture' }, 'newline');
    const errorListener = vi.fn();
    connection.on('error', errorListener);
    const startup = connection.start();
    await vi.advanceTimersByTimeAsync(0);
    await startup;
    const controller = new AbortController();
    const removeAbortListener = vi.spyOn(controller.signal, 'removeEventListener');
    const pending = [
      connection.request('tools/call', undefined, { signal: controller.signal }).catch(error => error),
      connection.request('tools/list').catch(error => error),
    ];
    const child = vi.mocked(spawn).mock.results.at(-1)?.value;
    const kill = vi.spyOn(child, 'kill');
    const observer = vi.fn();
    child.stdout.on('data', observer);
    try {
      if (framing === 'unterminated') {
        const chunk = Buffer.alloc(64 * 1024, 0x20);
        for (let bytes = 0; bytes < frameLimitBytes; bytes += chunk.length) child.stdout.emit('data', chunk);
        expect(kill).not.toHaveBeenCalled();
        child.stdout.emit('data', Buffer.from('x'));
      } else {
        const oversized = Buffer.alloc(frameLimitBytes + 2, 0x20);
        oversized[oversized.length - 1] = 0x0a;
        child.stdout.emit('data', oversized);
      }
      expect(kill).toHaveBeenCalledOnce();
      await connection.stop();
      for (const error of await Promise.all(pending)) {
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toMatch(/frame.*64 MiB/i);
      }
      expect(errorListener).toHaveBeenCalledOnce();
      expect(removeAbortListener).toHaveBeenCalledWith('abort', expect.any(Function));
      expect(child.stdout.listenerCount('data')).toBe(1);
      expect(child.stderr.listenerCount('data')).toBe(0);
      expect(child.listenerCount('close')).toBe(0);
      expect(child.listenerCount('error')).toBe(0);
      expect(child.stdin.listenerCount('error')).toBe(0);
      expect(child.stdin.listenerCount('close')).toBe(0);
      expect(vi.getTimerCount()).toBe(baseline);
      await expect(connection.request('tools/list')).rejects.toThrow(/frame|not connected/i);
    } finally {
      child.stdout.off('data', observer);
      await connection.stop();
      await Promise.all(pending);
      vi.useRealTimers();
    }
  });

  it('accepts a fragmented frame at the byte limit and resets the next frame budget', async () => {
    const frameLimitBytes = 64 * 1024 * 1024;
    const { spawn } = await import('node:child_process');
    const { McpStdioConnection } = await import('../../src/mcp/McpClientManager.js');
    const connection = new McpStdioConnection({ name: 'fixture', transport: 'stdio', command: 'fixture' }, 'newline');
    await connection.start();
    try {
      const first = connection.request('tools/call');
      const second = connection.request('tools/list');
      const child = vi.mocked(spawn).mock.results.at(-1)?.value;
      const prefix = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '音乐 🎵 — café' }));
      child.stdout.emit('data', prefix.subarray(0, prefix.indexOf(Buffer.from('🎵')) + 1));
      child.stdout.emit('data', prefix.subarray(prefix.indexOf(Buffer.from('🎵')) + 1));
      const padding = Buffer.alloc(64 * 1024, 0x20);
      for (let bytes = prefix.length; bytes < frameLimitBytes; bytes += padding.length) {
        child.stdout.emit('data', padding.subarray(0, Math.min(padding.length, frameLimitBytes - bytes)));
      }
      child.stdout.emit('data', Buffer.from('\n' + JSON.stringify({ jsonrpc: '2.0', id: 2, result: 'next' }) + '\n'));
      await expect(first).resolves.toBe('音乐 🎵 — café');
      await expect(second).resolves.toBe('next');
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
