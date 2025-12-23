/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Skills Module - Agent Skills standard implementation
 * Skills are instruction packages (workflows, guides) that provide specialized
 * instructions to the agent, similar to on-demand AGENTS.md files.
 */

// Types
export type {
  SkillSource,
  SkillActivationType,
  SkillFrontmatter,
  SkillDefinition,
  SkillParseResult,
  SkillSimilarityMatch,
  SkillUseData,
  SkillValidationResult,
  SkillCopyResult,
} from './types.js';

export {
  SKILL_CONSTRAINTS,
  isValidSkillName,
  validateSkillFrontmatter,
} from './types.js';

// Parser
export { SkillParser } from './SkillParser.js';
export type { FrontmatterExtraction } from './SkillParser.js';

// Registry
export { SkillsRegistry } from './SkillsRegistry.js';
export type { SkillImportResult } from './SkillsRegistry.js';

// Auto-skill generation
export {
  ProjectAnalyzer,
  generateAutoSkills,
  runAutoSkillGeneration,
  AVAILABLE_TOOLS,
  getAllTools,
  getToolsByCategory,
} from './autoSkill.js';
export type {
  ProjectAnalysis,
  GeneratedSkill,
  AutoSkillResult,
} from './autoSkill.js';

// Community skills
export { CommunitySkillsClient } from './CommunitySkillsClient.js';
export type {
  CommunitySkillsConfig,
  CommunitySkillPackage,
  SkillFilters,
  SkillSuggestion,
  BackupPayload,
  BackupEntry,
  SkillSubmission,
} from './CommunitySkillsClient.js';
