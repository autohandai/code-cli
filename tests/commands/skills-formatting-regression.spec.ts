/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression tests for /skills formatting and duplicate printing bugs.
 *
 * Bug 1 (FIXED): /skills list output should use clean text formatting,
 *   NOT raw markdown tokens (**bold**, _italic_, {{action:...}}) that
 *   display as literal text in the TUI.
 *
 * Bug 2 (FIXED): /skills install should NOT use console.log() mixed with
 *   showModal() Ink rendering, which caused duplicate/messy output.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkillsRegistry } from '../../src/types.js';

// ─── Mocks ───────────────────────────────────────────────────────────

const mockShowModal = vi.fn();
const mockShowInput = vi.fn();
const mockSafePrompt = vi.fn();

vi.mock('../../src/ui/ink/components/Modal.js', () => ({
  showModal: mockShowModal,
  showInput: mockShowInput,
  showConfirm: vi.fn(async () => false),
}));

vi.mock('../../src/utils/prompt.js', () => ({
  safePrompt: mockSafePrompt,
}));

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
    findSkill: vi.fn(() => null),
    findSimilarSkills: vi.fn(() => []),
    getFeaturedSkills: vi.fn(() => []),
    filterSkills: vi.fn((skills) => skills),
    fetchSkillDirectory: vi.fn(async () => new Map()),
  })),
}));

vi.mock('../../src/skills/LearnClient.js', () => ({
  LearnClient: vi.fn().mockImplementation(() => ({
    search: vi.fn(() => []),
    trending: vi.fn(() => []),
  })),
}));

// ─── Helpers ─────────────────────────────────────────────────────────

function createMockRegistry(overrides?: Partial<SkillsRegistry>): SkillsRegistry {
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
    ...overrides,
  } as unknown as SkillsRegistry;
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('/skills formatting regression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockShowModal.mockResolvedValue(null);
    mockShowInput.mockResolvedValue('');
    mockSafePrompt.mockResolvedValue({ scope: 'user' });
  });

  describe('Bug 1 (FIXED): /skills list returns clean text, NOT raw markdown tokens', () => {
    it('listSkills output should NOT contain **bold** markers', async () => {
      const { skills } = await import('../../src/commands/skills.js');
      const registry = createMockRegistry({
        listSkills: vi.fn(() => [
          {
            name: 'test-skill',
            description: 'A test skill',
            source: 'autohand-user',
            path: '/test/skills/test-skill/SKILL.md',
            body: 'Test body',
            isActive: false,
          },
        ]),
        getActiveSkills: vi.fn(() => []),
      });

      const result = await skills({ skillsRegistry: registry, workspaceRoot: '/test' }, []);

      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      // Should NOT contain raw **bold** markers
      expect(result).not.toContain('**Skills**');
      expect(result).not.toContain('**test-skill**');
      // Should contain clean text with emoji
      expect(result).toContain('📚 Skills');
      expect(result).toContain('⚪ test-skill');
    });

    it('listSkills output should NOT contain _italic_ markers for active status', async () => {
      const { skills } = await import('../../src/commands/skills.js');
      const registry = createMockRegistry({
        listSkills: vi.fn(() => [
          {
            name: 'test-skill',
            description: 'A test skill',
            source: 'autohand-user',
            path: '/test/skills/test-skill/SKILL.md',
            body: 'Test body',
            isActive: true,
          },
        ]),
        getActiveSkills: vi.fn(() => [{ name: 'test-skill' }]),
      });

      const result = await skills({ skillsRegistry: registry, workspaceRoot: '/test' }, []);

      expect(result).toBeDefined();
      // Should NOT contain raw _italic_ markers
      expect(result).not.toContain('_(active)_');
      // Should contain clean text with active status
      expect(result).toContain('🟢 test-skill (active)');
    });

    it('listSkills output should NOT contain {{action:...}} tokens', async () => {
      const { skills } = await import('../../src/commands/skills.js');
      const registry = createMockRegistry({
        listSkills: vi.fn(() => [
          {
            name: 'test-skill',
            description: 'A test skill',
            source: 'autohand-user',
            path: '/test/skills/test-skill/SKILL.md',
            body: 'Test body',
            isActive: false,
          },
        ]),
        getActiveSkills: vi.fn(() => []),
      });

      const result = await skills({ skillsRegistry: registry, workspaceRoot: '/test' }, []);

      expect(result).toBeDefined();
      // Should NOT contain raw {{action:...}} tokens
      expect(result).not.toContain('{{action:');
      // Should contain clean action hints
      expect(result).toContain('▶️  Activate: /skills use test-skill');
      expect(result).toContain('ℹ️  Info: /skills info test-skill');
    });

    it('listSkills output uses clean text formatting with emojis and spacing', async () => {
      const { skills } = await import('../../src/commands/skills.js');
      const registry = createMockRegistry({
        listSkills: vi.fn(() => [
          {
            name: 'react-testing',
            description: 'React testing patterns',
            source: 'autohand-user',
            path: '/test/skills/react-testing/SKILL.md',
            body: 'Test body',
            isActive: true,
          },
        ]),
        getActiveSkills: vi.fn(() => [{ name: 'react-testing' }]),
      });

      const result = await skills({ skillsRegistry: registry, workspaceRoot: '/test' }, []);

      expect(result).toBeDefined();
      expect(result).toContain('react-testing');
      expect(result).toContain('React testing patterns');
      // Should use emoji status indicators
      expect(result).toMatch(/[🟢⚪]/);
      // Should NOT contain any raw markdown tokens
      expect(result).not.toMatch(/\*\*[^*]+\*\*/);
      expect(result).not.toMatch(/_[^_]+_/);
      expect(result).not.toContain('{{action:');
    });

    it('empty skills list includes clean get-started actions without markup tokens', async () => {
      const { skills } = await import('../../src/commands/skills.js');
      const registry = createMockRegistry({
        listSkills: vi.fn(() => []),
        getActiveSkills: vi.fn(() => []),
      });

      const result = await skills({ skillsRegistry: registry, workspaceRoot: '/test' }, []);

      expect(result).toBeDefined();
      // Should NOT contain raw {{action:...}} tokens
      expect(result).not.toContain('{{action:');
      // Should NOT contain **bold** markers
      expect(result).not.toContain('**Get started:**');
      // Should contain clean text with action hints
      expect(result).toContain('Get started:');
      expect(result).toContain('🌐 Browse Community Skills');
      expect(result).toContain('✨ Create New Skill');
      expect(result).toContain('/skills install');
      expect(result).toContain('/skills new');
    });
  });

  describe('Bug 2 (FIXED): /skills install should not use console.log during interactive browser', () => {
    it('interactiveBrowser should not call console.log for header output', async () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { skillsInstall } = await import('../../src/commands/skills-install.js');
      const registry = createMockRegistry();

      mockShowModal.mockResolvedValue(null);

      await skillsInstall(
        {
          skillsRegistry: registry,
          workspaceRoot: '/workspace',
        },
        undefined
      );

      // The interactive browser should NOT use console.log for its UI
      // (it should return a formatted string or use the modal exclusively)
      const logCalls = consoleLogSpy.mock.calls.filter(
        (call) =>
          typeof call[0] === 'string' &&
          (call[0].includes('Community Skills') ||
            call[0].includes('─') ||
            call[0].includes('skills available'))
      );
      expect(logCalls).toHaveLength(0);

      consoleLogSpy.mockRestore();
    });

    it('interactiveBrowser should not call console.log for skill details', async () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { skillsInstall } = await import('../../src/commands/skills-install.js');
      const registry = createMockRegistry();

      // Simulate selecting a skill
      mockShowModal.mockResolvedValue({ value: 'test-skill' });

      await skillsInstall(
        {
          skillsRegistry: registry,
          workspaceRoot: '/workspace',
        },
        undefined
      );

      // Should NOT use console.log for skill details display
      const logCalls = consoleLogSpy.mock.calls.filter(
        (call) =>
          typeof call[0] === 'string' &&
          (call[0].includes('Skill:') ||
            call[0].includes('Description:') ||
            call[0].includes('Category:'))
      );
      expect(logCalls).toHaveLength(0);

      consoleLogSpy.mockRestore();
    });

    it('direct install should not use console.log for status messages', async () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { skillsInstall } = await import('../../src/commands/skills-install.js');
      const registry = createMockRegistry();

      // Mock the fetcher to find a skill
      const { GitHubRegistryFetcher } = await import('../../src/skills/GitHubRegistryFetcher.js');
      const fetcherInstance = vi.mocked(GitHubRegistryFetcher).mock.results[0]?.value;
      if (fetcherInstance) {
        fetcherInstance.findSkill = vi.fn().mockReturnValue({
          id: 'test-skill',
          name: 'test-skill',
          description: 'A test skill',
          category: 'testing',
          directory: 'skills/test-skill',
          files: ['SKILL.md'],
        });
      }

      await skillsInstall(
        {
          skillsRegistry: registry,
          workspaceRoot: '/workspace',
        },
        'test-skill'
      );

      // Should NOT use console.log for "Skill not found" or similar status
      const notFoundCalls = consoleLogSpy.mock.calls.filter(
        (call) =>
          typeof call[0] === 'string' && call[0].includes('Skill not found')
      );
      expect(notFoundCalls).toHaveLength(0);

      consoleLogSpy.mockRestore();
    });
  });
});
