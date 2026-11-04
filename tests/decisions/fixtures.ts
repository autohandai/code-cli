import { DecisionDispatcher, type DecisionPolicyContext } from '../../src/decisions/index.js';
import type { AutohandAISettings } from '../../src/types.js';

export function eligibleDecisionContext(settings: AutohandAISettings): DecisionPolicyContext {
  return {
    policyEpoch: 1, execution: { provider: 'autohandai', plan: 'cloud', attested: true },
    account: {
      tier: 'pro', freeRemaining: null,
      limits: { displayName: 'Pro', messagesPer5h: null, messagesPer24h: null, messagesPerWeek: null, messagesPerMonth: null, rpm: 100, inputTokensPerMinute: null, outputTokensPerMinute: null, requiresEligibility: false, perSeat: false, models: ['weka'] },
      quota: { available: true, window5h: null, window24h: null, week: null, month: null },
    },
    autohandSettings: settings, authValid: true, online: true, backgroundEnabled: true,
    features: { selection: true, preview: true, learning: true, compaction: true },
    remotePreviewEnabled: true, configuredModel: { provider: 'autohandai', model: 'weka' },
  };
}

export function eligibleDecisionDispatcher(settings: AutohandAISettings): DecisionDispatcher {
  return new DecisionDispatcher({ getContext: () => eligibleDecisionContext(settings) });
}
