/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { LearnClient } from '../../src/skills/LearnClient.js';
import type { CommunitySkillsRegistry, GitHubCommunitySkill } from '../../src/types.js';

function makeSkill(overrides: Partial<GitHubCommunitySkill> = {}): GitHubCommunitySkill {
  return {
    id: 'test-skill',
    name: 'test-skill',
    description: 'A test skill',
    category: 'testing',
    directory: 'skills/test-skill',
    files: ['SKILL.md'],
    downloadCount: 100,
    rating: 4.0,
    ...overrides,
  };
}

function makeRegistry(skills: GitHubCommunitySkill[] = []): CommunitySkillsRegistry {
  return {
    version: '1.0.0',
    updatedAt: new Date().toISOString(),
    skills,
    categories: [{ id: 'testing', name: 'Testing', count: skills.length }],
  };
}

describe('LearnClient', () => {
  let client: LearnClient;

  beforeEach(() => {
    client = new LearnClient();
  });

  describe('search', () => {
    it('returns matching skills sorted by download count', () => {
      const skills = [
        makeSkill({ id: 'seo-1', name: 'seo-basic', description: 'Basic SEO', downloadCount: 500 }),
        makeSkill({ id: 'seo-2', name: 'seo-pro', description: 'Advanced SEO tools', downloadCount: 5000 }),
        makeSkill({ id: 'react-1', name: 'react-hooks', description: 'React hooks guide', downloadCount: 3000 }),
      ];
      const registry = makeRegistry(skills);

      const results = client.search(registry, 'seo');
      expect(results).toHaveLength(2);
      expect(results[0].name).toBe('seo-pro');
      expect(results[1].name).toBe('seo-basic');
    });

    it('returns empty array for no matches', () => {
      const registry = makeRegistry([makeSkill()]);
      const results = client.search(registry, 'nonexistent-xyz');
      expect(results).toHaveLength(0);
    });

    it('limits results to 5 by default', () => {
      const skills = Array.from({ length: 10 }, (_, i) =>
        makeSkill({ id: `seo-${i}`, name: `seo-skill-${i}`, description: 'SEO tool', downloadCount: i * 100 })
      );
      const registry = makeRegistry(skills);
      const results = client.search(registry, 'seo');
      expect(results).toHaveLength(5);
    });

    it('respects custom limit', () => {
      const skills = Array.from({ length: 10 }, (_, i) =>
        makeSkill({ id: `seo-${i}`, name: `seo-skill-${i}`, description: 'SEO tool', downloadCount: i * 100 })
      );
      const registry = makeRegistry(skills);
      const results = client.search(registry, 'seo', 3);
      expect(results).toHaveLength(3);
    });

    it('searches across name, description, tags, languages, and frameworks', () => {
      const skills = [
        makeSkill({ id: 'a', name: 'helper', description: 'python helper', tags: ['python'] }),
        makeSkill({ id: 'b', name: 'formatter', description: 'code formatter', languages: ['python'] }),
        makeSkill({ id: 'c', name: 'bundler', description: 'asset bundler', frameworks: ['python-flask'] }),
      ];
      const registry = makeRegistry(skills);
      const results = client.search(registry, 'python', 10);
      expect(results).toHaveLength(3);
    });
  });

  describe('trending', () => {
    it('returns featured skills sorted by download count', () => {
      const skills = [
        makeSkill({ id: 'a', name: 'featured-1', isFeatured: true, downloadCount: 1000 }),
        makeSkill({ id: 'b', name: 'featured-2', isFeatured: true, downloadCount: 5000 }),
        makeSkill({ id: 'c', name: 'not-featured', isFeatured: false, downloadCount: 9000 }),
      ];
      const registry = makeRegistry(skills);
      const results = client.trending(registry);
      expect(results[0].name).toBe('featured-2');
      expect(results.some(r => r.name === 'not-featured')).toBe(true);
    });
  });

  describe('findBySlug', () => {
    it('finds skill by @owner/name format', () => {
      const skills = [makeSkill({ id: 'seo-optimizer', name: 'seo-optimizer', author: 'anthropic' })];
      const registry = makeRegistry(skills);
      const result = client.findBySlug(registry, '@anthropic/seo-optimizer');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('seo-optimizer');
    });

    it('finds skill by plain name', () => {
      const skills = [makeSkill({ id: 'seo-optimizer', name: 'seo-optimizer' })];
      const registry = makeRegistry(skills);
      const result = client.findBySlug(registry, 'seo-optimizer');
      expect(result).not.toBeNull();
    });

    it('returns null for unknown slug', () => {
      const registry = makeRegistry([makeSkill()]);
      const result = client.findBySlug(registry, '@nobody/nothing');
      expect(result).toBeNull();
    });
  });

  describe('filterLearnedSkills', () => {
    it('filters skills with agentskill-slug metadata', () => {
      const allSkills = [
        { name: 'manual-skill', metadata: {}, source: 'autohand-user' as const, description: '', body: '', path: '', isActive: false },
        { name: 'learned-skill', metadata: { 'agentskill-slug': 'learned-skill' }, source: 'autohand-user' as const, description: '', body: '', path: '', isActive: false },
      ];
      const learned = client.filterLearnedSkills(allSkills as any);
      expect(learned).toHaveLength(1);
      expect(learned[0].name).toBe('learned-skill');
    });
  });

  describe('checkUpdates', () => {
    it('detects skills needing update when SHA differs', () => {
      const installed = [
        { name: 'skill-a', metadata: { 'agentskill-slug': 'skill-a', 'agentskill-sha': 'old-sha' } },
      ];
      const registry = makeRegistry([makeSkill({ id: 'skill-a', name: 'skill-a' })]);
      const updates = client.checkUpdates(installed as any, registry, () => 'new-sha');
      expect(updates).toHaveLength(1);
      expect(updates[0].name).toBe('skill-a');
    });

    it('returns empty when all SHAs match', () => {
      const installed = [
        { name: 'skill-a', metadata: { 'agentskill-slug': 'skill-a', 'agentskill-sha': 'same-sha' } },
      ];
      const registry = makeRegistry([makeSkill({ id: 'skill-a', name: 'skill-a' })]);
      const updates = client.checkUpdates(installed as any, registry, () => 'same-sha');
      expect(updates).toHaveLength(0);
    });
  });

  describe('computeContentSha', () => {
    it('returns consistent hash for same content', () => {
      const sha1 = LearnClient.computeContentSha('hello world');
      const sha2 = LearnClient.computeContentSha('hello world');
      expect(sha1).toBe(sha2);
    });

    it('returns different hash for different content', () => {
      const sha1 = LearnClient.computeContentSha('hello');
      const sha2 = LearnClient.computeContentSha('world');
      expect(sha1).not.toBe(sha2);
    });

    it('returns short hex string', () => {
      const sha = LearnClient.computeContentSha('test');
      expect(sha).toMatch(/^[a-f0-9]{7}$/);
    });
  });
});
