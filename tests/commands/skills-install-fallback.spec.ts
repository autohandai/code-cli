/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    url: 'https://skilled.autohand.ai/skill/dotnet-aspnetcore',
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
    mocks.cache.getSkillDirectory.mockResolvedValue(new Map([[
      'SKILL.md',
      '---\nname: dotnet-aspnetcore\ndescription: ASP.NET Core web development skills.\n---\n\n# ASP.NET Core\n',
    ]]));
    mocks.cache.setSkillDirectory.mockResolvedValue(undefined);

    skillsRegistry.isSkillInstalled.mockResolvedValue(false);
    skillsRegistry.importCommunitySkillDirectory.mockResolvedValue({
      success: true,
      path: '/tmp/autohand/skills/dotnet-aspnetcore',
    });

    mocks.safePrompt.mockResolvedValue({ scope: 'user' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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

  it('uses the catalog ID for the install directory while preserving the display name', async () => {
    const skilledSkill = makeSkill({ name: 'ASP.NET Core' });
    mocks.cache.getRegistry.mockResolvedValue(makeRegistry([skilledSkill]));

    const result = await skillsInstall(
      {
        skillsRegistry: skillsRegistry as unknown as SkillsRegistry,
        workspaceRoot: '/workspace',
      },
      'dotnet-aspnetcore'
    );

    expect(result).toBe('Skill "ASP.NET Core" installed successfully.');
    expect(skillsRegistry.isSkillInstalled).toHaveBeenCalledWith(
      'dotnet-aspnetcore',
      expect.any(String)
    );
    expect(skillsRegistry.importCommunitySkillDirectory).toHaveBeenCalledWith(
      'dotnet-aspnetcore',
      expect.any(Map),
      expect.any(String),
      false
    );
  });

  it('validates Skilled detail content before printing install status or importing files', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const skilledSkill = makeSkill({
      sourceUrl: 'https://github.com/dotnet/skills/tree/main/plugins/dotnet-aspnetcore',
    });
    mocks.cache.getSkillDirectory.mockResolvedValue(null);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://skilled.autohand.ai/skills-index.json') {
        return new Response(JSON.stringify(makeRegistry([skilledSkill])), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url === 'https://skilled.autohand.ai/skills/dotnet-aspnetcore.json') {
        return new Response(JSON.stringify({
          ...skilledSkill,
          content: [
            '---',
            'name: dotnet-aspnetcore',
            'description: ASP.NET Core web development skills.',
            '---',
            '',
            'Skilled detail body.',
          ].join('\n'),
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      return new Response('', { status: 404 });
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
    const importedFiles = skillsRegistry.importCommunitySkillDirectory.mock.calls[0]?.[1] as Map<string, string>;
    expect(importedFiles.get('SKILL.md')).toContain('Skilled detail body.');

    const logs = consoleSpy.mock.calls.map((call) => String(call[0]));
    const sourceValidationIndex = logs.findIndex((line) => line.includes('Validating source files'));
    const installingIndex = logs.findIndex((line) => line.includes('Installing validated files'));
    const progressBarLogs = logs.filter((line) => /^[⣿⣀]+ /u.test(line));
    const progressDetailLogs = logs.filter((line) => /^\s+\[\d\/6\] /u.test(line));

    expect(sourceValidationIndex).toBeGreaterThanOrEqual(0);
    expect(installingIndex).toBeGreaterThan(sourceValidationIndex);
    expect(progressBarLogs).toHaveLength(1);
    expect(progressBarLogs[0]).toContain('Installing dotnet-aspnetcore');
    expect(progressDetailLogs).toEqual([
      '  [1/6] Validating skill metadata',
      '  [2/6] Checking target folder',
      '  [3/6] Checking existing installation',
      '  [4/6] Validating source files',
      '  [5/6] Validating SKILL.md content',
      '  [6/6] Installing validated files',
    ]);
    expect(fetchMock).not.toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/dotnet/skills/main/plugins/dotnet-aspnetcore/SKILL.md',
      expect.any(Object)
    );
  });

  it('stops during preflight when required Skilled files return HTTP errors', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const skilledSkill = makeSkill({
      sourceUrl: 'https://github.com/dotnet/skills/tree/main/plugins/dotnet-aspnetcore',
    });
    mocks.cache.getSkillDirectory.mockResolvedValue(null);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://skilled.autohand.ai/skills-index.json') {
        return new Response(JSON.stringify(makeRegistry([skilledSkill])), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url === 'https://skilled.autohand.ai/skills/dotnet-aspnetcore.json') {
        return new Response('service unavailable', { status: 500 });
      }

      return new Response('', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await skillsInstall(
      {
        skillsRegistry: skillsRegistry as unknown as SkillsRegistry,
        workspaceRoot: '/workspace',
      },
      'dotnet-aspnetcore'
    );

    expect(result).toBeNull();
    expect(skillsRegistry.importCommunitySkillDirectory).not.toHaveBeenCalled();

    const logs = consoleSpy.mock.calls.map((call) => String(call[0]));
    expect(logs.some((line) => line.includes('Validation failed before installation.'))).toBe(true);
    expect(logs.some((line) => line.includes('HTTP 500'))).toBe(true);
    expect(logs.some((line) => line.includes('No files were written.'))).toBe(true);
    expect(logs.some((line) => line.includes('Installing validated files'))).toBe(false);
  });

  it('rejects an unsafe cached file map before checking source content or importing', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const skilledSkill = makeSkill({
      sourceUrl: 'https://github.com/dotnet/skills/tree/main/plugins/dotnet-aspnetcore',
    });
    mocks.cache.getRegistry.mockResolvedValue(makeRegistry([skilledSkill]));
    mocks.cache.getSkillDirectory.mockResolvedValue(new Map([
      ['SKILL.md', '---\nname: dotnet-aspnetcore\ndescription: Safe\n---\n'],
      ['../../outside.txt', 'poison'],
    ]));

    const result = await skillsInstall(
      {
        skillsRegistry: skillsRegistry as unknown as SkillsRegistry,
        workspaceRoot: '/workspace',
      },
      'dotnet-aspnetcore'
    );

    expect(result).toBeNull();
    expect(skillsRegistry.importCommunitySkillDirectory).not.toHaveBeenCalled();
    expect(consoleSpy.mock.calls.some((call) => String(call[0]).includes('No files were written.'))).toBe(true);
  });
});
