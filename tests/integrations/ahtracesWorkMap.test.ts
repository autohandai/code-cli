/** @license Apache-2.0 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LoadedConfig } from '../../src/types.js';
import type { AhTracesRunner } from '../../src/integrations/ahtraces/client.js';
import {
  buildLocalWorkMap,
  parseWorkMapHarnesses,
  renderWorkMap,
  writeWorkMapOutput,
  type WorkMap,
} from '../../src/integrations/ahtraces/workMap.js';

const temporaryDirectories: string[] = [];

function emptyMap(since = '30d'): WorkMap {
  return {
    schemaVersion: 1,
    generatedAt: '2026-09-21T00:00:00.000Z',
    request: { since, sinceTimestamp: '2026-08-22T00:00:00.000Z', workspaceScope: 'all', harnesses: [] },
    coverage: { sessions: 0, sources: [], filesScanned: 0, bytesRead: 0, warnings: 0, partial: false },
    sessions: {
      total: 0, active: 0, completed: 0, failed: 0, cancelled: 0, unknown: 0,
      durationMs: 0, tokens: 0,
      usageProvenance: { actual: 0, estimated: 0, unavailable: 0 },
    },
    outcomes: { verified: 0, completedUnverified: 0, failed: 0, cancelled: 0, partial: 0, unknown: 0 },
    dimensions: { harnesses: [], models: [], providers: [], reasoningEfforts: [] },
    tools: [],
    workflows: [],
    verification: {
      sessionsWithObservedProof: 0, testsPassed: 0, testsFailed: 0,
      lintPassed: 0, buildPassed: 0, proofPassed: 0,
    },
    relationships: { parent: 0, child: 0, subagent: 0, resume: 0, fork: 0, worktree: 0 },
    repositories: { observed: 0, multiRepositorySessions: 0 },
    recommendations: [],
    privacy: {
      contentProcessedLocally: true,
      networkRequests: false,
      persistedRawContent: false,
      outputContainsAggregatesOnly: true,
      excluded: ['prompts'],
    },
    limits: [],
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe('ahtraces Work Map integration', () => {
  it('requires explicit monitoring and map consent before launching the component', async () => {
    const run = vi.fn<AhTracesRunner>();
    await expect(buildLocalWorkMap({ traces: { enabled: false } } as LoadedConfig, {}, undefined, { run }))
      .rejects.toThrow('Enable local trace monitoring');
    await expect(buildLocalWorkMap({
      traces: { consentVersion: 1, enabled: true, discoveryMap: false },
    } as LoadedConfig, {}, undefined, { run })).rejects.toThrow('traces.discoveryMap');
    expect(run).not.toHaveBeenCalled();
  });

  it('validates agent filters and delegates the bounded scan to ahtraces', async () => {
    const expected = emptyMap('7d');
    const run = vi.fn<AhTracesRunner>(async () => ({
      exitCode: 0,
      stdout: JSON.stringify(expected),
      stderr: '',
    }));
    const result = await buildLocalWorkMap({
      traces: { consentVersion: 1, enabled: true, discoveryMap: true },
    } as LoadedConfig, {
      since: '7d',
      workspace: '/tmp/project',
      harnesses: parseWorkMapHarnesses('autohand,codex'),
    }, undefined, { run });

    expect(result).toEqual(expected);
    expect(run).toHaveBeenCalledWith([
      'map', '--json', '--since', '7d', '--workspace', '/tmp/project', '--agent', 'autohand,codex',
    ], { signal: undefined });
    expect(() => parseWorkMapHarnesses('unknown-agent')).toThrow('Unknown trace agent');
  });

  it('rejects malformed or content-bearing protocol output', async () => {
    const run = vi.fn<AhTracesRunner>(async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ ...emptyMap(), messages: [{ role: 'user', content: 'secret' }] }),
      stderr: '',
    }));
    await expect(buildLocalWorkMap({
      traces: { consentVersion: 1, enabled: true, discoveryMap: true },
    } as LoadedConfig, {}, undefined, { run })).rejects.toThrow('invalid aggregate Work Map');
  });

  it('renders and atomically writes aggregate-only output', async () => {
    const map = emptyMap();
    const directory = await mkdtemp(path.join(os.tmpdir(), 'autohand-work-map-'));
    temporaryDirectories.push(directory);
    const output = path.join(directory, 'map.json');

    expect(renderWorkMap(map)).toContain('no network requests');
    await writeWorkMapOutput(output, map);
    expect(JSON.parse(await readFile(output, 'utf8'))).toEqual(map);
  });
});
