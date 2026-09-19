/** @license Apache-2.0 */
import os from 'node:os';
import path from 'node:path';
import type { LoadedConfig } from '../types.js';
import { AUTOHAND_HOME } from '../constants.js';
import { atomicWriteFile } from '../utils/atomicFile.js';
import { createTraceSourceRegistry } from './adapters/sourceRegistry.js';
import { TRACE_HARNESSES, type TraceHarness } from './model.js';
import { WorkMapModule, type WorkMapRequest } from './WorkMapModule.js';
import type { WorkMap } from './workMap.js';

const TRACE_HARNESS_SET = new Set<string>(TRACE_HARNESSES);

export interface LocalWorkMapOptions {
  homeDirectory?: string;
  autohandHome?: string;
  environment?: Record<string, string | undefined>;
  module?: Pick<WorkMapModule, 'map'>;
}

export function assertWorkMapEnabled(config: LoadedConfig): void {
  if (config.traces?.enabled !== true) {
    throw new Error('Enable local trace monitoring in /settings before using the Work Map.');
  }
  if (config.traces.discoveryMap === false) {
    throw new Error('Enable traces.discoveryMap in /settings before using the Work Map.');
  }
}

export function parseWorkMapHarnesses(value: string | readonly string[] | undefined): TraceHarness[] | undefined {
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
  const module = options.module ?? new WorkMapModule(createTraceSourceRegistry({
    homeDirectory: options.homeDirectory ?? os.homedir(),
    autohandHome: options.autohandHome ?? AUTOHAND_HOME,
    environment: options.environment ?? process.env,
  }));
  return module.map(request, signal);
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
