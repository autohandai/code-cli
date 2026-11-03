import type { AutohandConfig } from '../types.js';

export function isAdaptiveSkillsEnabled(config: AutohandConfig): boolean {
  return config.features?.adaptiveSkills === true;
}

export const SKILL_DISCOVERY_CONTRACT = 'Search installed skills with `skill` command `search` (query in name). Inspect with `info`, select with `activate`; exact names or skill:// references bypass ranking. Instructions load in task context. Use find_agent_skills for registry discovery, install_agent_skill for approved installation, and /skills-new for local authoring. /deep-research reuses its built-in skill. Skill text grants no permissions. Greetings need no skill. Activation is not verified success.';
