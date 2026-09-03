/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  SpecialistExecutionMode,
  SpecialistRequest,
} from './SpecialistOrchestrator.js';
import type { ProjectProfile, SignalType } from '../teams/types.js';

/**
 * Capability taxonomy for task-aware sub-agent discovery.
 *
 * Each capability maps task-language triggers and repository affinity signals
 * to a specialist role. `aliases` mirror the role table in
 * SpecialistOrchestrator so explicit role extraction stays consistent; the
 * taxonomy adds `triggers` (task-language patterns) and `repoAffinity`
 * (profile signals/structure/languages/frameworks that boost the capability).
 */
export interface CapabilityRepoAffinity {
  signals?: SignalType[];
  structure?: { hasDocs?: boolean; hasTests?: boolean; hasCI?: boolean };
  languages?: string[];
  frameworks?: string[];
}

export interface CapabilityDefinition {
  id: string;
  label: string;
  aliases: string[];
  triggers: RegExp[];
  repoAffinity: CapabilityRepoAffinity;
  preferredAgents: string[];
}

export const CAPABILITY_DEFINITIONS: readonly CapabilityDefinition[] = [
  {
    id: 'testing',
    label: 'Testing',
    aliases: ['tester', 'testing', 'test'],
    triggers: [
      /\b(write|add|create|fix|run)\s+tests?\b/i,
      /\btest\s+coverage\b/i,
    ],
    repoAffinity: { signals: ['missing-tests'] },
    preferredAgents: ['tester'],
  },
  {
    id: 'security',
    label: 'Security',
    aliases: ['security', 'security audit', 'threat model'],
    triggers: [
      /\b(harden(?:ing)?|auth(?:entication|orization)?|vulnerab\w*|threat\w*|exploit\w*|penetration|security)\b/i,
    ],
    repoAffinity: { signals: ['security-concern'] },
    preferredAgents: ['security-auditor'],
  },
  {
    id: 'docs-writer',
    label: 'Documentation',
    aliases: ['docs writer', 'documentation', 'docs'],
    triggers: [
      /\b(document(?:ation)?|docs?|readme)\b/i,
    ],
    repoAffinity: { signals: ['missing-docs'] },
    preferredAgents: ['docs-writer'],
  },
  {
    id: 'code-cleaner',
    label: 'Code cleanup',
    aliases: ['code cleaner', 'cleanup', 'clean up'],
    triggers: [
      /\b(refactor\w*|clean\s+up|dead\s+code|unused\s+\w+|redundant\w*|duplicate\w*)\b/i,
    ],
    repoAffinity: { signals: ['dead-code', 'lint-issues'] },
    preferredAgents: ['code-cleaner'],
  },
  {
    id: 'planner',
    label: 'Planning',
    aliases: ['planner', 'planning', 'architecture'],
    triggers: [
      /\b(plan(?:ning)?|sequence\w*|architecture\w*|roadmap|break\s+down)\b/i,
    ],
    repoAffinity: {},
    preferredAgents: ['planner'],
  },
  {
    id: 'debugger',
    label: 'Debugging',
    aliases: ['debugger', 'debugging', 'diagnosis'],
    triggers: [
      /\b(reproduce\w*|diagnos\w*|debug\w*|stack\s+trace|crash\w*|segfault|hang\w*)\b/i,
    ],
    repoAffinity: {},
    preferredAgents: ['debugger'],
  },
  {
    id: 'review',
    label: 'Review',
    aliases: ['reviewer', 'review'],
    triggers: [
      /\b(review\w*|audit\w*|code\s+review|pr\s+review)\b/i,
    ],
    repoAffinity: {},
    preferredAgents: ['reviewer'],
  },
  {
    id: 'research',
    label: 'Research',
    aliases: ['researcher', 'research'],
    triggers: [
      /\b(research\w*|investigate\w*|explore\w*|deep\s+dive|literature)\b/i,
    ],
    repoAffinity: {},
    preferredAgents: ['researcher'],
  },
  {
    id: 'release-readiness',
    label: 'Release readiness',
    aliases: ['release readiness', 'release', 'packaging'],
    triggers: [
      /\b(release\w*|package\w*|ship\w*|version\w*|changelog|publish\w*|deploy\w*)\b/i,
    ],
    repoAffinity: { signals: ['stale-deps'], structure: { hasCI: false } },
    preferredAgents: ['release-readiness'],
  },
  {
    id: 'todo-resolver',
    label: 'Todo resolution',
    aliases: ['todo resolver', 'todo'],
    triggers: [
      /\b(todo\w*|fixme|hack|unfinished|leftover)\b/i,
    ],
    repoAffinity: { signals: ['todo'] },
    preferredAgents: ['todo-resolver'],
  },
  {
    id: 'ui',
    label: 'UI',
    aliases: ['ui', 'user interface', 'interface design'],
    triggers: [
      /\b(ui|user\s+interface|interface\s+design|frontend|front-end)\b/i,
    ],
    repoAffinity: { frameworks: ['react', 'vue', 'angular', 'next', 'ink', 'swiftui', 'flutter'] },
    preferredAgents: ['ui-designer', 'frontend-designer'],
  },
  {
    id: 'ux',
    label: 'UX',
    aliases: ['ux', 'user experience', 'experience design'],
    triggers: [
      /\b(ux|user\s+experience|experience\s+design)\b/i,
    ],
    repoAffinity: { frameworks: ['react', 'vue', 'angular', 'next'] },
    preferredAgents: ['ux-researcher', 'ux-designer'],
  },
  {
    id: 'product-interviewer',
    label: 'Product interview',
    aliases: ['product interviewer', 'product interview', 'requirements interviewer'],
    triggers: [
      /\b(interview\w*|requirements\s+gathering|product\s+discovery)\b/i,
    ],
    repoAffinity: {},
    preferredAgents: ['product-interviewer'],
  },
] as const;

const EXPLICIT_ORCHESTRATION = /\b(bring|assemble|form|create|use|run|ask|have|need|spin\s+up)\b/i;
const ORCHESTRATION_NOUN = /\b(teams?|specialists?|agents?)\b/i;
const MUTATING_OBJECTIVE = /\b(implement|fix|change|modify|edit|write|create|delete|remove|refactor|migrate|upgrade|install)\b/i;

function aliasMatchIndex(input: string, alias: string): number {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const match = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i').exec(input);
  return match?.index ?? -1;
}

/**
 * Extract explicit role names from the instruction: known capability aliases
 * (position-ordered) plus unknown hyphenated role-like tokens when the
 * instruction uses orchestration phrasing. Unknown roles are preserved so the
 * caller can surface them as unresolved rather than silently dropping them.
 */
function extractExplicitRoles(instruction: string): string[] {
  const candidates: Array<{ role: string; index: number }> = [];
  for (const capability of CAPABILITY_DEFINITIONS) {
    const index = Math.min(
      ...capability.aliases.map((alias) => aliasMatchIndex(instruction, alias)).filter((i) => i >= 0),
    );
    if (Number.isFinite(index)) candidates.push({ role: capability.id, index });
  }

  if (EXPLICIT_ORCHESTRATION.test(instruction) && ORCHESTRATION_NOUN.test(instruction)) {
    for (const match of instruction.matchAll(/[a-z][a-z0-9]*(?:-[a-z0-9]+)+/gi)) {
      const role = match[0].toLowerCase();
      if (!candidates.some((candidate) => candidate.role === role)) {
        candidates.push({ role, index: match.index ?? 0 });
      }
    }
  }

  return candidates.sort((left, right) => left.index - right.index).map((candidate) => candidate.role);
}

/** Infer capabilities whose task-language triggers appear in the instruction, ordered by first match. */
function inferCapabilities(instruction: string): string[] {
  const matches: Array<{ id: string; index: number }> = [];
  for (const capability of CAPABILITY_DEFINITIONS) {
    let firstIndex = -1;
    for (const trigger of capability.triggers) {
      const match = trigger.exec(instruction);
      if (match && (firstIndex === -1 || match.index < firstIndex)) {
        firstIndex = match.index;
      }
    }
    if (firstIndex >= 0) matches.push({ id: capability.id, index: firstIndex });
  }
  return matches.sort((left, right) => left.index - right.index).map((match) => match.id);
}

/** Infer capabilities whose repo affinity matches the active project profile. */
function inferRepoAffinity(profile: ProjectProfile): string[] {
  const signalTypes = new Set(profile.signals.map((signal) => signal.type));
  const languages = new Set(profile.languages);
  const frameworks = new Set(profile.frameworks);
  const boosted: string[] = [];

  for (const capability of CAPABILITY_DEFINITIONS) {
    const affinity = capability.repoAffinity;
    const signalMatch = affinity.signals?.some((signal) => signalTypes.has(signal)) ?? false;
    const languageMatch = affinity.languages?.some((language) => languages.has(language)) ?? false;
    const frameworkMatch = affinity.frameworks?.some((framework) => frameworks.has(framework)) ?? false;
    const structureMatch = affinity.structure
      ? (affinity.structure.hasDocs !== undefined && affinity.structure.hasDocs === profile.structure.hasDocs)
        || (affinity.structure.hasTests !== undefined && affinity.structure.hasTests === profile.structure.hasTests)
        || (affinity.structure.hasCI !== undefined && affinity.structure.hasCI === profile.structure.hasCI)
      : false;
    if (signalMatch || languageMatch || frameworkMatch || structureMatch) {
      boosted.push(capability.id);
    }
  }
  return boosted;
}

function executionModeFor(objective: string, roles: string[]): SpecialistExecutionMode {
  if (roles.length === 1 && roles[0] === 'product-interviewer') return 'interview';
  if (roles.length > 1 && !MUTATING_OBJECTIVE.test(objective)) return 'parallel';
  return 'serial';
}

/**
 * Analyze a task instruction into a SpecialistRequest by unioning explicit
 * role names with trigger-inferred capabilities and repo-affinity boosts.
 * Deduped and order-preserving: explicit roles first, then inferred
 * capabilities by first trigger position, then repo-affinity boosts.
 */
export function analyzeTask(
  instruction: string,
  profile?: ProjectProfile,
): SpecialistRequest {
  const explicit = extractExplicitRoles(instruction);
  const inferred = inferCapabilities(instruction);
  const boosted = profile ? inferRepoAffinity(profile) : [];
  const roles = [...new Set([...explicit, ...inferred, ...boosted])];

  return {
    objective: instruction.trim(),
    requestedRoles: roles,
    source: 'intent',
    executionMode: executionModeFor(instruction, roles),
  };
}