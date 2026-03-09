/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for migrated subcommands: search, trending, remove, feedback
 * These were moved from /learn to /skills.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { skills } from '../../src/commands/skills.js';
import type { SkillsRegistry } from '../../src/skills/SkillsRegistry.js';

// ─── Mocks ───────────────────────────────────────────────────────────

vi.mock('../../src/skills/CommunitySkillsCache.js', () => ({
  CommunitySkillsCache: vi.fn().mockImplementation(() => ({
    getRegistry: vi.fn(async () => null),
    setRegistry: vi.fn(async () => {}),
    getSkillDirectory: vi.fn(async () => null),
    setSkillDirectory: vi.fn(async () => {}),
    getRegistryIgnoreTTL: vi.fn(async () => null),
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

vi.mock('../../src/ui/ink/components/Modal.js', () => ({
  showModal: vi.fn(async () => null),
  showConfirm: vi.fn(async () => false),
}));

vi.mock('../../src/skills/LearnClient.js', () => ({
  LearnClient: vi.fn().mockImplementation(() => ({
    search: vi.fn(() => []),
    trending: vi.fn(() => []),
    findBySlug: vi.fn(() => null),
    filterLearnedSkills: vi.fn(() => []),
    checkUpdates: vi.fn(() => []),
  })),
}));

// ─── Helpers ─────────────────────────────────────────────────────────

function createMockRegistry(): SkillsRegistry {
  return {
    listSkills: vi.fn(() => []),
    getActiveSkills: vi.fn(() => []),
    getSkill: vi.fn(),
    activateSkill: vi.fn(() => true),
    deactivateSkill: vi.fn(() => true),
    findSimilar: vi.fn(() => []),
    isSkillInstalled: vi.fn(async () => false),
    importCommunitySkillDirectory: vi.fn(async () => ({ success: true, path: '/test' })),
    trackSkillEvent: vi.fn(),
  } as unknown as SkillsRegistry;
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('/skills migrated subcommands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('search', () => {
    it('dispatches "search" and returns a string result', async () => {
      const ctx = { skillsRegistry: createMockRegistry(), workspaceRoot: '/test' };
      const result = await skills(ctx, ['search', 'react']);
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('search with empty query returns usage or result', async () => {
      const ctx = { skillsRegistry: createMockRegistry(), workspaceRoot: '/test' };
      const result = await skills(ctx, ['search']);
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('search with multi-word query joins words', async () => {
      const ctx = { skillsRegistry: createMockRegistry(), workspaceRoot: '/test' };
      const result = await skills(ctx, ['search', 'react', 'hooks']);
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });
  });

  describe('trending', () => {
    it('dispatches "trending" and returns formatted output', async () => {
      const ctx = { skillsRegistry: createMockRegistry(), workspaceRoot: '/test' };
      const result = await skills(ctx, ['trending']);
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });
  });

  describe('remove', () => {
    it('dispatches "remove" without slug shows usage', async () => {
      const ctx = { skillsRegistry: createMockRegistry(), workspaceRoot: '/test' };
      const result = await skills(ctx, ['remove']);
      expect(result).toBeDefined();
      expect(result).toContain('Usage');
    });

    it('dispatches "uninstall" alias without slug shows usage', async () => {
      const ctx = { skillsRegistry: createMockRegistry(), workspaceRoot: '/test' };
      const result = await skills(ctx, ['uninstall']);
      expect(result).toBeDefined();
      expect(result).toContain('Usage');
    });

    it('dispatches "remove" with slug that does not exist', async () => {
      const ctx = { skillsRegistry: createMockRegistry(), workspaceRoot: '/test' };
      const result = await skills(ctx, ['remove', 'nonexistent']);
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });
  });

  describe('feedback', () => {
    it('dispatches "feedback" and validates rating', async () => {
      const ctx = { skillsRegistry: createMockRegistry(), workspaceRoot: '/test' };
      const result = await skills(ctx, ['feedback', '@test/skill', '5', 'great']);
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('dispatches "feedback" rejects invalid rating above 5', async () => {
      const ctx = { skillsRegistry: createMockRegistry(), workspaceRoot: '/test' };
      const result = await skills(ctx, ['feedback', '@test/skill', '10']);
      expect(result).toBeDefined();
      expect(result).toContain('1-5');
    });

    it('dispatches "feedback" rejects invalid rating below 1', async () => {
      const ctx = { skillsRegistry: createMockRegistry(), workspaceRoot: '/test' };
      const result = await skills(ctx, ['feedback', '@test/skill', '0']);
      expect(result).toBeDefined();
      expect(result).toContain('1-5');
    });

    it('dispatches "feedback" rejects non-numeric rating', async () => {
      const ctx = { skillsRegistry: createMockRegistry(), workspaceRoot: '/test' };
      const result = await skills(ctx, ['feedback', '@test/skill', 'abc']);
      expect(result).toBeDefined();
      expect(result).toContain('1-5');
    });

    it('dispatches "feedback" without slug shows usage', async () => {
      const ctx = { skillsRegistry: createMockRegistry(), workspaceRoot: '/test' };
      const result = await skills(ctx, ['feedback']);
      expect(result).toBeDefined();
      expect(result).toContain('Usage');
    });

    it('dispatches "rate" alias', async () => {
      const ctx = { skillsRegistry: createMockRegistry(), workspaceRoot: '/test' };
      const result = await skills(ctx, ['rate', '@test/skill', '4', 'nice']);
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });
  });

  describe('/skills metadata exports', () => {
    it('exports searchMetadata with correct command and implemented flag', async () => {
      const { searchMetadata } = await import('../../src/commands/skills.js');
      expect(searchMetadata).toBeDefined();
      expect(searchMetadata.command).toBe('/skills search');
      expect(searchMetadata.description).toBe('search community skills');
      expect(searchMetadata.implemented).toBe(true);
    });

    it('exports trendingMetadata with correct command and implemented flag', async () => {
      const { trendingMetadata } = await import('../../src/commands/skills.js');
      expect(trendingMetadata).toBeDefined();
      expect(trendingMetadata.command).toBe('/skills trending');
      expect(trendingMetadata.description).toBe('show trending community skills');
      expect(trendingMetadata.implemented).toBe(true);
    });

    it('exports removeMetadata with correct command and implemented flag', async () => {
      const { removeMetadata } = await import('../../src/commands/skills.js');
      expect(removeMetadata).toBeDefined();
      expect(removeMetadata.command).toBe('/skills remove');
      expect(removeMetadata.description).toBe('remove an installed skill');
      expect(removeMetadata.implemented).toBe(true);
    });

    it('all metadata exports have required SlashCommand fields', async () => {
      const mod = await import('../../src/commands/skills.js');
      const metadatas = [
        mod.metadata,
        mod.useMetadata,
        mod.installMetadata,
        mod.searchMetadata,
        mod.trendingMetadata,
        mod.removeMetadata,
      ];
      for (const meta of metadatas) {
        expect(meta).toHaveProperty('command');
        expect(meta).toHaveProperty('description');
        expect(meta).toHaveProperty('implemented');
        expect(typeof meta.command).toBe('string');
        expect(meta.command.startsWith('/skills')).toBe(true);
      }
    });
  });

  describe('context interface', () => {
    it('accepts hookManager in context', async () => {
      const ctx = {
        skillsRegistry: createMockRegistry(),
        workspaceRoot: '/test',
        hookManager: {} as any,
      };
      const result = await skills(ctx, ['trending']);
      expect(result).toBeDefined();
    });

    it('accepts isNonInteractive in context', async () => {
      const ctx = {
        skillsRegistry: createMockRegistry(),
        workspaceRoot: '/test',
        isNonInteractive: true,
      };
      const result = await skills(ctx, ['search', 'react']);
      expect(result).toBeDefined();
    });
  });
});
