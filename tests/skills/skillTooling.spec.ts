/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitHubCommunitySkill, LearnAnalysisResponse } from '../../src/types.js';
import type { ProjectAnalysis } from '../../src/skills/autoSkill.js';
import {
  bootstrapProjectSkills,
  installAgentSkillByName,
} from '../../src/skills/skillTooling.js';

function makeCommunitySkill(overrides: Partial<GitHubCommunitySkill> = {}): GitHubCommunitySkill {
  return {
    id: 'clean-coder-skill',
    name: 'clean-coder-skill',
    description: 'Helps with disciplined code cleanup and implementation quality.',
    category: 'workflows',
    directory: 'skills/clean-coder-skill',
    files: ['SKILL.md'],
    ...overrides,
  };
}

function makeAnalysis(overrides: Partial<ProjectAnalysis> = {}): ProjectAnalysis {
  return {
    projectName: 'cli-3',
    languages: ['typescript'],
    frameworks: ['ink'],
    patterns: ['testing'],
    dependencies: ['ink', 'vitest'],
    filePatterns: [],
    platform: 'darwin',
    hasGit: true,
    hasTests: true,
    hasCI: true,
    packageManager: 'bun',
    ...overrides,
  };
}

function makeLearnResponse(overrides: Partial<LearnAnalysisResponse> = {}): LearnAnalysisResponse {
  return {
    projectSummary: 'Ink TypeScript CLI with strong testing needs.',
    audit: [],
    recommendations: [
      { slug: 'clean-coder-skill', score: 92, reason: 'Improves implementation discipline for CLI refactors.' },
    ],
    gapAnalysis: null,
    ...overrides,
  };
}

describe('skillTooling', () => {
  let registryState: Array<{ name: string; isActive: boolean; metadata?: Record<string, string> }>;
  let skillsRegistry: {
    listSkills: ReturnType<typeof vi.fn>;
    activateSkill: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    registryState = [];
    skillsRegistry = {
      listSkills: vi.fn(() => registryState),
      activateSkill: vi.fn((name: string) => {
        const skill = registryState.find((entry) => entry.name === name);
        if (!skill) return false;
        skill.isActive = true;
        return true;
      }),
    };
  });

  describe('installAgentSkillByName', () => {
    it('installs and activates a matching community skill', async () => {
      const skill = makeCommunitySkill();
      const installSkill = vi.fn(async () => {
        registryState.push({
          name: 'clean-coder-skill',
          isActive: false,
          metadata: { 'agentskill-slug': 'clean-coder-skill' },
        });
        return 'Installed clean-coder-skill';
      });

      const result = await installAgentSkillByName(
        {
          skillsRegistry: skillsRegistry as any,
          workspaceRoot: '/workspace',
          isNonInteractive: true,
        },
        'clean-coder-skill',
        { scope: 'project', activate: true },
        {
          fetchRegistry: vi.fn(async () => ({
            version: '1.0.0',
            updatedAt: '2026-04-02T00:00:00.000Z',
            skills: [skill],
            categories: [],
          })),
          fetcher: {
            findSkill: vi.fn(() => skill),
            findSimilarSkills: vi.fn(() => []),
          } as any,
          cache: {} as any,
          installSkill,
        }
      );

      expect(installSkill).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceRoot: '/workspace' }),
        skill,
        expect.anything(),
        expect.anything(),
        'project'
      );
      expect(skillsRegistry.activateSkill).toHaveBeenCalledWith('clean-coder-skill');
      expect(result.message).toContain('Installed clean-coder-skill');
      expect(result.message).toContain('Activated skill: clean-coder-skill');
      expect(result.installedSkillName).toBe('clean-coder-skill');
    });

    it('returns a suggestion list when the skill is not in the community registry', async () => {
      const result = await installAgentSkillByName(
        {
          skillsRegistry: skillsRegistry as any,
          workspaceRoot: '/workspace',
          isNonInteractive: true,
        },
        'clean-code',
        undefined,
        {
          fetchRegistry: vi.fn(async () => ({
            version: '1.0.0',
            updatedAt: '2026-04-02T00:00:00.000Z',
            skills: [makeCommunitySkill()],
            categories: [],
          })),
          fetcher: {
            findSkill: vi.fn(() => null),
            findSimilarSkills: vi.fn(() => [makeCommunitySkill({ id: 'clean-coder-skill', name: 'clean-coder-skill' })]),
          } as any,
          cache: {} as any,
          installSkill: vi.fn(),
        }
      );

      expect(result.message).toContain('Skill not found');
      expect(result.message).toContain('clean-coder-skill');
    });
  });

  describe('bootstrapProjectSkills', () => {
    it('selects, installs, and activates the top project-relevant community skills', async () => {
      const skill = makeCommunitySkill();
      const installSkill = vi.fn(async () => {
        registryState.push({
          name: 'clean-coder-skill',
          isActive: false,
          metadata: { 'agentskill-slug': 'clean-coder-skill' },
        });
        return 'Installed clean-coder-skill';
      });

      const result = await bootstrapProjectSkills(
        {
          skillsRegistry: skillsRegistry as any,
          workspaceRoot: '/workspace',
          llm: {} as any,
          isNonInteractive: true,
        },
        {},
        {
          analyzer: { analyze: vi.fn(async () => makeAnalysis()) } as any,
          advisor: {
            analyze: vi.fn(async () => makeLearnResponse()),
          } as any,
          fetchRegistry: vi.fn(async () => ({
            version: '1.0.0',
            updatedAt: '2026-04-02T00:00:00.000Z',
            skills: [skill],
            categories: [],
          })),
          fetcher: {
            findSkill: vi.fn(() => skill),
          } as any,
          cache: {} as any,
          installSkill,
        }
      );

      expect(result.projectSummary).toContain('Ink TypeScript CLI');
      expect(result.recommendations).toHaveLength(1);
      expect(result.installedSkillNames).toEqual(['clean-coder-skill']);
      expect(result.activatedSkillNames).toEqual(['clean-coder-skill']);
      expect(skillsRegistry.activateSkill).toHaveBeenCalledWith('clean-coder-skill');
    });

    it('does not auto-install low-confidence recommendations', async () => {
      const installSkill = vi.fn();

      const result = await bootstrapProjectSkills(
        {
          skillsRegistry: skillsRegistry as any,
          workspaceRoot: '/workspace',
          llm: {} as any,
          isNonInteractive: true,
        },
        {},
        {
          analyzer: { analyze: vi.fn(async () => makeAnalysis()) } as any,
          advisor: {
            analyze: vi.fn(async () =>
              makeLearnResponse({
                recommendations: [{ slug: 'clean-coder-skill', score: 55, reason: 'Weak match' }],
              })
            ),
          } as any,
          fetchRegistry: vi.fn(async () => ({
            version: '1.0.0',
            updatedAt: '2026-04-02T00:00:00.000Z',
            skills: [makeCommunitySkill()],
            categories: [],
          })),
          fetcher: {
            findSkill: vi.fn((skills: GitHubCommunitySkill[]) => skills[0] ?? null),
          } as any,
          cache: {} as any,
          installSkill,
        }
      );

      expect(result.recommendations).toHaveLength(0);
      expect(result.installedSkillNames).toEqual([]);
      expect(result.activatedSkillNames).toEqual([]);
      expect(installSkill).not.toHaveBeenCalled();
    });
  });
});
