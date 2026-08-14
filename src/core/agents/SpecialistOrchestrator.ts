/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentDefinition, AgentSource } from './AgentRegistry.js';
import { AgentRegistry } from './AgentRegistry.js';
import type { AgentDelegator } from './AgentDelegator.js';
import type { ToolActionOutcome } from '../../types.js';
import { randomUUID } from 'node:crypto';
import {
  fetchSubAgentsRegistry,
  installSubAgentFromCatalog,
  rankSubAgentsCatalog,
  type CatalogRegistry,
} from '../../actions/subAgentsCatalog.js';

export type SpecialistRequestSource = 'intent' | 'tool' | 'interview';
export type SpecialistExecutionMode = 'parallel' | 'serial' | 'interview' | 'team';
export type SpecialistAgentSource = AgentSource | 'awesome-sub-agents';

export interface SpecialistRequest {
  objective: string;
  requestedRoles: string[];
  source: SpecialistRequestSource;
  executionMode: SpecialistExecutionMode;
}

export interface SelectedSpecialist {
  requestedRole: string;
  agentName: string;
  source: SpecialistAgentSource;
  matchReason: string;
}

export interface SpecialistPlan {
  objective: string;
  requestedRoles: string[];
  selectedAgents: SelectedSpecialist[];
  source: SpecialistRequestSource;
  matchReason: string;
  executionMode: SpecialistExecutionMode;
  unresolvedRoles: string[];
  resolutionNotice?: string;
}

export interface SpecialistExecutionBatch {
  agents: string[];
  outcome: ToolActionOutcome;
}

export interface SpecialistExecutionResult {
  plan: SpecialistPlan;
  batches: SpecialistExecutionBatch[];
  completed: boolean;
}

export interface SpecialistInstallationResult {
  installedAgents: string[];
  failedAgents: string[];
}

export interface StagedSpecialistInstallation {
  planId: string;
  agentNames: string[];
}

interface SpecialistRoleDefinition {
  id: string;
  label: string;
  aliases: string[];
  preferredAgents: string[];
}

interface ActiveSpecialistInterview {
  agentName: string;
  agentSource: SpecialistAgentSource;
  requestedRole: string;
  objective: string;
}

export interface SpecialistOrchestratorOptions {
  registry?: AgentRegistry;
  maxParallel?: number;
  offline?: boolean;
  catalog?: SpecialistCatalogAdapter;
  getAllowedTools?: () => ReadonlySet<string>;
}

export interface SpecialistCatalogAdapter {
  fetchRegistry(): Promise<CatalogRegistry>;
  install(
    name: string,
    options: { registry: CatalogRegistry; allowedTools?: ReadonlySet<string> },
  ): Promise<string>;
}

const ROLE_DEFINITIONS: readonly SpecialistRoleDefinition[] = [
  { id: 'ui', label: 'UI', aliases: ['ui', 'user interface', 'interface design'], preferredAgents: ['ui-designer', 'frontend-designer'] },
  { id: 'ux', label: 'UX', aliases: ['ux', 'user experience', 'experience design'], preferredAgents: ['ux-researcher', 'ux-designer'] },
  { id: 'security', label: 'Security', aliases: ['security', 'security audit', 'threat model'], preferredAgents: ['security-auditor'] },
  { id: 'product-interviewer', label: 'Product interview', aliases: ['product interviewer', 'product interview', 'requirements interviewer'], preferredAgents: ['product-interviewer'] },
  { id: 'planner', label: 'Planning', aliases: ['planner', 'planning', 'architecture'], preferredAgents: ['planner'] },
  { id: 'debugger', label: 'Debugging', aliases: ['debugger', 'debugging', 'diagnosis'], preferredAgents: ['debugger'] },
  { id: 'release-readiness', label: 'Release readiness', aliases: ['release readiness', 'release', 'packaging'], preferredAgents: ['release-readiness'] },
  { id: 'research', label: 'Research', aliases: ['researcher', 'research'], preferredAgents: ['researcher'] },
  { id: 'review', label: 'Review', aliases: ['reviewer', 'review'], preferredAgents: ['reviewer'] },
  { id: 'testing', label: 'Testing', aliases: ['tester', 'testing', 'test'], preferredAgents: ['tester'] },
] as const;

const SOURCE_PRIORITY: Readonly<Record<AgentSource, number>> = {
  session: 0,
  user: 1,
  catalog: 2,
  external: 1,
  'auto-generated': 1,
  extension: 3,
  builtin: 4,
};

const MUTATING_OBJECTIVE = /\b(implement|fix|change|modify|edit|write|create|delete|remove|refactor|migrate|upgrade|install)\b/i;
const EXPLICIT_ORCHESTRATION = /\b(bring|assemble|form|create|use|run|ask|have|need|spin\s+up)\b/i;
const ORCHESTRATION_NOUN = /\b(teams?|specialists?|agents?)\b/i;

function aliasMatchIndex(input: string, alias: string): number {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const match = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i').exec(input);
  return match?.index ?? -1;
}

function definitionForRole(role: string): SpecialistRoleDefinition | undefined {
  return ROLE_DEFINITIONS.find((definition) => definition.id === role);
}

function extractRequestedRoles(instruction: string): string[] {
  return ROLE_DEFINITIONS
    .map((definition) => ({
      id: definition.id,
      index: Math.min(...definition.aliases
        .map((alias) => aliasMatchIndex(instruction, alias))
        .filter((index) => index >= 0)),
    }))
    .filter((match) => Number.isFinite(match.index))
    .sort((left, right) => left.index - right.index)
    .map((match) => match.id);
}

function executionModeFor(objective: string, roles: string[]): SpecialistExecutionMode {
  if (roles.length === 1 && roles[0] === 'product-interviewer') return 'interview';
  if (roles.length > 1 && !MUTATING_OBJECTIVE.test(objective)) return 'parallel';
  return 'serial';
}

export function detectSpecialistRequest(
  instruction: string,
  source: SpecialistRequestSource = 'intent',
): SpecialistRequest | null {
  if (!EXPLICIT_ORCHESTRATION.test(instruction) || !ORCHESTRATION_NOUN.test(instruction)) {
    return null;
  }

  const requestedRoles = extractRequestedRoles(instruction);
  if (requestedRoles.length === 0) return null;

  return {
    objective: instruction.trim(),
    requestedRoles,
    source,
    executionMode: executionModeFor(instruction, requestedRoles),
  };
}

export function createSpecialistRequest(
  objective: string,
  requestedRoles: string[],
  source: SpecialistRequestSource = 'tool',
): SpecialistRequest {
  const roles = requestedRoles.map((requestedRole) => {
    const normalized = requestedRole.trim().toLowerCase();
    return ROLE_DEFINITIONS.find((definition) => (
      definition.id === normalized
      || definition.aliases.some((alias) => alias === normalized)
    ))?.id ?? normalized;
  }).filter(Boolean);
  return {
    objective: objective.trim(),
    requestedRoles: roles,
    source,
    executionMode: executionModeFor(objective, roles),
  };
}

function normalizeSearchText(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
}

function scoreAgent(role: SpecialistRoleDefinition, agent: AgentDefinition): number {
  const preferredIndex = role.preferredAgents.indexOf(agent.name);
  if (preferredIndex !== -1) return 10_000 - preferredIndex * 100;

  const roleTokens = new Set(normalizeSearchText([role.id, ...role.aliases].join(' ')));
  const nameTokens = new Set(normalizeSearchText(agent.name));
  const descriptionTokens = new Set(normalizeSearchText(agent.description));
  let score = 0;
  for (const token of roleTokens) {
    if (nameTokens.has(token)) score += 100;
    if (descriptionTokens.has(token)) score += 10;
  }
  return score;
}

function sourcePriority(agent: AgentDefinition): number {
  return SOURCE_PRIORITY[agent.source];
}

function roleLabel(role: string): string {
  return definitionForRole(role)?.label ?? role;
}

function interviewIsComplete(batches: SpecialistExecutionBatch[]): boolean {
  return batches.some((batch) => {
    const output = batch.outcome.output ?? '';
    return /^\s*complete\s*:\s*true\s*$/im.test(output)
      || /"complete"\s*:\s*true\b/i.test(output);
  });
}

export function formatSpecialistRoster(plan: SpecialistPlan): string {
  const lines = ['Specialist roster'];
  for (const selected of plan.selectedAgents) {
    lines.push(`${roleLabel(selected.requestedRole)} → ${selected.agentName} [${selected.source}]`);
  }
  if (plan.unresolvedRoles.length > 0) {
    lines.push(`Unresolved → ${plan.unresolvedRoles.map(roleLabel).join(', ')}`);
  }
  return lines.join('\n');
}

export function formatSpecialistResults(result: SpecialistExecutionResult): string {
  return [
    'Specialist results for lead synthesis:',
    JSON.stringify({
      objective: result.plan.objective,
      executionMode: result.plan.executionMode,
      selectedAgents: result.plan.selectedAgents,
      unresolvedRoles: result.plan.unresolvedRoles,
      resolutionNotice: result.plan.resolutionNotice,
      batches: result.batches.map((batch) => ({
        agents: batch.agents,
        success: batch.outcome.success,
        output: batch.outcome.output,
        ...(!batch.outcome.success ? { error: batch.outcome.error } : {}),
      })),
    }, null, 2),
  ].join('\n');
}

export class SpecialistOrchestrator {
  private readonly registry: AgentRegistry;
  private readonly maxParallel: number;
  private readonly offline: boolean;
  private readonly catalog: SpecialistCatalogAdapter;
  private readonly getAllowedTools?: () => ReadonlySet<string>;
  private readonly catalogSnapshots = new WeakMap<SpecialistPlan, CatalogRegistry>();
  private readonly stagedInstallations = new Map<string, SpecialistPlan>();
  private activeInterview?: ActiveSpecialistInterview;

  constructor(
    private readonly delegator: AgentDelegator,
    options: SpecialistOrchestratorOptions = {},
  ) {
    this.registry = options.registry ?? AgentRegistry.getInstance();
    this.maxParallel = Math.max(1, Math.min(5, Math.floor(options.maxParallel ?? 5)));
    this.offline = options.offline === true;
    this.catalog = options.catalog ?? {
      fetchRegistry: () => fetchSubAgentsRegistry(),
      install: (name, installOptions) => installSubAgentFromCatalog(name, installOptions),
    };
    this.getAllowedTools = options.getAllowedTools;
  }

  async resolve(request: SpecialistRequest): Promise<SpecialistPlan> {
    await this.registry.loadAgents();
    const candidates = this.registry.getAllAgents();
    const usedAgents = new Set<string>();
    const selections: Array<SelectedSpecialist | undefined> = [];
    const locallyUnresolvedIndexes: number[] = [];

    for (const [index, requestedRole] of request.requestedRoles.entries()) {
      const role = definitionForRole(requestedRole);
      if (!role) {
        locallyUnresolvedIndexes.push(index);
        continue;
      }

      const ranked = candidates
        .filter((agent) => !usedAgents.has(agent.name))
        .map((agent) => ({ agent, score: scoreAgent(role, agent) }))
        .filter((candidate) => candidate.score >= 20)
        .sort((left, right) => (
          sourcePriority(left.agent) - sourcePriority(right.agent)
          || right.score - left.score
          || left.agent.name.localeCompare(right.agent.name)
        ));
      const match = ranked[0];
      if (!match) {
        locallyUnresolvedIndexes.push(index);
        continue;
      }

      usedAgents.add(match.agent.name);
      selections[index] = {
        requestedRole,
        agentName: match.agent.name,
        source: match.agent.source,
        matchReason: role.preferredAgents.includes(match.agent.name)
          ? `preferred ${role.label} definition`
          : `${role.label} role tokens matched the agent definition`,
      };
    }

    const plan: SpecialistPlan = {
      objective: request.objective,
      requestedRoles: [...request.requestedRoles],
      selectedAgents: [],
      source: request.source,
      matchReason: 'resolved by explicit requested role with local-source precedence',
      executionMode: request.executionMode,
      unresolvedRoles: [],
    };

    if (locallyUnresolvedIndexes.length > 0 && !this.offline) {
      try {
        const catalogRegistry = await this.catalog.fetchRegistry();
        this.catalogSnapshots.set(plan, catalogRegistry);
        for (const index of locallyUnresolvedIndexes) {
          const requestedRole = request.requestedRoles[index];
          const role = definitionForRole(requestedRole);
          if (!role) continue;
          const exactMatch = role.preferredAgents
            .map((name) => catalogRegistry.agents.find((agent) => agent.name === name))
            .find((agent) => agent !== undefined && !usedAgents.has(agent.name));
          const match = exactMatch ?? rankSubAgentsCatalog(
            catalogRegistry,
            [role.label, role.id, ...role.aliases].join(' '),
            { limit: 20 },
          ).find((agent) => !usedAgents.has(agent.name));
          if (!match) continue;
          usedAgents.add(match.name);
          selections[index] = {
            requestedRole,
            agentName: match.name,
            source: 'catalog',
            matchReason: role.preferredAgents.includes(match.name)
              ? `exact catalog match for the ${role.label} role`
              : `${role.label} role tokens matched the catalog definition`,
          };
        }
      } catch (error) {
        plan.resolutionNotice = `Specialist catalog unavailable: ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    for (const [index, requestedRole] of request.requestedRoles.entries()) {
      const selection = selections[index];
      if (selection) plan.selectedAgents.push(selection);
      else plan.unresolvedRoles.push(requestedRole);
    }
    return plan;
  }

  async installCatalogSelections(plan: SpecialistPlan): Promise<SpecialistInstallationResult> {
    const pending = plan.selectedAgents.filter((selected) => selected.source === 'catalog');
    if (pending.length === 0) {
      return { installedAgents: [], failedAgents: [] };
    }

    const snapshot = this.catalogSnapshots.get(plan);
    const installedAgents: string[] = [];
    const failedAgents: string[] = [];
    const failedRoles = new Set<string>();
    const failureMessages: string[] = [];

    if (!snapshot) {
      for (const selected of pending) {
        failedAgents.push(selected.agentName);
        failedRoles.add(selected.requestedRole);
      }
      failureMessages.push('the resolved catalog snapshot is no longer available');
    } else {
      const allowedTools = this.getAllowedTools?.();
      for (const selected of pending) {
        try {
          const output = await this.catalog.install(selected.agentName, {
            registry: snapshot,
            ...(allowedTools === undefined ? {} : { allowedTools }),
          });
          if (!/^Installed sub-agent\b/.test(output)) {
            throw new Error(output);
          }
          installedAgents.push(selected.agentName);
        } catch (error) {
          failedAgents.push(selected.agentName);
          failedRoles.add(selected.requestedRole);
          failureMessages.push(`${selected.agentName}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    if (failedAgents.length > 0) {
      plan.selectedAgents = plan.selectedAgents.filter((selected) => !failedAgents.includes(selected.agentName));
      for (const role of plan.requestedRoles) {
        if (failedRoles.has(role) && !plan.unresolvedRoles.includes(role)) {
          plan.unresolvedRoles.push(role);
        }
      }
      const notice = `Specialist installation failed: ${failureMessages.join('; ')}`;
      plan.resolutionNotice = plan.resolutionNotice
        ? `${plan.resolutionNotice}; ${notice}`
        : notice;
    }

    if (installedAgents.length > 0) {
      await this.registry.loadAgents();
    }
    return { installedAgents, failedAgents };
  }

  stageCatalogInstallation(plan: SpecialistPlan): StagedSpecialistInstallation | undefined {
    const agentNames = plan.selectedAgents
      .filter((selected) => selected.source === 'catalog')
      .map((selected) => selected.agentName);
    if (agentNames.length === 0) return undefined;

    const planId = randomUUID();
    this.stagedInstallations.set(planId, plan);
    return { planId, agentNames };
  }

  async installStagedCatalogSelections(
    planId: string,
    agentNames: string[],
  ): Promise<SpecialistInstallationResult> {
    const plan = this.stagedInstallations.get(planId);
    if (!plan) throw new Error('Specialist installation plan is missing or was already consumed.');

    const expectedNames = plan.selectedAgents
      .filter((selected) => selected.source === 'catalog')
      .map((selected) => selected.agentName);
    if (
      expectedNames.length !== agentNames.length
      || expectedNames.some((name, index) => name !== agentNames[index])
    ) {
      throw new Error('Specialist installation roster does not match the resolved plan.');
    }

    this.stagedInstallations.delete(planId);
    return this.installCatalogSelections(plan);
  }

  declineStagedCatalogInstallation(planId: string): void {
    const plan = this.stagedInstallations.get(planId);
    if (!plan) return;
    this.stagedInstallations.delete(planId);

    const declined = plan.selectedAgents.filter((selected) => selected.source === 'catalog');
    plan.selectedAgents = plan.selectedAgents.filter((selected) => selected.source !== 'catalog');
    for (const selected of declined) {
      if (!plan.unresolvedRoles.includes(selected.requestedRole)) {
        plan.unresolvedRoles.push(selected.requestedRole);
      }
    }
    const notice = `Catalog installation was not approved for: ${declined.map((selected) => selected.agentName).join(', ')}`;
    plan.resolutionNotice = plan.resolutionNotice
      ? `${plan.resolutionNotice}; ${notice}`
      : notice;
  }

  hasActiveInterview(): boolean {
    return this.activeInterview !== undefined;
  }

  clearSessionContext(): void {
    this.activeInterview = undefined;
    this.stagedInstallations.clear();
  }

  async continueInterview(answer: string): Promise<SpecialistExecutionResult | null> {
    const interview = this.activeInterview;
    if (!interview) return null;

    return this.execute({
      objective: [
        'Continue the existing product interview.',
        `Original objective: ${interview.objective}`,
        `Latest user answer relayed by the lead: ${answer.trim()}`,
      ].join('\n'),
      requestedRoles: [interview.requestedRole],
      selectedAgents: [{
        requestedRole: interview.requestedRole,
        agentName: interview.agentName,
        source: interview.agentSource,
        matchReason: 'continued the active session-scoped interview',
      }],
      source: 'interview',
      matchReason: 'continued the active session-scoped interview',
      executionMode: 'interview',
      unresolvedRoles: [],
    });
  }

  async execute(plan: SpecialistPlan): Promise<SpecialistExecutionResult> {
    const tasks = plan.selectedAgents.map((selected) => ({
      agent_name: selected.agentName,
      task: [
        `Act as the ${roleLabel(selected.requestedRole)} specialist for this objective:`,
        plan.objective,
        'Return concise evidence, decisions, unknowns, and recommendations to the lead agent.',
        'Do not address the user directly.',
      ].join('\n'),
    }));
    const batches: SpecialistExecutionBatch[] = [];

    if (plan.executionMode === 'parallel') {
      for (let index = 0; index < tasks.length; index += this.maxParallel) {
        const batch = tasks.slice(index, index + this.maxParallel);
        const outcome = await this.delegator.delegateParallelForTool(batch);
        batches.push({ agents: batch.map((task) => task.agent_name), outcome });
      }
    } else {
      for (const task of tasks) {
        const outcome = await this.delegator.delegateTaskForTool(task.agent_name, task.task);
        batches.push({ agents: [task.agent_name], outcome });
      }
    }

    if (plan.executionMode === 'interview' && plan.selectedAgents.length === 1) {
      if (interviewIsComplete(batches)) {
        this.activeInterview = undefined;
      } else {
        const selected = plan.selectedAgents[0];
        this.activeInterview = {
          agentName: selected.agentName,
          agentSource: selected.source,
          requestedRole: selected.requestedRole,
          objective: this.activeInterview?.objective ?? plan.objective,
        };
      }
    }

    return {
      plan,
      batches,
      completed: batches.every((batch) => batch.outcome.success),
    };
  }
}
