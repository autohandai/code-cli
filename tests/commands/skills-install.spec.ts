/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import chalk from 'chalk';

vi.mock('../../src/ui/ink/components/Modal.js', () => ({
  showModal: vi.fn(),
  showInput: vi.fn(),
}));

vi.mock('../../src/utils/prompt.js', () => ({
  safePrompt: vi.fn(),
}));

vi.mock('../../src/skills/GitHubRegistryFetcher.js', () => ({
  GitHubRegistryFetcher: class {
    fetchRegistry = vi.fn();
    findSkill = vi.fn();
    findSimilarSkills = vi.fn();
    getFeaturedSkills = vi.fn();
    filterSkills = vi.fn();
    fetchSkillDirectory = vi.fn();
  },
}));

vi.mock('../../src/skills/CommunitySkillsCache.js', () => ({
  CommunitySkillsCache: class {
    getRegistry = vi.fn();
    getRegistryIgnoreTTL = vi.fn();
    setRegistry = vi.fn();
    getSkillDirectory = vi.fn();
    setSkillDirectory = vi.fn();
  },
}));

import type { CommunitySkillsRegistry, GitHubCommunitySkill } from '../../src/types.js';
import { skillsInstall } from '../../src/commands/skills-install.js';
import { showModal, showInput } from '../../src/ui/ink/components/Modal.js';
import { safePrompt } from '../../src/utils/prompt.js';
import { GitHubRegistryFetcher } from '../../src/skills/GitHubRegistryFetcher.js';
import { CommunitySkillsCache } from '../../src/skills/CommunitySkillsCache.js';

const skillOne: GitHubCommunitySkill = {
  id: 'skill-one',
  name: 'skill-one',
  description: 'First skill for testing',
  category: 'testing',
  directory: 'skills/skill-one',
  files: ['SKILL.md'],
  isFeatured: true,
  rating: 4.8,
  downloadCount: 3400,
};

const skillTwo: GitHubCommunitySkill = {
  id: 'python-tooling',
  name: 'python-tooling',
  description: 'Python development workflows',
  category: 'languages',
  directory: 'skills/python-tooling',
  files: ['SKILL.md'],
  isCurated: true,
  rating: 4.5,
  downloadCount: 1800,
  tags: ['python'],
};

const registryFixture: CommunitySkillsRegistry = {
  version: '1.0.0',
  updatedAt: '2026-01-01T00:00:00.000Z',
  skills: [skillOne, skillTwo],
  categories: [
    { id: 'testing', name: 'Testing', count: 1 },
    { id: 'languages', name: 'Languages', count: 1 },
  ],
};

describe.skip('skillsInstall command', () => {
  const mockSkillsRegistry = {
    isSkillInstalled: vi.fn(),
    importCommunitySkillDirectory: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Create instances and mock their class properties
    const cacheInstance = new CommunitySkillsCache();
    vi.mocked(cacheInstance.getRegistry).mockResolvedValue(registryFixture);
    vi.mocked(cacheInstance.getRegistryIgnoreTTL).mockResolvedValue(null);
    vi.mocked(cacheInstance.setRegistry).mockResolvedValue(undefined);
    vi.mocked(cacheInstance.getSkillDirectory).mockResolvedValue(new Map([['SKILL.md', '# skill']]));
    vi.mocked(cacheInstance.setSkillDirectory).mockResolvedValue(undefined);

    const fetcherInstance = new GitHubRegistryFetcher();
    vi.mocked(fetcherInstance.fetchRegistry).mockResolvedValue(registryFixture);
    vi.mocked(fetcherInstance.getFeaturedSkills).mockReturnValue([skillOne]);
    vi.mocked(fetcherInstance.findSkill).mockImplementation((skills: GitHubCommunitySkill[], nameOrId: string) =>
      skills.find((s) => s.id === nameOrId || s.name === nameOrId) || null
    );
    vi.mocked(fetcherInstance.findSimilarSkills).mockReturnValue([]);
    vi.mocked(fetcherInstance.filterSkills).mockImplementation((skills: GitHubCommunitySkill[], query: string) => {
      if (!query.trim()) return skills;
      const lower = query.toLowerCase();
      return skills.filter((s) => `${s.name} ${s.description}`.toLowerCase().includes(lower));
    });
    vi.mocked(fetcherInstance.fetchSkillDirectory).mockResolvedValue(new Map([['SKILL.md', '# skill']]));

    mockSkillsRegistry.isSkillInstalled.mockResolvedValue(false);
    mockSkillsRegistry.importCommunitySkillDirectory.mockResolvedValue({
      success: true,
      path: '/tmp/skills/skill-one',
    });

    vi.mocked(showInput).mockResolvedValue('');
    vi.mocked(safePrompt).mockResolvedValue({ scope: 'user' });
  });

  it('installs a selected skill via Ink modal flow', async () => {
    vi.mocked(showModal).mockResolvedValue({ value: 'skill-one' });

    const result = await skillsInstall(
      {
        skillsRegistry: mockSkillsRegistry as any,
        workspaceRoot: '/workspace',
      },
      undefined
    );

    expect(result).toBe('Skill "skill-one" installed successfully.');
    expect(vi.mocked(showModal)).toHaveBeenCalled();
    expect(mockSkillsRegistry.importCommunitySkillDirectory).toHaveBeenCalledWith(
      'skill-one',
      expect.any(Map),
      expect.any(String),
      false
    );
  });

  it('supports search refinement in the modal browser', async () => {
    vi.mocked(showModal)
      .mockResolvedValueOnce({ value: '__skills_search__' })
      .mockResolvedValueOnce({ value: 'python-tooling' });
    vi.mocked(showInput).mockResolvedValue('python');
    mockSkillsRegistry.importCommunitySkillDirectory.mockResolvedValue({
      success: true,
      path: '/tmp/skills/python-tooling',
    });

    const result = await skillsInstall(
      {
        skillsRegistry: mockSkillsRegistry as any,
        workspaceRoot: '/workspace',
      },
      undefined
    );

    expect(result).toBe('Skill "python-tooling" installed successfully.');
    expect(vi.mocked(showInput)).toHaveBeenCalled();
    const fetcherInstance = new GitHubRegistryFetcher();
    expect(vi.mocked(fetcherInstance.filterSkills)).toHaveBeenCalledWith(registryFixture.skills, 'python');
  });

  it('returns null when user cancels from the browser', async () => {
    vi.mocked(showModal).mockResolvedValue(null);

    const result = await skillsInstall(
      {
        skillsRegistry: mockSkillsRegistry as any,
        workspaceRoot: '/workspace',
      },
      undefined
    );

    expect(result).toBe(chalk.gray('No skill selected.'));
    expect(mockSkillsRegistry.importCommunitySkillDirectory).not.toHaveBeenCalled();
  });
});
