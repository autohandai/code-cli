/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Skills inside delegated agents. The lead keeps one global activation state;
 * a sub-agent keeps its own, so a reviewer activating a skill does not change
 * what the lead or a sibling sees.
 */
import type { AgentAction, ToolActionOutcome } from '../../types.js';
import type { SkillDefinition } from '../../skills/types.js';

export interface SubAgentSkillsRegistry {
  listSkills(): SkillDefinition[];
  getSkill(name: string): SkillDefinition | null;
  findSimilar?(query: string, threshold?: number): Array<{ skill: SkillDefinition }>;
}

type SkillAction = Extract<AgentAction, { type: 'skill' }>;

/** Marker that lets the prompt section be replaced in place before each request. */
export const SUBAGENT_SKILLS_PROMPT_KEY = '<!-- subagent-skills -->';

export class SubAgentSkills {
  private readonly active = new Set<string>();

  constructor(
    private readonly registry: SubAgentSkillsRegistry,
    declared: readonly string[] = [],
  ) {
    for (const name of declared) {
      if (this.registry.getSkill(name)) this.active.add(name);
    }
  }

  /** Names declared by the agent that the registry does not know. */
  missingDeclared(declared: readonly string[]): string[] {
    return declared.filter((name) => !this.registry.getSkill(name));
  }

  activeSkills(): SkillDefinition[] {
    return [...this.active]
      .map((name) => this.registry.getSkill(name))
      .filter((skill): skill is SkillDefinition => skill !== null);
  }

  /**
   * System prompt section: active skill bodies first, then the catalogue.
   * Rebuilt before every request so a deactivated skill leaves the prompt.
   */
  buildPrompt(options: { canActivate?: boolean } = {}): string {
    const canActivate = options.canActivate ?? true;
    const parts: string[] = [SUBAGENT_SKILLS_PROMPT_KEY];
    const active = this.activeSkills();
    if (active.length > 0) {
      parts.push('## Active Skills', 'These skills apply to your task. Follow them.');
      for (const skill of active) parts.push('', `### Skill: ${skill.name}`, skill.body.trim());
    }
    // Without the skill tool the agent cannot activate anything, so the
    // catalogue would only invite calls that fail.
    const others = canActivate ? this.registry.listSkills().filter((skill) => !this.active.has(skill.name)) : [];
    if (others.length > 0) {
      if (active.length > 0) parts.push('');
      parts.push('## Available Skills', 'Activate one with the `skill` tool when it matches your task; its instructions are returned to you.');
      for (const skill of others) parts.push(`- **${skill.name}**: ${skill.description}`);
    }
    if (active.length === 0 && others.length === 0) parts.push('## Skills', canActivate ? 'No skills are installed.' : 'No skills are active.');
    return parts.join('\n');
  }

  handle(action: SkillAction): ToolActionOutcome {
    if (action.command === 'list') {
      const skills = this.registry.listSkills().map((skill) => ({
        name: skill.name, description: skill.description, source: skill.source, active: this.active.has(skill.name),
      }));
      return { success: true, output: JSON.stringify(skills, null, 2) };
    }
    const name = action.name?.trim();
    if (!name) throw new Error(`skill ${action.command} requires a "name" argument.`);
    const skill = this.registry.getSkill(name);
    if (!skill) {
      const similar = (this.registry.findSimilar?.(name, 0.2) ?? []).slice(0, 3).map((match) => match.skill.name);
      const error = `Skill "${name}" not found.${similar.length ? `\nDid you mean: ${similar.join(', ')}` : ''}`;
      return { success: false, kind: 'validation', error };
    }
    if (action.command === 'info') {
      return { success: true, output: JSON.stringify({
        name: skill.name, description: skill.description, source: skill.source, path: skill.path, active: this.active.has(name),
      }, null, 2) };
    }
    if (action.command === 'activate') {
      const already = this.active.has(name);
      this.active.add(name);
      return { success: true, output: `${already ? 'Skill already active' : 'Activated skill'}: ${name}\n\n${skill.body.trim()}` };
    }
    if (action.command === 'deactivate') {
      const removed = this.active.delete(name);
      return { success: true, output: removed ? `Deactivated skill: ${name}` : `Skill "${name}" is not active.` };
    }
    throw new Error(`Unsupported skill command: ${action.command}`);
  }
}
