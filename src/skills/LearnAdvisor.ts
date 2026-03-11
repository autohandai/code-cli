/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * LearnAdvisor — LLM orchestration for the /learn command.
 *
 * Phase 1 (`analyze`):  Analyze the project, audit installed skills,
 *                       and rank community catalog entries by relevance.
 *
 * Phase 2 (`generateSkill`): When no catalog skill scores well, generate
 *                            a custom skill tailored to the project.
 *
 * This class does NO file I/O, registry fetching, or skill installation.
 * It only calls the LLM and parses structured JSON responses.
 */

import type { LLMProvider } from '../providers/LLMProvider.js';
import type { ProjectAnalysis } from './autoSkill.js';
import type { SkillDefinition } from './types.js';
import type {
  GitHubCommunitySkill,
  LearnAnalysisResponse,
  LearnAuditEntry,
  LearnGeneratedSkill,
  LearnRecommendation,
} from '../types.js';
import {
  buildLearnSystemPrompt,
  buildLearnUserPrompt,
  buildLearnGenerationSystemPrompt,
  buildLearnGenerationUserPrompt,
} from './learnPrompts.js';

/** Kebab-case pattern: lowercase letters, digits, and hyphens only */
const KEBAB_CASE_RE = /^[a-z0-9-]+$/;

/**
 * Normalize a name to kebab-case. LLMs frequently produce names like
 * "My_Skill Name" or "TypeScript Testing" — convert instead of rejecting.
 * Returns empty string if the input has no usable alphanumeric chars.
 */
function toKebabCase(name: string): string {
  return name
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1-$2')   // camelCase → camel-Case
    .replace(/[\s_]+/g, '-')                 // spaces/underscores → hyphens
    .replace(/[^a-zA-Z0-9-]/g, '')           // strip non-alphanumeric
    .replace(/-+/g, '-')                     // collapse multiple hyphens
    .replace(/^-|-$/g, '')                   // trim leading/trailing hyphens
    .toLowerCase();
}

/** Valid audit statuses */
const VALID_AUDIT_STATUSES = new Set<string>(['redundant', 'outdated', 'conflicting']);

/**
 * LLM-powered advisor for the `/learn` command.
 *
 * Accepts an `LLMProvider` at construction and exposes two pure analysis
 * methods that call the LLM, parse JSON, validate structure, and return
 * strongly-typed results (or safe fallbacks on error).
 */
export class LearnAdvisor {
  private readonly llm: LLMProvider;

  constructor(llm: LLMProvider) {
    this.llm = llm;
  }

  /* ── Phase 1: Analyze + rank + audit ──────────────────────── */

  /**
   * Analyze the project, audit installed skills, and rank registry catalog.
   *
   * Returns a validated `LearnAnalysisResponse`. On any error (LLM failure,
   * invalid JSON, malformed fields) returns a safe empty fallback.
   */
  async analyze(
    analysis: ProjectAnalysis,
    installedSkills: SkillDefinition[],
    registrySkills: GitHubCommunitySkill[],
  ): Promise<LearnAnalysisResponse> {
    const fallback: LearnAnalysisResponse = {
      projectSummary: '',
      audit: [],
      recommendations: [],
      gapAnalysis: null,
    };

    try {
      const response = await this.llm.complete({
        messages: [
          { role: 'system', content: buildLearnSystemPrompt() },
          { role: 'user', content: buildLearnUserPrompt(analysis, installedSkills, registrySkills) },
        ],
        maxTokens: 4000,
        temperature: 0.2,
      });

      const json = this.extractJson(response.content);
      if (json === null) return fallback;

      const parsed = JSON.parse(json) as Record<string, unknown>;

      const projectSummary =
        typeof parsed.projectSummary === 'string' ? parsed.projectSummary : '';

      const gapAnalysis =
        typeof parsed.gapAnalysis === 'string' ? parsed.gapAnalysis : null;

      const recommendations = Array.isArray(parsed.recommendations)
        ? (parsed.recommendations as unknown[]).filter(
            (r): r is LearnRecommendation => this.isValidRecommendation(r),
          )
        : [];

      const audit = Array.isArray(parsed.audit)
        ? (parsed.audit as unknown[]).filter(
            (e): e is LearnAuditEntry => this.isValidAuditEntry(e),
          )
        : [];

      return { projectSummary, audit, recommendations, gapAnalysis };
    } catch {
      return fallback;
    }
  }

  /* ── Phase 2: Generate custom skill ──────────────────────── */

  /**
   * Generate a custom skill when no catalog entry scores well.
   *
   * Returns a validated `LearnGeneratedSkill`. On error, returns an object
   * with `{ error: string }` describing what went wrong, or `null` if
   * the LLM call itself fails.
   */
  async generateSkill(
    analysis: ProjectAnalysis,
    gapAnalysis: string | null,
    lowScoringSkills: LearnRecommendation[],
  ): Promise<LearnGeneratedSkill | null> {
    try {
      const response = await this.llm.complete({
        messages: [
          { role: 'system', content: buildLearnGenerationSystemPrompt() },
          {
            role: 'user',
            content: buildLearnGenerationUserPrompt(analysis, gapAnalysis, lowScoringSkills),
          },
        ],
        maxTokens: 6000,
        temperature: 0.3,
      });

      const json = this.extractJson(response.content);
      if (json === null) return null;

      const parsed = JSON.parse(json) as Record<string, unknown>;

      // Validate required fields
      if (typeof parsed.name !== 'string') return null;
      if (typeof parsed.description !== 'string') return null;
      if (typeof parsed.body !== 'string') return null;

      // Normalize name to kebab-case instead of rejecting outright.
      // LLMs frequently return "My_Skill Name" style names.
      const normalizedName = toKebabCase(parsed.name);
      if (!normalizedName) return null;

      const allowedTools = Array.isArray(parsed.allowedTools)
        ? (parsed.allowedTools as unknown[]).filter((t): t is string => typeof t === 'string')
        : [];

      return {
        name: normalizedName,
        description: parsed.description,
        allowedTools,
        body: parsed.body,
      };
    } catch (error) {
      // Surface the error message so callers can report it to the user
      const msg = error instanceof Error ? error.message : String(error);
      if (process.env.DEBUG) {
        console.error(`[LearnAdvisor] generateSkill failed: ${msg}`);
      }
      return null;
    }
  }

  /* ── Private helpers ─────────────────────────────────────── */

  /**
   * Extract a JSON string from LLM output that may contain markdown
   * code fences or surrounding prose.
   *
   * Strategy:
   *  1. If content starts with `{` or `[`, return as-is (already JSON).
   *  2. Try extracting from ` ```json ... ``` ` blocks.
   *  3. Try finding `{...}` in the text via greedy regex.
   *  4. Return null if nothing found.
   */
  private extractJson(content: string): string | null {
    const trimmed = content.trim();

    // 1. Already looks like raw JSON
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return trimmed;
    }

    // 2. Fenced code block: ```json ... ```
    const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch?.[1]) {
      return fenceMatch[1].trim();
    }

    // 3. Bare object somewhere in the text
    const braceMatch = trimmed.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      return braceMatch[0];
    }

    return null;
  }

  /**
   * Validate that an unknown value looks like a `LearnRecommendation`.
   */
  private isValidRecommendation(rec: unknown): rec is LearnRecommendation {
    if (rec === null || typeof rec !== 'object') return false;
    const r = rec as Record<string, unknown>;
    return (
      typeof r.slug === 'string' &&
      typeof r.score === 'number' &&
      typeof r.reason === 'string'
    );
  }

  /**
   * Validate that an unknown value looks like a `LearnAuditEntry`.
   */
  private isValidAuditEntry(entry: unknown): entry is LearnAuditEntry {
    if (entry === null || typeof entry !== 'object') return false;
    const e = entry as Record<string, unknown>;
    return (
      typeof e.skill === 'string' &&
      typeof e.status === 'string' &&
      VALID_AUDIT_STATUSES.has(e.status) &&
      typeof e.reason === 'string'
    );
  }
}
