/**
 * Bounded, read-only parser shared by the native trace Adapters. Native
 * formats vary, but they converge here on trace/message/part semantics.
 *
 * @license Apache-2.0
 */
import { createHash } from 'node:crypto';
import { constants as fsConstants, promises as nodeFs } from 'node:fs';
import path from 'node:path';
import {
  TRACE_SCHEMA_VERSION,
  createCanonicalTraceId,
  normalizedTraceSchema,
  type NormalizedTrace,
  type TraceHarness,
  type TracePart,
  type TraceTokenUsage,
} from '../model.js';
import { deriveTraceOutcome } from '../outcomes.js';
import type {
  TraceAdapterScanOptions,
  TraceAdapterScanResult,
  TraceSourceFileSnapshot,
  TraceSourceAdapter,
  TraceSourceFormat,
} from './sourceRegistry.js';

type UnknownRecord = Record<string, unknown>;

export const DEFAULT_TRACE_SCAN_LIMITS = Object.freeze({
  maxFiles: 5_000,
  maxBytesPerFile: 64 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxRecords: 100_000,
});
const MAX_WALK_DEPTH = 12;

interface NativeAdapterDefinition {
  harness: TraceHarness;
  displayName: string;
  formats: readonly TraceSourceFormat[];
  locations: readonly string[];
}

export interface TraceFileIdentity {
  size: number;
  mtimeMs: number;
  dev: number;
  ino: number;
}

interface SourceFile extends TraceFileIdentity {
  path: string;
  format: TraceSourceFormat;
}

interface MutableTrace {
  externalId: string;
  recordPath: string;
  fingerprint: string;
  agentVersion?: string;
  projectName?: string;
  projectPath?: string;
  gitRemote?: string;
  gitBranch?: string;
  gitRef?: string;
  startedAt?: string;
  endedAt?: string;
  status: NormalizedTrace['status'];
  model?: string;
  provider?: string;
  reasoningEffort?: string;
  contextWindow?: number;
  usage: TraceTokenUsage;
  messageUsage: TraceTokenUsage;
  relationships: NormalizedTrace['relationships'];
  messages: NormalizedTrace['messages'];
  hasSessionEvidence: boolean;
}

interface ScanBudget {
  maxFiles: number;
  maxBytesPerFile: number;
  maxTotalBytes: number;
  maxRecords: number;
  filesScanned: number;
  bytesRead: number;
  recordsRead: number;
  decodedBytes: number;
  truncated: boolean;
  warnings: string[];
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function valueAt(record: UnknownRecord, pathParts: readonly string[]): unknown {
  let current: unknown = record;
  for (const part of pathParts) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function firstString(record: UnknownRecord, paths: readonly (readonly string[])[]): string | undefined {
  for (const candidate of paths) {
    const value = valueAt(record, candidate);
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function firstNumber(record: UnknownRecord, paths: readonly (readonly string[])[]): number | undefined {
  for (const candidate of paths) {
    const value = valueAt(record, candidate);
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return undefined;
}

function toIsoTimestamp(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1_000 : value;
    const date = new Date(milliseconds);
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
  }
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const numeric = Number(value);
  if (/^\d+(?:\.\d+)?$/u.test(value) && Number.isFinite(numeric)) return toIsoTimestamp(numeric);
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function findTimestamp(record: UnknownRecord): string | undefined {
  const candidates = [
    ['timestamp'], ['createdAt'], ['created_at'], ['time'], ['time', 'created'],
    ['payload', 'timestamp'], ['message', 'timestamp'],
  ] as const;
  for (const candidate of candidates) {
    const timestamp = toIsoTimestamp(valueAt(record, candidate));
    if (timestamp) return timestamp;
  }
  return undefined;
}

function normalizeRole(value: unknown): NormalizedTrace['messages'][number]['role'] | undefined {
  if (typeof value !== 'string') return undefined;
  const role = value.toLowerCase();
  if (role === 'human') return 'user';
  if (role === 'ai' || role === 'model') return 'assistant';
  if (role === 'user' || role === 'assistant' || role === 'system' || role === 'tool') return role;
  return undefined;
}

function contentParts(value: unknown): TracePart[] {
  if (typeof value === 'string') return value ? [{ type: 'text', text: value }] : [];
  if (Array.isArray(value)) return value.flatMap(contentParts);
  if (!isRecord(value)) return [];

  const type = firstString(value, [['type'], ['kind']])?.toLowerCase();
  if (type === 'thinking' || type === 'reasoning' || type === 'analysis') {
    const text = firstString(value, [['thinking'], ['reasoning'], ['text'], ['content']]);
    if (text) return [{ type: 'reasoning', text }];
    const summary = contentParts(value.summary)
      .map((part) => part.type === 'text' || part.type === 'reasoning' ? part.text : '')
      .filter(Boolean)
      .join('\n');
    return summary ? [{ type: 'reasoning', text: summary }] : [];
  }
  if (type === 'tool_use' || type === 'tool_call' || type === 'function_call') {
    const name = firstString(value, [['name'], ['function', 'name']]) ?? 'unknown';
    const callId = firstString(value, [['id'], ['call_id'], ['tool_call_id']]);
    const args = decodeMaybeJson(value.input ?? value.arguments ?? value.args ?? value.function);
    return [{
      type: 'tool_call',
      name,
      ...(callId ? { callId } : {}),
      ...(args === undefined ? {} : { arguments: args }),
    }];
  }
  if (type === 'tool_result' || type === 'function_call_output') {
    const callId = firstString(value, [['tool_use_id'], ['call_id'], ['tool_call_id'], ['id']]);
    const name = firstString(value, [['name']]);
    const decodedOutput = decodeMaybeJson(value.output);
    const outputRecord = isRecord(decodedOutput) ? decodedOutput : undefined;
    const content = value.content
      ?? outputRecord?.output
      ?? outputRecord?.content
      ?? outputRecord?.result
      ?? decodedOutput
      ?? value.result;
    const directExitCode = firstNumber(value, [
      ['exitCode'], ['exit_code'], ['status', 'exitCode'], ['content', 'exitCode'], ['output', 'exitCode'],
    ]);
    const decodedExitCode = outputRecord
      ? firstNumber(outputRecord, [['exitCode'], ['exit_code'], ['status', 'exitCode']])
      : undefined;
    const exitCode = directExitCode ?? decodedExitCode;
    return [{
      type: 'tool_result',
      ...(name ? { name } : {}),
      ...(callId ? { callId } : {}),
      ...(content === undefined ? {} : { content }),
      ...(value.is_error === true
        || value.isError === true
        || outputRecord?.is_error === true
        || outputRecord?.isError === true
        ? { isError: true }
        : {}),
      ...(exitCode === undefined ? {} : { exitCode: Math.round(exitCode) }),
    }];
  }
  if (type === 'terminal' || type === 'command') {
    const command = firstString(value, [['command'], ['input']]);
    const output = firstString(value, [['output'], ['content']]);
    const exitCode = firstNumber(value, [['exitCode'], ['exit_code'], ['code']]);
    return [{
      type: 'terminal',
      ...(command ? { command } : {}),
      ...(output ? { output } : {}),
      ...(exitCode === undefined ? {} : { exitCode: Math.round(exitCode) }),
    }];
  }
  if (type === 'error') {
    return [{
      type: 'error',
      ...(firstString(value, [['code']]) ? { code: firstString(value, [['code']]) } : {}),
      ...(firstString(value, [['message'], ['text']]) ? { message: firstString(value, [['message'], ['text']]) } : {}),
    }];
  }

  const nested = value.parts ?? value.content;
  if (nested !== undefined && nested !== value) {
    const parts = contentParts(nested);
    if (parts.length > 0) return parts;
  }
  const text = firstString(value, [['text'], ['input_text'], ['output_text'], ['message']]);
  return text ? [{ type: 'text', text }] : [];
}

function findNumberByKey(value: unknown, keys: ReadonlySet<string>, depth = 0): number | undefined {
  if (depth > 5 || value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findNumberByKey(entry, keys, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  for (const [key, entry] of Object.entries(value)) {
    if (keys.has(key) && typeof entry === 'number' && Number.isFinite(entry) && entry >= 0) {
      return Math.round(entry);
    }
  }
  for (const entry of Object.values(value)) {
    const found = findNumberByKey(entry, keys, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function extractUsage(record: UnknownRecord): TraceTokenUsage {
  const input = findNumberByKey(record, new Set(['input', 'input_tokens', 'prompt_tokens', 'promptTokens']));
  const output = findNumberByKey(record, new Set(['output', 'output_tokens', 'completion_tokens', 'completionTokens']));
  const reasoning = findNumberByKey(record, new Set(['reasoning', 'reasoning_tokens', 'reasoning_output_tokens']));
  const cacheRead = findNumberByKey(record, new Set(['cache_read', 'cache_read_tokens', 'cacheReadTokens']));
  const cacheWrite = findNumberByKey(record, new Set(['cache_write', 'cache_write_tokens', 'cacheWriteTokens']));
  const total = findNumberByKey(record, new Set(['total', 'total_tokens', 'totalTokens']));
  const available = [input, output, reasoning, cacheRead, cacheWrite, total].some((item) => item !== undefined);
  return {
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(cacheRead === undefined ? {} : { cacheRead }),
    ...(cacheWrite === undefined ? {} : { cacheWrite }),
    ...(total === undefined ? {} : { total }),
    provenance: available ? 'actual' : 'unavailable',
  };
}

function mergeUsage(current: TraceTokenUsage, incoming: TraceTokenUsage): TraceTokenUsage {
  if (incoming.provenance === 'unavailable') return current;
  const max = (left: number | undefined, right: number | undefined): number | undefined => {
    if (left === undefined) return right;
    if (right === undefined) return left;
    return Math.max(left, right);
  };
  const input = max(current.input, incoming.input);
  const output = max(current.output, incoming.output);
  const reasoning = max(current.reasoning, incoming.reasoning);
  const cacheRead = max(current.cacheRead, incoming.cacheRead);
  const cacheWrite = max(current.cacheWrite, incoming.cacheWrite);
  const total = max(current.total, incoming.total);
  return {
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(cacheRead === undefined ? {} : { cacheRead }),
    ...(cacheWrite === undefined ? {} : { cacheWrite }),
    ...(total === undefined ? {} : { total }),
    provenance: current.provenance === 'actual' || incoming.provenance === 'actual'
      ? 'actual'
      : incoming.provenance,
  };
}

function sumUsage(current: TraceTokenUsage, incoming: TraceTokenUsage): TraceTokenUsage {
  if (incoming.provenance === 'unavailable') return current;
  const sum = (left: number | undefined, right: number | undefined): number | undefined => {
    if (left === undefined) return right;
    if (right === undefined) return left;
    return left + right;
  };
  const input = sum(current.input, incoming.input);
  const output = sum(current.output, incoming.output);
  const reasoning = sum(current.reasoning, incoming.reasoning);
  const cacheRead = sum(current.cacheRead, incoming.cacheRead);
  const cacheWrite = sum(current.cacheWrite, incoming.cacheWrite);
  const total = sum(current.total, incoming.total);
  return {
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(cacheRead === undefined ? {} : { cacheRead }),
    ...(cacheWrite === undefined ? {} : { cacheWrite }),
    ...(total === undefined ? {} : { total }),
    provenance: current.provenance === 'actual' || incoming.provenance === 'actual'
      ? 'actual'
      : incoming.provenance,
  };
}

function preferAggregateUsage(
  aggregate: TraceTokenUsage,
  messages: TraceTokenUsage,
): TraceTokenUsage {
  if (aggregate.provenance === 'unavailable') return messages;
  const input = aggregate.input ?? messages.input;
  const output = aggregate.output ?? messages.output;
  const reasoning = aggregate.reasoning ?? messages.reasoning;
  const cacheRead = aggregate.cacheRead ?? messages.cacheRead;
  const cacheWrite = aggregate.cacheWrite ?? messages.cacheWrite;
  const total = aggregate.total ?? messages.total;
  return {
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(cacheRead === undefined ? {} : { cacheRead }),
    ...(cacheWrite === undefined ? {} : { cacheWrite }),
    ...(total === undefined ? {} : { total }),
    provenance: aggregate.provenance,
  };
}

function externalIdFrom(record: UnknownRecord): string | undefined {
  const type = firstString(record, [['type']]);
  const candidates: Array<readonly string[]> = [
    ['sessionId'], ['session_id'], ['conversationId'], ['conversation_id'],
    ['chatId'], ['chat_id'], ['threadId'], ['thread_id'],
    ['payload', 'session_id'], ['payload', 'sessionId'],
  ];
  if (type === 'session_meta') candidates.push(['payload', 'id']);
  return firstString(record, candidates);
}

function statusFrom(record: UnknownRecord): NormalizedTrace['status'] | undefined {
  const status = firstString(record, [['status'], ['state'], ['metadata', 'status']])?.toLowerCase();
  if (status === 'active' || status === 'running') return 'active';
  if (status === 'completed' || status === 'complete' || status === 'success') return 'completed';
  if (status === 'failed' || status === 'error') return 'failed';
  if (status === 'cancelled' || status === 'canceled') return 'cancelled';
  return undefined;
}

function fingerprint(...files: SourceFile[]): string {
  return `sha256:${createHash('sha256')
    .update(files
      .map((file) => `${file.path}\0${file.dev}\0${file.ino}\0${file.size}\0${Math.round(file.mtimeMs)}`)
      .sort()
      .join('\0'))
    .digest('hex')}`;
}

function sameTraceFileIdentity(
  actual: TraceFileIdentity,
  expected: TraceFileIdentity,
): boolean {
  return actual.size === expected.size
    && actual.mtimeMs === expected.mtimeMs
    && actual.dev === expected.dev
    && actual.ino === expected.ino;
}

export async function readBoundedTraceFile(
  filePath: string,
  expected: TraceFileIdentity,
  maximumBytes: number,
): Promise<Buffer> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0 || expected.size > maximumBytes) {
    throw new Error('Trace source exceeds its read budget.');
  }

  const noFollow = process.platform === 'win32' ? 0 : fsConstants.O_NOFOLLOW;
  const handle = await nodeFs.open(filePath, fsConstants.O_RDONLY | noFollow);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !sameTraceFileIdentity(opened, expected)) {
      throw new Error('Trace source changed while scanning.');
    }

    const content = Buffer.allocUnsafe(expected.size);
    let offset = 0;
    while (offset < content.byteLength) {
      const { bytesRead } = await handle.read(content, offset, content.byteLength - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }

    const completed = await handle.stat();
    if (offset !== expected.size || !sameTraceFileIdentity(completed, expected)) {
      throw new Error('Trace source changed while scanning.');
    }
    return content;
  } finally {
    await handle.close();
  }
}

function sourceFileKey(harness: TraceHarness, filePath: string): string {
  return `src_${createHash('sha256')
    .update(`${harness}\0${path.normalize(filePath)}`)
    .digest('hex')
    .slice(0, 32)}`;
}

function messageId(externalId: string, recordPath: string, order: number, sourceId?: string): string {
  return `msg_${createHash('sha256')
    .update(`${externalId}\0${recordPath}\0${sourceId ?? order}`)
    .digest('hex')
    .slice(0, 32)}`;
}

function formatForFile(filePath: string, formats: readonly TraceSourceFormat[]): TraceSourceFormat | undefined {
  const lower = filePath.toLowerCase();
  if (formats.includes('jsonl-zstd') && (lower.endsWith('.jsonl.zst') || lower.endsWith('.jsonl.zstd') || lower.endsWith('.zst'))) {
    return 'jsonl-zstd';
  }
  if (formats.includes('sqlite') && (
    lower.endsWith('.db')
    || lower.endsWith('.sqlite')
    || lower.endsWith('.sqlite3')
    || lower.endsWith('.vscdb')
  )) {
    return 'sqlite';
  }
  if (formats.includes('jsonl') && lower.endsWith('.jsonl')) return 'jsonl';
  if (formats.includes('json') && lower.endsWith('.json')) return 'json';
  return undefined;
}

async function discoverFiles(
  definition: NativeAdapterDefinition,
  budget: ScanBudget,
  signal?: AbortSignal,
): Promise<SourceFile[]> {
  const files: SourceFile[] = [];
  const visit = async (candidate: string, depth: number): Promise<void> => {
    signal?.throwIfAborted();
    if (files.length >= budget.maxFiles) {
      budget.truncated = true;
      return;
    }
    let stat;
    try {
      stat = await nodeFs.lstat(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        budget.warnings.push(`Could not inspect ${path.basename(candidate)}.`);
      }
      return;
    }
    if (stat.isSymbolicLink()) return;
    if (stat.isFile()) {
      const format = formatForFile(candidate, definition.formats);
      if (format) {
        files.push({
          path: candidate,
          format,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          dev: stat.dev,
          ino: stat.ino,
        });
      }
      return;
    }
    if (!stat.isDirectory() || depth >= MAX_WALK_DEPTH) return;
    let entries;
    try {
      entries = await nodeFs.readdir(candidate, { withFileTypes: true });
    } catch {
      budget.warnings.push(`Could not read ${path.basename(candidate)}.`);
      return;
    }
    for (const entry of entries) {
      if (files.length >= budget.maxFiles) {
        budget.truncated = true;
        break;
      }
      if (entry.isSymbolicLink()) continue;
      await visit(path.join(candidate, entry.name), depth + 1);
    }
  };
  for (const location of definition.locations) await visit(location, 0);
  return files;
}

function parseJsonLines(content: string, budget: ScanBudget, label: string): UnknownRecord[] {
  const records: UnknownRecord[] = [];
  const lines = content.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    if (budget.recordsRead >= budget.maxRecords) {
      budget.truncated = true;
      break;
    }
    const line = lines[index].trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (isRecord(parsed)) {
        records.push(parsed);
        budget.recordsRead += 1;
      }
    } catch {
      const isTrailingPartial = index === lines.length - 1;
      if (!isTrailingPartial) budget.warnings.push(`Skipped malformed JSONL in ${label}.`);
    }
  }
  return records;
}

function parseJson(content: string, budget: ScanBudget, label: string): UnknownRecord[] {
  try {
    const parsed = JSON.parse(content) as unknown;
    const records = Array.isArray(parsed) ? parsed.filter(isRecord) : isRecord(parsed) ? [parsed] : [];
    const remaining = Math.max(0, budget.maxRecords - budget.recordsRead);
    if (records.length > remaining) budget.truncated = true;
    const bounded = records.slice(0, remaining);
    budget.recordsRead += bounded.length;
    return bounded;
  } catch {
    budget.warnings.push(`Skipped malformed JSON in ${label}.`);
    return [];
  }
}

function decodeMaybeJson(value: unknown): unknown {
  if (Buffer.isBuffer(value)) {
    return extractJsonObjects(value);
  }
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  for (const candidate of [trimmed, /^[a-f0-9]+$/iu.test(trimmed) ? Buffer.from(trimmed, 'hex').toString('utf8') : '']) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // Try the next representation.
    }
  }
  return value;
}

function extractJsonObjects(buffer: Buffer): UnknownRecord[] {
  const output: UnknownRecord[] = [];
  const text = buffer.toString('utf8');
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '{') continue;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let end = start; end < text.length; end += 1) {
      const character = text[end];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (quoted && character === '\\') {
        escaped = true;
        continue;
      }
      if (character === '"') quoted = !quoted;
      if (quoted) continue;
      if (character === '{') depth += 1;
      if (character === '}') depth -= 1;
      if (depth !== 0) continue;
      try {
        const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
        if (isRecord(parsed)) output.push(parsed);
      } catch {
        // Binary blobs commonly contain non-JSON braces.
      }
      start = end;
      break;
    }
  }
  return output;
}

async function sqliteRecords(file: SourceFile, budget: ScanBudget): Promise<UnknownRecord[]> {
  let DatabaseSync: typeof import('node:sqlite').DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    budget.warnings.push('SQLite trace support is unavailable in this runtime.');
    return [];
  }
  const database = new DatabaseSync(file.path, { readOnly: true } as Record<string, unknown>);
  try {
    const tables = database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    ).all() as Array<{ name: string }>;
    const tableRanks = new Map<string, number>([
      ['meta', 0],
      ['session', 1],
      ['sessions', 1],
      ['message', 2],
      ['messages', 2],
      ['blobs', 3],
      ['part', 4],
      ['parts', 4],
    ]);
    const rank = (name: string): number => tableRanks.get(name) ?? 5;
    tables.sort((left, right) => rank(left.name) - rank(right.name));
    const records: UnknownRecord[] = [];
    const recordLimit = Math.max(0, budget.maxRecords - budget.recordsRead);
    for (const { name } of tables) {
      const remaining = recordLimit - records.length;
      if (remaining <= 0) {
        budget.truncated = true;
        break;
      }
      const escapedName = name.replaceAll('"', '""');
      let rows: UnknownRecord[];
      try {
        rows = database.prepare(`SELECT * FROM "${escapedName}" LIMIT ?`).all(remaining) as UnknownRecord[];
      } catch {
        continue;
      }
      for (const row of rows) {
        if (records.length >= recordLimit) {
          budget.truncated = true;
          break;
        }
        const normalized: UnknownRecord = { ...row, __table: name };
        const nestedRecords: UnknownRecord[] = [];
        for (const [key, value] of Object.entries(row)) {
          const decoded = decodeMaybeJson(value);
          if (Array.isArray(decoded) && decoded.every(isRecord)) {
            const nestedLimit = recordLimit - records.length - 1 - nestedRecords.length;
            if (decoded.length > nestedLimit) budget.truncated = true;
            for (const entry of decoded.slice(0, Math.max(0, nestedLimit))) {
              nestedRecords.push({ ...normalized, ...entry });
            }
          } else if (isRecord(decoded)) {
            Object.assign(normalized, decoded);
          } else if (decoded !== value) {
            normalized[key] = decoded;
          }
        }
        records.push(normalized, ...nestedRecords);
      }
    }
    budget.recordsRead += records.length;
    return records;
  } finally {
    database.close();
  }
}

function createMutableTrace(
  externalId: string,
  file: SourceFile,
  sourceFingerprint: string,
  hasSessionEvidence: boolean,
): MutableTrace {
  return {
    externalId,
    recordPath: file.path,
    fingerprint: sourceFingerprint,
    status: 'unknown',
    usage: { provenance: 'unavailable' },
    messageUsage: { provenance: 'unavailable' },
    relationships: [],
    messages: [],
    hasSessionEvidence,
  };
}

function updateTraceMetadata(
  trace: MutableTrace,
  record: UnknownRecord,
  harness: TraceHarness,
): void {
  trace.model ??= firstString(record, [
    ['model'], ['message', 'model'], ['payload', 'model'], ['metadata', 'model'], ['lastUsedModel'],
  ]);
  trace.provider ??= firstString(record, [
    ['provider'], ['model_provider'], ['modelProvider'], ['payload', 'model_provider'], ['metadata', 'provider'],
  ]);
  trace.reasoningEffort ??= firstString(record, [
    ['reasoningEffort'], ['reasoning_effort'], ['effort'], ['payload', 'effort'], ['metadata', 'reasoningEffort'],
  ]);
  trace.contextWindow ??= firstNumber(record, [
    ['contextWindow'], ['context_window'], ['payload', 'context_window'], ['metadata', 'contextWindow'],
  ]);
  trace.agentVersion ??= firstString(record, [
    ['agentVersion'], ['agent_version'], ['cliVersion'], ['version'], ['metadata', 'clientVersion'],
  ]);
  trace.projectPath ??= firstString(record, [
    ['projectPath'], ['project_path'], ['cwd'], ['directory'], ['payload', 'cwd'], ['metadata', 'projectPath'],
  ]);
  trace.projectName ??= firstString(record, [['projectName'], ['project_name'], ['metadata', 'projectName']]);
  trace.gitRemote ??= firstString(record, [['gitRemote'], ['git_remote'], ['repository', 'remote']]);
  trace.gitBranch ??= firstString(record, [['gitBranch'], ['git_branch'], ['branch']]);
  trace.gitRef ??= firstString(record, [['gitRef'], ['git_ref'], ['ref']]);
  trace.startedAt ??= toIsoTimestamp(valueAt(record, ['createdAt']))
    ?? toIsoTimestamp(valueAt(record, ['created_at']))
    ?? toIsoTimestamp(valueAt(record, ['startTime']))
    ?? toIsoTimestamp(valueAt(record, ['time_created']));
  trace.endedAt ??= toIsoTimestamp(valueAt(record, ['closedAt']))
    ?? toIsoTimestamp(valueAt(record, ['endedAt']))
    ?? toIsoTimestamp(valueAt(record, ['endTime']))
    ?? toIsoTimestamp(valueAt(record, ['time_updated']));
  trace.status = statusFrom(record) ?? trace.status;
  const branch = isRecord(record.branch) ? record.branch : undefined;
  const sourceSessionId = branch && firstString(branch, [['sourceSessionId']]);
  if (harness === 'autohand'
    && (branch?.type === 'fork' || branch?.type === 'clone')
    && sourceSessionId) {
    const targetPath = path.join(
      path.dirname(path.dirname(trace.recordPath)),
      sourceSessionId,
      path.basename(trace.recordPath),
    );
    const relationship = {
      type: 'fork' as const,
      traceId: createCanonicalTraceId(harness, sourceSessionId, targetPath),
    };
    if (!trace.relationships.some((candidate) => (
      candidate.type === relationship.type && candidate.traceId === relationship.traceId
    ))) {
      trace.relationships.push(relationship);
    }
  }
}

function messageFromRecord(
  trace: MutableTrace,
  record: UnknownRecord,
): NormalizedTrace['messages'][number] | null {
  const payload = isRecord(record.payload) ? record.payload : undefined;
  const payloadType = firstString(record, [['payload', 'type']])?.toLowerCase();
  const payloadIsPart = payloadType === 'function_call'
    || payloadType === 'function_call_output'
    || payloadType === 'reasoning'
    || payloadType === 'thinking';
  let message: UnknownRecord = record;
  if (isRecord(record.message)) message = record.message;
  else if (payload && (payloadType === 'message' || payloadIsPart)) message = payload;
  const role = normalizeRole(message.role)
    ?? normalizeRole(record.role)
    ?? normalizeRole(record.type)
    ?? (payloadType === 'function_call_output'
      ? 'tool'
      : payloadType === 'function_call' || payloadType === 'reasoning' || payloadType === 'thinking'
        ? 'assistant'
        : undefined);
  if (!role) return null;

  const rawContent = payloadIsPart
    ? message
    : message.content
    ?? message.parts
    ?? message.text
    ?? message.output
    ?? record.content
    ?? record.text;
  const parts = contentParts(rawContent);
  if (parts.length === 0) return null;
  const sourceKey = firstString(record, [
    ['id'], ['uuid'], ['messageId'], ['message_id'], ['payload', 'id'], ['payload', 'call_id'], ['message', 'id'],
  ]);
  const identityKey = sourceKey && payloadIsPart ? `${payloadType}:${sourceKey}` : sourceKey;
  const timestamp = findTimestamp(record);
  const usage = extractUsage(message);
  return {
    id: messageId(trace.externalId, trace.recordPath, trace.messages.length, identityKey),
    ...(sourceKey ? { sourceKey } : {}),
    role,
    order: trace.messages.length,
    ...(timestamp ? { timestamp } : {}),
    ...(firstString(message, [['model']]) ? { model: firstString(message, [['model']]) } : {}),
    usage,
    parts,
  };
}

function recordsToTraces(
  definition: NativeAdapterDefinition,
  file: SourceFile,
  records: UnknownRecord[],
  parsedAt: string,
  sourceFingerprint: string,
): NormalizedTrace[] {
  const traces = new Map<string, MutableTrace>();
  let currentExternalId = path.basename(file.path).replace(/\.(?:jsonl(?:\.zst|\.zstd)?|json|db|sqlite3?|vscdb)$/iu, '');

  const getTrace = (externalId: string, evidence: boolean): MutableTrace => {
    const current = traces.get(externalId);
    if (current) {
      current.hasSessionEvidence ||= evidence;
      return current;
    }
    const created = createMutableTrace(externalId, file, sourceFingerprint, evidence);
    traces.set(externalId, created);
    return created;
  };

  const processRecord = (record: UnknownRecord, inheritedExternalId?: string): void => {
    const explicitExternalId = externalIdFrom(record);
    if (explicitExternalId) currentExternalId = explicitExternalId;
    const externalId = explicitExternalId ?? inheritedExternalId ?? currentExternalId;
    const type = firstString(record, [['type']]);
    const table = firstString(record, [['__table']]);
    const evidence = Boolean(
      explicitExternalId
      || type === 'session_meta'
      || table === 'session'
      || table === 'sessions'
      || Array.isArray(record.messages),
    );
    const trace = getTrace(externalId, evidence);
    updateTraceMetadata(trace, record, definition.harness);

    if (Array.isArray(record.messages)) {
      trace.usage = mergeUsage(trace.usage, extractUsage(record));
      for (const nested of record.messages) {
        if (isRecord(nested)) processRecord({ ...nested, sessionId: externalId }, externalId);
      }
      return;
    }

    const message = messageFromRecord(trace, record);
    if (!message) {
      trace.usage = mergeUsage(trace.usage, extractUsage(record));
      return;
    }
    if (!trace.messages.some((existing) => existing.id === message.id)) {
      trace.messages.push(message);
      trace.messageUsage = sumUsage(trace.messageUsage, message.usage);
      if (message.timestamp) {
        if (!trace.startedAt || message.timestamp < trace.startedAt) trace.startedAt = message.timestamp;
        if (!trace.endedAt || message.timestamp > trace.endedAt) trace.endedAt = message.timestamp;
      }
    }
  };
  for (const record of records) processRecord(record);

  return [...traces.values()]
    .filter((trace) => trace.messages.length > 0 || trace.hasSessionEvidence)
    .map((trace) => {
      const selectedUsage = preferAggregateUsage(trace.usage, trace.messageUsage);
      const computedTotal = selectedUsage.total ?? (
        selectedUsage.input !== undefined || selectedUsage.output !== undefined || selectedUsage.reasoning !== undefined
          ? (selectedUsage.input ?? 0) + (selectedUsage.output ?? 0) + (selectedUsage.reasoning ?? 0)
          : undefined
      );
      const usage = computedTotal === undefined ? selectedUsage : { ...selectedUsage, total: computedTotal };
      const normalized = normalizedTraceSchema.parse({
        schemaVersion: TRACE_SCHEMA_VERSION,
        id: createCanonicalTraceId(definition.harness, trace.externalId, trace.recordPath),
        source: {
          harness: definition.harness,
          externalId: trace.externalId,
          recordPath: trace.recordPath,
          fingerprint: trace.fingerprint,
        },
        agent: {
          name: definition.displayName,
          ...(trace.agentVersion ? { version: trace.agentVersion } : {}),
        },
        project: {
          ...(trace.projectName ? { name: trace.projectName } : {}),
          ...(trace.projectPath ? { path: trace.projectPath } : {}),
          ...(trace.gitRemote ? { gitRemote: trace.gitRemote } : {}),
          ...(trace.gitBranch ? { gitBranch: trace.gitBranch } : {}),
          ...(trace.gitRef ? { gitRef: trace.gitRef } : {}),
        },
        ...(trace.startedAt ? { startedAt: trace.startedAt } : {}),
        ...(trace.endedAt ? { endedAt: trace.endedAt } : {}),
        status: trace.status,
        ...(trace.model ? { model: trace.model } : {}),
        ...(trace.provider ? { provider: trace.provider } : {}),
        ...(trace.reasoningEffort ? { reasoningEffort: trace.reasoningEffort } : {}),
        ...(trace.contextWindow === undefined ? {} : { contextWindow: Math.max(0, Math.round(trace.contextWindow)) }),
        usage,
        relationships: trace.relationships,
        messages: trace.messages,
        provenance: {
          adapterVersion: 1,
          parsedAt,
          completeness: trace.messages.length > 0 ? 'complete' : 'metadata_only',
          warnings: [],
        },
      });
      normalized.outcome = deriveTraceOutcome(normalized);
      return normalized;
    });
}

class NativeTraceAdapter implements TraceSourceAdapter {
  readonly harness: TraceHarness;
  readonly displayName: string;
  readonly formats: readonly TraceSourceFormat[];
  readonly locations: readonly string[];

  constructor(private readonly definition: NativeAdapterDefinition) {
    this.harness = definition.harness;
    this.displayName = definition.displayName;
    this.formats = definition.formats;
    this.locations = definition.locations;
  }

  async scan(options: TraceAdapterScanOptions = {}): Promise<TraceAdapterScanResult> {
    const budget: ScanBudget = {
      maxFiles: options.maxFiles ?? DEFAULT_TRACE_SCAN_LIMITS.maxFiles,
      maxBytesPerFile: options.maxBytesPerFile ?? DEFAULT_TRACE_SCAN_LIMITS.maxBytesPerFile,
      maxTotalBytes: options.maxTotalBytes ?? DEFAULT_TRACE_SCAN_LIMITS.maxTotalBytes,
      maxRecords: options.maxRecords ?? DEFAULT_TRACE_SCAN_LIMITS.maxRecords,
      filesScanned: 0,
      bytesRead: 0,
      recordsRead: 0,
      decodedBytes: 0,
      truncated: false,
      warnings: [],
    };
    let files = await discoverFiles(this.definition, budget, options.signal);
    if (this.harness === 'autohand') {
      files = files.sort((left, right) => {
        const leftMetadata = path.basename(left.path) === 'metadata.json' ? 0 : 1;
        const rightMetadata = path.basename(right.path) === 'metadata.json' ? 0 : 1;
        return leftMetadata - rightMetadata;
      });
    }
    const consumed = new Set<string>();
    const traces: NormalizedTrace[] = [];
    const sourceFiles: TraceSourceFileSnapshot[] = [];
    const parsedAt = new Date().toISOString();

    for (const file of files) {
      options.signal?.throwIfAborted();
      if (consumed.has(file.path)) continue;
      const conversationFile = this.harness === 'autohand' && path.basename(file.path) === 'metadata.json'
        ? files.find((candidate) => candidate.path === path.join(path.dirname(file.path), 'conversation.jsonl'))
        : undefined;
      if (conversationFile) consumed.add(conversationFile.path);
      const relatedFiles = conversationFile ? [file, conversationFile] : [file];
      const sourceFingerprint = fingerprint(...relatedFiles);
      const sourceKey = sourceFileKey(this.harness, file.path);
      const snapshot: TraceSourceFileSnapshot = {
        harness: this.harness,
        key: sourceKey,
        fingerprint: sourceFingerprint,
        changed: options.knownFingerprints?.[sourceKey] !== sourceFingerprint,
        parsed: true,
        traceIds: [],
      };
      if (!snapshot.changed) {
        sourceFiles.push(snapshot);
        continue;
      }
      const sourceBytes = relatedFiles.reduce((total, candidate) => total + candidate.size, 0);
      if (relatedFiles.some((candidate) => candidate.size > budget.maxBytesPerFile)
        || budget.bytesRead + sourceBytes > budget.maxTotalBytes) {
        budget.truncated = true;
        budget.warnings.push(`Skipped oversized trace source ${path.basename(file.path)}.`);
        snapshot.parsed = false;
        sourceFiles.push(snapshot);
        continue;
      }
      try {
        let records: UnknownRecord[];
        if (file.format === 'sqlite') {
          records = await sqliteRecords(file, budget);
          budget.bytesRead += file.size;
        } else {
          const bytes = await readBoundedTraceFile(
            file.path,
            file,
            Math.min(budget.maxBytesPerFile, budget.maxTotalBytes - budget.bytesRead),
          );
          budget.bytesRead += bytes.byteLength;
          if (file.format === 'jsonl-zstd') {
            const remainingDecodedBytes = budget.maxTotalBytes - budget.decodedBytes;
            if (remainingDecodedBytes <= 0) {
              throw new Error('Cumulative decompressed trace budget exhausted.');
            }
            const { zstdDecompressSync } = await import('node:zlib');
            if (typeof zstdDecompressSync !== 'function') {
              throw new Error('Zstd trace support is unavailable in this runtime.');
            }
            const decoded = zstdDecompressSync(bytes, {
              maxOutputLength: Math.min(budget.maxBytesPerFile, remainingDecodedBytes),
            });
            budget.decodedBytes += decoded.byteLength;
            records = parseJsonLines(
              decoded.toString('utf8'),
              budget,
              path.basename(file.path),
            );
          } else if (file.format === 'jsonl') {
            records = parseJsonLines(bytes.toString('utf8'), budget, path.basename(file.path));
          } else {
            records = parseJson(bytes.toString('utf8'), budget, path.basename(file.path));
          }
        }

        if (conversationFile && records[0]) {
          if (budget.bytesRead + conversationFile.size <= budget.maxTotalBytes) {
            const conversation = await readBoundedTraceFile(
              conversationFile.path,
              conversationFile,
              Math.min(budget.maxBytesPerFile, budget.maxTotalBytes - budget.bytesRead),
            );
            budget.bytesRead += conversation.byteLength;
            const messages = parseJsonLines(
              conversation.toString('utf8'),
              budget,
              path.basename(conversationFile.path),
            );
            records = [{ ...records[0], messages }];
          }
        }

        const parsedTraces = recordsToTraces(this.definition, file, records, parsedAt, sourceFingerprint);
        traces.push(...parsedTraces);
        snapshot.traceIds = parsedTraces.map((trace) => trace.id);
        budget.filesScanned += 1;
      } catch (error) {
        snapshot.parsed = false;
        budget.truncated = true;
        budget.warnings.push(
          `Could not parse ${path.basename(file.path)}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      sourceFiles.push(snapshot);
      if (budget.recordsRead >= budget.maxRecords) {
        budget.truncated = true;
        break;
      }
    }

    const unique = new Map<string, NormalizedTrace>();
    for (const trace of traces) {
      const existing = unique.get(trace.id);
      if (!existing || trace.messages.length > existing.messages.length) unique.set(trace.id, trace);
    }
    return {
      traces: [...unique.values()],
      filesScanned: budget.filesScanned,
      bytesRead: budget.bytesRead,
      warnings: budget.warnings,
      truncated: budget.truncated,
      sourceFiles,
    };
  }
}

export function createNativeTraceAdapter(definition: NativeAdapterDefinition): TraceSourceAdapter {
  return new NativeTraceAdapter(definition);
}
