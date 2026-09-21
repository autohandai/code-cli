/**
 * Canonical, versioned trace model shared by local Work Map derivation and
 * explicitly consented cloud uploads.
 *
 * @license Apache-2.0
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';

export const TRACE_SCHEMA_VERSION = 1 as const;

export const TRACE_HARNESSES = [
  'autohand',
  'claude-code',
  'cursor',
  'opencode',
  'opencode2',
  'codex',
  'pi',
  'amp',
  'copilot',
  'cline',
  'openclaw',
  'hermes',
  'droid',
  'grok',
  'kimi',
  'antigravity',
  'prime-agent',
  'fx',
  'deepseek',
] as const;

export const traceHarnessSchema = z.enum(TRACE_HARNESSES);
export type TraceHarness = z.infer<typeof traceHarnessSchema>;

const nonnegativeInteger = z.number().int().nonnegative();

export const tokenUsageSchema = z.object({
  input: nonnegativeInteger.optional(),
  output: nonnegativeInteger.optional(),
  reasoning: nonnegativeInteger.optional(),
  cacheRead: nonnegativeInteger.optional(),
  cacheWrite: nonnegativeInteger.optional(),
  total: nonnegativeInteger.optional(),
  provenance: z.enum(['actual', 'estimated', 'unavailable']),
}).strict();

export type TraceTokenUsage = z.infer<typeof tokenUsageSchema>;

export function deriveTraceTotalTokens(
  usage: TraceTokenUsage,
  harness: TraceHarness,
): number | undefined {
  if (usage.total !== undefined) return usage.total;
  const hasInputOrOutput = usage.input !== undefined || usage.output !== undefined;
  if (!hasInputOrOutput && harness !== 'opencode' && harness !== 'opencode2') return undefined;
  const base = (usage.input ?? 0) + (usage.output ?? 0);
  if (harness === 'opencode' || harness === 'opencode2') {
    return base + (usage.reasoning ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
  }
  if (harness === 'claude-code') {
    return base + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
  }
  return base;
}

const tracePartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }).strict(),
  z.object({ type: z.literal('reasoning'), text: z.string() }).strict(),
  z.object({
    type: z.literal('tool_call'),
    name: z.string(),
    callId: z.string().optional(),
    arguments: z.unknown().optional(),
  }).strict(),
  z.object({
    type: z.literal('tool_result'),
    name: z.string().optional(),
    callId: z.string().optional(),
    content: z.unknown().optional(),
    isError: z.boolean().optional(),
    exitCode: z.number().int().optional(),
  }).strict(),
  z.object({
    type: z.literal('error'),
    code: z.string().optional(),
    message: z.string().optional(),
  }).strict(),
  z.object({
    type: z.literal('file_change'),
    path: z.string().optional(),
    additions: nonnegativeInteger.optional(),
    deletions: nonnegativeInteger.optional(),
  }).strict(),
  z.object({
    type: z.literal('terminal'),
    command: z.string().optional(),
    output: z.string().optional(),
    exitCode: z.number().int().optional(),
  }).strict(),
]);

export type TracePart = z.infer<typeof tracePartSchema>;

export const normalizedMessageSchema = z.object({
  id: z.string().min(1),
  sourceKey: z.string().optional(),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  order: nonnegativeInteger,
  timestamp: z.string().datetime({ offset: true }).optional(),
  model: z.string().optional(),
  usage: tokenUsageSchema,
  parts: z.array(tracePartSchema),
}).strict();

const traceOutcomeSchema = z.object({
  state: z.enum([
    'verified',
    'completed_unverified',
    'failed',
    'cancelled',
    'partial',
    'unknown',
  ]),
  facts: z.array(z.enum([
    'files_changed',
    'tests_passed',
    'tests_failed',
    'lint_passed',
    'build_passed',
    'proof_passed',
    'commit_created',
    'user_cancelled',
    'tool_error',
  ])),
  confidence: z.enum(['high', 'medium', 'low']),
}).strict();

export const normalizedTraceSchema = z.object({
  schemaVersion: z.literal(TRACE_SCHEMA_VERSION),
  id: z.string().min(1),
  source: z.object({
    harness: traceHarnessSchema,
    externalId: z.string().min(1),
    recordPath: z.string().min(1),
    fingerprint: z.string().min(1),
  }).strict(),
  agent: z.object({
    name: z.string().min(1),
    version: z.string().optional(),
  }).strict(),
  project: z.object({
    name: z.string().optional(),
    path: z.string().optional(),
    gitRemote: z.string().optional(),
    gitBranch: z.string().optional(),
    gitRef: z.string().optional(),
  }).strict(),
  startedAt: z.string().datetime({ offset: true }).optional(),
  endedAt: z.string().datetime({ offset: true }).optional(),
  status: z.enum(['active', 'completed', 'failed', 'cancelled', 'unknown']),
  model: z.string().optional(),
  provider: z.string().optional(),
  reasoningEffort: z.string().optional(),
  contextWindow: nonnegativeInteger.optional(),
  usage: tokenUsageSchema,
  relationships: z.array(z.object({
    type: z.enum(['parent', 'child', 'subagent', 'resume', 'fork', 'worktree']),
    traceId: z.string().min(1),
  }).strict()),
  messages: z.array(normalizedMessageSchema),
  outcome: traceOutcomeSchema.optional(),
  provenance: z.object({
    adapterVersion: nonnegativeInteger,
    parsedAt: z.string().datetime({ offset: true }),
    completeness: z.enum(['complete', 'partial', 'metadata_only']),
    warnings: z.array(z.string()),
  }).strict(),
}).strict();

export type NormalizedTrace = z.infer<typeof normalizedTraceSchema>;
export type TraceContentMode = 'metadata' | 'full';

export interface TraceUpload {
  schemaVersion: typeof TRACE_SCHEMA_VERSION;
  traceId: string;
  sourceExternalIdHash: string;
  sourceFingerprint: string;
  contentMode: TraceContentMode;
  harness: TraceHarness;
  agentVersion?: string;
  startedAt?: string;
  endedAt?: string;
  status: NormalizedTrace['status'];
  model?: string;
  provider?: string;
  reasoningEffort?: string;
  contextWindow?: number;
  usage: TraceTokenUsage;
  relationships: NormalizedTrace['relationships'];
  outcome?: NormalizedTrace['outcome'];
  messages?: NormalizedTrace['messages'];
  contentTruncated?: boolean;
}

/** Stable identity without exposing the native session ID or local path. */
export function createCanonicalTraceId(
  harness: TraceHarness,
  externalId: string,
  recordPath: string,
): string {
  const digest = createHash('sha256')
    .update(`${harness}\0${externalId}\0${recordPath}`)
    .digest('hex')
    .slice(0, 32);
  return `tr_${digest}`;
}

export function createOpaqueTraceId(value: string): string {
  return /^tr_[a-f0-9]{32}$/u.test(value)
    ? value
    : `tr_${createHash('sha256').update(value).digest('hex').slice(0, 32)}`;
}

function hashExternalId(value: string, recordPath: string): string {
  if (recordPath === 'local-index' && /^ext_[a-f0-9]{64}$/u.test(value)) {
    return value.slice('ext_'.length);
  }
  return createHash('sha256').update(value).digest('hex');
}

const MAX_UPLOAD_MESSAGES = 500;
const MAX_UPLOAD_PARTS_PER_MESSAGE = 100;
const MAX_UPLOAD_STRING_CHARACTERS = 16_384;
const MAX_UPLOAD_CONTENT_CHARACTERS = 1024 * 1024;
const MAX_UPLOAD_OBJECT_KEYS = 100;
const MAX_UPLOAD_DEPTH = 8;
const MAX_SERIALIZED_TRACE_BYTES = 3 * 1024 * 1024;
const SECRET_FIELD = /(?:authorization|cookie|password|passwd|secret|token|api[_-]?key|private[_-]?key)/iu;

interface RedactionBudget {
  remaining: number;
  truncated: boolean;
  seen: WeakSet<object>;
}

function redactString(value: string, budget: RedactionBudget): string {
  const redacted = value
    .replace(/\b(?:ahc_|sk-|gh[opsu]_|github_pat_)[A-Za-z0-9_-]+\b/gu, '[redacted]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+\b/giu, '$1[redacted]')
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/giu, '$1[redacted]@')
    .replace(/\/Users\/[^/\s]+(?:\/[^\s"']*)?/gu, '[local-path]')
    .replace(/\/(?:home|root)\/[^/\s]+(?:\/[^\s"']*)?/gu, '[local-path]')
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+(?:\\[^\s"']*)?/gu, '[local-path]');
  const allowed = Math.max(0, Math.min(MAX_UPLOAD_STRING_CHARACTERS, budget.remaining));
  if (redacted.length > allowed) budget.truncated = true;
  const bounded = allowed === 0 ? '[truncated]' : redacted.slice(0, allowed);
  budget.remaining = Math.max(0, budget.remaining - bounded.length);
  return bounded;
}

function redactUnknown(value: unknown, budget: RedactionBudget, depth = 0): unknown {
  if (depth > MAX_UPLOAD_DEPTH) {
    budget.truncated = true;
    return '[truncated]';
  }
  if (typeof value === 'string') return redactString(value, budget);
  if (Array.isArray(value)) {
    if (budget.seen.has(value)) return '[circular]';
    budget.seen.add(value);
    if (value.length > MAX_UPLOAD_OBJECT_KEYS) budget.truncated = true;
    return value.slice(0, MAX_UPLOAD_OBJECT_KEYS).map((entry) => redactUnknown(entry, budget, depth + 1));
  }
  if (value && typeof value === 'object') {
    if (budget.seen.has(value)) return '[circular]';
    budget.seen.add(value);
    const entries = Object.entries(value);
    if (entries.length > MAX_UPLOAD_OBJECT_KEYS) budget.truncated = true;
    return Object.fromEntries(entries.slice(0, MAX_UPLOAD_OBJECT_KEYS).map(([key, entry]) => {
      const secretField = SECRET_FIELD.test(key);
      const projectedKey = secretField
        ? '[redacted-field]'
        : redactContentString(key, budget, 256);
      return [
        projectedKey,
        secretField ? '[redacted]' : redactUnknown(entry, budget, depth + 1),
      ];
    }));
  }
  return value;
}

function opaqueMessageId(value: string): string {
  return `msg_${createHash('sha256').update(value).digest('hex').slice(0, 32)}`;
}

function opaqueSourceFingerprint(value: string): string {
  return /^sha256:[a-f0-9]{64}$/u.test(value)
    ? value
    : `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function redactMetadataString(value: string, maximumCharacters: number): string {
  return redactString(value, {
    remaining: maximumCharacters,
    truncated: false,
    seen: new WeakSet<object>(),
  });
}

function redactContentString(
  value: string,
  budget: RedactionBudget,
  maximumCharacters: number,
): string {
  const redacted = redactString(value, budget);
  if (redacted.length <= maximumCharacters) return redacted;
  budget.truncated = true;
  return redacted.slice(0, maximumCharacters);
}

function projectPart(part: TracePart, budget: RedactionBudget): TracePart {
  switch (part.type) {
    case 'text':
    case 'reasoning':
      return { type: part.type, text: redactContentString(part.text, budget, MAX_UPLOAD_STRING_CHARACTERS) };
    case 'tool_call':
      return {
        type: part.type,
        name: redactContentString(part.name, budget, 128),
        ...(part.callId ? { callId: redactContentString(part.callId, budget, 128) } : {}),
        ...(part.arguments === undefined ? {} : { arguments: redactUnknown(part.arguments, budget) }),
      };
    case 'tool_result':
      return {
        type: part.type,
        ...(part.name ? { name: redactContentString(part.name, budget, 128) } : {}),
        ...(part.callId ? { callId: redactContentString(part.callId, budget, 128) } : {}),
        ...(part.content === undefined ? {} : { content: redactUnknown(part.content, budget) }),
        ...(part.isError === undefined ? {} : { isError: part.isError }),
        ...(part.exitCode === undefined ? {} : { exitCode: part.exitCode }),
      };
    case 'error':
      return {
        type: part.type,
        ...(part.code ? { code: redactContentString(part.code, budget, 128) } : {}),
        ...(part.message ? { message: redactContentString(part.message, budget, MAX_UPLOAD_STRING_CHARACTERS) } : {}),
      };
    case 'file_change':
      return {
        type: part.type,
        ...(part.path ? { path: redactContentString(part.path, budget, MAX_UPLOAD_STRING_CHARACTERS) } : {}),
        ...(part.additions === undefined ? {} : { additions: part.additions }),
        ...(part.deletions === undefined ? {} : { deletions: part.deletions }),
      };
    case 'terminal':
      return {
        type: part.type,
        ...(part.command ? { command: redactContentString(part.command, budget, MAX_UPLOAD_STRING_CHARACTERS) } : {}),
        ...(part.output ? { output: redactContentString(part.output, budget, MAX_UPLOAD_STRING_CHARACTERS) } : {}),
        ...(part.exitCode === undefined ? {} : { exitCode: part.exitCode }),
      };
  }
}

function projectMessages(
  messages: NormalizedTrace['messages'],
  budget: RedactionBudget,
): NormalizedTrace['messages'] {
  if (messages.length > MAX_UPLOAD_MESSAGES) budget.truncated = true;
  return messages.slice(0, MAX_UPLOAD_MESSAGES).map((message) => {
    if (message.parts.length > MAX_UPLOAD_PARTS_PER_MESSAGE) budget.truncated = true;
    return {
      id: opaqueMessageId(message.id),
      role: message.role,
      order: message.order,
      ...(message.timestamp ? { timestamp: message.timestamp } : {}),
      ...(message.model ? { model: redactMetadataString(message.model, 200) } : {}),
      usage: message.usage,
      parts: message.parts
        .slice(0, MAX_UPLOAD_PARTS_PER_MESSAGE)
        .map((part) => projectPart(part, budget)),
    };
  });
}

function boundSerializedMessages(upload: TraceUpload): void {
  if (!upload.messages || Buffer.byteLength(JSON.stringify(upload)) <= MAX_SERIALIZED_TRACE_BYTES) return;
  upload.contentTruncated = true;
  const messages = upload.messages;
  let lower = 0;
  let upper = messages.length;
  while (lower < upper) {
    const candidateLength = Math.ceil((lower + upper) / 2);
    const candidate = { ...upload, messages: messages.slice(0, candidateLength) };
    if (Buffer.byteLength(JSON.stringify(candidate)) <= MAX_SERIALIZED_TRACE_BYTES) {
      lower = candidateLength;
    } else {
      upper = candidateLength - 1;
    }
  }
  upload.messages = messages.slice(0, lower);
}

export function projectTraceForUpload(
  trace: NormalizedTrace,
  contentMode: TraceContentMode,
): TraceUpload {
  const relationships = trace.relationships.slice(0, 1_000).map((relationship) => ({
    ...relationship,
    traceId: createOpaqueTraceId(relationship.traceId),
  }));
  const outcome = trace.outcome ? {
    ...trace.outcome,
    facts: trace.outcome.facts.slice(0, 32),
  } : undefined;
  const structurallyTruncated = relationships.length !== trace.relationships.length
    || (outcome?.facts.length ?? 0) !== (trace.outcome?.facts.length ?? 0);
  const base: TraceUpload = {
    schemaVersion: TRACE_SCHEMA_VERSION,
    traceId: createOpaqueTraceId(trace.id),
    sourceExternalIdHash: hashExternalId(trace.source.externalId, trace.source.recordPath),
    sourceFingerprint: opaqueSourceFingerprint(trace.source.fingerprint),
    contentMode,
    harness: trace.source.harness,
    ...(trace.agent.version ? { agentVersion: redactMetadataString(trace.agent.version, 100) } : {}),
    ...(trace.startedAt ? { startedAt: trace.startedAt } : {}),
    ...(trace.endedAt ? { endedAt: trace.endedAt } : {}),
    status: trace.status,
    ...(trace.model ? { model: redactMetadataString(trace.model, 200) } : {}),
    ...(trace.provider ? { provider: redactMetadataString(trace.provider, 100) } : {}),
    ...(trace.reasoningEffort ? { reasoningEffort: redactMetadataString(trace.reasoningEffort, 64) } : {}),
    ...(trace.contextWindow === undefined ? {} : { contextWindow: trace.contextWindow }),
    usage: trace.usage,
    relationships,
    ...(outcome ? { outcome } : {}),
    ...(structurallyTruncated ? { contentTruncated: true } : {}),
  };

  if (contentMode === 'full') {
    const budget: RedactionBudget = {
      remaining: MAX_UPLOAD_CONTENT_CHARACTERS,
      truncated: false,
      seen: new WeakSet<object>(),
    };
    base.messages = projectMessages(trace.messages, budget);
    if (budget.truncated || structurallyTruncated) base.contentTruncated = true;
    boundSerializedMessages(base);
  }
  return base;
}
