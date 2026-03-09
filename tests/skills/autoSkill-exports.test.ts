import { describe, it, expect } from 'vitest';
import { buildSkillGenerationPrompt } from '../../src/skills/autoSkill.js';

describe('autoSkill exports', () => {
  it('exports buildSkillGenerationPrompt as a function', () => {
    expect(typeof buildSkillGenerationPrompt).toBe('function');
  });

  it('buildSkillGenerationPrompt returns project analysis string', () => {
    const analysis = {
      projectName: 'test',
      languages: ['typescript'],
      frameworks: ['react'],
      patterns: ['testing'],
      dependencies: ['react', 'vitest'],
      filePatterns: [],
      platform: 'darwin' as const,
      hasGit: true,
      hasTests: true,
      hasCI: false,
      packageManager: 'bun' as const,
    };
    const result = buildSkillGenerationPrompt(analysis);
    expect(result).toContain('test');
    expect(result).toContain('typescript');
    expect(result).toContain('react');
  });
});
