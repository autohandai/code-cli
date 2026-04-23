/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_TOOL_DEFINITIONS } from '../../src/core/toolManager.js';
import { filterToolsByRelevance } from '../../src/core/toolFilter.js';
import type { LLMMessage } from '../../src/types.js';

// Mock TeammateProcess to avoid conflicts with other test files that mock it
// This is needed because toolManager imports agent which imports TeamManager which imports TeammateProcess
vi.mock('../../src/core/teams/TeammateProcess.js', () => {
  return {
    TeammateProcess: vi.fn().mockImplementation((opts) => {
      const mock = {
        name: opts.name,
        status: 'spawning' as string,
        pid: 0,
        setStatus: vi.fn((s: string) => { mock.status = s; }),
        spawn: vi.fn(),
        send: vi.fn(),
        assignTask: vi.fn(),
        sendMessage: vi.fn(),
        requestShutdown: vi.fn(),
        kill: vi.fn(),
        toMember: () => ({
          name: opts.name,
          agentName: opts.agentName,
          pid: 0,
          status: 'idle',
        }),
      };
      return mock;
    }),
  };
});

class MockCommunitySkillsCache {
  async getRegistry() {
    return null;
  }
  async getRegistryIgnoreTTL() {
    return null;
  }
  async setRegistry() {
    return;
  }
  async getSkillDirectory() {
    return null;
  }
  async setSkillDirectory() {
    return;
  }
}

class MockGitHubRegistryFetcher {
  async fetchRegistry() {
    return {
      version: '1.0.0',
      updatedAt: '2026-01-01',
      skills: [
        {
          id: 'react-testing',
          name: 'React Testing',
          description: 'Best practices for testing React components',
          category: 'testing',
          tags: ['react', 'testing', 'jest'],
          languages: ['typescript', 'javascript'],
          frameworks: ['react'],
          downloadCount: 500,
          directory: 'skills/react-testing',
          files: ['SKILL.md'],
        },
        {
          id: 'python-api',
          name: 'Python API',
          description: 'Build REST APIs with Python',
          category: 'frameworks',
          tags: ['python', 'api', 'rest'],
          languages: ['python'],
          frameworks: ['fastapi', 'flask'],
          downloadCount: 300,
          directory: 'skills/python-api',
          files: ['SKILL.md'],
        },
        {
          id: 'docker-deploy',
          name: 'Docker Deploy',
          description: 'Docker deployment workflows',
          category: 'workflows',
          tags: ['docker', 'deployment'],
          languages: [],
          frameworks: [],
          downloadCount: 200,
          directory: 'skills/docker-deploy',
          files: ['SKILL.md'],
        },
      ],
      categories: [],
    };
  }
  async fetchSkillDirectory() {
    return new Map();
  }
}

vi.mock('../../src/skills/CommunitySkillsCache.js', () => ({
  CommunitySkillsCache: MockCommunitySkillsCache,
}));

vi.mock('../../src/skills/GitHubRegistryFetcher.js', () => ({
  GitHubRegistryFetcher: MockGitHubRegistryFetcher,
}));

describe('find_agent_skills tool', () => {
  describe('tool definition', () => {
    it('exists in DEFAULT_TOOL_DEFINITIONS', () => {
      const def = DEFAULT_TOOL_DEFINITIONS.find((t) => t.name === 'find_agent_skills');
      expect(def).toBeDefined();
    });

    it('has correct name and description', () => {
      const def = DEFAULT_TOOL_DEFINITIONS.find((t) => t.name === 'find_agent_skills');
      expect(def!.name).toBe('find_agent_skills');
      expect(def!.description).toContain('skill');
    });

    it('requires query parameter', () => {
      const def = DEFAULT_TOOL_DEFINITIONS.find((t) => t.name === 'find_agent_skills');
      expect(def!.parameters?.required).toContain('query');
    });

    it('has optional category and limit parameters', () => {
      const def = DEFAULT_TOOL_DEFINITIONS.find((t) => t.name === 'find_agent_skills');
      expect(def!.parameters?.properties).toHaveProperty('category');
      expect(def!.parameters?.properties).toHaveProperty('limit');
      expect(def!.parameters?.required).not.toContain('category');
      expect(def!.parameters?.required).not.toContain('limit');
    });

    it('does not require approval', () => {
      const def = DEFAULT_TOOL_DEFINITIONS.find((t) => t.name === 'find_agent_skills');
      expect(def!.requiresApproval).toBeUndefined();
    });

    it('survives relevance filtering — always available to LLM regardless of context', () => {
      // Use a minimal message that triggers no special categories
      const messages: LLMMessage[] = [{ role: 'user', content: 'hello' }];
      const toolDef = DEFAULT_TOOL_DEFINITIONS.find((t) => t.name === 'find_agent_skills')!;
      const filtered = filterToolsByRelevance([toolDef], messages);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('find_agent_skills');
    });
  });

  describe('find_agent_skills execution', () => {
    beforeEach(() => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    it('formats results with name, description, and install hint', async () => {
      const { searchCommunitySkills } = await import('../../src/actions/skills.js');
      const result = await searchCommunitySkills('react', { limit: 5 });
      expect(result).toContain('react-testing');
      expect(result).toContain('React Testing');
      expect(result).toContain('testing React components');
      expect(result).toContain('/skills install');
    });

    it('returns no-results message for unmatched queries', async () => {
      const { searchCommunitySkills } = await import('../../src/actions/skills.js');
      const result = await searchCommunitySkills('nonexistent-xyz-skill', { limit: 5 });
      expect(result).toContain('No skills found');
    });

    it('filters by category when provided', async () => {
      const { searchCommunitySkills } = await import('../../src/actions/skills.js');
      const result = await searchCommunitySkills('', { category: 'testing', limit: 10 });
      expect(result).toContain('react-testing');
      expect(result).not.toContain('docker-deploy');
    });

    it('handles empty query with category filter', async () => {
      const { searchCommunitySkills } = await import('../../src/actions/skills.js');
      const result = await searchCommunitySkills('', { category: 'frameworks' });
      expect(result).toContain('python-api');
    });

    it('handles query with special characters safely', async () => {
      const { searchCommunitySkills } = await import('../../src/actions/skills.js');
      const result = await searchCommunitySkills('react (hooks)', { limit: 5 });
      expect(typeof result).toBe('string');
    });

    it('clamps limit to max 20', async () => {
      const { searchCommunitySkills } = await import('../../src/actions/skills.js');
      const result = await searchCommunitySkills('react', { limit: 1000 });
      expect(typeof result).toBe('string');
    });
  });
});
