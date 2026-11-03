import type { AccountEntitlement } from '../auth/AuthClient.js';
import type { AutohandAISettings } from '../types.js';

export type DecisionFeature = 'selection' | 'preview' | 'learning' | 'compaction';

export interface DecisionModelConfiguration {
  provider: string;
  model: string;
}

export interface DecisionPolicyContext {
  policyEpoch: number;
  execution: { provider: string | null; plan?: 'cloud' | 'local'; attested: boolean };
  account: AccountEntitlement | null;
  authValid: boolean;
  autohandSettings?: AutohandAISettings;
  online: boolean;
  backgroundEnabled: boolean;
  features: Partial<Record<DecisionFeature, boolean>>;
  remotePreviewEnabled: boolean;
  configuredModel?: DecisionModelConfiguration;
  featureModels?: Partial<Record<DecisionFeature, DecisionModelConfiguration>>;
}

export type DecisionLocalReason =
  | 'context-unavailable' | 'stale-policy' | 'provider-unattested' | 'provider-mismatch'
  | 'weka-provider-ineligible' | 'account-ineligible' | 'credentials-unavailable'
  | 'auth-invalid'
  | 'offline' | 'background-disabled' | 'feature-disabled' | 'preview-disabled'
  | 'model-not-configured' | 'transport-unavailable' | 'invalid-request'
  | 'request-too-large' | 'response-too-large' | 'invalid-response' | 'deadline' | 'transport-failed';

export interface AuthorizedDecisionRoute {
  provider: string;
  model: string;
  weka: boolean;
}

export type DecisionPolicyResult = { allowed: true; route: AuthorizedDecisionRoute }
  | { allowed: false; reason: DecisionLocalReason };

export function isWekaDecisionModel(model: string): boolean {
  return model.trim().toLowerCase().split('/').at(-1) === 'weka';
}

function eligibleForWeka(account: AccountEntitlement | null): boolean {
  if (!account || !account.tier.trim() || ['unknown', 'invalid', 'free'].includes(account.tier.toLowerCase())
    || account.paymentAccess || account.quota?.available !== true
    || !account.limits?.models.some(isWekaDecisionModel)) return false;
  return [account.quota.window5h, account.quota.window24h, account.quota.week, account.quota.month]
    .every(window => window?.remaining === null || window?.remaining === undefined || window.remaining > 0);
}

export function authorizeDecision(
  context: DecisionPolicyContext,
  feature: DecisionFeature,
  requestedModel?: string,
): DecisionPolicyResult {
  if (context.online !== true) return { allowed: false, reason: 'offline' };
  if (context.backgroundEnabled !== true) return { allowed: false, reason: 'background-disabled' };
  if (context.features[feature] !== true) return { allowed: false, reason: 'feature-disabled' };
  if (feature === 'preview' && context.remotePreviewEnabled !== true) return { allowed: false, reason: 'preview-disabled' };
  const { execution } = context;
  if (!execution.attested || !execution.provider) return { allowed: false, reason: 'provider-unattested' };
  const configured = context.featureModels?.[feature] ?? context.configuredModel;
  if (!configured) return { allowed: false, reason: 'model-not-configured' };
  const model = requestedModel ?? (feature === 'preview' ? process.env.AUTOHAND_TYPE_AHEAD_MODEL : undefined) ?? configured.model;
  if (!model.trim() || model.length > 128) return { allowed: false, reason: 'invalid-request' };
  if (isWekaDecisionModel(model)) {
    if (execution.provider !== 'autohandai' || execution.plan !== 'cloud') return { allowed: false, reason: 'weka-provider-ineligible' };
    if (configured.provider !== execution.provider) return { allowed: false, reason: 'provider-mismatch' };
    if (context.authValid !== true) return { allowed: false, reason: 'auth-invalid' };
    if (!eligibleForWeka(context.account)) return { allowed: false, reason: 'account-ineligible' };
    const settings = context.autohandSettings;
    const token = settings?.authMode === 'account' ? settings.accountToken : settings?.apiKey;
    if (settings?.plan !== 'cloud' || !token?.trim()) return { allowed: false, reason: 'credentials-unavailable' };
    return { allowed: true, route: { provider: 'autohandai', model: 'weka', weka: true } };
  }
  if (configured.provider !== execution.provider) return { allowed: false, reason: 'provider-mismatch' };
  return { allowed: true, route: { provider: execution.provider, model, weka: false } };
}

export function decisionPolicyFingerprint(context: DecisionPolicyContext): string {
  return JSON.stringify({
    policyEpoch: context.policyEpoch, execution: context.execution, account: context.account, authValid: context.authValid,
    autohandSettings: context.autohandSettings, online: context.online,
    backgroundEnabled: context.backgroundEnabled, features: context.features,
    remotePreviewEnabled: context.remotePreviewEnabled, configuredModel: context.configuredModel,
    featureModels: context.featureModels, previewModel: process.env.AUTOHAND_TYPE_AHEAD_MODEL,
  });
}
