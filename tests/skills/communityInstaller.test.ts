/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi } from 'vitest';
import {
  fetchRegistryWithFallback,
  installSkillWithSecurity,
  injectLearnMetadata,
} from '../../src/skills/communityInstaller.js';
import type { CommunitySkillsRegistry, GitHubCommunitySkill } from '../../src/types.js';

// ─── Test Helpers ─────────────────────────────────────────────────────

function makeSkill(overrides: Partial<GitHubCommunitySkill> = {}): GitHubCommunitySkill {
  return {
    id: 'test-skill',
    name: 'Test Skill',
    description: 'A test skill',
    category: 'testing',
    tags: ['test'],
    author: 'tester',
    ...overrides,
  };
}

function makeRegistry(skills: GitHubCommunitySkill[] = []): CommunitySkillsRegistry {
  return {
    version: '1.0.0',
    updatedAt: new Date().toISOString(),
    skills,
    categories: [],
  };
}

// ─── Exports ──────────────────────────────────────────────────────────

describe('communityInstaller exports', () => {
  it('exports fetchRegistryWithFallback function', () => {
    expect(typeof fetchRegistryWithFallback).toBe('function');
  });

  it('exports installSkillWithSecurity function', () => {
    expect(typeof installSkillWithSecurity).toBe('function');
  });

  it('exports injectLearnMetadata function', () => {
    expect(typeof injectLearnMetadata).toBe('function');
  });
});

// ─── fetchRegistryWithFallback ────────────────────────────────────────

describe('fetchRegistryWithFallback', () => {
  it('returns cached registry when available', async () => {
    const registry = makeRegistry();
    const cache = {
      getRegistry: vi.fn().mockResolvedValue(registry),
      setRegistry: vi.fn(),
      getRegistryIgnoreTTL: vi.fn(),
    };
    const fetcher = {
      fetchRegistry: vi.fn(),
    };

    const result = await fetchRegistryWithFallback(cache as any, fetcher as any);
    expect(result).toBe(registry);
    expect(cache.getRegistry).toHaveBeenCalled();
    expect(fetcher.fetchRegistry).not.toHaveBeenCalled();
  });

  it('fetches from GitHub when cache misses', async () => {
    const registry = makeRegistry();
    const cache = {
      getRegistry: vi.fn().mockResolvedValue(null),
      setRegistry: vi.fn(),
      getRegistryIgnoreTTL: vi.fn(),
    };
    const fetcher = {
      fetchRegistry: vi.fn().mockResolvedValue(registry),
    };

    const result = await fetchRegistryWithFallback(cache as any, fetcher as any);
    expect(result).toBe(registry);
    expect(fetcher.fetchRegistry).toHaveBeenCalled();
    expect(cache.setRegistry).toHaveBeenCalledWith(registry);
  });

  it('falls back to stale cache when fetch fails', async () => {
    const staleRegistry = makeRegistry();
    const cache = {
      getRegistry: vi.fn().mockResolvedValue(null),
      setRegistry: vi.fn(),
      getRegistryIgnoreTTL: vi.fn().mockResolvedValue(staleRegistry),
    };
    const fetcher = {
      fetchRegistry: vi.fn().mockRejectedValue(new Error('network error')),
    };

    const result = await fetchRegistryWithFallback(cache as any, fetcher as any);
    expect(result).toBe(staleRegistry);
    expect(cache.getRegistryIgnoreTTL).toHaveBeenCalled();
  });

  it('returns null when everything fails', async () => {
    const cache = {
      getRegistry: vi.fn().mockResolvedValue(null),
      setRegistry: vi.fn(),
      getRegistryIgnoreTTL: vi.fn().mockResolvedValue(null),
    };
    const fetcher = {
      fetchRegistry: vi.fn().mockRejectedValue(new Error('offline')),
    };

    const result = await fetchRegistryWithFallback(cache as any, fetcher as any);
    expect(result).toBeNull();
  });
});

// ─── injectLearnMetadata ──────────────────────────────────────────────

describe('injectLearnMetadata', () => {
  const skill = makeSkill({ id: 'seo-optimizer', author: 'anthropic' });

  it('injects all 5 metadata keys', () => {
    const input = '# SEO Optimizer\n\nHelp with SEO.';
    const result = injectLearnMetadata(input, skill);

    expect(result).toContain('agentskill-slug: seo-optimizer');
    expect(result).toContain('agentskill-owner: anthropic');
    expect(result).toContain('agentskill-sha:');
    expect(result).toContain('agentskill-installed:');
    expect(result).toContain('agentskill-source: github-registry');
  });

  it('creates frontmatter when none exists', () => {
    const input = '# No frontmatter\n\nJust content.';
    const result = injectLearnMetadata(input, skill);

    // Should start with YAML frontmatter
    expect(result).toMatch(/^---\nmetadata:/);
    // Should end with --- and original content
    expect(result).toContain('---\n# No frontmatter');
  });

  it('injects into existing frontmatter with metadata block', () => {
    const input = '---\nname: test\nmetadata:\n  existing: value\n---\n# Content';
    const result = injectLearnMetadata(input, skill);

    // Original metadata block should be preserved
    expect(result).toContain('existing: value');
    // New keys should be injected
    expect(result).toContain('agentskill-slug: seo-optimizer');
    // Should still have proper frontmatter structure
    expect(result).toMatch(/^---/);
  });

  it('adds metadata block to existing frontmatter without one', () => {
    const input = '---\nname: test\n---\n# Content';
    const result = injectLearnMetadata(input, skill);

    // Should inject a metadata: block
    expect(result).toContain('metadata:');
    expect(result).toContain('agentskill-slug: seo-optimizer');
  });

  it('uses "community" as default owner when author is missing', () => {
    const noAuthorSkill = makeSkill({ id: 'anon-skill', author: undefined });
    const input = '# Anon\n\nContent.';
    const result = injectLearnMetadata(input, noAuthorSkill);

    expect(result).toContain('agentskill-owner: community');
  });

  it('includes a SHA hash derived from the content', () => {
    const input = '# Test\n\nContent.';
    const result = injectLearnMetadata(input, skill);

    // SHA should be a 7-char hex string
    const shaMatch = result.match(/agentskill-sha: ([a-f0-9]+)/);
    expect(shaMatch).not.toBeNull();
    expect(shaMatch![1]).toHaveLength(7);
  });

  it('includes an ISO 8601 installed timestamp', () => {
    const input = '# Test\n\nContent.';
    const result = injectLearnMetadata(input, skill);

    const tsMatch = result.match(/agentskill-installed: (.+)/);
    expect(tsMatch).not.toBeNull();
    // Should be a valid ISO date
    const parsed = new Date(tsMatch![1]);
    expect(parsed.getTime()).not.toBeNaN();
  });
});

// ─── installSkillWithSecurity ─────────────────────────────────────────

describe('installSkillWithSecurity', () => {
  const skill = makeSkill({ id: 'test-skill', name: 'Test Skill' });

  function makeContext(overrides: Record<string, any> = {}) {
    return {
      skillsRegistry: {
        isSkillInstalled: vi.fn().mockResolvedValue(false),
        importCommunitySkillDirectory: vi.fn().mockResolvedValue({ success: true, path: '/skills/test' }),
        trackSkillEvent: vi.fn(),
      },
      workspaceRoot: '/tmp/project',
      isNonInteractive: true,
      ...overrides,
    };
  }

  function makeCache() {
    return {
      getSkillDirectory: vi.fn().mockResolvedValue(new Map([['SKILL.md', '# Test Skill\n\nSafe content.']])),
      setSkillDirectory: vi.fn(),
    };
  }

  function makeFetcher() {
    return {
      fetchSkillDirectory: vi.fn().mockResolvedValue(new Map([['SKILL.md', '# Test Skill']])),
    };
  }

  it('returns already-installed message when skill exists', async () => {
    const ctx = makeContext({
      skillsRegistry: {
        isSkillInstalled: vi.fn().mockResolvedValue(true),
        importCommunitySkillDirectory: vi.fn(),
        trackSkillEvent: vi.fn(),
      },
    });

    const result = await installSkillWithSecurity(ctx as any, skill, makeCache() as any, makeFetcher() as any);
    expect(result).toContain('Test Skill');
    expect(ctx.skillsRegistry.importCommunitySkillDirectory).not.toHaveBeenCalled();
  });

  it('fetches files from network when cache misses', async () => {
    const ctx = makeContext();
    const cache = {
      getSkillDirectory: vi.fn().mockResolvedValue(null),
      setSkillDirectory: vi.fn(),
    };
    const fetcher = makeFetcher();

    await installSkillWithSecurity(ctx as any, skill, cache as any, fetcher as any);
    expect(fetcher.fetchSkillDirectory).toHaveBeenCalledWith(skill);
    expect(cache.setSkillDirectory).toHaveBeenCalled();
  });

  it('returns error when file fetch fails', async () => {
    const ctx = makeContext();
    const cache = {
      getSkillDirectory: vi.fn().mockResolvedValue(null),
      setSkillDirectory: vi.fn(),
    };
    const fetcher = {
      fetchSkillDirectory: vi.fn().mockRejectedValue(new Error('network down')),
    };

    const result = await installSkillWithSecurity(ctx as any, skill, cache as any, fetcher as any);
    expect(result).toContain('Failed to fetch skill files');
    expect(result).toContain('network down');
  });

  it('calls importCommunitySkillDirectory on successful install', async () => {
    const ctx = makeContext();
    const cache = makeCache();
    const fetcher = makeFetcher();

    await installSkillWithSecurity(ctx as any, skill, cache as any, fetcher as any);
    expect(ctx.skillsRegistry.importCommunitySkillDirectory).toHaveBeenCalled();
  });

  it('tracks install telemetry on success', async () => {
    const ctx = makeContext();
    const cache = makeCache();
    const fetcher = makeFetcher();

    await installSkillWithSecurity(ctx as any, skill, cache as any, fetcher as any);
    expect(ctx.skillsRegistry.trackSkillEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        skillName: 'Test Skill',
        source: 'community',
        action: 'install',
      }),
    );
  });

  it('returns error message when import fails', async () => {
    const ctx = makeContext({
      skillsRegistry: {
        isSkillInstalled: vi.fn().mockResolvedValue(false),
        importCommunitySkillDirectory: vi.fn().mockResolvedValue({ success: false, error: 'disk full' }),
        trackSkillEvent: vi.fn(),
      },
    });

    const result = await installSkillWithSecurity(ctx as any, skill, makeCache() as any, makeFetcher() as any);
    expect(result).toContain('disk full');
  });

  it('respects pre-learn hook blocking', async () => {
    const hookManager = {
      executeHooks: vi.fn().mockResolvedValue([{ blockingError: 'Policy violation' }]),
    };
    const ctx = makeContext({ hookManager });

    const result = await installSkillWithSecurity(ctx as any, skill, makeCache() as any, makeFetcher() as any);
    expect(result).toBeTruthy();
    expect(ctx.skillsRegistry.importCommunitySkillDirectory).not.toHaveBeenCalled();
  });

  it('fires post-learn hook after successful install', async () => {
    const hookManager = {
      executeHooks: vi.fn().mockResolvedValue([]),
    };
    const ctx = makeContext({ hookManager });
    const cache = makeCache();
    const fetcher = makeFetcher();

    await installSkillWithSecurity(ctx as any, skill, cache as any, fetcher as any);
    expect(hookManager.executeHooks).toHaveBeenCalledWith('post-learn', expect.objectContaining({
      tool: 'learn',
      success: true,
    }));
  });
});
