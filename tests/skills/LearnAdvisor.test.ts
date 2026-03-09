/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * LearnAdvisor — TDD tests for LLM-powered analysis and skill generation.
 */
import { describe, it, expect, vi } from 'vitest';
import type { LLMProvider } from '../../src/providers/LLMProvider.js';
import type { ProjectAnalysis } from '../../src/skills/autoSkill.js';
import type { SkillDefinition } from '../../src/skills/types.js';
import type { GitHubCommunitySkill } from '../../src/types.js';
import { LearnAdvisor } from '../../src/skills/LearnAdvisor.js';

/* ── Helpers ─────────────────────────────────────────────── */

function createMockLLM(responses: string[]): LLMProvider {
  let callIndex = 0;
  return {
    getName: () => 'mock',
    complete: vi.fn(async () => {
      const content = responses[callIndex] || '{}';
      callIndex++;
      return { id: '1', created: Date.now(), content, finishReason: 'stop' as const, raw: null };
    }),
    listModels: vi.fn(async () => []),
    isAvailable: vi.fn(async () => true),
    setModel: vi.fn(),
  };
}

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

/* ── analyze() tests ─────────────────────────────────────── */

describe('LearnAdvisor', () => {
  describe('analyze()', () => {
    it('calls LLM and returns parsed response with correct fields', async () => {
      const llmResponse = JSON.stringify({
        projectSummary: 'A React/Next.js app with TypeScript and vitest',
        audit: [
          { skill: 'old-lint', status: 'outdated', reason: 'No longer relevant' },
        ],
        recommendations: [
          { slug: 'typescript-testing', score: 85, reason: 'Great match for vitest stack' },
          { slug: 'react-patterns', score: 72, reason: 'React hooks patterns' },
        ],
        gapAnalysis: null,
      });

      const llm = createMockLLM([llmResponse]);
      const advisor = new LearnAdvisor(llm);

      const result = await advisor.analyze(
        makeAnalysis(),
        [makeInstalledSkill()],
        [makeRegistrySkill()],
      );

      expect(result.projectSummary).toBe('A React/Next.js app with TypeScript and vitest');
      expect(result.audit).toHaveLength(1);
      expect(result.audit[0].skill).toBe('old-lint');
      expect(result.audit[0].status).toBe('outdated');
      expect(result.recommendations).toHaveLength(2);
      expect(result.recommendations[0].slug).toBe('typescript-testing');
      expect(result.recommendations[0].score).toBe(85);
      expect(result.gapAnalysis).toBeNull();

      // Verify LLM was called with correct parameters
      expect(llm.complete).toHaveBeenCalledOnce();
      const callArgs = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.maxTokens).toBe(4000);
      expect(callArgs.temperature).toBe(0.2);
      expect(callArgs.messages).toHaveLength(2);
      expect(callArgs.messages[0].role).toBe('system');
      expect(callArgs.messages[1].role).toBe('user');
    });

    it('returns empty recommendations on invalid JSON', async () => {
      const llm = createMockLLM(['this is not JSON at all']);
      const advisor = new LearnAdvisor(llm);

      const result = await advisor.analyze(
        makeAnalysis(),
        [],
        [makeRegistrySkill()],
      );

      expect(result.projectSummary).toBe('');
      expect(result.audit).toEqual([]);
      expect(result.recommendations).toEqual([]);
      expect(result.gapAnalysis).toBeNull();
    });

    it('extracts JSON from markdown code blocks', async () => {
      const wrappedResponse = '```json\n' + JSON.stringify({
        projectSummary: 'Extracted from code block',
        audit: [],
        recommendations: [
          { slug: 'ts-skill', score: 90, reason: 'Perfect match' },
        ],
        gapAnalysis: null,
      }) + '\n```';

      const llm = createMockLLM([wrappedResponse]);
      const advisor = new LearnAdvisor(llm);

      const result = await advisor.analyze(
        makeAnalysis(),
        [],
        [makeRegistrySkill()],
      );

      expect(result.projectSummary).toBe('Extracted from code block');
      expect(result.recommendations).toHaveLength(1);
      expect(result.recommendations[0].slug).toBe('ts-skill');
    });

    it('filters out invalid recommendations (missing fields)', async () => {
      const llmResponse = JSON.stringify({
        projectSummary: 'A project',
        audit: [
          { skill: 'valid', status: 'redundant', reason: 'Overlaps' },
          { status: 'outdated', reason: 'Missing skill field' },  // invalid: no skill
          { skill: 'bad-status', status: 'broken', reason: 'Invalid status' },  // invalid status
        ],
        recommendations: [
          { slug: 'good-skill', score: 80, reason: 'Valid recommendation' },
          { score: 50, reason: 'Missing slug' },                  // invalid: no slug
          { slug: 'no-score', reason: 'Missing score' },           // invalid: no score
          { slug: 'no-reason', score: 60 },                        // invalid: no reason
          { slug: 'all-good', score: 95, reason: 'Another valid' },
        ],
        gapAnalysis: null,
      });

      const llm = createMockLLM([llmResponse]);
      const advisor = new LearnAdvisor(llm);

      const result = await advisor.analyze(
        makeAnalysis(),
        [],
        [makeRegistrySkill()],
      );

      // Only valid recommendations should survive
      expect(result.recommendations).toHaveLength(2);
      expect(result.recommendations[0].slug).toBe('good-skill');
      expect(result.recommendations[1].slug).toBe('all-good');

      // Only valid audit entries should survive
      expect(result.audit).toHaveLength(1);
      expect(result.audit[0].skill).toBe('valid');
    });

    it('handles LLM throwing an error gracefully', async () => {
      const llm = createMockLLM([]);
      (llm.complete as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('API rate limit exceeded'),
      );

      const advisor = new LearnAdvisor(llm);

      const result = await advisor.analyze(
        makeAnalysis(),
        [],
        [makeRegistrySkill()],
      );

      expect(result.projectSummary).toBe('');
      expect(result.audit).toEqual([]);
      expect(result.recommendations).toEqual([]);
      expect(result.gapAnalysis).toBeNull();
    });
  });

  /* ── generateSkill() tests ───────────────────────────────── */

  describe('generateSkill()', () => {
    it('calls LLM and returns generated skill', async () => {
      const skillResponse = JSON.stringify({
        name: 'bun-workspace',
        description: 'Guides for managing Bun workspace monorepos',
        allowedTools: ['Bash', 'Read'],
        body: '# Bun Workspace\n\n## When to Use\nWhen working with Bun monorepos...',
      });

      const llm = createMockLLM([skillResponse]);
      const advisor = new LearnAdvisor(llm);

      const result = await advisor.generateSkill(
        makeAnalysis(),
        'No good skill for Bun workspace management',
        [{ slug: 'npm-workspaces', score: 35, reason: 'Close but for npm' }],
      );

      expect(result).not.toBeNull();
      expect(result!.name).toBe('bun-workspace');
      expect(result!.description).toBe('Guides for managing Bun workspace monorepos');
      expect(result!.allowedTools).toEqual(['Bash', 'Read']);
      expect(result!.body).toContain('Bun Workspace');

      // Verify LLM was called with correct parameters
      expect(llm.complete).toHaveBeenCalledOnce();
      const callArgs = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.maxTokens).toBe(4000);
      expect(callArgs.temperature).toBe(0.3);
    });

    it('returns null on invalid JSON', async () => {
      const llm = createMockLLM(['Here is your skill: definitely not json']);
      const advisor = new LearnAdvisor(llm);

      const result = await advisor.generateSkill(
        makeAnalysis(),
        'No matches found',
        [],
      );

      expect(result).toBeNull();
    });

    it('validates name matches kebab-case pattern', async () => {
      const badNameResponse = JSON.stringify({
        name: 'Invalid Name With Spaces',
        description: 'A valid description',
        allowedTools: ['Bash'],
        body: '# Content here',
      });

      const llm = createMockLLM([badNameResponse]);
      const advisor = new LearnAdvisor(llm);

      const result = await advisor.generateSkill(
        makeAnalysis(),
        'Gap detected',
        [],
      );

      expect(result).toBeNull();
    });

    it('returns null when missing required fields (name, description, body)', async () => {
      // Missing body
      const missingBody = JSON.stringify({
        name: 'valid-name',
        description: 'Has description',
        allowedTools: ['Bash'],
      });

      const llm1 = createMockLLM([missingBody]);
      const advisor1 = new LearnAdvisor(llm1);
      expect(await advisor1.generateSkill(makeAnalysis(), null, [])).toBeNull();

      // Missing description
      const missingDesc = JSON.stringify({
        name: 'valid-name',
        body: '# Content',
        allowedTools: [],
      });

      const llm2 = createMockLLM([missingDesc]);
      const advisor2 = new LearnAdvisor(llm2);
      expect(await advisor2.generateSkill(makeAnalysis(), null, [])).toBeNull();

      // Missing name
      const missingName = JSON.stringify({
        description: 'Has desc',
        body: '# Content',
        allowedTools: [],
      });

      const llm3 = createMockLLM([missingName]);
      const advisor3 = new LearnAdvisor(llm3);
      expect(await advisor3.generateSkill(makeAnalysis(), null, [])).toBeNull();
    });
  });
});
