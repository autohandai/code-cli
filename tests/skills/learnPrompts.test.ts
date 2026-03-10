/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import type { ProjectAnalysis } from '../../src/skills/autoSkill.js';
import type { SkillDefinition } from '../../src/skills/types.js';
import type { GitHubCommunitySkill, LearnRecommendation } from '../../src/types.js';
import {
  buildLearnSystemPrompt,
  buildLearnUserPrompt,
  buildLearnGenerationSystemPrompt,
  buildLearnGenerationUserPrompt,
} from '../../src/skills/learnPrompts.js';

/* ── Helpers ─────────────────────────────────────────────── */

function makeAnalysis(overrides: Partial<ProjectAnalysis> = {}): ProjectAnalysis {
  return {
    projectName: 'my-app',
    languages: ['typescript', 'javascript'],
    frameworks: ['react', 'nextjs'],
    patterns: ['testing', 'bundling'],
    dependencies: ['react', 'next', 'vitest', 'typescript'],
    filePatterns: [],
    platform: 'darwin',
    hasGit: true,
    hasTests: true,
    hasCI: false,
    packageManager: 'bun',
    ...overrides,
  };
}

function makeInstalledSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    name: 'code-review',
    description: 'Reviews code for best practices',
    body: '# Code Review\nSteps...',
    path: '/home/user/.autohand/skills/code-review/SKILL.md',
    source: 'autohand-user',
    isActive: false,
    ...overrides,
  };
}

function makeRegistrySkill(overrides: Partial<GitHubCommunitySkill> = {}): GitHubCommunitySkill {
  return {
    id: 'typescript-testing',
    name: 'typescript-testing',
    description: 'TypeScript testing best practices',
    category: 'testing',
    tags: ['typescript', 'vitest'],
    languages: ['typescript'],
    frameworks: ['vitest'],
    directory: 'skills/typescript-testing',
    files: ['SKILL.md'],
    ...overrides,
  };
}

function makeRecommendation(overrides: Partial<LearnRecommendation> = {}): LearnRecommendation {
  return {
    slug: 'react-hooks',
    score: 45,
    reason: 'React hooks patterns guide',
    ...overrides,
  };
}

/* ── Tests ────────────────────────────────────────────────── */

describe('learnPrompts', () => {
  describe('buildLearnSystemPrompt', () => {
    it('returns string containing projectSummary, recommendations, audit, gapAnalysis, and JSON', () => {
      const prompt = buildLearnSystemPrompt();
      expect(prompt).toContain('projectSummary');
      expect(prompt).toContain('recommendations');
      expect(prompt).toContain('audit');
      expect(prompt).toContain('gapAnalysis');
      expect(prompt).toContain('JSON');
    });

    it('includes scoring criteria and rules', () => {
      const prompt = buildLearnSystemPrompt();
      expect(prompt).toContain('Language/framework match');
      expect(prompt).toContain('Do NOT inflate scores');
      expect(prompt).toContain('redundant');
      expect(prompt).toContain('outdated');
      expect(prompt).toContain('conflicting');
    });
  });

  describe('buildLearnUserPrompt', () => {
    it('includes project name, languages, frameworks, and package manager', () => {
      const analysis = makeAnalysis();
      const prompt = buildLearnUserPrompt(analysis, [], []);
      expect(prompt).toContain('my-app');
      expect(prompt).toContain('typescript, javascript');
      expect(prompt).toContain('react, nextjs');
      expect(prompt).toContain('bun');
    });

    it('includes installed skills info', () => {
      const analysis = makeAnalysis();
      const installed = [
        makeInstalledSkill({ name: 'code-review', description: 'Reviews code', source: 'autohand-user' }),
        makeInstalledSkill({ name: 'test-gen', description: 'Generates tests', source: 'community' }),
      ];
      const prompt = buildLearnUserPrompt(analysis, installed, []);
      expect(prompt).toContain('**code-review**');
      expect(prompt).toContain('Reviews code');
      expect(prompt).toContain('[source: autohand-user]');
      expect(prompt).toContain('**test-gen**');
      expect(prompt).toContain('Generates tests');
      expect(prompt).toContain('[source: community]');
    });

    it('includes registry skills catalog', () => {
      const analysis = makeAnalysis();
      const registry = [
        makeRegistrySkill({
          id: 'ts-testing',
          description: 'TS testing guide',
          category: 'testing',
          tags: ['ts', 'vitest'],
          languages: ['typescript'],
          frameworks: ['vitest'],
        }),
      ];
      const prompt = buildLearnUserPrompt(analysis, [], registry);
      expect(prompt).toContain('**ts-testing**');
      expect(prompt).toContain('TS testing guide');
      expect(prompt).toContain('[category: testing]');
      expect(prompt).toContain('[tags: ts, vitest]');
      expect(prompt).toContain('[languages: typescript]');
      expect(prompt).toContain('[frameworks: vitest]');
    });

    it('handles empty installed skills — shows "No skills currently installed."', () => {
      const analysis = makeAnalysis();
      const prompt = buildLearnUserPrompt(analysis, [], []);
      expect(prompt).toContain('No skills currently installed.');
    });

    it('handles empty registry — shows "No community skills available in the catalog."', () => {
      const analysis = makeAnalysis();
      const prompt = buildLearnUserPrompt(analysis, [], []);
      expect(prompt).toContain('No community skills available in the catalog.');
    });

    it('shows "none detected" when languages/frameworks/patterns are empty', () => {
      const analysis = makeAnalysis({ languages: [], frameworks: [], patterns: [] });
      const prompt = buildLearnUserPrompt(analysis, [], []);
      expect(prompt).toMatch(/\*\*Languages:\*\*\s*none detected/);
      expect(prompt).toMatch(/\*\*Frameworks:\*\*\s*none detected/);
      expect(prompt).toMatch(/\*\*Patterns:\*\*\s*none detected/);
    });

    it('shows "unknown" when packageManager is null', () => {
      const analysis = makeAnalysis({ packageManager: null });
      const prompt = buildLearnUserPrompt(analysis, [], []);
      expect(prompt).toContain('**Package Manager:** unknown');
    });

    it('shows "Yes/No" for hasTests and hasCI', () => {
      const withTests = buildLearnUserPrompt(makeAnalysis({ hasTests: true, hasCI: true }), [], []);
      expect(withTests).toContain('**Has Tests:** Yes');
      expect(withTests).toContain('**Has CI/CD:** Yes');

      const withoutTests = buildLearnUserPrompt(makeAnalysis({ hasTests: false, hasCI: false }), [], []);
      expect(withoutTests).toContain('**Has Tests:** No');
      expect(withoutTests).toContain('**Has CI/CD:** No');
    });

    it('shows Key Dependencies only when deps exist, limited to 30', () => {
      const manyDeps = Array.from({ length: 50 }, (_, i) => `dep-${i}`);
      const analysis = makeAnalysis({ dependencies: manyDeps });
      const prompt = buildLearnUserPrompt(analysis, [], []);
      expect(prompt).toContain('**Key Dependencies:**');
      // Should have exactly 30 deps
      const depsLine = prompt.split('\n').find(l => l.includes('Key Dependencies'));
      expect(depsLine).toBeDefined();
      const listed = depsLine!.replace('**Key Dependencies:** ', '').split(', ');
      expect(listed).toHaveLength(30);
    });

    it('omits Key Dependencies line when deps are empty', () => {
      const analysis = makeAnalysis({ dependencies: [] });
      const prompt = buildLearnUserPrompt(analysis, [], []);
      expect(prompt).not.toContain('Key Dependencies');
    });

    it('ends with the analysis instruction line', () => {
      const prompt = buildLearnUserPrompt(makeAnalysis(), [], []);
      expect(prompt.trim()).toMatch(/Analyze this project, audit installed skills, and rank the catalog\.$/);
    });
  });

  describe('buildLearnUserPrompt registry handling', () => {
    it('does not dump full registry when skills exceed threshold', () => {
      const analysis = makeAnalysis({ languages: ['typescript'], frameworks: ['react'] });

      // Generate a large registry with no language/framework match
      const manySkills = Array.from({ length: 50 }, (_, i) =>
        makeRegistrySkill({
          id: `skill-${i}`,
          name: `Skill ${i}`,
          description: `Description for skill ${i}`,
          languages: ['ruby'],
          frameworks: ['rails'],
        }),
      );

      const prompt = buildLearnUserPrompt(analysis, [], manySkills);

      // Should mention find_agent_skills, not list all 50
      expect(prompt).toContain('find_agent_skills');
      expect(prompt).not.toContain('skill-49');
    });

    it('shows matching skills filtered by project stack', () => {
      const analysis = makeAnalysis({ languages: ['typescript'], frameworks: ['react'] });

      const skills = [
        makeRegistrySkill({ id: 'ts-skill', languages: ['typescript'], frameworks: [] }),
        makeRegistrySkill({ id: 'ruby-skill', languages: ['ruby'], frameworks: ['rails'] }),
      ];

      const prompt = buildLearnUserPrompt(analysis, [], skills);
      expect(prompt).toContain('ts-skill');
      // ruby-skill should not appear in matching section
    });

    it('includes registry count summary', () => {
      const analysis = makeAnalysis();
      const skills = [makeRegistrySkill()];

      const prompt = buildLearnUserPrompt(analysis, [], skills);
      expect(prompt).toMatch(/1 community skill/);
    });

    it('mentions find_agent_skills tool when registry has skills', () => {
      const analysis = makeAnalysis();
      const skills = [makeRegistrySkill()];

      const prompt = buildLearnUserPrompt(analysis, [], skills);
      expect(prompt).toContain('find_agent_skills');
    });
  });

  describe('buildLearnGenerationSystemPrompt', () => {
    it('returns string with "exactly 1", "JSON", "name", "allowedTools", "body"', () => {
      const prompt = buildLearnGenerationSystemPrompt();
      expect(prompt).toContain('exactly 1');
      expect(prompt).toContain('JSON');
      expect(prompt).toContain('name');
      expect(prompt).toContain('allowedTools');
      expect(prompt).toContain('body');
    });

    it('includes skill quality guidelines', () => {
      const prompt = buildLearnGenerationSystemPrompt();
      expect(prompt).toContain('Clear Purpose');
      expect(prompt).toContain('Concrete Examples');
      expect(prompt).toContain('Actionable Steps');
      expect(prompt).toContain('Tool Awareness');
      expect(prompt).toContain('Platform Aware');
    });
  });

  describe('buildLearnGenerationUserPrompt', () => {
    it('includes project analysis and gap context', () => {
      const analysis = makeAnalysis();
      const lowScoring = [
        makeRecommendation({ slug: 'react-hooks', score: 45, reason: 'React hooks patterns' }),
        makeRecommendation({ slug: 'test-gen', score: 30, reason: 'Generic test generator' }),
      ];
      const prompt = buildLearnGenerationUserPrompt(analysis, 'Need a deployment workflow', lowScoring);
      // Should contain project analysis from buildSkillGenerationPrompt
      expect(prompt).toContain('my-app');
      expect(prompt).toContain('typescript');
      // Should contain gap context
      expect(prompt).toContain('No existing community skills matched well');
      expect(prompt).toContain('Gap analysis: Need a deployment workflow');
      // Should contain low scoring skills
      expect(prompt).toContain('**react-hooks** (score: 45)');
      expect(prompt).toContain('**test-gen** (score: 30)');
    });

    it('handles null gap analysis — omits "Gap analysis:" line', () => {
      const analysis = makeAnalysis();
      const lowScoring = [
        makeRecommendation({ slug: 'some-skill', score: 50, reason: 'Some reason' }),
      ];
      const prompt = buildLearnGenerationUserPrompt(analysis, null, lowScoring);
      expect(prompt).not.toContain('Gap analysis:');
      // Still should contain the project info and low scoring skills
      expect(prompt).toContain('my-app');
      expect(prompt).toContain('**some-skill** (score: 50)');
    });

    it('handles empty lowScoringSkills — omits "The closest matches were:" line', () => {
      const analysis = makeAnalysis();
      const prompt = buildLearnGenerationUserPrompt(analysis, 'Need CI/CD skill', []);
      expect(prompt).not.toContain('The closest matches were:');
      expect(prompt).toContain('Gap analysis: Need CI/CD skill');
    });

    it('limits low scoring skills to top 3', () => {
      const analysis = makeAnalysis();
      const lowScoring = [
        makeRecommendation({ slug: 'a', score: 55, reason: 'Reason A' }),
        makeRecommendation({ slug: 'b', score: 50, reason: 'Reason B' }),
        makeRecommendation({ slug: 'c', score: 45, reason: 'Reason C' }),
        makeRecommendation({ slug: 'd', score: 40, reason: 'Reason D' }),
        makeRecommendation({ slug: 'e', score: 35, reason: 'Reason E' }),
      ];
      const prompt = buildLearnGenerationUserPrompt(analysis, null, lowScoring);
      expect(prompt).toContain('**a** (score: 55)');
      expect(prompt).toContain('**b** (score: 50)');
      expect(prompt).toContain('**c** (score: 45)');
      expect(prompt).not.toContain('**d** (score: 40)');
      expect(prompt).not.toContain('**e** (score: 35)');
    });

    it('includes "Generate a skill that fills the most important gap" instruction', () => {
      const analysis = makeAnalysis();
      const prompt = buildLearnGenerationUserPrompt(analysis, null, []);
      expect(prompt).toContain('Generate a skill that fills the most important gap for this project.');
    });
  });
});
