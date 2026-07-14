/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registry: {
    version: '1.0.0',
    updatedAt: '2026-07-14T00:00:00.000Z',
    categories: [],
    skills: [{
      id: 'display-skill',
      name: 'Display Skill',
      description: 'Skill with a distinct display name.',
      category: 'testing',
      directory: 'skills/display-skill',
      files: ['SKILL.md'],
    }],
  },
  files: new Map([['SKILL.md', '# Display Skill']]),
}));

vi.mock('../../../src/skills/CommunitySkillsCache.js', () => ({
  CommunitySkillsCache: class {
    getRegistry = vi.fn(async () => mocks.registry);
    getSkillDirectory = vi.fn(async () => mocks.files);
    setRegistry = vi.fn();
    setSkillDirectory = vi.fn();
  },
}));

vi.mock('../../../src/skills/GitHubRegistryFetcher.js', () => ({
  GitHubRegistryFetcher: class {
    findSkill = vi.fn((skills: typeof mocks.registry.skills, query: string) => (
      skills.find((skill) => skill.id === query || skill.name === query) ?? null
    ));
    findSimilarSkills = vi.fn(() => []);
    fetchRegistry = vi.fn(async () => mocks.registry);
    fetchSkillDirectory = vi.fn(async () => mocks.files);
  },
}));

import { RPCAdapter } from '../../../src/modes/rpc/adapter.js';

describe('RPC skill install filesystem identity', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the display name in the result while installing under the catalog ID', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const skillsRegistry = {
      isSkillInstalled: vi.fn(async () => false),
      importCommunitySkillDirectory: vi.fn(async () => ({
        success: true,
        path: '/workspace/.autohand/skills/display-skill',
      })),
    };
    const adapter = new RPCAdapter();
    Object.assign(adapter as unknown as Record<string, unknown>, {
      agent: { getSkillsRegistry: () => skillsRegistry },
      workspace: '/workspace',
    });

    const result = await adapter.handleInstallSkill('request-1', {
      skillName: 'display-skill',
      scope: 'project',
    });

    expect(skillsRegistry.isSkillInstalled).toHaveBeenCalledWith(
      'display-skill',
      '/workspace/.autohand/skills'
    );
    expect(skillsRegistry.importCommunitySkillDirectory).toHaveBeenCalledWith(
      'display-skill',
      mocks.files,
      '/workspace/.autohand/skills',
      false
    );
    expect(result).toEqual({
      success: true,
      skillName: 'Display Skill',
      path: '/workspace/.autohand/skills/display-skill',
    });
  });
});
