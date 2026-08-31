/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getProviderConfig } from '../../config.js';
import { ProviderFactory } from '../../providers/ProviderFactory.js';
import type { AutohandConfig, ProviderName } from '../../types.js';

export type TeamModelAssignmentSource =
  | 'member-override'
  | 'environment'
  | 'agent-override'
  | 'team-default'
  | 'agent-definition'
  | 'active-session';

export interface TeamModelAssignment {
  provider: ProviderName;
  model: string;
  source: TeamModelAssignmentSource;
}

export interface TeamModelAssignmentInput {
  config: AutohandConfig;
  active: Pick<TeamModelAssignment, 'provider' | 'model'>;
  override?: Partial<Pick<TeamModelAssignment, 'provider' | 'model'>>;
  agentName?: string;
  agentModel?: string;
  environment?: Pick<NodeJS.ProcessEnv, 'SUB_AGENTS_MODEL' | 'SUB_AGENTS_PROVIDER'>;
}

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
    if (candidate.provider || candidate.model) {
      return resolveCandidate(input, candidate, active);
    }
  }

  return active;
}
