import type { AutohandConfig, BuiltInProviderName, ExtensionProviderId, ProviderName, ProviderSettings } from '../../types.js';

function providerControls(config: AutohandConfig, provider = config.provider ?? 'openrouter'): ProviderSettings | undefined {
  if (provider.startsWith('custom:')) return config.customProviders?.[provider.slice('custom:'.length)];
  if (provider.startsWith('extension:')) return config.extensionProviders?.[provider as ExtensionProviderId];
  return config[provider as BuiltInProviderName];
}

export function areProviderBackgroundCallsEnabled(config: AutohandConfig, provider?: ProviderName): boolean {
  return providerControls(config, provider)?.backgroundCalls !== false;
}

export function isAutohandOrchestrationEnabled(config: AutohandConfig, provider = config.provider): boolean {
  return provider === 'autohandai'
    && config.autohandai?.plan === 'cloud'
    && config.autohandai.maxConcurrentThreads !== 1
    && config.autohandai.backgroundCalls !== false
    && config.autohandai.orchestration !== false;
}

export function orchestrationThreadLimit(config: AutohandConfig, provider?: ProviderName): number {
  const limit = config.features?.multi_agent_v2?.max_concurrent_threads_per_session
    ?? (isAutohandOrchestrationEnabled(config, provider) ? 4 : 9);
  const providerLimit = providerControls(config, provider)?.maxConcurrentThreads;
  if (providerLimit === undefined) return limit;
  if (!Number.isSafeInteger(providerLimit) || providerLimit < 1 || providerLimit > 64) {
    throw new RangeError('Provider maxConcurrentThreads must be an integer between 1 and 64.');
  }
  return Math.min(limit, providerLimit);
}

export function canUseMoaAdvisor(config: AutohandConfig, tier?: string, model = config.autohandai?.model): boolean {
  return areProviderBackgroundCallsEnabled(config) && isAutohandOrchestrationEnabled(config) && tier !== 'free'
    && (Boolean(tier) || model === 'moa' || model === 'auto');
}

export const RESEARCH_WORKER_TOOLS: ReadonlySet<string> = new Set([
  'read_file', 'list_tree', 'find_grep', 'fff_find',
  'git_diff', 'git_status', 'git_list_untracked', 'git_diff_range', 'git_log',
  'web_search', 'fetch_url',
]);

export const RESEARCH_WORKER_INSTRUCTIONS = 'You are a read-only research worker. Inspect only the assigned scope. '
  + 'Return a compact structured report with: files and symbols (paths and line references), findings, '
  + 'contracts and dependencies, documentation snippets with source URLs, and uncertainties. '
  + 'Do not implement changes, run commands, delegate, or claim checks you did not perform.';

export const ORCHESTRATION_INSTRUCTIONS = 'Autohand AI orchestration is enabled. You own planning, code edits, '
  + 'tests and integration. Delegate independent file discovery, symbol/AST summaries and documentation lookup '
  + 'to the three-worker read-only research pool using delegate_parallel with research_only: true. Ordinary '
  + 'reviewer and implementer delegations retain their definitions, tools and reasoning. Workers default to Fantail unless their definition requests reasoning; respect '
  + 'the user\'s model overrides. Give each worker a bounded scope and request structured findings with evidence. '
  + 'Use plan/exit_plan_mode when planning mode is active. Moa provides independent checkpoint advice before '
  + 'finalizing plans, after a repeated test/compiler failure, and before staging, committing or completing tool work. '
  + 'Review its findings and resolve contract or auth-invariant problems before proceeding. Ordinary shell steps need no advisor call.';
