/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CandidateRecordSchema,
  EvaluationRecordSchema,
  LedgerStore,
  loadLedgerEvents,
  type CandidateRecord,
} from '../../src/autoresearch/ledger.js';

const tempRoots: string[] = [];

async function createWorkspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-ledger-'));
  tempRoots.push(root);
  return root;
}

function candidateRecord(overrides: Partial<CandidateRecord> = {}): CandidateRecord {
  return {
    schemaVersion: 1,
    type: 'candidate',
    id: 'event_candidate_1',
    attemptId: 'attempt_1',
    timestamp: '2026-07-15T00:00:00.000Z',
    context: {},
    description: 'reduce runtime',
    baseCommit: '0123456789abcdef0123456789abcdef01234567',
    parentAttemptId: null,
    patchObject: null,
    untrackedFiles: [],
    changedPaths: [],
    evaluator: {
      configObject: 'a'.repeat(64),
      measureObject: 'b'.repeat(64),
    },
    environment: {
      platform: 'darwin',
      architecture: 'arm64',
      cliVersion: '0.8.2',
      nodeVersion: 'v22.0.0',
      bunVersion: '1.2.0',
      gitVersion: 'git version 2.50.0',
      lockfiles: {},
      evaluators: {},
      allowedEnvironment: {},
    },
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.remove(root)));
});

describe('autoresearch ledger schemas and persistence', () => {
  it('validates discriminated immutable candidate and evaluation records', () => {
    expect(CandidateRecordSchema.parse(candidateRecord()).type).toBe('candidate');
    expect(EvaluationRecordSchema.parse({
      schemaVersion: 1,
      type: 'evaluation',
      id: 'event_evaluation_1',
      attemptId: 'attempt_1',
      timestamp: '2026-07-15T00:01:00.000Z',
      context: {},
      evaluatorMode: 'original',
      samples: [{
        sequence: 1,
        metrics: { total_ms: 42 },
        outputObject: 'c'.repeat(64),
        durationMs: 10,
        timestamp: '2026-07-15T00:01:00.000Z',
      }],
      aggregates: { total_ms: { median: 42, mad: 0, sampleCount: 1 } },
      checks: { passed: true },
      execution: { outcome: 'passed' },
      driftWarnings: [],
    }).type).toBe('evaluation');
  });

  it('deduplicates objects by SHA-256 and verifies content on read', async () => {
    const root = await createWorkspace();
    const store = new LedgerStore(root);

    const first = await store.putObject(Buffer.from('same artifact'));
    const second = await store.putObject(Buffer.from('same artifact'));

    expect(first).toBe(second);
    expect(await store.readObject(first)).toEqual(Buffer.from('same artifact'));
    expect(await fs.readdir(path.join(root, '.auto', 'ledger', 'objects'))).toEqual([first]);
  });

  it('tolerates only a truncated final JSONL record', async () => {
    const root = await createWorkspace();
    const store = new LedgerStore(root);
    await store.append(candidateRecord());
    await fs.appendFile(store.eventsPath, '{"schemaVersion":1,"type":"evaluation"');

    await expect(loadLedgerEvents(root)).resolves.toHaveLength(1);

    await fs.writeFile(store.eventsPath, [
      JSON.stringify(candidateRecord()),
      '{not-json}',
      JSON.stringify(candidateRecord({ id: 'event_candidate_2', attemptId: 'attempt_2' })),
      '',
    ].join('\n'));

    await expect(loadLedgerEvents(root)).rejects.toThrow(/events\.jsonl line 2/i);

    await fs.writeFile(store.eventsPath, '{"schemaVersion":1,"type":"candidate"}');
    await expect(loadLedgerEvents(root)).rejects.toThrow(/events\.jsonl line 1/i);

    await fs.writeFile(store.eventsPath, '{not-json}');
    await expect(loadLedgerEvents(root)).rejects.toThrow(/events\.jsonl line 1/i);
  });

  it('reports object corruption instead of returning unverified bytes', async () => {
    const root = await createWorkspace();
    const store = new LedgerStore(root);
    const objectId = await store.putObject(Buffer.from('expected'));
    await fs.writeFile(store.objectPath(objectId), 'corrupt');

    await expect(store.readObject(objectId)).rejects.toThrow(/corrupt ledger object/i);
  });
});
