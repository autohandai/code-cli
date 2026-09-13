/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { SubAgentSkills } from '../../../src/core/agents/subAgentSkills.js';
import type { SkillDefinition } from '../../../src/skills/types.js';

function skill(name: string, body: string): SkillDefinition {
  return { name, description: `${name} description`, body, path: `/skills/${name}/SKILL.md`, source: 'builtin', isActive: false };
}

const registry = {
  skills: [skill('systematic-debugging', '# Debug\nReproduce first.'), skill('pull-request-review', '# Review\nRead the diff.')],
  listSkills() { return this.skills; },
  getSkill(name: string) { return this.skills.find((entry) => entry.name === name) ?? null; },
  findSimilar(query: string) { return this.skills.filter((entry) => entry.name.includes(query.slice(0, 4))).map((entry) => ({ skill: entry })); },
};

describe('SubAgentSkills', () => {
  it('activates declared skills up front and lists the rest as available', () => {
    const skills = new SubAgentSkills(registry, ['systematic-debugging', 'unknown-skill']);
    expect(skills.missingDeclared(['systematic-debugging', 'unknown-skill'])).toEqual(['unknown-skill']);
    const prompt = skills.buildPrompt();
    expect(prompt.startsWith('<!-- subagent-skills -->\n')).toBe(true);
    expect(prompt).toContain('## Active Skills');
    expect(prompt).toContain('### Skill: systematic-debugging\n# Debug\nReproduce first.');
    expect(prompt).toContain('## Available Skills');
    expect(prompt).toContain('- **pull-request-review**: pull-request-review description');
    expect(prompt).not.toContain('- **systematic-debugging**');
  });

  it('keeps activation local: activate returns the body, deactivate removes it, unknown names suggest', () => {
    const skills = new SubAgentSkills(registry);
    expect(skills.buildPrompt()).not.toContain('## Active Skills');

    const activated = skills.handle({ type: 'skill', command: 'activate', name: 'pull-request-review' });
    expect(activated).toMatchObject({ success: true, output: 'Activated skill: pull-request-review\n\n# Review\nRead the diff.' });
    expect(skills.activeSkills().map((entry) => entry.name)).toEqual(['pull-request-review']);
    expect(registry.getSkill('pull-request-review')?.isActive).toBe(false);

    expect(skills.handle({ type: 'skill', command: 'activate', name: 'pull-request-review' }).output).toContain('Skill already active');
    expect(JSON.parse(skills.handle({ type: 'skill', command: 'list' }).output ?? '[]')).toEqual([
      { name: 'systematic-debugging', description: 'systematic-debugging description', source: 'builtin', active: false },
      { name: 'pull-request-review', description: 'pull-request-review description', source: 'builtin', active: true },
    ]);
    expect(skills.handle({ type: 'skill', command: 'deactivate', name: 'pull-request-review' })).toMatchObject({ success: true, output: 'Deactivated skill: pull-request-review' });
    expect(skills.handle({ type: 'skill', command: 'info', name: 'systematic-debugging' }).output).toContain('"active": false');
    expect(skills.handle({ type: 'skill', command: 'activate', name: 'systematic' })).toMatchObject({ success: false, error: expect.stringContaining('Did you mean: systematic-debugging') });
    expect(() => skills.handle({ type: 'skill', command: 'activate' })).toThrow('requires a "name"');
  });
});
