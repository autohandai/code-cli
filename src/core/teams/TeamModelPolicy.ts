/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getProviderConfig } from '../../config.js';
import { ProviderFactory } from '../../providers/ProviderFactory.js';
import { getProviderModelIds } from '../../providers/modelCatalog.js';
import { isCustomProviderName } from '../../providers/customProviders.js';
import type { AutohandConfig, BuiltInProviderName, ProviderName, ReasoningEffort } from '../../types.js';
import type { LLMProvider } from '../../providers/LLMProvider.js';

export type TeamModelAssignmentSource =
  | 'member-override'
  | 'environment'
  | 'agent-override'
  | 'team-default'
  | 'agent-definition'
  | 'agent-nature'
  | 'active-session';

export interface TeamModelAssignment {
  provider: ProviderName;
  model: string;
  source: TeamModelAssignmentSource;
  /** Reasoning depth for models that accept one (Autohand AI moa); absent means the provider default. */
  reasoningEffort?: ReasoningEffort;
}

export interface TeamModelAssignmentInput {
  config: AutohandConfig;
  active: Pick<TeamModelAssignment, 'provider' | 'model'>;
  override?: Partial<Pick<TeamModelAssignment, 'provider' | 'model'>>;
  agentName?: string;
  agentModel?: string;
  /** Reasoning depth the agent definition asks for; marks an agent whose work is judgement rather than execution. */
  agentReasoning?: ReasoningEffort;
  environment?: Pick<NodeJS.ProcessEnv, 'SUB_AGENTS_MODEL' | 'SUB_AGENTS_PROVIDER'>;
}

/** Autohand AI sub-agents run on the fast tier unless their definition asks for reasoning. */
export const AUTOHAND_AI_SUBAGENT_DEFAULT_MODEL = 'fantail';
export const AUTOHAND_AI_SUBAGENT_REASONING_MODEL = 'moa';

interface AssignmentCandidate {
  provider?: ProviderName;
  model?: string;
  source: TeamModelAssignmentSource;
}

function normalizeModel(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function normalizeProvider(value: string | undefined, config: AutohandConfig): ProviderName | undefined {
  const trimmed = value?.trim();
  return trimmed && ProviderFactory.isValidProvider(trimmed, config)
    ? trimmed
    : undefined;
}

function modelForProvider(
  config: AutohandConfig,
  provider: ProviderName,
  active: TeamModelAssignmentInput['active'],
): string {
  if (provider === active.provider && normalizeModel(active.model)) {
    return active.model.trim();
  }

  return normalizeModel(getProviderConfig(config, provider)?.model)
    ?? active.model.trim();
}

function resolveCandidate(
  input: TeamModelAssignmentInput,
  candidate: AssignmentCandidate,
  fallback: Pick<TeamModelAssignment, 'provider' | 'model'>,
): TeamModelAssignment {
  const provider = candidate.provider ?? fallback.provider;
  return {
    provider,
    model: candidate.model ?? modelForProvider(input.config, provider, input.active),
    source: candidate.source,
  };
}

/**
 * Models named by an agent definition or by the lead model's tool call are
 * suggestions, not the user's choice. They only count when the provider's
 * catalogue knows them; a catalogue-less provider (local plans, custom
 * endpoints) accepts any id because there is nothing to check against.
 */
function isKnownModelForProvider(config: AutohandConfig, provider: ProviderName, model: string): boolean {
  if (isCustomProviderName(provider)) return true;
  if (provider === 'autohandai' && config.autohandai?.plan === 'local') return true;
  const known = getProviderModelIds(provider as BuiltInProviderName);
  return known.length === 0 || known.includes(model);
}

function isSuggestedSource(source: TeamModelAssignmentSource): boolean {
  return source === 'agent-definition' || source === 'member-override';
}

function usesAutohandAICloud(config: AutohandConfig, provider: ProviderName): boolean {
  return provider === 'autohandai' && config.autohandai?.plan !== 'local';
}

/**
 * The Autohand AI default for a sub-agent: fantail for execution-style
 * agents, moa with the requested reasoning effort for judgement-style ones.
 */
function resolveAutohandAINature(input: TeamModelAssignmentInput): TeamModelAssignment {
  if (input.agentReasoning && input.agentReasoning !== 'none') {
    return {
      provider: 'autohandai',
      model: AUTOHAND_AI_SUBAGENT_REASONING_MODEL,
      source: 'agent-nature',
      reasoningEffort: input.agentReasoning,
    };
  }
  return { provider: 'autohandai', model: AUTOHAND_AI_SUBAGENT_DEFAULT_MODEL, source: 'agent-nature' };
}

/**
 * Resolves the provider/model pair a teammate will actually use. Keeping both
 * values together prevents a model selected for Autohand AI from silently
 * being sent through whichever provider happens to be configured globally.
 */
export function resolveTeamModelAssignment(input: TeamModelAssignmentInput): TeamModelAssignment {
  const active: TeamModelAssignment = {
    provider: input.active.provider,
    model: input.active.model.trim(),
    source: 'active-session',
  };
  const environment = input.environment ?? process.env;
  const savedAgentOverride = input.agentName
    ? input.config.teams?.agentModelOverrides?.[input.agentName]
    : undefined;
  const candidates: AssignmentCandidate[] = [
    {
      provider: normalizeProvider(input.override?.provider, input.config),
      model: normalizeModel(input.override?.model),
      source: 'member-override',
    },
    {
      provider: normalizeProvider(environment.SUB_AGENTS_PROVIDER, input.config),
      model: normalizeModel(environment.SUB_AGENTS_MODEL),
      source: 'environment',
    },
    {
      provider: normalizeProvider(savedAgentOverride?.provider, input.config),
      model: normalizeModel(savedAgentOverride?.model),
      source: 'agent-override',
    },
    {
      provider: normalizeProvider(input.config.teams?.defaultProvider, input.config),
      model: normalizeModel(input.config.teams?.defaultModel),
      source: 'team-default',
    },
    {
      model: normalizeModel(input.agentModel),
      source: 'agent-definition',
    },
  ];

  for (const candidate of candidates) {
    if (!candidate.provider && !candidate.model) continue;
    const provider = candidate.provider ?? active.provider;
    if (isSuggestedSource(candidate.source) && candidate.model && !isKnownModelForProvider(input.config, provider, candidate.model)) {
      continue;
    }
    return resolveCandidate(input, candidate, active);
  }

  if (usesAutohandAICloud(input.config, active.provider)) {
    return resolveAutohandAINature(input);
  }

  return active;
}

/**
 * Builds the provider a team member talks to. The assignment's reasoning
 * effort rides along for Autohand AI so a moa member reasons at the depth its
 * definition asked for instead of whatever the lead session happens to use.
 */
export function createTeamMemberProvider(config: AutohandConfig, assignment: TeamModelAssignment): LLMProvider {
  const memberConfig: AutohandConfig = { ...config, provider: assignment.provider };
  if (assignment.provider === 'autohandai' && config.autohandai && assignment.reasoningEffort) {
    memberConfig.autohandai = { ...config.autohandai, reasoningEffort: assignment.reasoningEffort };
  }
  const provider = ProviderFactory.create(memberConfig);
  provider.setModel(assignment.model);
  return provider;
}
