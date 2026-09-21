/** @license Apache-2.0 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import type {
  NormalizedTrace,
  TraceHarness,
  TracePart,
  TraceTokenUsage,
} from './model.js';
import { createOpaqueTraceId, deriveTraceTotalTokens } from './model.js';

export const WORK_MAP_SCHEMA_VERSION = 1 as const;

export interface WorkMapCoverageInput {
  harness: TraceHarness;
  filesScanned: number;
  bytesRead: number;
  warnings: number;
  truncated: boolean;
  sessions: number;
}

export interface WorkMapDerivationOptions {
  now?: Date;
  since: string;
  workspace?: string;
  harnesses?: readonly TraceHarness[];
  coverage: readonly WorkMapCoverageInput[];
  maxTools?: number;
  maxWorkflows?: number;
  maxDimensions?: number;
}

export interface WorkMapDimension {
  name: string;
  sessions: number;
  tokens: number;
}

export interface WorkMap {
  schemaVersion: typeof WORK_MAP_SCHEMA_VERSION;
  generatedAt: string;
  request: {
    since: string;
    sinceTimestamp: string;
    workspaceScope: 'all' | 'current';
    harnesses: TraceHarness[];
  };
  coverage: {
    sessions: number;
    sources: Array<WorkMapCoverageInput>;
    filesScanned: number;
    bytesRead: number;
    warnings: number;
    partial: boolean;
  };
  sessions: {
    total: number;
    active: number;
    completed: number;
    failed: number;
    cancelled: number;
    unknown: number;
    durationMs: number;
    tokens: number;
    usageProvenance: Record<TraceTokenUsage['provenance'], number>;
  };
  outcomes: {
    verified: number;
    completedUnverified: number;
    failed: number;
    cancelled: number;
    partial: number;
    unknown: number;
  };
  dimensions: {
    harnesses: WorkMapDimension[];
    models: WorkMapDimension[];
    providers: WorkMapDimension[];
    reasoningEfforts: WorkMapDimension[];
  };
  tools: Array<{
    category: ToolCategory;
    calls: number;
    errors: number;
    sessions: number;
  }>;
  workflows: Array<{
    motif: string;
    occurrences: number;
    sessions: number;
    verified: number;
  }>;
  verification: {
    sessionsWithObservedProof: number;
    testsPassed: number;
    testsFailed: number;
    lintPassed: number;
    buildPassed: number;
    proofPassed: number;
  };
  relationships: {
    parent: number;
    child: number;
    subagent: number;
    resume: number;
    fork: number;
    worktree: number;
  };
  repositories: {
    observed: number;
    multiRepositorySessions: number;
  };
  recommendations: Array<{
    kind: 'verification_gap' | 'test_recovery' | 'workflow_automation';
    evidenceCount: number;
    confidence: 'high' | 'medium' | 'low';
  }>;
  privacy: {
    contentProcessedLocally: true;
    networkRequests: false;
    persistedRawContent: false;
    outputContainsAggregatesOnly: true;
    excluded: string[];
  };
  limits: Array<{ name: string; value: number; reached: boolean }>;
}

type ToolCategory =
  | 'read'
  | 'search'
  | 'edit'
  | 'test'
  | 'lint'
  | 'build'
  | 'proof'
  | 'git'
  | 'web'
  | 'delegate'
  | 'other';

interface MutableDimension {
  sessions: Set<string>;
  tokens: number;
}

interface MutableToolAggregate {
  calls: number;
  errors: number;
  sessions: Set<string>;
}

interface MutableWorkflowAggregate {
  occurrences: number;
  sessions: Set<string>;
  verified: number;
}

const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_MODELS_PER_TRACE = 64;
const UNATTRIBUTED_MODEL = 'unattributed';
const SAFE_LABEL = /^[A-Za-z0-9][A-Za-z0-9._:/+ -]{0,79}$/u;
const SECRETISH = /(?:ahc_|sk-|github_pat_|gh[opsu]_|bearer\s|@|\\|\/Users\/|\/home\/|\/root\/)/iu;

function sinceTimestamp(value: string, now: Date): number {
  const match = /^(\d+)([dhm])$/u.exec(value.trim());
  if (!match) throw new Error('since must use a bounded duration such as 30d, 24h, or 60m.');
  const count = Number(match[1]);
  if (!Number.isSafeInteger(count) || count < 1 || count > 3_650) {
    throw new Error('since duration is outside the supported range.');
  }
  const multiplier = match[2] === 'd' ? DAY_MS : match[2] === 'h' ? 60 * 60 * 1_000 : 60 * 1_000;
  return now.getTime() - count * multiplier;
}

function safeDimensionLabel(value: string | undefined): string | undefined {
  const candidate = value?.trim();
  if (!candidate || !SAFE_LABEL.test(candidate) || SECRETISH.test(candidate)) return undefined;
  return candidate;
}

function traceTime(trace: NormalizedTrace): number | undefined {
  const value = trace.startedAt ?? trace.endedAt;
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isWithinWorkspace(trace: NormalizedTrace, workspace: string | undefined): boolean {
  if (!workspace) return true;
  const projectPath = trace.project.path;
  if (!projectPath) return false;
  const root = path.resolve(workspace);
  const candidate = path.resolve(projectPath);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function usageTotal(usage: TraceTokenUsage, harness: TraceHarness): number {
  return deriveTraceTotalTokens(usage, harness) ?? 0;
}

function explicitUsageBreakdown(
  trace: NormalizedTrace,
  totalTokens: number,
  labelFor: (entry: NonNullable<NormalizedTrace['modelUsage']>[number]) => string | undefined,
): Map<string, number> | undefined {
  if (!trace.modelUsage || trace.modelUsage.length === 0) return undefined;
  const breakdown = new Map<string, number>();
  let measuredTokens = 0;
  for (const entry of trace.modelUsage) {
    if (entry.usage.provenance === 'unavailable') continue;
    const tokens = usageTotal(entry.usage, trace.source.harness);
    if (tokens <= 0) continue;
    measuredTokens += tokens;
    const label = safeDimensionLabel(labelFor(entry));
    if (label && (breakdown.has(label) || breakdown.size < MAX_MODELS_PER_TRACE)) {
      breakdown.set(label, (breakdown.get(label) ?? 0) + tokens);
    }
  }
  if (measuredTokens === 0) return undefined;
  if (measuredTokens > totalTokens) return new Map([[UNATTRIBUTED_MODEL, totalTokens]]);
  const attributed = [...breakdown.values()].reduce((sum, value) => sum + value, 0);
  if (totalTokens > attributed) breakdown.set(UNATTRIBUTED_MODEL, totalTokens - attributed);
  return breakdown;
}

function modelTokenBreakdown(trace: NormalizedTrace, totalTokens: number): Map<string, number> {
  const explicit = explicitUsageBreakdown(trace, totalTokens, (entry) => entry.model);
  if (explicit) return explicit;
  const byModel = new Map<string, number>();
  const observedModels = new Set<string>();
  let measuredTokens = 0;
  for (const message of trace.messages) {
    const model = safeDimensionLabel(message.model);
    if (model && observedModels.size < 2) observedModels.add(model);
    if (message.usage.provenance === 'unavailable') continue;
    const tokens = usageTotal(message.usage, trace.source.harness);
    if (tokens <= 0) continue;
    measuredTokens += tokens;
    if (model && (byModel.has(model) || byModel.size < MAX_MODELS_PER_TRACE)) {
      byModel.set(model, (byModel.get(model) ?? 0) + tokens);
    }
  }

  if (measuredTokens > 0) {
    if (measuredTokens > totalTokens) return new Map([[UNATTRIBUTED_MODEL, totalTokens]]);
    const attributed = [...byModel.values()].reduce((sum, value) => sum + value, 0);
    if (totalTokens > attributed) byModel.set(UNATTRIBUTED_MODEL, totalTokens - attributed);
    return byModel;
  }
  if (observedModels.size > 1) return new Map([[UNATTRIBUTED_MODEL, totalTokens]]);
  const traceModel = safeDimensionLabel(trace.model);
  if (traceModel && observedModels.size === 1 && !observedModels.has(traceModel)) {
    return new Map([[UNATTRIBUTED_MODEL, totalTokens]]);
  }
  return new Map([[traceModel ?? [...observedModels][0] ?? UNATTRIBUTED_MODEL, totalTokens]]);
}

function providerTokenBreakdown(trace: NormalizedTrace, totalTokens: number): Map<string, number> {
  const explicit = explicitUsageBreakdown(trace, totalTokens, (entry) => entry.provider);
  if (explicit) return explicit;
  const provider = safeDimensionLabel(trace.provider);
  return provider ? new Map([[provider, totalTokens]]) : new Map();
}

function addDimension(
  dimensions: Map<string, MutableDimension>,
  name: string | undefined,
  traceId: string,
  tokens: number,
): void {
  const safeName = safeDimensionLabel(name);
  if (!safeName) return;
  const aggregate = dimensions.get(safeName) ?? { sessions: new Set<string>(), tokens: 0 };
  if (!aggregate.sessions.has(traceId)) {
    aggregate.sessions.add(traceId);
    aggregate.tokens += tokens;
  }
  dimensions.set(safeName, aggregate);
}

function renderDimensions(dimensions: Map<string, MutableDimension>, limit: number): WorkMapDimension[] {
  return [...dimensions.entries()]
    .map(([name, value]) => ({ name, sessions: value.sessions.size, tokens: value.tokens }))
    .sort((left, right) => right.tokens - left.tokens || right.sessions - left.sessions || left.name.localeCompare(right.name))
    .slice(0, limit);
}

function classifyCommand(args: unknown): ToolCategory | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined;
  const command = 'command' in args && typeof args.command === 'string' ? args.command.toLowerCase() : '';
  if (!command) return undefined;
  if (/\b(?:proof|check-release)\b/u.test(command)) return 'proof';
  if (/\b(?:test|vitest|jest|pytest|cargo test|go test)\b/u.test(command)) return 'test';
  if (/\b(?:lint|eslint|rubocop|clippy)\b/u.test(command)) return 'lint';
  if (/\b(?:build|compile|tsc)\b/u.test(command)) return 'build';
  if (/\bgit\b/u.test(command)) return 'git';
  return 'other';
}

function classifyTool(part: Extract<TracePart, { type: 'tool_call' }>): ToolCategory {
  const name = part.name.toLowerCase();
  if (/test|vitest|jest|pytest/u.test(name)) return 'test';
  if (/lint|eslint/u.test(name)) return 'lint';
  if (/build|compile/u.test(name)) return 'build';
  if (/proof/u.test(name)) return 'proof';
  if (/read|view|open/u.test(name)) return 'read';
  if (/search|find|grep|glob|list_tree/u.test(name)) return 'search';
  if (/write|edit|patch|replace|append|delete|rename|copy/u.test(name)) return 'edit';
  if (/git|worktree|commit|branch/u.test(name)) return 'git';
  if (/web|fetch|browser/u.test(name)) return 'web';
  if (/delegate|agent|team|task/u.test(name)) return 'delegate';
  if (/command|shell|terminal|exec|run/u.test(name)) return classifyCommand(part.arguments) ?? 'other';
  return 'other';
}

function workflowStage(category: ToolCategory): string | undefined {
  if (category === 'read' || category === 'search') return 'inspect';
  if (category === 'edit') return 'edit';
  if (category === 'test' || category === 'lint' || category === 'build' || category === 'proof') return category;
  if (category === 'git') return 'git';
  if (category === 'delegate') return 'delegate';
  return undefined;
}

function outcomeState(trace: NormalizedTrace): NonNullable<NormalizedTrace['outcome']>['state'] {
  if (trace.outcome) return trace.outcome.state;
  if (trace.status === 'failed') return 'failed';
  if (trace.status === 'cancelled') return 'cancelled';
  if (trace.status === 'completed') return 'completed_unverified';
  if (trace.status === 'active') return 'partial';
  return 'unknown';
}

function durationMs(trace: NormalizedTrace): number {
  if (!trace.startedAt || !trace.endedAt) return 0;
  const start = Date.parse(trace.startedAt);
  const end = Date.parse(trace.endedAt);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : 0;
}

function repositoryKey(trace: NormalizedTrace): string | undefined {
  return trace.project.gitRemote ?? trace.project.path ?? trace.project.name;
}

function opaqueLocalId(prefix: string, value: string, length = 32): string {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, length)}`;
}

function opaqueFingerprint(value: string): string {
  return /^sha256:[a-f0-9]{64}$/u.test(value)
    ? value
    : `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function projectTraceForLocalIndex(trace: NormalizedTrace): NormalizedTrace {
  const parts: TracePart[] = [];
  const callCategories = new Map<string, ToolCategory>();
  for (const message of trace.messages) {
    for (const part of message.parts) {
      if (parts.length >= 1_000) break;
      if (part.type === 'tool_call') {
        const category = classifyTool(part);
        if (part.callId) callCategories.set(part.callId, category);
        parts.push({ type: 'tool_call', name: category });
      } else if (part.type === 'tool_result' && (part.isError === true || part.exitCode !== undefined)) {
        const category = part.callId ? callCategories.get(part.callId) : undefined;
        parts.push({
          type: 'tool_result',
          name: category ?? 'other',
          ...(part.isError === true ? { isError: true } : {}),
          ...(part.exitCode === undefined ? {} : { exitCode: part.exitCode }),
        });
      } else if (part.type === 'error') {
        parts.push({ type: 'error', code: 'observed_error' });
      }
    }
  }
  const repository = repositoryKey(trace);
  const agentVersion = safeDimensionLabel(trace.agent.version);
  const model = safeDimensionLabel(trace.model);
  const provider = safeDimensionLabel(trace.provider);
  const reasoningEffort = safeDimensionLabel(trace.reasoningEffort);
  const modelUsage = trace.modelUsage?.flatMap((entry) => {
    const usageModel = safeDimensionLabel(entry.model);
    if (!usageModel) return [];
    const usageProvider = safeDimensionLabel(entry.provider);
    const task = safeDimensionLabel(entry.task);
    return [{
      model: usageModel,
      ...(usageProvider ? { provider: usageProvider } : {}),
      ...(task ? { task } : {}),
      usage: entry.usage,
    }];
  });
  const modelSummaries: NormalizedTrace['messages'] = usageTotal(trace.usage, trace.source.harness) > 0
    ? [...modelTokenBreakdown(trace, usageTotal(trace.usage, trace.source.harness))]
      .map(([name, tokens], order) => ({
        id: opaqueLocalId('msg', `${trace.id}\0model\0${name}`),
        role: 'assistant' as const,
        order,
        model: name,
        usage: { total: tokens, provenance: trace.usage.provenance },
        parts: [],
      }))
    : [];
  return {
    schemaVersion: trace.schemaVersion,
    id: createOpaqueTraceId(trace.id),
    source: {
      harness: trace.source.harness,
      externalId: opaqueLocalId('ext', trace.source.externalId, 64),
      recordPath: 'local-index',
      fingerprint: opaqueFingerprint(trace.source.fingerprint),
    },
    agent: {
      name: trace.source.harness,
      ...(agentVersion ? { version: agentVersion } : {}),
    },
    project: repository ? { name: opaqueLocalId('repo', repository) } : {},
    ...(trace.startedAt ? { startedAt: trace.startedAt } : {}),
    ...(trace.endedAt ? { endedAt: trace.endedAt } : {}),
    status: trace.status,
    ...(model ? { model } : {}),
    ...(provider ? { provider } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(trace.contextWindow === undefined ? {} : { contextWindow: trace.contextWindow }),
    usage: trace.usage,
    ...(modelUsage && modelUsage.length > 0 ? { modelUsage } : {}),
    relationships: trace.relationships.map((relationship) => ({
      type: relationship.type,
      traceId: createOpaqueTraceId(relationship.traceId),
    })),
    messages: parts.length === 0 ? modelSummaries : [...modelSummaries, {
      id: opaqueLocalId('msg', trace.id),
      role: 'assistant',
      order: modelSummaries.length,
      usage: { provenance: 'unavailable' },
      parts,
    }],
    ...(trace.outcome ? { outcome: trace.outcome } : {}),
    provenance: {
      adapterVersion: trace.provenance.adapterVersion,
      parsedAt: trace.provenance.parsedAt,
      completeness: parts.length > 0 ? 'partial' : 'metadata_only',
      warnings: [],
    },
  };
}

export function deriveWorkMap(
  traces: readonly NormalizedTrace[],
  options: WorkMapDerivationOptions,
): WorkMap {
  const now = options.now ?? new Date();
  const lowerBound = sinceTimestamp(options.since, now);
  const selectedHarnesses = new Set(options.harnesses ?? []);
  const selected = traces.filter((trace) => {
    const timestamp = traceTime(trace);
    return (timestamp === undefined || timestamp >= lowerBound)
      && isWithinWorkspace(trace, options.workspace)
      && (selectedHarnesses.size === 0 || selectedHarnesses.has(trace.source.harness));
  });
  const maxTools = Math.max(1, Math.min(options.maxTools ?? 20, 100));
  const maxWorkflows = Math.max(1, Math.min(options.maxWorkflows ?? 20, 100));
  const maxDimensions = Math.max(1, Math.min(options.maxDimensions ?? 50, 200));
  const dimensions = {
    harnesses: new Map<string, MutableDimension>(),
    models: new Map<string, MutableDimension>(),
    providers: new Map<string, MutableDimension>(),
    reasoningEfforts: new Map<string, MutableDimension>(),
  };
  const tools = new Map<ToolCategory, MutableToolAggregate>();
  const workflows = new Map<string, MutableWorkflowAggregate>();
  const repositories = new Set<string>();
  const sessionCounts = { active: 0, completed: 0, failed: 0, cancelled: 0, unknown: 0 };
  const outcomes = { verified: 0, completedUnverified: 0, failed: 0, cancelled: 0, partial: 0, unknown: 0 };
  const provenance: Record<TraceTokenUsage['provenance'], number> = { actual: 0, estimated: 0, unavailable: 0 };
  const verification = {
    sessionsWithObservedProof: 0,
    testsPassed: 0,
    testsFailed: 0,
    lintPassed: 0,
    buildPassed: 0,
    proofPassed: 0,
  };
  const relationships = { parent: 0, child: 0, subagent: 0, resume: 0, fork: 0, worktree: 0 };
  let totalTokens = 0;
  let totalDurationMs = 0;

  for (const trace of selected) {
    const tokens = usageTotal(trace.usage, trace.source.harness);
    totalTokens += tokens;
    totalDurationMs += durationMs(trace);
    sessionCounts[trace.status] += 1;
    provenance[trace.usage.provenance] += 1;
    addDimension(dimensions.harnesses, trace.source.harness, trace.id, tokens);
    for (const [name, modelTokens] of modelTokenBreakdown(trace, tokens)) {
      addDimension(dimensions.models, name, trace.id, modelTokens);
    }
    for (const [name, providerTokens] of providerTokenBreakdown(trace, tokens)) {
      addDimension(dimensions.providers, name, trace.id, providerTokens);
    }
    addDimension(dimensions.reasoningEfforts, trace.reasoningEffort, trace.id, tokens);
    const repository = repositoryKey(trace);
    if (repository) repositories.add(repository);
    for (const relationship of trace.relationships) relationships[relationship.type] += 1;

    const state = outcomeState(trace);
    if (state === 'completed_unverified') outcomes.completedUnverified += 1;
    else outcomes[state] += 1;
    const facts = new Set(trace.outcome?.facts ?? []);
    const hasProof = ['tests_passed', 'lint_passed', 'build_passed', 'proof_passed']
      .some((fact) => facts.has(fact as NonNullable<NormalizedTrace['outcome']>['facts'][number]));
    if (hasProof) verification.sessionsWithObservedProof += 1;
    if (facts.has('tests_passed')) verification.testsPassed += 1;
    if (facts.has('tests_failed')) verification.testsFailed += 1;
    if (facts.has('lint_passed')) verification.lintPassed += 1;
    if (facts.has('build_passed')) verification.buildPassed += 1;
    if (facts.has('proof_passed')) verification.proofPassed += 1;

    const stages: string[] = [];
    const callCategories = new Map<string, ToolCategory>();
    for (const message of trace.messages) {
      for (const part of message.parts) {
        if (part.type !== 'tool_call') continue;
        const category = classifyTool(part);
        if (part.callId) callCategories.set(part.callId, category);
        const aggregate = tools.get(category) ?? { calls: 0, errors: 0, sessions: new Set<string>() };
        aggregate.calls += 1;
        aggregate.sessions.add(trace.id);
        tools.set(category, aggregate);
        const stage = workflowStage(category);
        if (stage && stages.at(-1) !== stage) stages.push(stage);
      }
    }
    for (const message of trace.messages) {
      for (const part of message.parts) {
        if (
          part.type !== 'tool_result'
          || (part.isError !== true && (part.exitCode === undefined || part.exitCode === 0))
        ) continue;
        const category = (part.callId ? callCategories.get(part.callId) : undefined)
          ?? classifyTool({ type: 'tool_call', name: part.name ?? 'other' });
        const aggregate = tools.get(category);
        if (aggregate) aggregate.errors += 1;
      }
    }
    if (stages.length >= 2) {
      const motif = stages.slice(0, 6).join(' -> ');
      const aggregate = workflows.get(motif) ?? { occurrences: 0, sessions: new Set<string>(), verified: 0 };
      aggregate.occurrences += 1;
      aggregate.sessions.add(trace.id);
      if (state === 'verified') aggregate.verified += 1;
      workflows.set(motif, aggregate);
    }
  }

  const renderedTools = [...tools.entries()]
    .map(([category, value]) => ({
      category,
      calls: value.calls,
      errors: value.errors,
      sessions: value.sessions.size,
    }))
    .sort((left, right) => right.calls - left.calls || left.category.localeCompare(right.category))
    .slice(0, maxTools);
  const renderedWorkflows = [...workflows.entries()]
    .map(([motif, value]) => ({
      motif,
      occurrences: value.occurrences,
      sessions: value.sessions.size,
      verified: value.verified,
    }))
    .sort((left, right) => right.occurrences - left.occurrences || left.motif.localeCompare(right.motif))
    .slice(0, maxWorkflows);
  const coverageSources = [...options.coverage]
    .filter((source) => selectedHarnesses.size === 0 || selectedHarnesses.has(source.harness))
    .sort((left, right) => left.harness.localeCompare(right.harness));
  const warnings = coverageSources.reduce((total, source) => total + source.warnings, 0);
  const recommendations: WorkMap['recommendations'] = [];
  if (outcomes.completedUnverified > 0) {
    recommendations.push({
      kind: 'verification_gap',
      evidenceCount: outcomes.completedUnverified,
      confidence: outcomes.completedUnverified >= 5 ? 'high' : outcomes.completedUnverified >= 2 ? 'medium' : 'low',
    });
  }
  if (verification.testsFailed > 0) {
    recommendations.push({
      kind: 'test_recovery',
      evidenceCount: verification.testsFailed,
      confidence: verification.testsFailed >= 5 ? 'high' : verification.testsFailed >= 2 ? 'medium' : 'low',
    });
  }
  const repeatedWorkflow = renderedWorkflows.find((workflow) => workflow.occurrences >= 3);
  if (repeatedWorkflow) {
    recommendations.push({
      kind: 'workflow_automation',
      evidenceCount: repeatedWorkflow.occurrences,
      confidence: repeatedWorkflow.occurrences >= 10 ? 'high' : 'medium',
    });
  }

  return {
    schemaVersion: WORK_MAP_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    request: {
      since: options.since,
      sinceTimestamp: new Date(lowerBound).toISOString(),
      workspaceScope: options.workspace ? 'current' : 'all',
      harnesses: selectedHarnesses.size > 0
        ? [...selectedHarnesses].sort()
        : [...new Set(coverageSources.map((source) => source.harness))].sort(),
    },
    coverage: {
      sessions: selected.length,
      sources: coverageSources,
      filesScanned: coverageSources.reduce((total, source) => total + source.filesScanned, 0),
      bytesRead: coverageSources.reduce((total, source) => total + source.bytesRead, 0),
      warnings,
      partial: warnings > 0 || coverageSources.some((source) => source.truncated),
    },
    sessions: {
      total: selected.length,
      ...sessionCounts,
      durationMs: totalDurationMs,
      tokens: totalTokens,
      usageProvenance: provenance,
    },
    outcomes,
    dimensions: {
      harnesses: renderDimensions(dimensions.harnesses, maxDimensions),
      models: renderDimensions(dimensions.models, maxDimensions),
      providers: renderDimensions(dimensions.providers, maxDimensions),
      reasoningEfforts: renderDimensions(dimensions.reasoningEfforts, maxDimensions),
    },
    tools: renderedTools,
    workflows: renderedWorkflows,
    verification,
    relationships,
    repositories: {
      observed: repositories.size,
      multiRepositorySessions: countMultiRepositorySessions(selected),
    },
    recommendations,
    privacy: {
      contentProcessedLocally: true,
      networkRequests: false,
      persistedRawContent: false,
      outputContainsAggregatesOnly: true,
      excluded: [
        'prompts',
        'responses',
        'reasoning',
        'tool arguments and results',
        'commands',
        'source code and diffs',
        'absolute paths',
        'repository names and remotes',
        'session identifiers',
        'credentials and environment values',
      ],
    },
    limits: [
      { name: 'tools', value: maxTools, reached: tools.size > maxTools },
      { name: 'workflows', value: maxWorkflows, reached: workflows.size > maxWorkflows },
      {
        name: 'dimensions',
        value: maxDimensions,
        reached: Object.values(dimensions).some((values) => values.size > maxDimensions),
      },
    ],
  };
}

function countMultiRepositorySessions(traces: readonly NormalizedTrace[]): number {
  const byId = new Map(traces.map((trace) => [trace.id, trace]));
  const adjacent = new Map<string, Set<string>>();
  for (const trace of traces) {
    adjacent.set(trace.id, adjacent.get(trace.id) ?? new Set<string>());
    for (const relationship of trace.relationships) {
      if (!byId.has(relationship.traceId)) continue;
      adjacent.get(trace.id)!.add(relationship.traceId);
      const reverse = adjacent.get(relationship.traceId) ?? new Set<string>();
      reverse.add(trace.id);
      adjacent.set(relationship.traceId, reverse);
    }
  }

  const visited = new Set<string>();
  let count = 0;
  for (const trace of traces) {
    if (visited.has(trace.id)) continue;
    const pending = [trace.id];
    const component: NormalizedTrace[] = [];
    while (pending.length > 0) {
      const traceId = pending.pop()!;
      if (visited.has(traceId)) continue;
      visited.add(traceId);
      const member = byId.get(traceId);
      if (member) component.push(member);
      for (const neighbor of adjacent.get(traceId) ?? []) {
        if (!visited.has(neighbor)) pending.push(neighbor);
      }
    }
    const componentRepositories = new Set(
      component.map(repositoryKey).filter((value): value is string => value !== undefined),
    );
    if (componentRepositories.size > 1) count += component.length;
  }
  return count;
}
