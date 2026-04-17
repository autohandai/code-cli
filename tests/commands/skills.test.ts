/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for /skills command
 */
import { describe, expect, it, vi } from 'vitest';
import type { SkillsRegistry } from '../../src/types.js';

// Mock dependencies
vi.mock('../../src/ui/ink/components/Modal.js', () => ({
  showModal: vi.fn(),
  showInput: vi.fn(),
  showConfirm: vi.fn(),
}));

vi.mock('../../src/utils/prompt.js', () => ({
  safePrompt: vi.fn(),
}));

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

describe('skills command', () => {
  it('returns formatted skills list', async () => {
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

    const result = await skills({ skillsRegistry: registry, isNonInteractive: true }, []);

    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    expect(result).toContain('test-skill');
    expect(result).toContain('A test skill');
  });

  it('handles use subcommand', async () => {
    const { skills } = await import('../../src/commands/skills.js');
    const registry = createMockRegistry();

    const result = await skills({ skillsRegistry: registry, isNonInteractive: true }, ['use', 'my-skill']);

    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
  });

  it('handles deactivate subcommand', async () => {
    const { skills } = await import('../../src/commands/skills.js');
    const registry = createMockRegistry();

    const result = await skills({ skillsRegistry: registry, isNonInteractive: true }, ['deactivate', 'my-skill']);

    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
  });

  it('handles missing skills registry', async () => {
    const { skills } = await import('../../src/commands/skills.js');
    const result = await skills({ skillsRegistry: undefined as unknown as SkillsRegistry, isNonInteractive: true }, []);

    expect(result).toContain('not available');
  });

  it('returns skills list for empty subcommand', async () => {
    const { skills } = await import('../../src/commands/skills.js');
    const registry = createMockRegistry();

    const result = await skills({ skillsRegistry: registry, isNonInteractive: true }, []);

    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    expect(result).toContain('Skills');
  });
});
