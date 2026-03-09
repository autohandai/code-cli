/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for the LLM-powered /learn command rewrite.
 * Covers: parseLearnArgs (updated), handleLearnRecommend flow,
 * LLM failure handling, gap analysis, and generation flow.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { learn, parseLearnArgs } from '../../src/commands/learn.js';
import type { LLMProvider } from '../../src/providers/LLMProvider.js';

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock('../../src/skills/CommunitySkillsCache.js', () => ({
  CommunitySkillsCache: vi.fn().mockImplementation(() => ({
    getRegistry: vi.fn(async () => null),
    getRegistryIgnoreTTL: vi.fn(async () => null),
    setRegistry: vi.fn(async () => {}),
    getSkillDirectory: vi.fn(async () => null),
    setSkillDirectory: vi.fn(async () => {}),
  })),
}));

vi.mock('../../src/skills/GitHubRegistryFetcher.js', () => ({
  GitHubRegistryFetcher: vi.fn().mockImplementation(() => ({
    fetchRegistry: vi.fn(async () => ({
      version: '1.0.0',
      updatedAt: new Date().toISOString(),
      skills: [],
      categories: [],
    })),
    fetchSkillDirectory: vi.fn(async () => new Map()),
  })),
}));

vi.mock('../../src/skills/autoSkill.js', () => ({
  ProjectAnalyzer: vi.fn().mockImplementation(() => ({
    analyze: vi.fn(async () => ({
      projectName: 'test-app',
      languages: ['typescript'],
      frameworks: ['react'],
      patterns: ['testing'],
      dependencies: ['react', 'vitest'],
      filePatterns: [],
      platform: 'darwin',
      hasGit: true,
      hasTests: true,
      hasCI: false,
      packageManager: 'bun',
    })),
  })),
  buildSkillGenerationPrompt: vi.fn(() => 'mock prompt'),
}));

vi.mock('../../src/ui/ink/components/Modal.js', () => ({
  showModal: vi.fn(async () => null),
  showConfirm: vi.fn(async () => false),
}));

// ─── Test Helpers ───────────────────────────────────────────────────

function createMockLLM(response: string): LLMProvider {
  return {
    getName: () => 'mock',
    complete: vi.fn(async () => ({
      id: '1',
      created: Date.now(),
      content: response,
      finishReason: 'stop' as const,
    })),
    listModels: vi.fn(async () => []),
    isAvailable: vi.fn(async () => true),
    setModel: vi.fn(),
  };
}

function createMockRegistry() {
  return {
    listSkills: vi.fn(() => []),
    getActiveSkills: vi.fn(() => []),
    getSkill: vi.fn(),
    isSkillInstalled: vi.fn(async () => false),
    importCommunitySkillDirectory: vi.fn(async () => ({ success: true, path: '/test' })),
    saveSkill: vi.fn(async () => true),
    trackSkillEvent: vi.fn(),
  } as any;
}

// ─── parseLearnArgs Tests (Updated) ────────────────────────────────

describe('parseLearnArgs (updated)', () => {
  it('empty args returns recommend', () => {
    expect(parseLearnArgs([]).subcommand).toBe('recommend');
    expect(parseLearnArgs([]).deep).toBeFalsy();
  });

  it('--deep sets deep flag', () => {
    const result = parseLearnArgs(['--deep']);
    expect(result.subcommand).toBe('recommend');
    expect(result.deep).toBe(true);
  });

  it('update returns update', () => {
    expect(parseLearnArgs(['update']).subcommand).toBe('update');
  });

  it('update --deep sets both', () => {
    const result = parseLearnArgs(['update', '--deep']);
    expect(result.subcommand).toBe('update');
    expect(result.deep).toBe(true);
  });

  it('unknown args default to recommend', () => {
    expect(parseLearnArgs(['something']).subcommand).toBe('recommend');
  });

  it('multiple unknown args still default to recommend', () => {
    expect(parseLearnArgs(['foo', 'bar']).subcommand).toBe('recommend');
  });

  it('--deep alone (only flag) returns recommend with deep', () => {
    const result = parseLearnArgs(['--deep']);
    expect(result.subcommand).toBe('recommend');
    expect(result.deep).toBe(true);
  });
});

// ─── /learn LLM-powered Flow Tests ─────────────────────────────────

describe('/learn LLM-powered flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns error when skillsRegistry is not available', async () => {
    const llm = createMockLLM('{}');
    const result = await learn(
      {
        skillsRegistry: null as any,
        workspaceRoot: '/test',
        llm,
        isNonInteractive: true,
      },
      [],
    );
    expect(result).toBe('Skills registry not available.');
  });

  it('calls LLM to analyze project when invoked without args', async () => {
    const analysisResponse = JSON.stringify({
      projectSummary: 'TypeScript React app with testing',
      audit: [],
      recommendations: [{ slug: 'react-testing', score: 85, reason: 'Great match' }],
      gapAnalysis: null,
    });
    const llm = createMockLLM(analysisResponse);
    const result = await learn(
      {
        skillsRegistry: createMockRegistry(),
        workspaceRoot: '/test',
        llm,
        isNonInteractive: true,
      },
      [],
    );

    expect(llm.complete).toHaveBeenCalledTimes(1);
    expect(result).toContain('react-testing');
  });

  it('includes audit findings in output', async () => {
    const analysisResponse = JSON.stringify({
      projectSummary: 'Test project',
      audit: [{ skill: 'old-skill', status: 'outdated', reason: 'No longer uses Python' }],
      recommendations: [],
      gapAnalysis: 'Need Ink testing skill',
    });
    const llm = createMockLLM(analysisResponse);
    const result = await learn(
      {
        skillsRegistry: createMockRegistry(),
        workspaceRoot: '/test',
        llm,
        isNonInteractive: true,
      },
      [],
    );

    expect(result).toContain('old-skill');
    expect(result).toContain('outdated');
  });

  it('handles LLM failure gracefully', async () => {
    const llm = createMockLLM('not json');
    const result = await learn(
      {
        skillsRegistry: createMockRegistry(),
        workspaceRoot: '/test',
        llm,
        isNonInteractive: true,
      },
      [],
    );

    expect(result).toBeDefined();
    expect(result).not.toBeNull();
    // Should not crash — should return something useful even on parse failure
  });

  it('shows gap analysis when no good matches', async () => {
    const analysisResponse = JSON.stringify({
      projectSummary: 'Test project',
      audit: [],
      recommendations: [{ slug: 'unrelated', score: 20, reason: 'Not relevant' }],
      gapAnalysis: 'No skill covers Ink component testing',
    });
    const llm = createMockLLM(analysisResponse);
    const result = await learn(
      {
        skillsRegistry: createMockRegistry(),
        workspaceRoot: '/test',
        llm,
        isNonInteractive: true,
      },
      [],
    );

    expect(result).toContain('Ink component testing');
  });

  it('sorts recommendations by score descending', async () => {
    const analysisResponse = JSON.stringify({
      projectSummary: 'Multi-framework app',
      audit: [],
      recommendations: [
        { slug: 'low-score', score: 65, reason: 'Okay match' },
        { slug: 'high-score', score: 95, reason: 'Perfect match' },
        { slug: 'mid-score', score: 80, reason: 'Good match' },
      ],
      gapAnalysis: null,
    });
    const llm = createMockLLM(analysisResponse);
    const result = await learn(
      {
        skillsRegistry: createMockRegistry(),
        workspaceRoot: '/test',
        llm,
        isNonInteractive: true,
      },
      [],
    );

    // All three should be present since score >= 60
    expect(result).toContain('high-score');
    expect(result).toContain('mid-score');
    expect(result).toContain('low-score');

    // high-score should appear before low-score
    const highIdx = result!.indexOf('high-score');
    const lowIdx = result!.indexOf('low-score');
    expect(highIdx).toBeLessThan(lowIdx);
  });

  it('filters out recommendations below score 60', async () => {
    const analysisResponse = JSON.stringify({
      projectSummary: 'Test project',
      audit: [],
      recommendations: [
        { slug: 'good-match', score: 75, reason: 'Relevant' },
        { slug: 'poor-match', score: 30, reason: 'Not relevant' },
      ],
      gapAnalysis: null,
    });
    const llm = createMockLLM(analysisResponse);
    const result = await learn(
      {
        skillsRegistry: createMockRegistry(),
        workspaceRoot: '/test',
        llm,
        isNonInteractive: true,
      },
      [],
    );

    expect(result).toContain('good-match');
    // poor-match should not appear in recommendations section
    // (it has score 30 < 60 threshold)
    expect(result).not.toContain('poor-match');
  });

  it('includes action buttons for install in recommendations', async () => {
    const analysisResponse = JSON.stringify({
      projectSummary: 'TypeScript project',
      audit: [],
      recommendations: [{ slug: 'my-skill', score: 90, reason: 'Perfect' }],
      gapAnalysis: null,
    });
    const llm = createMockLLM(analysisResponse);
    const result = await learn(
      {
        skillsRegistry: createMockRegistry(),
        workspaceRoot: '/test',
        llm,
        isNonInteractive: true,
      },
      [],
    );

    expect(result).toContain('{{action:Install|/skills install @my-skill}}');
  });

  it('shows project summary in output', async () => {
    const analysisResponse = JSON.stringify({
      projectSummary: 'A Node.js backend API using Express and PostgreSQL',
      audit: [],
      recommendations: [],
      gapAnalysis: null,
    });
    const llm = createMockLLM(analysisResponse);
    const result = await learn(
      {
        skillsRegistry: createMockRegistry(),
        workspaceRoot: '/test',
        llm,
        isNonInteractive: true,
      },
      [],
    );

    expect(result).toContain('A Node.js backend API using Express and PostgreSQL');
  });

  it('caps recommendations to 5 in output', async () => {
    const analysisResponse = JSON.stringify({
      projectSummary: 'Big project',
      audit: [],
      recommendations: [
        { slug: 'skill-1', score: 99, reason: 'Match 1' },
        { slug: 'skill-2', score: 95, reason: 'Match 2' },
        { slug: 'skill-3', score: 90, reason: 'Match 3' },
        { slug: 'skill-4', score: 85, reason: 'Match 4' },
        { slug: 'skill-5', score: 80, reason: 'Match 5' },
        { slug: 'skill-6', score: 75, reason: 'Match 6' },
        { slug: 'skill-7', score: 70, reason: 'Match 7' },
      ],
      gapAnalysis: null,
    });
    const llm = createMockLLM(analysisResponse);
    const result = await learn(
      {
        skillsRegistry: createMockRegistry(),
        workspaceRoot: '/test',
        llm,
        isNonInteractive: true,
      },
      [],
    );

    // Skills 1-5 should be present (top 5)
    expect(result).toContain('skill-1');
    expect(result).toContain('skill-5');
    // Skill 6 and 7 should not be shown (capped at 5)
    expect(result).not.toContain('skill-6');
    expect(result).not.toContain('skill-7');
  });

  it('handles LLM throwing an error gracefully', async () => {
    const llm: LLMProvider = {
      getName: () => 'mock',
      complete: vi.fn(async () => {
        throw new Error('Network error');
      }),
      listModels: vi.fn(async () => []),
      isAvailable: vi.fn(async () => true),
      setModel: vi.fn(),
    };

    const result = await learn(
      {
        skillsRegistry: createMockRegistry(),
        workspaceRoot: '/test',
        llm,
        isNonInteractive: true,
      },
      [],
    );

    expect(result).toBeDefined();
    expect(result).not.toBeNull();
    // Should return gracefully without crashing
  });

  it('handles empty recommendations and no gap as valid output', async () => {
    const analysisResponse = JSON.stringify({
      projectSummary: 'Simple project',
      audit: [],
      recommendations: [],
      gapAnalysis: null,
    });
    const llm = createMockLLM(analysisResponse);
    const result = await learn(
      {
        skillsRegistry: createMockRegistry(),
        workspaceRoot: '/test',
        llm,
        isNonInteractive: true,
      },
      [],
    );

    expect(result).toBeDefined();
    // Should say no strong matches
    expect(result).toContain('No strong matches');
  });
});
