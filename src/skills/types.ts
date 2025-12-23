/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Skills Types - Agent Skills standard implementation
 * Skills are instruction packages (workflows, guides) that provide specialized
 * instructions to the agent, similar to on-demand AGENTS.md files.
 */

/**
 * Source locations where skills can be found, in order of precedence.
 * Later sources win on collision.
 */
export type SkillSource =
  | 'codex-user'       // ~/.codex/skills/**/SKILL.md (recursive)
  | 'codex-project'    // <cwd>/.codex/skills/**/SKILL.md (recursive)
  | 'claude-user'      // ~/.claude/skills/*/SKILL.md (one level)
  | 'claude-project'   // <cwd>/.claude/skills/*/SKILL.md (one level)
  | 'autohand-user'    // ~/.autohand/skills/**/SKILL.md (recursive)
  | 'autohand-project' // <cwd>/.autohand/skills/**/SKILL.md (recursive)
  | 'community';       // Downloaded from community API

/**
 * Activation type for skill usage tracking
 */
export type SkillActivationType = 'auto' | 'explicit';

/**
 * Skill frontmatter parsed from SKILL.md YAML header
 */
export interface SkillFrontmatter {
  /** Required: Skill name, max 64 chars, a-z/0-9/hyphens only */
  name: string;
  /** Required: Description of what the skill does, max 1024 chars */
  description: string;
  /** Optional: License identifier (e.g., MIT, Apache-2.0) */
  license?: string;
  /** Optional: Compatibility notes, max 500 chars */
  compatibility?: string;
  /** Optional: Additional metadata as key-value pairs */
  metadata?: Record<string, string>;
  /** Optional: Space-delimited list of allowed tools for this skill */
  'allowed-tools'?: string;
}

/**
 * Full skill definition including parsed content and source information
 */
export interface SkillDefinition extends SkillFrontmatter {
  /** Full markdown body content (after frontmatter) */
  body: string;
  /** Absolute path to the source SKILL.md file */
  path: string;
  /** Where this skill was loaded from */
  source: SkillSource;
  /** Whether this skill is currently active in the session */
  isActive: boolean;
}

/**
 * Result of parsing a SKILL.md file
 */
export interface SkillParseResult {
  success: boolean;
  skill?: SkillDefinition;
  error?: string;
}

/**
 * Similarity match result for skill deduplication
 */
export interface SkillSimilarityMatch {
  skill: SkillDefinition;
  score: number;
}

/**
 * Skill telemetry event data
 */
export interface SkillUseData {
  skillName: string;
  source: SkillSource;
  activationType: SkillActivationType;
}

/**
 * Result of skill auto-copy operation
 */
export interface SkillCopyResult {
  /** Number of skills successfully copied */
  copiedCount: number;
  /** Number of skills skipped (already exist) */
  skippedCount: number;
  /** Number of skills that failed to copy */
  errorCount: number;
  /** Names of skills that were copied */
  copiedSkills: string[];
  /** Names of skills that were skipped */
  skippedSkills: string[];
}

/**
 * Validation result for skill frontmatter
 */
export interface SkillValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Constants for skill validation
 */
export const SKILL_CONSTRAINTS = {
  NAME_MAX_LENGTH: 64,
  NAME_PATTERN: /^[a-z0-9-]+$/,
  DESCRIPTION_MAX_LENGTH: 1024,
  COMPATIBILITY_MAX_LENGTH: 500,
} as const;

/**
 * Validates skill name format
 */
export function isValidSkillName(name: string): boolean {
  if (!name || typeof name !== 'string') return false;
  if (name.length > SKILL_CONSTRAINTS.NAME_MAX_LENGTH) return false;
  return SKILL_CONSTRAINTS.NAME_PATTERN.test(name);
}

/**
 * Validates skill frontmatter
 */
export function validateSkillFrontmatter(frontmatter: Partial<SkillFrontmatter>): SkillValidationResult {
  const errors: string[] = [];

  // Required: name
  if (!frontmatter.name) {
    errors.push('Missing required field: name');
  } else if (!isValidSkillName(frontmatter.name)) {
    errors.push(`Invalid name: must be 1-${SKILL_CONSTRAINTS.NAME_MAX_LENGTH} chars, lowercase alphanumeric with hyphens only`);
  }

  // Required: description
  if (!frontmatter.description) {
    errors.push('Missing required field: description');
  } else if (frontmatter.description.length > SKILL_CONSTRAINTS.DESCRIPTION_MAX_LENGTH) {
    errors.push(`Description exceeds ${SKILL_CONSTRAINTS.DESCRIPTION_MAX_LENGTH} characters`);
  }

  // Optional: compatibility length check
  if (frontmatter.compatibility && frontmatter.compatibility.length > SKILL_CONSTRAINTS.COMPATIBILITY_MAX_LENGTH) {
    errors.push(`Compatibility exceeds ${SKILL_CONSTRAINTS.COMPATIBILITY_MAX_LENGTH} characters`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
