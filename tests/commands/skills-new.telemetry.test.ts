/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSkill } from '../../src/commands/skills-new.js';

const mocks = vi.hoisted(() => ({
  safePrompt: vi.fn(),
  ensureDir: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('../../src/utils/prompt.js', () => ({
  safePrompt: mocks.safePrompt,
}));

vi.mock('fs-extra', () => ({
  default: {
    ensureDir: mocks.ensureDir,
    writeFile: mocks.writeFile,
  },
}));

describe('/skills new telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureDir.mockResolvedValue(undefined);
    mocks.writeFile.mockResolvedValue(undefined);
  });

  it('tracks a successfully saved project skill', async () => {
    mocks.safePrompt
      .mockResolvedValueOnce({ name: 'review-evidence', description: 'Review evidence rigorously' })
      .mockResolvedValueOnce({ level: 'project' })
      .mockResolvedValueOnce({ confirm: true })
      .mockResolvedValueOnce({ activate: false });
    const trackSkillEvent = vi.fn();
    const skillsRegistry = {
      hasSkill: vi.fn(() => false),
      findSimilar: vi.fn(() => []),
      saveSkill: vi.fn(async () => true),
      trackSkillEvent,
      activateSkill: vi.fn(),
    };
    const llm = {
      complete: vi.fn(async () => ({
        content: '---\nname: review-evidence\ndescription: Review evidence rigorously\n---\n\n# Review evidence',
      })),
    };

    await expect(createSkill({
      llm: llm as never,
      skillsRegistry: skillsRegistry as never,
      workspaceRoot: '/workspace',
    })).resolves.toBe('Created new skill: review-evidence');

    expect(trackSkillEvent).toHaveBeenCalledWith({
      skillName: 'review-evidence',
      source: 'autohand-project',
      activationType: 'explicit',
      action: 'install',
    });
  });
});
