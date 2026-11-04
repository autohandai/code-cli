import type { AutohandConfig } from '../types.js';

export const AUTOHAND_PROVIDER_TIMEOUT_MS = 300_000;
export const PROVIDER_TIMEOUT_DEFAULTS = 'provider default (300 s Autohand, 600 s Anthropic)';

export function describeNetworkTimeout(config?: Pick<AutohandConfig, 'network' | 'provider'>): string {
  const configured = config?.network?.timeout;
  if (configured === undefined) return PROVIDER_TIMEOUT_DEFAULTS;
  const floor = config?.provider === 'autohandai' ? AUTOHAND_PROVIDER_TIMEOUT_MS : config?.provider === 'anthropic' ? 600_000 : 0;
  return `${Math.max(configured, floor)}ms`;
}
