/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkillsRegistry } from '../../src/skills/SkillsRegistry.js';
import type { CommunitySkillsRegistry, GitHubCommunitySkill } from '../../src/types.js';

const mocks = vi.hoisted(() => ({
  safePrompt: vi.fn(),
  showModal: vi.fn(),
  showInput: vi.fn(),
  showConfirm: vi.fn(),
  cache: {
    getRegistry: vi.fn(),
    getRegistryIgnoreTTL: vi.fn(),
    setRegistry: vi.fn(),
    getSkillDirectory: vi.fn(),
    setSkillDirectory: vi.fn(),
  },
}));

vi.mock('../../src/ui/ink/components/Modal.js', () => ({
  showModal: mocks.showModal,
  showInput: mocks.showInput,
  showConfirm: mocks.showConfirm,
}));

vi.mock('../../src/utils/prompt.js', () => ({
  safePrompt: mocks.safePrompt,
}));

vi.mock('../../src/skills/CommunitySkillsCache.js', () => ({
  CommunitySkillsCache: vi.fn(function CommunitySkillsCache() {
    return mocks.cache;
  }),
}));

import { skillsInstall } from '../../src/commands/skills-install.js';

function makeRegistry(skills: GitHubCommunitySkill[] = []): CommunitySkillsRegistry {
  return {
    version: '1.0.0',
    updatedAt: '2026-06-30T00:00:00.000Z',
    skills,
    categories: [],
  };
}

function makeSkill(overrides: Partial<GitHubCommunitySkill> = {}): GitHubCommunitySkill {
  return {
    id: 'dotnet-aspnetcore',
    name: 'dotnet-aspnetcore',
    description: 'ASP.NET Core web development skills.',
    category: 'dotnet',
    directory: 'dotnet-aspnetcore',
    files: ['SKILL.md'],
    author: 'dotnet',
    ...overrides,
  };
}

describe('skillsInstall direct install Skilled catalog fallback', () => {
  const skillsRegistry = {
    isSkillInstalled: vi.fn(),
    importCommunitySkillDirectory: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();

    mocks.cache.getRegistry.mockResolvedValue(makeRegistry());
    mocks.cache.getRegistryIgnoreTTL.mockResolvedValue(null);
    mocks.cache.setRegistry.mockResolvedValue(undefined);
    mocks.cache.getSkillDirectory.mockResolvedValue(new Map([['SKILL.md', '# ASP.NET Core\n']]));
    mocks.cache.setSkillDirectory.mockResolvedValue(undefined);

    skillsRegistry.isSkillInstalled.mockResolvedValue(false);
    skillsRegistry.importCommunitySkillDirectory.mockResolvedValue({
      success: true,
      path: '/tmp/autohand/skills/dotnet-aspnetcore',
    });

    mocks.safePrompt.mockResolvedValue({ scope: 'user' });
  });

  it('installs a direct skill from Skilled when the CLI registry does not contain it', async () => {
    const skilledSkill = makeSkill({
      sourceUrl: 'https://github.com/dotnet/skills/tree/main/plugins/dotnet-aspnetcore',
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('https://skilled.autohand.ai/skills-index.json');
      return new Response(JSON.stringify(makeRegistry([skilledSkill])), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await skillsInstall(
      {
        skillsRegistry: skillsRegistry as unknown as SkillsRegistry,
        workspaceRoot: '/workspace',
      },
      'dotnet-aspnetcore'
    );

    expect(result).toBe('Skill "dotnet-aspnetcore" installed successfully.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(skillsRegistry.importCommunitySkillDirectory).toHaveBeenCalledWith(
      'dotnet-aspnetcore',
      expect.any(Map),
      expect.any(String),
      false
    );
  });
});
