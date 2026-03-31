/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('AutohandAgent skill and sleep tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists available skills with active state', async () => {
    const { AutohandAgent } = await import('../../src/core/agent.js');
    const agent = Object.create(AutohandAgent.prototype) as any;

    agent.skillsRegistry = {
      listSkills: vi.fn().mockReturnValue([
        { name: 'reviewer', description: 'Review code', source: 'autohand-user', isActive: true },
        { name: 'perf-audit', description: 'Audit performance', source: 'community', isActive: false },
      ]),
    };

    const result = agent.handleSkillTool({ command: 'list' });
    const parsed = JSON.parse(result);

    expect(parsed).toEqual([
      {
        name: 'reviewer',
        description: 'Review code',
        source: 'autohand-user',
        active: true,
      },
      {
        name: 'perf-audit',
        description: 'Audit performance',
        source: 'community',
        active: false,
      },
    ]);
  });

  it('activates a skill by name', async () => {
    const { AutohandAgent } = await import('../../src/core/agent.js');
    const agent = Object.create(AutohandAgent.prototype) as any;

    agent.skillsRegistry = {
      getSkill: vi.fn().mockReturnValue({
        name: 'reviewer',
        description: 'Review code',
        source: 'autohand-user',
        isActive: false,
      }),
      activateSkill: vi.fn().mockReturnValue(true),
      findSimilar: vi.fn().mockReturnValue([]),
    };

    const result = agent.handleSkillTool({ command: 'activate', name: 'reviewer' });

    expect(agent.skillsRegistry.activateSkill).toHaveBeenCalledWith('reviewer');
    expect(result).toContain('Activated skill: reviewer');
  });

  it('sleeps for the requested duration and returns a summary', async () => {
    const { AutohandAgent } = await import('../../src/core/agent.js');
    const agent = Object.create(AutohandAgent.prototype) as any;
    agent.sleep = vi.fn().mockResolvedValue(undefined);

    const result = await agent.executeSleepTool(2, 'wait for service restart');

    expect(agent.sleep).toHaveBeenCalledWith(2000);
    expect(result).toContain('Slept for 2 second');
    expect(result).toContain('wait for service restart');
  });
});
