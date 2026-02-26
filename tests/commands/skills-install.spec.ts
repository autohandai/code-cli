/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockShowModal,
  mockShowInput,
  mockSafePrompt,
  mockFetchRegistry,
  mockFindSkill,
  mockFindSimilarSkills,
  mockGetFeaturedSkills,
  mockFilterSkills,
  mockFetchSkillDirectory,
  mockGetRegistry,
  mockGetRegistryIgnoreTTL,
  mockSetRegistry,
  mockGetSkillDirectory,
  mockSetSkillDirectory,
} = vi.hoisted(() => ({
  mockShowModal: vi.fn(),
  mockShowInput: vi.fn(),
  mockSafePrompt: vi.fn(),
  mockFetchRegistry: vi.fn(),
  mockFindSkill: vi.fn(),
  mockFindSimilarSkills: vi.fn(),
  mockGetFeaturedSkills: vi.fn(),
  mockFilterSkills: vi.fn(),
  mockFetchSkillDirectory: vi.fn(),
  mockGetRegistry: vi.fn(),
  mockGetRegistryIgnoreTTL: vi.fn(),
  mockSetRegistry: vi.fn(),
  mockGetSkillDirectory: vi.fn(),
  mockSetSkillDirectory: vi.fn(),
}));

vi.mock('../../src/ui/ink/components/Modal.js', () => ({
  showModal: mockShowModal,
  showInput: mockShowInput,
}));

vi.mock('../../src/utils/prompt.js', () => ({
  safePrompt: mockSafePrompt,
}));

vi.mock('../../src/skills/GitHubRegistryFetcher.js', () => ({
  GitHubRegistryFetcher: vi.fn().mockImplementation(() => ({
    fetchRegistry: mockFetchRegistry,
    findSkill: mockFindSkill,
    findSimilarSkills: mockFindSimilarSkills,
    getFeaturedSkills: mockGetFeaturedSkills,
    filterSkills: mockFilterSkills,
    fetchSkillDirectory: mockFetchSkillDirectory,
  })),
}));

vi.mock('../../src/skills/CommunitySkillsCache.js', () => ({
  CommunitySkillsCache: vi.fn().mockImplementation(() => ({
    getRegistry: mockGetRegistry,
    getRegistryIgnoreTTL: mockGetRegistryIgnoreTTL,
    setRegistry: mockSetRegistry,
    getSkillDirectory: mockGetSkillDirectory,
    setSkillDirectory: mockSetSkillDirectory,
  })),
}));

import type { CommunitySkillsRegistry, GitHubCommunitySkill } from '../../src/types.js';
import { skillsInstall } from '../../src/commands/skills-install.js';

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

describe('skillsInstall command', () => {
  const mockSkillsRegistry = {
    isSkillInstalled: vi.fn(),
    importCommunitySkillDirectory: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockGetRegistry.mockResolvedValue(registryFixture);
    mockGetRegistryIgnoreTTL.mockResolvedValue(null);
    mockFetchRegistry.mockResolvedValue(registryFixture);
    mockSetRegistry.mockResolvedValue(undefined);
    mockGetFeaturedSkills.mockReturnValue([skillOne]);
    mockFindSkill.mockImplementation((skills: GitHubCommunitySkill[], nameOrId: string) =>
      skills.find((s) => s.id === nameOrId || s.name === nameOrId) || null
    );
    mockFindSimilarSkills.mockReturnValue([]);
    mockFilterSkills.mockImplementation((skills: GitHubCommunitySkill[], query: string) => {
      if (!query.trim()) return skills;
      const lower = query.toLowerCase();
      return skills.filter((s) => `${s.name} ${s.description}`.toLowerCase().includes(lower));
    });
    mockGetSkillDirectory.mockResolvedValue(new Map([['SKILL.md', '# skill']]));
    mockFetchSkillDirectory.mockResolvedValue(new Map([['SKILL.md', '# skill']]));
    mockSetSkillDirectory.mockResolvedValue(undefined);
    mockSkillsRegistry.isSkillInstalled.mockResolvedValue(false);
    mockSkillsRegistry.importCommunitySkillDirectory.mockResolvedValue({
      success: true,
      path: '/tmp/skills/skill-one',
    });

    mockShowInput.mockResolvedValue('');
    mockSafePrompt.mockResolvedValue({ scope: 'user' });
  });

  it('installs a selected skill via Ink modal flow', async () => {
    mockShowModal.mockResolvedValue({ value: 'skill-one' });

    const result = await skillsInstall(
      {
        skillsRegistry: mockSkillsRegistry as any,
        workspaceRoot: '/workspace',
      },
      undefined
    );

    expect(result).toBe('Skill "skill-one" installed successfully.');
    expect(mockShowModal).toHaveBeenCalled();
    expect(mockSkillsRegistry.importCommunitySkillDirectory).toHaveBeenCalledWith(
      'skill-one',
      expect.any(Map),
      expect.any(String),
      false
    );
  });

  it('supports search refinement in the modal browser', async () => {
    mockShowModal
      .mockResolvedValueOnce({ value: '__skills_search__' })
      .mockResolvedValueOnce({ value: 'python-tooling' });
    mockShowInput.mockResolvedValue('python');
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
    expect(mockShowInput).toHaveBeenCalled();
    expect(mockFilterSkills).toHaveBeenCalledWith(registryFixture.skills, 'python');
  });

  it('returns null when user cancels from the browser', async () => {
    mockShowModal.mockResolvedValue(null);

    const result = await skillsInstall(
      {
        skillsRegistry: mockSkillsRegistry as any,
        workspaceRoot: '/workspace',
      },
      undefined
    );

    expect(result).toBeNull();
    expect(mockSkillsRegistry.importCommunitySkillDirectory).not.toHaveBeenCalled();
  });
});
