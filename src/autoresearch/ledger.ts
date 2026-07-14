/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import path from 'node:path';
import fs from 'fs-extra';
import { z } from 'zod';

export const LEDGER_SCHEMA_VERSION = 1 as const;
export const LEDGER_POLICY_VERSION = '1' as const;

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const JsonPrimitiveSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  JsonPrimitiveSchema,
  z.array(JsonValueSchema),
  z.record(z.string(), JsonValueSchema),
]));

const RecordBaseSchema = z.object({
  schemaVersion: z.literal(LEDGER_SCHEMA_VERSION),
  id: z.string().min(1),
  attemptId: z.string().min(1),
  timestamp: z.string().min(1),
  context: z.record(z.string(), JsonValueSchema),
});

export const MetricAggregateSchema = z.object({
  median: z.number().finite(),
  mad: z.number().finite().nonnegative(),
  sampleCount: z.number().int().positive(),
});
export type MetricAggregate = z.infer<typeof MetricAggregateSchema>;

export const EnvironmentFingerprintSchema = z.object({
  platform: z.string().min(1),
  architecture: z.string().min(1),
  cliVersion: z.string().min(1),
  nodeVersion: z.string().min(1),
  bunVersion: z.string(),
  gitVersion: z.string().min(1),
  lockfiles: z.record(z.string(), Sha256Schema),
  evaluators: z.record(z.string(), Sha256Schema),
  allowedEnvironment: z.record(z.string(), z.string()),
});
export type EnvironmentFingerprint = z.infer<typeof EnvironmentFingerprintSchema>;

export const CandidateRecordSchema = RecordBaseSchema.extend({
  type: z.literal('candidate'),
  description: z.string().min(1),
  baseCommit: z.string().min(7),
  parentAttemptId: z.string().min(1).nullable(),
  patchObject: Sha256Schema.nullable(),
  untrackedFiles: z.array(z.object({
    path: z.string().min(1),
    kind: z.enum(['file', 'symlink']),
    object: Sha256Schema,
    mode: z.number().int().nonnegative(),
  })),
  changedPaths: z.array(z.object({
    path: z.string().min(1),
    kind: z.enum(['added', 'modified', 'deleted', 'renamed']),
    hash: Sha256Schema.nullable(),
    mode: z.number().int().nonnegative().nullable(),
  })),
  evaluator: z.object({
    configObject: Sha256Schema,
    measureObject: Sha256Schema,
    checksObject: Sha256Schema.optional(),
    beforeHookObject: Sha256Schema.optional(),
    afterHookObject: Sha256Schema.optional(),
  }),
  environment: EnvironmentFingerprintSchema,
});
export type CandidateRecord = z.infer<typeof CandidateRecordSchema>;

export const EvaluationRecordSchema = RecordBaseSchema.extend({
  type: z.literal('evaluation'),
  evaluatorMode: z.enum(['original', 'current']),
  samples: z.array(z.object({
    sequence: z.number().int().positive(),
    metrics: z.record(z.string(), z.number().finite()),
    outputObject: Sha256Schema,
    durationMs: z.number().int().nonnegative(),
    timestamp: z.string().min(1),
  })),
  aggregates: z.record(z.string(), MetricAggregateSchema),
  checks: z.object({
    passed: z.boolean(),
    outputObject: Sha256Schema.optional(),
  }),
  execution: z.object({
    outcome: z.enum(['passed', 'benchmark_failed', 'checks_failed', 'cancelled']),
    error: z.string().optional(),
    outputObject: Sha256Schema.optional(),
  }),
  driftWarnings: z.array(z.string()),
});
export type EvaluationRecord = z.infer<typeof EvaluationRecordSchema>;

export const ConstraintResultSchema = z.object({
  metricName: z.string().min(1),
  operator: z.enum(['<', '<=', '>', '>=']),
  threshold: z.number().finite(),
  conservativeValue: z.number().finite(),
  passed: z.boolean(),
  conclusive: z.boolean(),
});
export type ConstraintResult = z.infer<typeof ConstraintResultSchema>;

export const DecisionRecordSchema = RecordBaseSchema.extend({
  type: z.literal('decision'),
  policyVersion: z.string().min(1),
  evaluationId: z.string().min(1),
  source: z.enum(['original', 'replay', 'rescore']),
  constraintResults: z.array(ConstraintResultSchema),
  primaryImprovement: z.number(),
  confidence: z.number(),
  outcome: z.enum(['accepted', 'rejected', 'inconclusive', 'checks_failed', 'crashed']),
  materialized: z.boolean(),
  explanation: z.string().min(1),
});
export type DecisionRecord = z.infer<typeof DecisionRecordSchema>;

export const PinRecordSchema = RecordBaseSchema.extend({
  type: z.literal('pin'),
  pinned: z.boolean(),
});
export type PinRecord = z.infer<typeof PinRecordSchema>;

export const ArtifactPrunedRecordSchema = RecordBaseSchema.extend({
  type: z.literal('artifact_pruned'),
  objects: z.array(Sha256Schema),
  bytesFreed: z.number().int().nonnegative(),
  reason: z.string().min(1),
});
export type ArtifactPrunedRecord = z.infer<typeof ArtifactPrunedRecordSchema>;

export const LedgerEventSchema = z.discriminatedUnion('type', [
  CandidateRecordSchema,
  EvaluationRecordSchema,
  DecisionRecordSchema,
  PinRecordSchema,
  ArtifactPrunedRecordSchema,
]);
export type LedgerEvent = z.infer<typeof LedgerEventSchema>;

export class LedgerCorruptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerCorruptionError';
  }
}

export class LedgerStore {
  readonly ledgerDir: string;
  readonly objectsDir: string;
  readonly eventsPath: string;

  constructor(readonly workspaceRoot: string) {
    this.ledgerDir = path.join(workspaceRoot, '.auto', 'ledger');
    this.objectsDir = path.join(this.ledgerDir, 'objects');
    this.eventsPath = path.join(this.ledgerDir, 'events.jsonl');
  }

  objectPath(objectId: string): string {
    if (!Sha256Schema.safeParse(objectId).success) {
      throw new Error(`Invalid autoresearch ledger object id: ${objectId}`);
    }
    return path.join(this.objectsDir, objectId);
  }

  async putObject(content: Buffer | string): Promise<string> {
    await assertSafeAutoresearchStorage(this.workspaceRoot);
    const buffer = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
    const objectId = createHash('sha256').update(buffer).digest('hex');
    const destination = this.objectPath(objectId);
    await fs.ensureDir(this.objectsDir);
    await assertSafeAutoresearchStorage(this.workspaceRoot);
    if (await fs.pathExists(destination)) {
      await this.readObject(objectId);
      return objectId;
    }

    const temporary = path.join(this.objectsDir, `.${objectId}.${randomUUID()}.tmp`);
    await fs.writeFile(temporary, buffer, { flag: 'wx', mode: 0o600 });
    try {
      await fs.rename(temporary, destination);
    } catch (error) {
      if (!(await fs.pathExists(destination))) throw error;
      await fs.remove(temporary);
      await this.readObject(objectId);
    }
    return objectId;
  }

  async readObject(objectId: string): Promise<Buffer> {
    await assertSafeAutoresearchStorage(this.workspaceRoot);
    const objectPath = this.objectPath(objectId);
    let content: Buffer;
    try {
      const stats = await fs.lstat(objectPath);
      if (!stats.isFile() || stats.isSymbolicLink()) {
        throw new Error('object path is not a regular file');
      }
      content = await fs.readFile(objectPath);
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      throw new LedgerCorruptionError(`Missing ledger object ${objectId}: ${details}`);
    }
    const actual = createHash('sha256').update(content).digest('hex');
    if (actual !== objectId) {
      throw new LedgerCorruptionError(`Corrupt ledger object ${objectId}: content hash is ${actual}.`);
    }
    return content;
  }

  async append(event: LedgerEvent): Promise<void> {
    const parsed = LedgerEventSchema.parse(event);
    await assertSafeAutoresearchStorage(this.workspaceRoot);
    await fs.ensureDir(this.ledgerDir);
    await assertSafeAutoresearchStorage(this.workspaceRoot);
    await fs.writeFile(this.eventsPath, `${JSON.stringify(parsed)}\n`, { flag: 'a', mode: 0o600 });
  }

  load(): Promise<LedgerEvent[]> {
    return loadLedgerEvents(this.workspaceRoot);
  }
}

export async function loadLedgerEvents(workspaceRoot: string): Promise<LedgerEvent[]> {
  await assertSafeAutoresearchStorage(workspaceRoot);
  const eventsPath = path.join(workspaceRoot, '.auto', 'ledger', 'events.jsonl');
  if (!(await fs.pathExists(eventsPath))) return [];

  const contents = await fs.readFile(eventsPath, 'utf8');
  const lines = contents.split('\n');
  const hasTrailingNewline = contents.endsWith('\n');
  const events: LedgerEvent[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    let json: unknown;
    try {
      json = JSON.parse(line) as unknown;
    } catch (error) {
      const isTruncatedFinalWrite = index === lines.length - 1
        && !hasTrailingNewline
        && isLikelyTruncatedJson(line, error);
      if (isTruncatedFinalWrite) break;
      const details = error instanceof Error ? error.message : String(error);
      throw new LedgerCorruptionError(
        `Invalid autoresearch ledger at ${eventsPath} line ${index + 1}: ${details}`
      );
    }
    const parsed = LedgerEventSchema.safeParse(json);
    if (!parsed.success) {
      throw new LedgerCorruptionError(
        `Invalid autoresearch ledger at ${eventsPath} line ${index + 1}: ${parsed.error.message}`
      );
    }
    events.push(parsed.data);
  }
  return events;
}

export async function assertSafeAutoresearchStorage(workspaceRoot: string): Promise<void> {
  const root = path.resolve(workspaceRoot);
  const directories = [
    path.join(root, '.auto'),
    path.join(root, '.auto', 'hooks'),
    path.join(root, '.auto', 'ledger'),
    path.join(root, '.auto', 'ledger', 'objects'),
  ];
  for (const directory of directories) {
    const stats = await lstatIfExists(directory);
    if (!stats) continue;
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(`Unsafe autoresearch storage path ${directory}: expected a real directory, not a symbolic link or special file.`);
    }
  }

  const files = [
    'config.json',
    'prompt.md',
    'measure.sh',
    'checks.sh',
    'log.jsonl',
    'state.json',
    'dashboard.html',
    'finalize.md',
    'finalize-branches.json',
  ].map((filename) => path.join(root, '.auto', filename));
  files.push(
    path.join(root, '.auto', 'hooks', 'before.sh'),
    path.join(root, '.auto', 'hooks', 'after.sh'),
    path.join(root, '.auto', 'ledger', 'events.jsonl')
  );
  for (const file of files) {
    const stats = await lstatIfExists(file);
    if (!stats) continue;
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error(`Unsafe autoresearch storage path ${file}: expected a regular file, not a symbolic link or special file.`);
    }
  }
}

async function lstatIfExists(filePath: string): Promise<Stats | null> {
  try {
    return await fs.lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot inspect autoresearch storage path ${filePath}: ${details}`);
  }
}

function isLikelyTruncatedJson(line: string, error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (/unexpected end of json input/i.test(message)) return true;
  const position = message.match(/position\s+(\d+)/i)?.[1];
  return position !== undefined && Number(position) >= line.length;
}

export function createLedgerId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}
