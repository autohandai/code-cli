import type { AutohandConfig, BuiltInProviderName } from '../types.js';
import { isCustomProviderName } from '../providers/customProviders.js';

export const AUTOHAND_PROVIDER_TIMEOUT_MS = 300_000;
export const PROVIDER_TIMEOUT_DEFAULTS = 'provider default';

const DEFAULT_TIMEOUTS: Readonly<Record<string, number | undefined>> = {
  autohandai: AUTOHAND_PROVIDER_TIMEOUT_MS, anthropic: 600_000,
  openrouter: 30_000, azure: 30_000, vertexai: 30_000, cerebras: 30_000,
  nvidia: 30_000, llmgateway: 30_000, zai: 30_000, sakana: 30_000, deepseek: 30_000,
  mlx: 60_000, ollama: 120_000,
  openai: undefined, xai: undefined, llamacpp: undefined, bedrock: undefined,
} satisfies Record<BuiltInProviderName, number | undefined>;

export function describeNetworkTimeout(config?: Pick<AutohandConfig, 'network' | 'provider'>): string {
  const provider = config?.provider ?? 'openrouter';
  const providerDefault = isCustomProviderName(provider) ? 30_000 : DEFAULT_TIMEOUTS[provider];
  if (providerDefault === undefined) return PROVIDER_TIMEOUT_DEFAULTS;
  const configured = config?.network?.timeout;
  if (configured === undefined) return `provider default (${providerDefault / 1000} s)`;
  const floor = provider === 'autohandai' || provider === 'anthropic' ? providerDefault : 0;
  const effective = Math.max(configured, floor);
  return effective > configured
    ? `${effective / 1000} s (set to ${configured / 1000} s, raised by the provider)`
    : `${configured / 1000} s`;
}
