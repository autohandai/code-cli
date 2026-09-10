/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentDefinition, AgentRegistry } from './AgentRegistry.js';
import {
  rankSubAgentsCatalog,
} from '../../actions/subAgentsCatalog.js';
import {
  CAPABILITY_DEFINITIONS,
  type CapabilityDefinition,
} from './TaskAnalyzer.js';
import type {
  SelectedSpecialist,
  SpecialistCatalogAdapter,
  SpecialistRequest,
} from './SpecialistOrchestrator.js';
import type { ProjectProfile, ProjectSignal } from '../teams/types.js';

export interface ComposedTask {
  id: string;
  subject: string;
  description: string;
  agentName: string;
  blockedBy: string[];
}

export interface TeamComposition {
  objective: string;
  selectedAgents: SelectedSpecialist[];
  tasks: ComposedTask[];
  unresolvedRoles: string[];
  resolutionNotice?: string;
}

export interface TeamComposerOptions {
  registry: AgentRegistry;
  catalog?: SpecialistCatalogAdapter;
  profile?: ProjectProfile;
  maxTeammates?: number;
}

const SOURCE_PRIORITY: Readonly<Record<string, number>> = {
  session: 0,
  user: 1,
  catalog: 2,
  external: 1,
  'auto-generated': 1,
  extension: 3,
  builtin: 4,
};

function normalizeSearchText(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
}

function capabilityForRole(role: string): CapabilityDefinition | undefined {
  return CAPABILITY_DEFINITIONS.find((capability) => (
    capability.id === role
    || capability.aliases.some((alias) => alias === role)
  ));
}

function sourcePriority(agent: AgentDefinition): number {
  return SOURCE_PRIORITY[agent.source] ?? 4;
}

function signalTypes(profile: ProjectProfile | undefined): Set<ProjectSignal['type']> {
  return new Set(profile?.signals.map((signal) => signal.type) ?? []);
}

/**
 * Score a candidate agent for a task role, combining:
 * 1. Role fit: preferred-agent bonus + role/alias token overlap (mirrors
 *    SpecialistOrchestrator.scoreAgent).
 * 2. Repo affinity: profile signals, languages, and frameworks that match the
 *    capability's declared affinity.
 * 3. Tool coverage: agents whose tools include write tools for mutating tasks
 *    or read-only tools for inspection tasks.
 *
 * Deterministic and unit-testable; higher is better.
 */
export function scoreAgentForTask(
  agent: AgentDefinition,
  role: string,
  profile?: ProjectProfile,
  objective = '',
): number {
  const capability = capabilityForRole(role);
  const preferredIndex = capability?.preferredAgents.indexOf(agent.name) ?? -1;
  if (preferredIndex !== -1) return 10_000 - preferredIndex * 100;

  const roleTokens = new Set(normalizeSearchText(
    capability ? [capability.id, ...capability.aliases].join(' ') : role,
  ));
  const nameTokens = new Set(normalizeSearchText(agent.name));
  const descriptionTokens = new Set(normalizeSearchText(agent.description));
  let score = 0;
  for (const token of roleTokens) {
    if (nameTokens.has(token)) score += 100;
    if (descriptionTokens.has(token)) score += 10;
  }

  // Repo affinity: signals, languages, frameworks.
  if (profile && capability) {
    const signals = signalTypes(profile);
    if (capability.repoAffinity.signals?.some((signal) => signals.has(signal))) {
      score += 250;
    }
    if (capability.repoAffinity.languages?.some((language) => profile.languages.includes(language))) {
      score += 120;
    }
    if (capability.repoAffinity.frameworks?.some((framework) => profile.frameworks.includes(framework))) {
      score += 120;
    }
    if (capability.repoAffinity.structure?.hasCI === false && profile.structure.hasCI === false) {
      score += 80;
    }
  }

  // Tool coverage: write tools for mutating objectives, read tools otherwise.
  const mutating = /\b(implement|fix|change|modify|edit|write|create|delete|remove|refactor|migrate|upgrade|install)\b/i.test(objective);
  const writeTools = new Set(['write_file', 'apply_patch', 'search_replace', 'create_directory', 'run_command', 'shell']);
  const readTools = new Set(['read_file', 'fff_find', 'find_grep', 'list_tree', 'search']);
  const agentTools = new Set(agent.tools);
  if (mutating && [...writeTools].some((tool) => agentTools.has(tool))) score += 60;
  if (!mutating && [...readTools].some((tool) => agentTools.has(tool))) score += 30;

  return score;
}

function roleLabel(role: string): string {
  return capabilityForRole(role)?.label ?? role;
}

/**
 * Pure, testable team composition pipeline. No I/O except injected adapters.
 *
 * Given a SpecialistRequest (task + roles) and an optional ProjectProfile,
 * ranks candidate agents by role fit + repo affinity + tool coverage, selects
 * up to maxTeammates, decomposes the objective into phase-ordered tasks with
 * valid blockedBy edges, and surfaces unresolved roles for the catalog
 * fallback path.
 */
export class TeamComposer {
  private readonly registry: AgentRegistry;
  private readonly catalog?: SpecialistCatalogAdapter;
  private readonly profile?: ProjectProfile;
  private readonly maxTeammates: number;

  constructor(options: TeamComposerOptions) {
    this.registry = options.registry;
    this.catalog = options.catalog;
    this.profile = options.profile;
    this.maxTeammates = Math.max(1, Math.min(5, Math.floor(options.maxTeammates ?? 5)));
  }

  async compose(request: SpecialistRequest): Promise<TeamComposition> {
    await this.registry.loadAgents();
    const candidates = this.registry.getAllAgents();
    const usedAgents = new Set<string>();
    const selections: Array<SelectedSpecialist | undefined> = [];
    const unresolvedIndexes: number[] = [];

    for (const [index, requestedRole] of request.requestedRoles.entries()) {
      const capability = capabilityForRole(requestedRole);
      if (!capability) {
        unresolvedIndexes.push(index);
        continue;
      }

      const ranked = candidates
        .filter((agent) => !usedAgents.has(agent.name))
        .map((agent) => ({
          agent,
          score: scoreAgentForTask(agent, requestedRole, this.profile, request.objective),
        }))
        .filter((candidate) => candidate.score >= 20)
        .sort((left, right) => (
          sourcePriority(left.agent) - sourcePriority(right.agent)
          || right.score - left.score
          || left.agent.name.localeCompare(right.agent.name)
        ));
      const match = ranked[0];
      if (!match) {
        unresolvedIndexes.push(index);
        continue;
      }

      usedAgents.add(match.agent.name);
      selections[index] = {
        requestedRole,
        agentName: match.agent.name,
        source: match.agent.source,
        matchReason: this.matchReason(capability, match.agent, requestedRole),
      };
    }

    // Catalog fallback for locally unresolved roles (best-effort, offline-safe).
    if (unresolvedIndexes.length > 0 && this.catalog) {
      try {
        const catalogRegistry = await this.catalog.fetchRegistry();
        for (const index of unresolvedIndexes) {
          const requestedRole = request.requestedRoles[index];
          const capability = capabilityForRole(requestedRole);
          if (!capability) continue;
          const exactMatch = capability.preferredAgents
            .map((name) => catalogRegistry.agents.find((agent) => agent.name === name))
            .find((agent) => agent !== undefined && !usedAgents.has(agent.name));
          const match = exactMatch ?? rankSubAgentsCatalog(
            catalogRegistry,
            [capability.label, capability.id, ...capability.aliases].join(' '),
            { limit: 20 },
          ).find((agent) => !usedAgents.has(agent.name));
          if (!match) continue;
          usedAgents.add(match.name);
          selections[index] = {
            requestedRole,
            agentName: match.name,
            source: 'catalog',
            matchReason: capability.preferredAgents.includes(match.name)
              ? `exact catalog match for the ${capability.label} role`
              : `${capability.label} role tokens matched the catalog definition`,
          };
        }
      } catch {
        // Catalog failures degrade to "no signal"; composition never blocks.
      }
    }

    const selectedAgents: SelectedSpecialist[] = [];
    const unresolvedRoles: string[] = [];
    for (const [index, requestedRole] of request.requestedRoles.entries()) {
      const selection = selections[index];
      if (selection) selectedAgents.push(selection);
      else unresolvedRoles.push(requestedRole);
    }

    const tasks = this.decomposeTasks(request.objective, selectedAgents);

    return {
      objective: request.objective,
      selectedAgents: selectedAgents.slice(0, this.maxTeammates),
      tasks,
      unresolvedRoles,
    };
  }

  private matchReason(
    capability: CapabilityDefinition,
    agent: AgentDefinition,
    _requestedRole: string,
  ): string {
    if (capability.preferredAgents.includes(agent.name)) {
      return `preferred ${capability.label} definition`;
    }
    const profileNote = this.profile
      ? this.profileNote(capability)
      : '';
    const base = `${capability.label} role tokens matched the agent definition`;
    return profileNote ? `${base} + ${profileNote}` : base;
  }

  private profileNote(capability: CapabilityDefinition): string {
    const signals = signalTypes(this.profile);
    const parts: string[] = [];
    if (capability.repoAffinity.signals?.some((signal) => signals.has(signal))) {
      const matched = capability.repoAffinity.signals.filter((signal) => signals.has(signal));
      parts.push(`${matched.join(', ')} signal`);
    }
    if (capability.repoAffinity.languages?.some((language) => this.profile!.languages.includes(language))) {
      parts.push('language match');
    }
    if (capability.repoAffinity.frameworks?.some((framework) => this.profile!.frameworks.includes(framework))) {
      parts.push('framework match');
    }
    return parts.join(', ');
  }

  /**
   * Decompose the objective into phase-ordered tasks:
   * - Phase 0: research/context when the objective is complex or the profile
   *   has no signals (unknown repo context).
   * - Phase 1: implementation/testing/docs in parallel where independent.
   * - Phase 2: review/security/release as a fan-in blocked by earlier tasks.
   */
  private decomposeTasks(
    objective: string,
    selectedAgents: SelectedSpecialist[],
  ): ComposedTask[] {
    const tasks: ComposedTask[] = [];
    const taskIds: string[] = [];
    const byAgent = new Map<string, SelectedSpecialist>();
    for (const selected of selectedAgents) {
      byAgent.set(selected.agentName, selected);
    }

    const addTask = (subject: string, description: string, agentName: string, blockedBy: string[] = []): string => {
      const id = `task-${tasks.length + 1}`;
      tasks.push({ id, subject, description, agentName, blockedBy });
      taskIds.push(id);
      return id;
    };

    const researchAgent = byAgent.get('researcher');
    const complex = /\b(complex|large|multi|several|many|end-to-end|full)\b/i.test(objective);
    const unknownContext = this.profile === undefined || this.profile.signals.length === 0;
    if (researchAgent && (complex || unknownContext)) {
      addTask(
        'Research and context gathering',
        `Gather repository context and evidence for: ${objective}`,
        researchAgent.agentName,
      );
    }

    const phaseOne: string[] = [];
    for (const selected of selectedAgents) {
      const role = selected.requestedRole;
      if (role === 'research' || role === 'review' || role === 'security' || role === 'release-readiness') {
        continue;
      }
      const id = addTask(
        `${roleLabel(role)}: ${objective}`,
        `Act as the ${roleLabel(role)} specialist for: ${objective}. Return concise evidence, decisions, unknowns, and recommendations to the lead agent.`,
        selected.agentName,
      );
      phaseOne.push(id);
    }

    const fanIn: string[] = [];
    for (const selected of selectedAgents) {
      const role = selected.requestedRole;
      if (role === 'review' || role === 'security' || role === 'release-readiness') {
        const id = addTask(
          `${roleLabel(role)}: ${objective}`,
          `Act as the ${roleLabel(role)} specialist for: ${objective}. Review the work produced by earlier phases and return findings to the lead agent.`,
          selected.agentName,
          [...phaseOne, ...taskIds.filter((id) => !phaseOne.includes(id) && !fanIn.includes(id))],
        );
        fanIn.push(id);
      }
    }

    return tasks;
  }

  static formatRoster(composition: TeamComposition): string {
    const lines = ['Recommended roster'];
    for (const selected of composition.selectedAgents) {
      lines.push(`  ${roleLabel(selected.requestedRole)} → ${selected.agentName} [${selected.source}]  ${selected.matchReason}`);
    }
    if (composition.unresolvedRoles.length > 0) {
      lines.push(`  Unresolved → ${composition.unresolvedRoles.map(roleLabel).join(', ')}`);
    }
    if (composition.tasks.length > 0) {
      lines.push('Task graph:');
      for (const task of composition.tasks) {
        const blocked = task.blockedBy.length > 0 ? ` (blocked by: ${task.blockedBy.join(', ')})` : '';
        lines.push(`  ${task.id}: ${task.subject} → ${task.agentName}${blocked}`);
      }
    }
    return lines.join('\n');
  }
}