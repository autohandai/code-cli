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
});
