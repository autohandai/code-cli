/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubRegistryFetcher } from '../../src/skills/GitHubRegistryFetcher.js';
import type { GitHubCommunitySkill } from '../../src/types.js';

describe('GitHubRegistryFetcher', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('downloads skill files from GitHub sourceUrl metadata when present', async () => {
    const fetchMock = vi.fn(async () => new Response('# ASP.NET Core\n', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const fetcher = new GitHubRegistryFetcher({ timeout: 1000 });
    const skill: GitHubCommunitySkill = {
      id: 'dotnet-aspnetcore',
      name: 'dotnet-aspnetcore',
      description: 'ASP.NET Core web development skills.',
      category: 'dotnet',
      directory: 'dotnet-aspnetcore',
      files: ['SKILL.md'],
      sourceUrl: 'https://github.com/dotnet/skills/tree/main/plugins/dotnet-aspnetcore',
    };

    const files = await fetcher.fetchSkillDirectory(skill);

    expect(files.get('SKILL.md')).toBe('# ASP.NET Core\n');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/dotnet/skills/main/plugins/dotnet-aspnetcore/SKILL.md',
      expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': 'autohand-cli',
        }),
      })
    );
  });

  it('uses Skilled detail content before GitHub sourceUrl fallback', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://skilled.autohand.ai/skills/dotnet-aspnetcore.json') {
        return new Response(JSON.stringify({
          content: '---\nname: dotnet-aspnetcore\ndescription: ASP.NET Core web development skills.\n---\n\nSkilled detail body.\n',
        }), { status: 200 });
      }

      return new Response('', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const fetcher = new GitHubRegistryFetcher({ timeout: 1000 });
    const skill: GitHubCommunitySkill = {
      id: 'dotnet-aspnetcore',
      name: 'dotnet-aspnetcore',
      description: 'ASP.NET Core web development skills.',
      category: 'dotnet',
      directory: 'dotnet-aspnetcore',
      files: ['SKILL.md'],
      sourceUrl: 'https://github.com/dotnet/skills/tree/main/plugins/dotnet-aspnetcore',
      url: 'https://skilled.autohand.ai/skill/dotnet-aspnetcore',
    };

    const files = await fetcher.fetchSkillDirectory(skill);

    expect(files.get('SKILL.md')).toContain('Skilled detail body.');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://skilled.autohand.ai/skills/dotnet-aspnetcore.json',
      expect.any(Object)
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/dotnet/skills/main/plugins/dotnet-aspnetcore/SKILL.md',
      expect.any(Object)
    );
  });

  it.each([
    ['id', '../outside'],
    ['id', 'C:\\outside'],
    ['name', '../outside'],
    ['directory', '../outside'],
    ['directory', '/absolute'],
    ['directory', 'skills\\mixed'],
    ['directory', 'skills//empty'],
    ['directory', 'skills/safe?raw=1'],
    ['files', ['SKILL.md', '../outside.txt']],
    ['files', ['SKILL.md', 'templates\\outside.md']],
    ['files', ['SKILL.md', 'templates//empty.md']],
    ['files', ['SKILL.md', 'templates/example.md#fragment']],
    ['source', 'owner/../outside'],
  ] as const)(
    'rejects unsafe direct skill metadata in %s before fetching',
    async (field, value) => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const fetcher = new GitHubRegistryFetcher({ timeout: 1000 });
      const skill: GitHubCommunitySkill = {
        id: 'safe-skill',
        name: 'safe-skill',
        description: 'Safe skill.',
        category: 'testing',
        directory: 'skills/safe-skill',
        files: ['SKILL.md'],
        [field]: value,
      };

      await expect(fetcher.fetchSkillDirectory(skill)).rejects.toThrow(/invalid/i);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it.each([
    'https://github.com/dotnet/skills/tree/main/plugins/dotnet-aspnetcore?raw=1',
    'https://github.com/dotnet/skills/tree/main/plugins/dotnet-aspnetcore#readme',
    'https://github.com/dotnet/skills/tree/feature%2Funsafe/plugins/dotnet-aspnetcore',
  ])('rejects unsafe GitHub source URL components before fetching: %s', async (sourceUrl) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const fetcher = new GitHubRegistryFetcher({ timeout: 1000 });
    const skill: GitHubCommunitySkill = {
      id: 'dotnet-aspnetcore',
      name: 'dotnet-aspnetcore',
      description: 'ASP.NET Core web development skills.',
      category: 'dotnet',
      directory: 'dotnet-aspnetcore',
      files: ['SKILL.md'],
      sourceUrl,
    };

    await expect(fetcher.fetchSkillDirectory(skill)).rejects.toThrow(/invalid/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects unsafe repository and branch configuration', () => {
    expect(() => new GitHubRegistryFetcher({ repo: 'owner/../outside' })).toThrow(/invalid/i);
    expect(() => new GitHubRegistryFetcher({ branch: 'feature/unsafe' })).toThrow(/invalid/i);
  });

  it('rejects an unsafe registry entry instead of returning it to cache consumers', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      version: '1.0.0',
      updatedAt: new Date().toISOString(),
      categories: [],
      skills: [{
        id: '../outside',
        name: 'Unsafe skill',
        description: 'Unsafe registry entry.',
        category: 'testing',
        directory: 'skills/safe-skill',
        files: ['SKILL.md'],
      }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const fetcher = new GitHubRegistryFetcher({ timeout: 1000 });

    await expect(fetcher.fetchRegistry()).rejects.toThrow(/invalid/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves validated nested file keys', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => (
      new Response(`content:${String(input)}`, { status: 200 })
    ));
    vi.stubGlobal('fetch', fetchMock);
    const fetcher = new GitHubRegistryFetcher({ timeout: 1000 });
    const skill: GitHubCommunitySkill = {
      id: 'nested-skill',
      name: 'nested-skill',
      description: 'Nested assets.',
      category: 'testing',
      directory: 'skills/nested-skill',
      files: ['SKILL.md', 'templates/example.md', 'scripts/check.ts'],
    };

    const files = await fetcher.fetchSkillDirectory(skill);

    expect([...files.keys()]).toEqual([
      'SKILL.md',
      'templates/example.md',
      'scripts/check.ts',
    ]);
  });
});
