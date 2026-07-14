/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createServer, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { describe, it, expect, vi } from 'vitest';
import {
  fetchUrl,
  formatSearchResults,
  formatPackageInfo,
  webSearch,
  type WebSearchResult,
  type PackageInfo,
} from '../src/actions/web.js';

async function startStalledServer(): Promise<{
  server: Server;
  url: string;
  getRequestCount: () => number;
  waitForRequest: () => Promise<void>;
  close: () => Promise<void>;
}> {
  let requestCount = 0;
  let notifyRequest: (() => void) | undefined;
  const requestReceived = new Promise<void>((resolve) => {
    notifyRequest = resolve;
  });
  const sockets = new Set<Socket>();
  const server = createServer(() => {
    requestCount += 1;
    notifyRequest?.();
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP address');

  return {
    server,
    url: `http://127.0.0.1:${address.port}/stalled`,
    getRequestCount: () => requestCount,
    waitForRequest: () => requestReceived,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}

function rejectAfter<T>(milliseconds: number, message: string): Promise<T> {
  return new Promise<T>((_resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), milliseconds);
    timer.unref?.();
  });
}

describe('Web Actions', () => {
  describe('cancellation', () => {
    it('does not start a fetch when its signal is already aborted', async () => {
      const stalled = await startStalledServer();
      const controller = new AbortController();
      controller.abort();

      try {
        await expect(Promise.race([
          fetchUrl(stalled.url, { signal: controller.signal }),
          rejectAfter<string>(250, 'fetch did not honor an already-aborted signal'),
        ])).rejects.toMatchObject({
          name: 'AbortError',
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(stalled.getRequestCount()).toBe(0);
      } finally {
        await stalled.close();
      }
    });

    it('aborts an active fetch and removes its signal listener', async () => {
      const stalled = await startStalledServer();
      const controller = new AbortController();
      const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
      const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
      const result = fetchUrl(stalled.url, { signal: controller.signal });

      try {
        await stalled.waitForRequest();
        controller.abort();

        await expect(Promise.race([
          result,
          rejectAfter<string>(250, 'fetch did not honor active abort'),
        ])).rejects.toMatchObject({ name: 'AbortError' });
        expect(addEventListener).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
        expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
      } finally {
        await stalled.close();
      }
    });

    it('bounds a stalled fetch with its configured timeout', async () => {
      const stalled = await startStalledServer();
      const controller = new AbortController();

      try {
        const result = fetchUrl(stalled.url, {
          signal: controller.signal,
          timeoutMs: 25,
        });
        const boundedResult = Promise.race([
          result,
          rejectAfter<string>(250, 'fetch did not honor timeoutMs'),
        ]);

        await expect(boundedResult).rejects.toThrow('Request timed out');
      } finally {
        controller.abort();
        await stalled.close();
      }
    });

    it('short-circuits an already-aborted search before provider work starts', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(Promise.race([
        webSearch('abort before search', {
          provider: 'duckduckgo',
          signal: controller.signal,
        }),
        rejectAfter<WebSearchResult[]>(250, 'search did not honor an already-aborted signal'),
      ])).rejects.toMatchObject({ name: 'AbortError' });
    });
  });

  describe('formatSearchResults', () => {
    it('formats empty results', () => {
      const result = formatSearchResults([]);
      expect(result).toBe('No results found.');
    });

    it('formats search results with snippets', () => {
      const results: WebSearchResult[] = [
        { title: 'React Docs', url: 'https://react.dev', snippet: 'A library for building user interfaces' },
        { title: 'Vue Docs', url: 'https://vuejs.org', snippet: 'The Progressive JavaScript Framework' }
      ];
      const formatted = formatSearchResults(results);
      expect(formatted).toContain('1. **React Docs**');
      expect(formatted).toContain('https://react.dev');
      expect(formatted).toContain('A library for building user interfaces');
      expect(formatted).toContain('2. **Vue Docs**');
    });

    it('formats results without snippets', () => {
      const results: WebSearchResult[] = [
        { title: 'Test', url: 'https://test.com', snippet: '' }
      ];
      const formatted = formatSearchResults(results);
      expect(formatted).toContain('1. **Test**');
      expect(formatted).toContain('https://test.com');
    });
  });

  describe('formatPackageInfo', () => {
    it('formats basic npm package info', () => {
      const info: PackageInfo = {
        registry: 'npm',
        name: 'lodash',
        version: '4.17.21',
        description: 'A modern JavaScript utility library'
      };
      const formatted = formatPackageInfo(info);
      expect(formatted).toContain('**lodash** v4.17.21 (npm)');
      expect(formatted).toContain('A modern JavaScript utility library');
    });

    it('formats PyPI package info', () => {
      const info: PackageInfo = {
        registry: 'pypi',
        name: 'requests',
        version: '2.31.0',
        description: 'Python HTTP for Humans',
        license: 'Apache-2.0'
      };
      const formatted = formatPackageInfo(info);
      expect(formatted).toContain('**requests** v2.31.0 (PyPI)');
      expect(formatted).toContain('License: Apache-2.0');
    });

    it('formats Cargo crate info', () => {
      const info: PackageInfo = {
        registry: 'crates',
        name: 'serde',
        version: '1.0.193',
        description: 'A generic serialization/deserialization framework',
        authors: ['Erick Tryzelaar', 'David Tolnay']
      };
      const formatted = formatPackageInfo(info);
      expect(formatted).toContain('**serde** v1.0.193 (crates.io)');
      expect(formatted).toContain('Authors: Erick Tryzelaar, David Tolnay');
    });

    it('formats package with homepage and license', () => {
      const info: PackageInfo = {
        registry: 'npm',
        name: 'express',
        version: '4.18.2',
        description: 'Fast web framework',
        homepage: 'https://expressjs.com',
        license: 'MIT'
      };
      const formatted = formatPackageInfo(info);
      expect(formatted).toContain('Homepage: https://expressjs.com');
      expect(formatted).toContain('License: MIT');
    });

    it('formats package with dependencies', () => {
      const info: PackageInfo = {
        registry: 'npm',
        name: 'test-pkg',
        version: '1.0.0',
        description: 'Test',
        dependencies: {
          'lodash': '^4.17.0',
          'axios': '^1.0.0'
        }
      };
      const formatted = formatPackageInfo(info);
      expect(formatted).toContain('Dependencies:');
      expect(formatted).toContain('lodash: ^4.17.0');
      expect(formatted).toContain('axios: ^1.0.0');
    });

    it('truncates long dependency lists', () => {
      const deps: Record<string, string> = {};
      for (let i = 0; i < 15; i++) {
        deps[`dep-${i}`] = '^1.0.0';
      }
      const info: PackageInfo = {
        registry: 'npm',
        name: 'test-pkg',
        version: '1.0.0',
        description: 'Test',
        dependencies: deps
      };
      const formatted = formatPackageInfo(info);
      expect(formatted).toContain('... and 5 more');
    });
  });
});
