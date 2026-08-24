/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { LoadedConfig } from '../../types.js';
import { getAutohandAICloudModelContextWindow } from '../../providers/AutohandAIProvider.js';

/**
 * Moa is a paid-tier model. A free-plan account that ends up with `moa` selected
 * (via /provider, the setup wizard, or a stale config) only finds out when the
 * gateway rejects the request with model_not_available. This policy downgrades
 * such a selection to Fantail — the free-tier default — before any request is made.
 */

/** The tier string GET /v1/auth/me reports for free accounts. */
const FREE_TIER = 'free';

/** Fantail is the free-tier default cloud model. */
export const AUTOHAND_AI_FREE_TIER_MODEL = 'fantail';

function isMoaModel(model: string | undefined): boolean {
  if (!model) return false;
  const normalized = model.toLowerCase();
  return normalized === 'moa' || normalized === 'autohandai/moa';
}

/**
 * True only when the entitlement explicitly says the account is on the free tier.
 * Unknown tiers fail open: the server remains the final authority.
 */
export function isFreeTier(tier: string | undefined): boolean {
  return tier === FREE_TIER;
}

export interface AutohandAIModelTierInput {
  provider: LoadedConfig['provider'];
  plan: 'cloud' | 'local' | undefined;
  model: string | undefined;
  tier: string | undefined;
}

/**
 * Resolve the model a given account tier may run. Returns `'fantail'` only for
 * the exact combination that must be corrected — free tier + autohandai cloud +
 * Moa — and passes every other selection through unchanged.
 */
export function resolveAutohandAIModelForTier(input: AutohandAIModelTierInput): string {
  const applies =
    input.provider === 'autohandai' &&
    input.plan === 'cloud' &&
    isMoaModel(input.model) &&
    isFreeTier(input.tier);
  return applies ? AUTOHAND_AI_FREE_TIER_MODEL : (input.model ?? AUTOHAND_AI_FREE_TIER_MODEL);
}

export interface AutohandAIModelTierPolicyResult {
  config: LoadedConfig;
  /** True only when the policy actually changed the effective model. */
  switched: boolean;
  /** The model the account was running before the policy applied. */
  previousModel?: string;
  /**
   * The model the account must now run. `runtime.options.model` shadows the
   * persisted selection for the active session and lives on `AgentRuntime`, not
   * on the config, so the caller applies this there — leave it pointing at Moa
   * and the very next turn would still use the old model.
   */
  resolvedModel?: string;
}

/**
 * Apply the free-tier model policy to a loaded config. Returns the input config
 * by reference when nothing applies, so callers can detect a no-op cheaply and
 * skip persistence.
 */
export function applyAutohandAIModelTierPolicy(
  config: LoadedConfig,
  tier: string | undefined,
): AutohandAIModelTierPolicyResult {
  const settings = config.autohandai;
  if (!settings || config.provider !== 'autohandai') {
    return { config, switched: false };
  }

  const resolved = resolveAutohandAIModelForTier({
    provider: config.provider,
    plan: settings.plan,
    model: settings.model,
    tier,
  });
  if (resolved === settings.model) {
    return { config, switched: false };
  }

  const previousModel = settings.model;
  const nextSettings = {
    ...settings,
    model: resolved,
    contextWindow: getAutohandAICloudModelContextWindow(resolved),
  };
  // reasoningEffort is a Moa-only setting; carrying it onto Fantail would send
  // an unsupported request parameter.
  if (isMoaModel(previousModel) && !isMoaModel(resolved)) {
    delete nextSettings.reasoningEffort;
  }

  const next: LoadedConfig = { ...config, autohandai: nextSettings };

  return { config: next, switched: true, previousModel, resolvedModel: resolved };
}
