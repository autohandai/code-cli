/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for /learn update — project-hash change detection and skill regeneration.
 * Covers: no-generated-skills case, up-to-date hashes, stale hashes triggering
 * regeneration, LLM failure during regeneration, and file write errors.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { learn } from '../../src/commands/learn.js';
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

const mockWriteFile = vi.fn(async () => {});

vi.mock('fs-extra', () => ({
  default: {
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    ensureDir: vi.fn(async () => {}),
    pathExists: vi.fn(async () => true),
    readFile: vi.fn(async () => ''),
    readJson: vi.fn(async () => ({})),
    readdir: vi.fn(async () => []),
    remove: vi.fn(async () => {}),
  },
}));

// ─── Test Helpers ───────────────────────────────────────────────────

/**
 * The mock ProjectAnalyzer always returns:
 *   languages: ['typescript'], frameworks: ['react'],
 *   patterns: ['testing'], packageManager: 'bun'
 *
 * computeProjectHash hashes those sorted fields to '0d01944'.
 */
const CURRENT_HASH = '0d01944';

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

function createMockRegistry(skills: any[] = []) {
  return {
    listSkills: vi.fn(() => skills),
    getActiveSkills: vi.fn(() => []),
    getSkill: vi.fn(),
    isSkillInstalled: vi.fn(async () => false),
    importCommunitySkillDirectory: vi.fn(async () => ({ success: true, path: '/test' })),
    saveSkill: vi.fn(async () => true),
    trackSkillEvent: vi.fn(),
  } as any;
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('/learn update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined);
  });

  it('reports no generated skills when none exist', async () => {
    const llm = createMockLLM('{}');
    const result = await learn(
      {
        skillsRegistry: createMockRegistry([]),
        workspaceRoot: '/test',
        llm,
        isNonInteractive: true,
      },
      ['update'],
    );

    expect(result).toContain('No LLM-generated skills');
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('reports no generated skills when only non-generated skills exist', async () => {
    const llm = createMockLLM('{}');
    const skills = [
      {
        name: 'manual-skill',
        description: 'A manual skill',
        body: '# Manual',
        path: '/test/.autohand/skills/manual-skill/SKILL.md',
        source: 'autohand-user',
        isActive: false,
        metadata: { 'agentskill-source': 'github-registry' },
      },
    ];
    const result = await learn(
      {
        skillsRegistry: createMockRegistry(skills),
        workspaceRoot: '/test',
        llm,
        isNonInteractive: true,
      },
      ['update'],
    );

    expect(result).toContain('No LLM-generated skills');
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('reports up-to-date when project hash matches stored hash', async () => {
    const llm = createMockLLM('{}');
    const skills = [
      {
        name: 'my-skill',
        description: 'A generated skill',
        body: '# My skill',
        path: '/test/.autohand/skills/my-skill/SKILL.md',
        source: 'autohand-user',
        isActive: false,
        metadata: {
          'agentskill-source': 'llm-generated',
          'agentskill-project-hash': CURRENT_HASH,
        },
      },
    ];
    const result = await learn(
      {
        skillsRegistry: createMockRegistry(skills),
        workspaceRoot: '/test',
        llm,
        isNonInteractive: true,
      },
      ['update'],
    );

    // Hash matches — no LLM call needed
    expect(llm.complete).not.toHaveBeenCalled();
    expect(result).toContain('up to date');
    expect(result).not.toContain('Regenerated');
  });

  it('regenerates skills when project hash changed', async () => {
    const generatedSkill = JSON.stringify({
      name: 'updated-skill',
      description: 'Updated for new stack',
      allowedTools: ['read_file'],
      body: '# Updated Skill\n\nContent.',
    });
    const llm = createMockLLM(generatedSkill);

    const skills = [
      {
        name: 'old-skill',
        description: 'Old',
        body: '# Old',
        path: '/test/.autohand/skills/old-skill/SKILL.md',
        source: 'autohand-user',
        isActive: false,
        metadata: {
          'agentskill-source': 'llm-generated',
          'agentskill-project-hash': 'stale00',
        },
      },
    ];
    const result = await learn(
      {
        skillsRegistry: createMockRegistry(skills),
        workspaceRoot: '/test',
        llm,
        isNonInteractive: true,
      },
      ['update'],
    );

    expect(llm.complete).toHaveBeenCalled();
    expect(result).toContain('Regenerated');
    expect(result).toContain('Updated 1 skill');
  });

  it('writes regenerated content to the skill path', async () => {
    const generatedSkill = JSON.stringify({
      name: 'regen-skill',
      description: 'Regenerated',
      allowedTools: ['read_file', 'write_file'],
      body: '# Regenerated Skill\n\nNew content.',
    });
    const llm = createMockLLM(generatedSkill);

    const skillPath = '/test/.autohand/skills/regen-skill/SKILL.md';
    const skills = [
      {
        name: 'regen-skill',
        description: 'Old version',
        body: '# Old',
        path: skillPath,
        source: 'autohand-user',
        isActive: false,
        metadata: {
          'agentskill-source': 'llm-generated',
          'agentskill-project-hash': 'old0000',
        },
      },
    ];
    await learn(
      {
        skillsRegistry: createMockRegistry(skills),
        workspaceRoot: '/test',
        llm,
        isNonInteractive: true,
      },
      ['update'],
    );

    expect(mockWriteFile).toHaveBeenCalledWith(
      skillPath,
      expect.stringContaining('# Regenerated Skill'),
      'utf-8',
    );
    // Written content should include the new project hash
    const writtenContent = mockWriteFile.mock.calls[0]?.[1] as string;
    expect(writtenContent).toContain(`agentskill-project-hash: ${CURRENT_HASH}`);
    expect(writtenContent).toContain('agentskill-source: llm-generated');
  });

  it('handles LLM failure gracefully during regeneration', async () => {
    // LLM returns invalid non-JSON — generateSkill returns null
    const llm = createMockLLM('not valid json at all');

    const skills = [
      {
        name: 'fail-skill',
        description: 'Will fail',
        body: '# Fail',
        path: '/test/.autohand/skills/fail-skill/SKILL.md',
        source: 'autohand-user',
        isActive: false,
        metadata: {
          'agentskill-source': 'llm-generated',
          'agentskill-project-hash': 'old0000',
        },
      },
    ];
    const result = await learn(
      {
        skillsRegistry: createMockRegistry(skills),
        workspaceRoot: '/test',
        llm,
        isNonInteractive: true,
      },
      ['update'],
    );

    // Should not crash, should report failure
    expect(result).toBeDefined();
    expect(result).toContain('Failed to regenerate');
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('handles file write error gracefully', async () => {
    const generatedSkill = JSON.stringify({
      name: 'write-fail-skill',
      description: 'Will fail on write',
      allowedTools: [],
      body: '# Write Fail\n\nContent.',
    });
    const llm = createMockLLM(generatedSkill);
    mockWriteFile.mockRejectedValue(new Error('EACCES'));

    const skills = [
      {
        name: 'write-fail-skill',
        description: 'Test',
        body: '# Old',
        path: '/test/.autohand/skills/write-fail-skill/SKILL.md',
        source: 'autohand-user',
        isActive: false,
        metadata: {
          'agentskill-source': 'llm-generated',
          'agentskill-project-hash': 'old0000',
        },
      },
    ];
    const result = await learn(
      {
        skillsRegistry: createMockRegistry(skills),
        workspaceRoot: '/test',
        llm,
        isNonInteractive: true,
      },
      ['update'],
    );

    expect(result).toContain('Failed to write');
    expect(result).not.toContain('Updated 1');
  });

  it('handles mixed skills — some up-to-date, some stale', async () => {
    const generatedSkill = JSON.stringify({
      name: 'stale-skill',
      description: 'Regenerated',
      allowedTools: [],
      body: '# Regenerated\n\nNew.',
    });
    const llm = createMockLLM(generatedSkill);

    const skills = [
      {
        name: 'fresh-skill',
        description: 'Already up-to-date',
        body: '# Fresh',
        path: '/test/.autohand/skills/fresh-skill/SKILL.md',
        source: 'autohand-user',
        isActive: false,
        metadata: {
          'agentskill-source': 'llm-generated',
          'agentskill-project-hash': CURRENT_HASH,
        },
      },
      {
        name: 'stale-skill',
        description: 'Needs update',
        body: '# Stale',
        path: '/test/.autohand/skills/stale-skill/SKILL.md',
        source: 'autohand-user',
        isActive: false,
        metadata: {
          'agentskill-source': 'llm-generated',
          'agentskill-project-hash': 'old0000',
        },
      },
      {
        name: 'manual-skill',
        description: 'Not generated',
        body: '# Manual',
        path: '/test/.autohand/skills/manual-skill/SKILL.md',
        source: 'autohand-user',
        isActive: false,
        metadata: {},
      },
    ];
    const result = await learn(
      {
        skillsRegistry: createMockRegistry(skills),
        workspaceRoot: '/test',
        llm,
        isNonInteractive: true,
      },
      ['update'],
    );

    // Only the stale skill should trigger LLM call
    expect(llm.complete).toHaveBeenCalledTimes(1);
    expect(result).toContain('Updated 1 skill');
    expect(result).toContain('1 skill already up to date');
  });

  it('handles skill with no metadata gracefully (filtered out)', async () => {
    const llm = createMockLLM('{}');
    const skills = [
      {
        name: 'no-meta-skill',
        description: 'No metadata at all',
        body: '# No Meta',
        path: '/test/.autohand/skills/no-meta-skill/SKILL.md',
        source: 'autohand-user',
        isActive: false,
        // No metadata field at all
      },
    ];
    const result = await learn(
      {
        skillsRegistry: createMockRegistry(skills),
        workspaceRoot: '/test',
        llm,
        isNonInteractive: true,
      },
      ['update'],
    );

    expect(result).toContain('No LLM-generated skills');
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('includes allowed-tools in regenerated frontmatter', async () => {
    const generatedSkill = JSON.stringify({
      name: 'tool-skill',
      description: 'Has tools',
      allowedTools: ['read_file', 'write_file', 'run_command'],
      body: '# Tool Skill\n\nWith tools.',
    });
    const llm = createMockLLM(generatedSkill);

    const skills = [
      {
        name: 'tool-skill',
        description: 'Old',
        body: '# Old',
        path: '/test/.autohand/skills/tool-skill/SKILL.md',
        source: 'autohand-user',
        isActive: false,
        metadata: {
          'agentskill-source': 'llm-generated',
          'agentskill-project-hash': 'old0000',
        },
      },
    ];
    await learn(
      {
        skillsRegistry: createMockRegistry(skills),
        workspaceRoot: '/test',
        llm,
        isNonInteractive: true,
      },
      ['update'],
    );

    expect(mockWriteFile).toHaveBeenCalled();
    const writtenContent = mockWriteFile.mock.calls[0]?.[1] as string;
    expect(writtenContent).toContain('allowed-tools: read_file write_file run_command');
  });

  it('reports correct pluralization for multiple updates', async () => {
    const generatedSkill = JSON.stringify({
      name: 'multi-skill',
      description: 'Multi',
      allowedTools: [],
      body: '# Multi\n\nContent.',
    });
    const llm = createMockLLM(generatedSkill);

    const skills = [
      {
        name: 'skill-a',
        description: 'A',
        body: '# A',
        path: '/test/.autohand/skills/skill-a/SKILL.md',
        source: 'autohand-user',
        isActive: false,
        metadata: {
          'agentskill-source': 'llm-generated',
          'agentskill-project-hash': 'old0000',
        },
      },
      {
        name: 'skill-b',
        description: 'B',
        body: '# B',
        path: '/test/.autohand/skills/skill-b/SKILL.md',
        source: 'autohand-user',
        isActive: false,
        metadata: {
          'agentskill-source': 'llm-generated',
          'agentskill-project-hash': 'old1111',
        },
      },
    ];
    const result = await learn(
      {
        skillsRegistry: createMockRegistry(skills),
        workspaceRoot: '/test',
        llm,
        isNonInteractive: true,
      },
      ['update'],
    );

    expect(llm.complete).toHaveBeenCalledTimes(2);
    expect(result).toContain('Updated 2 skills');
  });
});
