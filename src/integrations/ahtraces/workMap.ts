/** @license Apache-2.0 */
import path from 'node:path';
import { z } from 'zod';
import type { LoadedConfig } from '../../types.js';
import { atomicWriteFile } from '../../utils/atomicFile.js';
import { isTraceMonitoringEnabled } from './consent.js';
import { runAhTracesProcess, type AhTracesRunner } from './client.js';

export const TRACE_HARNESSES = [
  'autohand', 'claude-code', 'cursor', 'opencode', 'opencode2', 'codex', 'pi', 'amp',
  'copilot', 'cline', 'openclaw', 'hermes', 'droid', 'grok', 'kimi', 'antigravity',
  'prime-agent', 'fx', 'deepseek',
] as const;

const traceHarnessSchema = z.enum(TRACE_HARNESSES);
export type TraceHarness = z.infer<typeof traceHarnessSchema>;

const nonnegativeInteger = z.number().int().nonnegative();
const dimensionSchema = z.object({
  name: z.string(),
  sessions: nonnegativeInteger,
  tokens: nonnegativeInteger,
}).strict();
const coverageSourceSchema = z.object({
  harness: traceHarnessSchema,
  filesScanned: nonnegativeInteger,
  bytesRead: nonnegativeInteger,
  warnings: nonnegativeInteger,
  truncated: z.boolean(),
  sessions: nonnegativeInteger,
}).strict();

const workMapSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string(),
  request: z.object({
    since: z.string(),
    sinceTimestamp: z.string(),
    workspaceScope: z.enum(['all', 'current']),
    harnesses: z.array(traceHarnessSchema),
  }).strict(),
  coverage: z.object({
    sessions: nonnegativeInteger,
    sources: z.array(coverageSourceSchema),
    filesScanned: nonnegativeInteger,
    bytesRead: nonnegativeInteger,
    warnings: nonnegativeInteger,
    partial: z.boolean(),
  }).strict(),
  sessions: z.object({
    total: nonnegativeInteger,
    active: nonnegativeInteger,
    completed: nonnegativeInteger,
    failed: nonnegativeInteger,
    cancelled: nonnegativeInteger,
    unknown: nonnegativeInteger,
    durationMs: nonnegativeInteger,
    tokens: nonnegativeInteger,
    usageProvenance: z.object({
      actual: nonnegativeInteger,
      estimated: nonnegativeInteger,
      unavailable: nonnegativeInteger,
    }).strict(),
  }).strict(),
  outcomes: z.object({
    verified: nonnegativeInteger,
    completedUnverified: nonnegativeInteger,
    failed: nonnegativeInteger,
    cancelled: nonnegativeInteger,
    partial: nonnegativeInteger,
    unknown: nonnegativeInteger,
  }).strict(),
  dimensions: z.object({
    harnesses: z.array(dimensionSchema),
    models: z.array(dimensionSchema),
    providers: z.array(dimensionSchema),
    reasoningEfforts: z.array(dimensionSchema),
  }).strict(),
  tools: z.array(z.object({
    category: z.enum(['read', 'search', 'edit', 'test', 'lint', 'build', 'proof', 'git', 'web', 'delegate', 'other']),
    calls: nonnegativeInteger,
    errors: nonnegativeInteger,
    sessions: nonnegativeInteger,
  }).strict()),
  workflows: z.array(z.object({
    motif: z.string(),
    occurrences: nonnegativeInteger,
    sessions: nonnegativeInteger,
    verified: nonnegativeInteger,
  }).strict()),
  verification: z.object({
    sessionsWithObservedProof: nonnegativeInteger,
    testsPassed: nonnegativeInteger,
    testsFailed: nonnegativeInteger,
    lintPassed: nonnegativeInteger,
    buildPassed: nonnegativeInteger,
    proofPassed: nonnegativeInteger,
  }).strict(),
  relationships: z.object({
    parent: nonnegativeInteger,
    child: nonnegativeInteger,
    subagent: nonnegativeInteger,
    resume: nonnegativeInteger,
    fork: nonnegativeInteger,
    worktree: nonnegativeInteger,
  }).strict(),
  repositories: z.object({
    observed: nonnegativeInteger,
    multiRepositorySessions: nonnegativeInteger,
  }).strict(),
  recommendations: z.array(z.object({
    kind: z.enum(['verification_gap', 'test_recovery', 'workflow_automation']),
    evidenceCount: nonnegativeInteger,
    confidence: z.enum(['high', 'medium', 'low']),
  }).strict()),
  privacy: z.object({
    contentProcessedLocally: z.literal(true),
    networkRequests: z.literal(false),
    persistedRawContent: z.literal(false),
    outputContainsAggregatesOnly: z.literal(true),
    excluded: z.array(z.string()),
  }).strict(),
  limits: z.array(z.object({
    name: z.string(),
    value: nonnegativeInteger,
    reached: z.boolean(),
  }).strict()),
}).strict();

export type WorkMap = z.infer<typeof workMapSchema>;

export interface WorkMapRequest {
  since?: string;
  workspace?: string;
  harnesses?: readonly TraceHarness[];
}

export interface LocalWorkMapOptions {
  run?: AhTracesRunner;
}

const TRACE_HARNESS_SET = new Set<string>(TRACE_HARNESSES);

export function assertWorkMapEnabled(config: LoadedConfig): void {
  if (!isTraceMonitoringEnabled(config)) {
    throw new Error('Enable local trace monitoring in /settings before using the Work Map.');
  }
  if (config.traces?.discoveryMap === false) {
    throw new Error('Enable traces.discoveryMap in /settings before using the Work Map.');
  }
}

export function parseWorkMapHarnesses(
  value: string | readonly string[] | undefined,
): TraceHarness[] | undefined {
  if (value === undefined) return undefined;
  const requested = (typeof value === 'string' ? value.split(',') : value)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (requested.length === 0) throw new Error('Select at least one trace agent.');
  const unique = [...new Set(requested)];
  const unknown = unique.filter((entry) => !TRACE_HARNESS_SET.has(entry));
  if (unknown.length > 0) {
    throw new Error(`Unknown trace agent: ${unknown.join(', ')}. Supported agents: ${TRACE_HARNESSES.join(', ')}.`);
  }
  return unique as TraceHarness[];
}

export async function buildLocalWorkMap(
  config: LoadedConfig,
  request: WorkMapRequest,
  signal?: AbortSignal,
  options: LocalWorkMapOptions = {},
): Promise<WorkMap> {
  assertWorkMapEnabled(config);
  signal?.throwIfAborted();
  const args = ['map', '--json', '--since', request.since ?? '30d'];
  if (request.workspace) args.push('--workspace', request.workspace);
  if (request.harnesses?.length) args.push('--agent', request.harnesses.join(','));
  const result = await (options.run ?? runAhTracesProcess)(args, { signal });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `ahtraces exited with code ${result.exitCode}.`);
  }
  try {
    return workMapSchema.parse(JSON.parse(result.stdout));
  } catch {
    throw new Error('ahtraces returned an invalid aggregate Work Map.');
  }
}

function dimensionLine(label: string, values: WorkMap['dimensions']['harnesses']): string {
  const rendered = values.slice(0, 8).map((value) => `${value.name} ${value.sessions}`).join(' · ');
  return `  ${label.padEnd(10)} ${rendered || 'none observed'}`;
}

export function renderWorkMap(map: WorkMap): string {
  return [
    'WORK MAP',
    `  Window     ${map.request.since}`,
    `  Sessions   ${map.sessions.total} (${map.sessions.completed} completed, ${map.sessions.failed} failed, ${map.sessions.active} active)`,
    `  Tokens     ${map.sessions.tokens}`,
    `  Coverage   ${map.coverage.sources.length} agents · ${map.coverage.filesScanned} files${map.coverage.partial ? ' · partial' : ''}`,
    '',
    dimensionLine('Agents', map.dimensions.harnesses),
    dimensionLine('Models', map.dimensions.models),
    dimensionLine('Providers', map.dimensions.providers),
    dimensionLine('Reasoning', map.dimensions.reasoningEfforts),
    '',
    `  Outcomes   ${map.outcomes.verified} verified · ${map.outcomes.completedUnverified} unverified · ${map.outcomes.failed} failed · ${map.outcomes.partial} partial`,
    `  Proof      tests ${map.verification.testsPassed}/${map.verification.testsFailed} · lint ${map.verification.lintPassed} · build ${map.verification.buildPassed} · proof ${map.verification.proofPassed}`,
    `  Privacy    aggregate-only · local processing · ${map.privacy.networkRequests ? 'network used' : 'no network requests'}`,
  ].join('\n');
}

export async function writeWorkMapOutput(filePath: string, map: WorkMap): Promise<string> {
  const resolved = path.resolve(filePath);
  await atomicWriteFile(resolved, `${JSON.stringify(map, null, 2)}\n`);
  return resolved;
}
