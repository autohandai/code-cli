/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import {
  WebActionAbortedError,
  fetchUrl,
  getPackageInfo,
  webSearch,
} from '../src/actions/web.js';

describe('web action cancellation', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (!server) return;
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  });

  it('aborts an in-flight fetch_url request', async () => {
    server = createServer(() => {
      // Deliberately leave the response open until the client aborts.
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    const controller = new AbortController();

    const request = fetchUrl(`http://127.0.0.1:${address.port}/slow`, {
      signal: controller.signal,
    });
    controller.abort();

    await expect(request).rejects.toBeInstanceOf(WebActionAbortedError);
  });

  it('resolves relative redirects against the current URL', async () => {
    server = createServer((request, response) => {
      if (request.url === '/start') {
        response.writeHead(302, { Location: '/docs/en/claude-code' });
        response.end();
        return;
      }

      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<html><body><main>Claude Code documentation</main></body></html>');
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');

    const content = await fetchUrl(`http://127.0.0.1:${address.port}/start`);

    expect(content).toContain('Claude Code documentation');
  });

  it('reads past a large document head before applying max_length', async () => {
    server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(
        `<html><head><style>${'x'.repeat(5000)}</style></head>`
        + '<body><main>Useful documentation body</main></body></html>'
      );
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');

    const content = await fetchUrl(`http://127.0.0.1:${address.port}/docs`, { maxLength: 100 });

    expect(content).toContain('Useful documentation body');
    expect(content.length).toBeLessThanOrEqual(100);
  });

  it('falls back to the connected browser when direct fetching fails', async () => {
    server = createServer((_request, response) => {
      response.writeHead(503, { 'Content-Type': 'text/plain' });
      response.end('temporarily unavailable');
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    const calls: string[] = [];

    const content = await fetchUrl(`http://127.0.0.1:${address.port}/docs`, {
      browserToolInvoker: async (toolName) => {
        calls.push(toolName);
        if (toolName === 'browser_execute_js') {
          return JSON.stringify({ text: 'Documentation loaded in Chromium' });
        }
        return 'ok';
      },
    });

    expect(content).toBe('Documentation loaded in Chromium');
    expect(calls).toEqual([
      'browser_navigate',
      'browser_wait_for_element',
      'browser_execute_js',
    ]);
  });

  it('does not start a web search when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(webSearch('should not run', {
      provider: 'google',
      signal: controller.signal,
    })).rejects.toBeInstanceOf(WebActionAbortedError);
  });

  it('does not start a package registry request when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(getPackageInfo('abort-before-registry-request', {
      registry: 'npm',
      signal: controller.signal,
    })).rejects.toBeInstanceOf(WebActionAbortedError);
  });
});
