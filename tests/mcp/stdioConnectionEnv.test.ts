/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
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
    return child;
  }),
}));

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
