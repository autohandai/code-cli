/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { McpRegistryCache } from '../../src/mcp/McpRegistryCache.js';
import { McpRegistryFetcher } from '../../src/mcp/McpRegistryFetcher.js';

function registryWith(servers: unknown[]) {
  return {
    version: '1.0.0',
    updatedAt: '2026-09-04T00:00:00.000Z',
    categories: [{ id: 'developer-tools', name: 'Developer tools', description: 'Developer tooling' }],
    servers,
  };
}

const validStdioServer = {
  id: 'filesystem',
  name: 'Filesystem',
  description: 'Read approved files.',
  category: 'developer-tools',
  transport: 'stdio',
  command: 'npx',
  args: ['@modelcontextprotocol/server-filesystem'],
  directory: 'developer-tools/filesystem',
  files: ['README.md'],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('McpRegistryFetcher', () => {
  it('adapts latest official registry entries into safe HTTP and npm stdio installs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      servers: [
        {
          server: {
            name: 'io.example/docs',
            title: 'Documentation',
            description: 'Search documentation.',
            version: '1.2.3',
            websiteUrl: 'https://example.com/docs',
            remotes: [{ type: 'streamable-http', url: 'https://example.com/mcp' }],
          },
          _meta: { 'io.modelcontextprotocol.registry/official': { isLatest: true } },
        },
        {
          server: {
            name: 'io.example/local',
            description: 'A local server.',
            version: '2.0.0',
            packages: [{
              registryType: 'npm',
              identifier: '@example/local-mcp',
              version: '2.0.0',
              transport: { type: 'stdio' },
              environmentVariables: [{ name: 'LOCAL_TOKEN', isRequired: true }],
            }],
          },
          _meta: { 'io.modelcontextprotocol.registry/official': { isLatest: true } },
        },
        {
          server: {
            name: 'io.example/needs-header',
            description: 'Cannot be configured safely without a header value.',
            version: '1.0.0',
            remotes: [{
              type: 'streamable-http',
              url: 'https://example.com/requires-header',
              headers: [{ name: 'Authorization', isRequired: true }],
            }],
          },
          _meta: { 'io.modelcontextprotocol.registry/official': { isLatest: true } },
        },
        {
          server: {
            name: 'io.example/needs-runtime-arguments',
            description: 'Requires an npm launch recipe the installer cannot represent.',
            version: '1.0.0',
            packages: [{
              registryType: 'npm',
              identifier: '@example/runtime-arguments-mcp',
              version: '1.0.0',
              transport: { type: 'stdio' },
              runtimeArguments: [{ type: 'named', name: '--registry', value: 'https://npm.example.com' }],
            }],
          },
          _meta: { 'io.modelcontextprotocol.registry/official': { isLatest: true } },
        },
        {
          server: {
            name: 'io.example/docs',
            description: 'Older metadata that must not replace the latest version.',
            version: '1.0.0',
            remotes: [{ type: 'streamable-http', url: 'https://example.com/old' }],
          },
          _meta: { 'io.modelcontextprotocol.registry/official': { isLatest: false } },
        },
      ],
      metadata: { count: 4 },
    }), { status: 200 })));

    const registry = await new McpRegistryFetcher().fetchRegistry();

    expect(registry.servers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'io.example/docs',
        transport: 'http',
        url: 'https://example.com/mcp',
      }),
      expect.objectContaining({
        id: 'io.example/local',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@example/local-mcp@2.0.0'],
        envVars: ['LOCAL_TOKEN'],
      }),
    ]));
    expect(registry.servers.map((server) => server.id)).not.toContain('io.example/needs-header');
    expect(registry.servers.map((server) => server.id)).not.toContain('io.example/needs-runtime-arguments');
  });

  it('keeps only transport configurations that can be constructed safely', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(registryWith([
      validStdioServer,
      {
        id: 'context7',
        name: 'Context7',
        description: 'Documentation lookup.',
        category: 'developer-tools',
        transport: 'http',
        url: 'https://mcp.context7.com/mcp',
        directory: 'developer-tools/context7',
        files: ['README.md'],
      },
      {
        ...validStdioServer,
        id: 'missing-command',
        command: undefined,
      },
      {
        ...validStdioServer,
        id: 'missing-url',
        transport: 'http',
        command: undefined,
      },
    ])), { status: 200 })));

    const registry = await new McpRegistryFetcher({ repo: 'example/catalog' }).fetchRegistry();

    expect(registry.servers.map((server) => server.id)).toEqual(['filesystem', 'context7']);
    expect(registry.servers[1]).toMatchObject({
      transport: 'http',
      url: 'https://mcp.context7.com/mcp',
    });
  });

  it('rejects poisoned cached registry entries before an install can resolve them', async () => {
    const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-mcp-registry-'));
    const cache = new McpRegistryCache({ cacheDir });
    await fs.writeJson(path.join(cacheDir, 'registry.json'), {
      fetchedAt: Date.now(),
      registry: registryWith([{
        ...validStdioServer,
        command: undefined,
      }]),
    });

    await expect(cache.getRegistry()).resolves.toBeNull();
    await fs.remove(cacheDir);
  });
});
