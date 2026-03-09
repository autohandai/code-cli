import { describe, it, expect } from 'vitest';
import type {
  LearnRecommendation,
  LearnAuditEntry,
  LearnAnalysisResponse,
  LearnGeneratedSkill,
} from '../../src/types.js';

describe('Learn LLM response types', () => {
  it('LearnRecommendation has required fields', () => {
    const rec: LearnRecommendation = {
      slug: 'test-skill',
      score: 85,
      reason: 'Matches TypeScript CLI stack',
    };
    expect(rec.slug).toBe('test-skill');
    expect(rec.score).toBe(85);
    expect(rec.reason).toBe('Matches TypeScript CLI stack');
  });

  it('LearnAuditEntry has required fields', () => {
    const audit: LearnAuditEntry = {
      skill: 'old-skill',
      status: 'redundant',
      reason: 'Overlaps with new-skill',
    };
    expect(audit.status).toBe('redundant');
  });

  it('LearnAnalysisResponse has all sections', () => {
    const response: LearnAnalysisResponse = {
      projectSummary: 'TypeScript CLI tool',
      audit: [],
      recommendations: [{ slug: 'test', score: 70, reason: 'Good match' }],
      gapAnalysis: null,
    };
    expect(response.recommendations).toHaveLength(1);
    expect(response.gapAnalysis).toBeNull();
  });

  it('LearnGeneratedSkill has required fields', () => {
    const skill: LearnGeneratedSkill = {
      name: 'test-skill',
      description: 'A test skill',
      allowedTools: ['read_file'],
      body: '# Test Skill\n\nContent here.',
    };
    expect(skill.name).toBe('test-skill');
    expect(skill.allowedTools).toContain('read_file');
  });
});
