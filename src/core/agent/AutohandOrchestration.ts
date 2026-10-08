import type { AutohandConfig, ProviderName } from '../../types.js';

export function isAutohandOrchestrationEnabled(config: AutohandConfig, provider = config.provider): boolean {
  return provider === 'autohandai'
    && config.autohandai?.plan === 'cloud'
    && config.autohandai.orchestration !== false;
}

export function orchestrationThreadLimit(config: AutohandConfig, provider?: ProviderName): number {
  return config.features?.multi_agent_v2?.max_concurrent_threads_per_session
    ?? (isAutohandOrchestrationEnabled(config, provider) ? 4 : 9);
}

export function canUseMoaAdvisor(config: AutohandConfig, tier?: string, model = config.autohandai?.model): boolean {
  return isAutohandOrchestrationEnabled(config) && tier !== 'free'
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
  + 'to the three-worker read-only research pool using delegate_parallel. Workers default to Fantail; respect '
  + 'the user\'s model overrides. Give each worker a bounded scope and request structured findings with evidence. '
  + 'Use plan/exit_plan_mode when planning mode is active. Moa provides independent checkpoint advice before '
  + 'finalizing plans, after a repeated test/compiler failure, and before staging, committing or completing tool work. '
  + 'Review its findings and resolve contract or auth-invariant problems before proceeding. Ordinary shell steps need no advisor call.';
