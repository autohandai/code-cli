/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

interface FakeServer {
  listen: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  address: ReturnType<typeof vi.fn>;
  emit: (event: string, ...args: unknown[]) => boolean;
}

vi.mock('node:http', async () => {
  const { EventEmitter } = await import('node:events');
  const server = Object.assign(new EventEmitter(), {
    listen: vi.fn(),
    close: vi.fn((callback?: () => void) => callback?.()),
    address: vi.fn(() => null),
  });
  return {
    createServer: vi.fn(() => server),
    __fakeServer: server,
  };
});

async function fakeServer(): Promise<FakeServer> {
  const http = await import('node:http');
  return (http as unknown as { __fakeServer: FakeServer }).__fakeServer;
}

describe('listenForOAuthCallback', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears the sign-in deadline and closes the server when listening fails', async () => {
    vi.useFakeTimers();
    const server = await fakeServer();
    server.listen.mockImplementation(() => {
      queueMicrotask(() => {
        server.emit('error', Object.assign(new Error('permission denied'), { code: 'EACCES' }));
      });
      return server;
    });
    const { listenForOAuthCallback } = await import('../../src/providers/openaiAuth.js');

    await expect(listenForOAuthCallback('state')).rejects.toThrow('permission denied');

    expect(server.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
