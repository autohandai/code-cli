/**
 * Bounded, read-only parser shared by the native trace Adapters. Native
 * formats vary, but they converge here on trace/message/part semantics.
 *
 * @license Apache-2.0
 */
import { createHash } from 'node:crypto';
import { constants as fsConstants, promises as nodeFs } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync as SqliteDatabaseSync } from 'node:sqlite';
import {
  TRACE_SCHEMA_VERSION,
  createCanonicalTraceId,
  deriveTraceTotalTokens,
  normalizedTraceSchema,
  type NormalizedTrace,
  type TraceHarness,
  type TracePart,
  type TraceTokenUsage,
} from '../model.js';
import { deriveTraceOutcome } from '../outcomes.js';
import { normalizePiSessionRecords } from './PiTraceNormalizer.js';
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
    ['timestamp'], ['ts'], ['createdAt'], ['created_at'], ['time'], ['time', 'created'],
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

function extractUsage(record: UnknownRecord): TraceTokenUsage {
  const source = [
    record.usage,
    record.metrics,
    record.tokenUsage,
    record.token_usage,
    record.tokens,
    valueAt(record, ['metadata', 'usage']),
    valueAt(record, ['info', 'total_token_usage']),
    valueAt(record, ['payload', 'info', 'total_token_usage']),
  ].find(isRecord);
  if (!source) return { provenance: 'unavailable' };
  const nonnegative = (paths: readonly (readonly string[])[]): number | undefined => {
    const value = firstNumber(source, paths);
    return value === undefined || value < 0 ? undefined : Math.round(value);
  };
  const input = nonnegative([['input'], ['input_tokens'], ['inputTokens'], ['prompt_tokens'], ['promptTokens']]);
  const output = nonnegative([['output'], ['output_tokens'], ['outputTokens'], ['completion_tokens'], ['completionTokens']]);
  const reasoning = nonnegative([['reasoning'], ['reasoning_tokens'], ['reasoning_output_tokens']]);
  const cacheRead = nonnegative([['cacheRead'], ['cache_read'], ['cache_read_tokens'], ['cacheReadTokens'], ['cache', 'read']]);
  const cacheWrite = nonnegative([['cacheWrite'], ['cache_write'], ['cache_write_tokens'], ['cacheWriteTokens'], ['cache', 'write']]);
  const total = nonnegative([['total'], ['total_tokens'], ['totalTokens']]);
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

async function sqliteWalSnapshot(databasePath: string): Promise<SourceFile | undefined> {
  const walPath = `${databasePath}-wal`;
  let stat;
  try {
    stat = await nodeFs.lstat(walPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('SQLite WAL is not a regular file.');
  return {
    path: walPath,
    format: 'sqlite',
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    dev: stat.dev,
    ino: stat.ino,
  };
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

const CREDENTIAL_SOURCE_NAME = /^(?:auth|secrets?|credentials?|configs?|settings?|tokens?|oauth|accounts?|identity|api[-_]?keys?|globalstate)(?:$|[-_.])/u;

function isCredentialSourceName(name: string): boolean {
  return CREDENTIAL_SOURCE_NAME.test(name.toLowerCase().replace(/^\.+/u, ''));
}

function formatForFile(filePath: string, formats: readonly TraceSourceFormat[]): TraceSourceFormat | undefined {
  const lower = filePath.toLowerCase();
  if (isCredentialSourceName(path.basename(filePath))) {
    return undefined;
  }
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

function isSessionSourcePath(definition: NativeAdapterDefinition, location: string, candidate: string): boolean {
  const relative = path.relative(location, candidate);
  if (!relative) return true;
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return false;
  const segments = relative.split(path.sep);
  const base = path.basename(candidate);
  const rootName = path.basename(location);

  if (rootName === 'workspaceStorage') {
    return segments.length === 3 && segments[1] === 'chatSessions';
  }
  if (definition.harness === 'openclaw' && rootName === 'agents') {
    return segments.length >= 3 && segments[1] === 'sessions';
  }
  if (definition.harness === 'copilot' && rootName === 'session-state') {
    return segments.length === 2 && base === 'events.jsonl';
  }
  if (definition.harness === 'cline' && rootName === 'tasks') {
    return segments.length === 2 && (
      base === 'api_conversation_history.json'
      || base === 'ui_messages.json'
      || base === 'task_metadata.json'
    );
  }
  if (definition.harness === 'cline' && rootName === 'sessions') {
    return segments.length === 2 && (
      base === `${segments[0]}.json` || base === `${segments[0]}.messages.json`
    );
  }
  if (definition.harness === 'kimi' && rootName === 'sessions') {
    return base === 'wire.jsonl' || base === 'state.json';
  }
  return true;
}

function isClineSessionManifest(filePath: string): boolean {
  const sessionId = path.basename(path.dirname(filePath));
  return path.basename(path.dirname(path.dirname(filePath))) === 'sessions'
    && path.basename(filePath) === `${sessionId}.json`;
}

function isClineMessagesV1(records: UnknownRecord[], filePath: string): boolean {
  const document = records[0];
  return records.length === 1
    && document?.version === 1
    && Array.isArray(document.messages)
    && firstString(document, [['sessionId']]) === path.basename(path.dirname(filePath));
}

async function discoverFiles(
  definition: NativeAdapterDefinition,
  budget: ScanBudget,
  signal?: AbortSignal,
): Promise<SourceFile[]> {
  const files: SourceFile[] = [];
  const visit = async (candidate: string, location: string, depth: number): Promise<void> => {
    signal?.throwIfAborted();
    const relative = path.relative(location, candidate);
    if (relative && relative.split(path.sep).some(isCredentialSourceName)) return;
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
      if (!isSessionSourcePath(definition, location, candidate)) return;
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
      await visit(path.join(candidate, entry.name), location, depth + 1);
    }
  };
  for (const location of definition.locations) await visit(location, location, 0);
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

async function sqliteRecords(file: SourceFile, budget: ScanBudget, harness: TraceHarness): Promise<UnknownRecord[]> {
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
    const tableNames = new Set(tables.map(({ name }) => name));
    if (harness === 'opencode2' && tableNames.has('session') && tableNames.has('session_message')) {
      return openCode2SqliteRecords(database, budget);
    }
    if (harness === 'opencode' && tableNames.has('session')
      && tableNames.has('message') && tableNames.has('part')) {
      return openCodeSqliteRecords(database, budget, tableNames.has('session_message'));
    }
    if (harness === 'opencode2' && tableNames.has('session')) return [];
    const records: UnknownRecord[] = [];
    const recordLimit = Math.max(0, budget.maxRecords - budget.recordsRead);
    for (const { name } of tables) {
      if (!TRACE_SQLITE_TABLES.has(name)) continue;
      const remaining = recordLimit - records.length;
      if (remaining <= 0) {
        budget.truncated = true;
        break;
      }
      const escapedName = name.replaceAll('"', '""');
      let rows: UnknownRecord[];
      try {
        const select = name === 'cursorDiskKV' || name === 'ItemTable'
          ? `SELECT key, value FROM "${escapedName}" WHERE key LIKE 'composerData:%' OR key LIKE 'bubbleId:%' OR key = 'composer.composerData' LIMIT ?`
          : `SELECT * FROM "${escapedName}" LIMIT ?`;
        rows = database.prepare(select).all(remaining) as UnknownRecord[];
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

const TRACE_SQLITE_TABLES = new Set([
  'session', 'sessions', 'message', 'messages', 'part', 'parts',
  'cursorDiskKV', 'ItemTable',
]);

function openCodeTableRows(
  database: SqliteDatabaseSync,
  table: 'session' | 'message' | 'part' | 'session_message',
  selectedColumns: readonly string[],
  requiredColumns: readonly string[],
  budget: ScanBudget,
): UnknownRecord[] {
  const available = new Set((database.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>)
    .map(({ name }) => name));
  if (requiredColumns.some((column) => !available.has(column))) {
    budget.warnings.push(`OpenCode ${table} schema is missing required trace columns.`);
    budget.truncated = true;
    return [];
  }
  const remaining = budget.maxRecords - budget.recordsRead;
  if (remaining <= 0) {
    budget.truncated = true;
    return [];
  }
  const columns = selectedColumns.filter((column) => available.has(column));
  const order = table === 'session_message' && available.has('seq')
    ? ' ORDER BY "seq", "id"'
    : available.has('time_created') ? ' ORDER BY "time_created", "id"' : ' ORDER BY "id"';
  const rows = database.prepare(
    `SELECT ${columns.map((column) => `"${column}"`).join(', ')} FROM "${table}"${order} LIMIT ?`,
  ).all(remaining + 1) as UnknownRecord[];
  if (rows.length > remaining) budget.truncated = true;
  const bounded = rows.slice(0, remaining);
  budget.recordsRead += bounded.length;
  return bounded;
}

function openCodeSessionUsage(session: UnknownRecord): TraceTokenUsage {
  const read = (key: string): number | undefined => {
    const value = session[key];
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  };
  const input = read('tokens_input');
  const output = read('tokens_output');
  const reasoning = read('tokens_reasoning');
  const cacheRead = read('tokens_cache_read');
  const cacheWrite = read('tokens_cache_write');
  if (![input, output, reasoning, cacheRead, cacheWrite].some((value) => value !== undefined && value > 0)) {
    return { provenance: 'unavailable' };
  }
  return {
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(cacheRead === undefined ? {} : { cacheRead }),
    ...(cacheWrite === undefined ? {} : { cacheWrite }),
    provenance: 'actual',
  };
}

function openCodePartContent(part: UnknownRecord): UnknownRecord[] {
  const type = firstString(part, [['type']]);
  if (type === 'text' || type === 'reasoning') {
    const text = firstString(part, [['text']]);
    return text ? [{ type, text }] : [];
  }
  if (type !== 'tool') return [];
  const name = firstString(part, [['tool']]) ?? 'unknown';
  const callId = firstString(part, [['callID']]);
  const state = isRecord(part.state) ? part.state : undefined;
  const call: UnknownRecord = {
    type: 'tool_call', name,
    ...(callId ? { call_id: callId } : {}),
    ...(state && isRecord(state.input) ? { input: state.input } : {}),
  };
  if (!state || (state.status !== 'completed' && state.status !== 'error')) return [call];
  const exitCode = firstNumber(state, [['metadata', 'exitCode'], ['metadata', 'exit_code']]);
  return [call, {
    type: 'tool_result', name,
    ...(callId ? { call_id: callId } : {}),
    ...(state.status === 'error'
      ? { content: state.error, isError: true }
      : { content: state.output ?? state.result ?? state.content }),
    ...(exitCode === undefined ? {} : { exitCode }),
  }];
}

function openCode2SessionIds(database: SqliteDatabaseSync, budget: ScanBudget): Set<string> | undefined {
  const columns = database.prepare('PRAGMA table_info("session_message")').all() as Array<{ name: string }>;
  if (!columns.some(({ name }) => name === 'session_id')) {
    budget.truncated = true;
    budget.warnings.push('OpenCode session_message schema is missing session_id.');
    return undefined;
  }
  const remaining = budget.maxRecords - budget.recordsRead;
  if (remaining <= 0) {
    budget.truncated = true;
    return undefined;
  }
  const rows = database.prepare('SELECT DISTINCT "session_id" FROM "session_message" LIMIT ?')
    .all(remaining + 1) as Array<{ session_id: unknown }>;
  if (rows.length > remaining) {
    budget.truncated = true;
    budget.warnings.push('OpenCode v2 session identities exceeded the scan budget.');
    return undefined;
  }
  budget.recordsRead += rows.length;
  return new Set(rows.flatMap(({ session_id }) => typeof session_id === 'string' ? [session_id] : []));
}

function openCodeSqliteRecords(
  database: SqliteDatabaseSync,
  budget: ScanBudget,
  hasSessionMessageTable: boolean,
): UnknownRecord[] {
  const v2SessionIds = hasSessionMessageTable ? openCode2SessionIds(database, budget) : new Set<string>();
  if (!v2SessionIds) return [];
  const sessions = openCodeTableRows(database, 'session', [
    'id', 'parent_id', 'directory', 'version', 'time_created', 'time_updated', 'agent', 'model',
    'tokens_input', 'tokens_output', 'tokens_reasoning', 'tokens_cache_read', 'tokens_cache_write',
  ], ['id'], budget);
  const messages = openCodeTableRows(database, 'message', [
    'id', 'session_id', 'time_created', 'time_updated', 'data',
  ], ['id', 'session_id', 'data'], budget);
  const parts = openCodeTableRows(database, 'part', [
    'id', 'message_id', 'session_id', 'time_created', 'data',
  ], ['id', 'message_id', 'session_id', 'data'], budget);
  const partsByMessage = new Map<string, UnknownRecord[]>();
  for (const row of parts) {
    const messageId = firstString(row, [['message_id']]);
    const data = decodeMaybeJson(row.data);
    if (!messageId || !isRecord(data)) continue;
    const content = openCodePartContent(data);
    if (content.length === 0) continue;
    const existing = partsByMessage.get(messageId) ?? [];
    existing.push(...content);
    partsByMessage.set(messageId, existing);
  }
  const messagesBySession = new Map<string, UnknownRecord[]>();
  const usageBySession = new Map<string, TraceTokenUsage>();
  for (const row of messages) {
    const sessionId = firstString(row, [['session_id']]);
    const id = firstString(row, [['id']]);
    const data = decodeMaybeJson(row.data);
    if (!sessionId || !id || !isRecord(data)) continue;
    const usage = extractUsage(data);
    usageBySession.set(sessionId, sumUsage(usageBySession.get(sessionId) ?? { provenance: 'unavailable' }, usage));
    const role = normalizeRole(data.role);
    if (!role) continue;
    const model = isRecord(data.model) ? data.model : undefined;
    const content = partsByMessage.get(id) ?? [];
    if (content.length === 0) continue;
    const message: UnknownRecord = {
      id, role, content, usage,
      timestamp: row.time_created ?? valueAt(data, ['time', 'created']),
      model: firstString(data, [['modelID']]) ?? (model ? firstString(model, [['modelID'], ['id']]) : undefined),
      provider: firstString(data, [['providerID']]) ?? (model ? firstString(model, [['providerID']]) : undefined),
    };
    const existing = messagesBySession.get(sessionId) ?? [];
    existing.push(message);
    messagesBySession.set(sessionId, existing);
  }
  return assembleOpenCodeSessions(
    sessions.filter((session) => !v2SessionIds.has(firstString(session, [['id']]) ?? '')),
    messagesBySession,
    usageBySession,
  );
}

function openCode2MessageContent(type: string, data: UnknownRecord): UnknownRecord[] {
  if (type === 'user' || type === 'system' || type === 'synthetic') {
    const text = firstString(data, [['text']]);
    return text ? [{ type: 'text', text }] : [];
  }
  if (type === 'shell') {
    return [{ type: 'terminal', command: data.command, output: data.output }];
  }
  if (type !== 'assistant' || !Array.isArray(data.content)) return [];
  return data.content.flatMap((entry: unknown) => {
    if (!isRecord(entry)) return [];
    if (entry.type !== 'tool') return openCodePartContent(entry);
    return openCodePartContent({
      type: 'tool',
      tool: entry.name,
      callID: entry.id,
      state: entry.state,
    });
  });
}

function openCode2SqliteRecords(database: SqliteDatabaseSync, budget: ScanBudget): UnknownRecord[] {
  const sessions = openCodeTableRows(database, 'session', [
    'id', 'parent_id', 'directory', 'version', 'time_created', 'time_updated', 'agent', 'model',
    'tokens_input', 'tokens_output', 'tokens_reasoning', 'tokens_cache_read', 'tokens_cache_write',
  ], ['id'], budget);
  const messages = openCodeTableRows(database, 'session_message', [
    'id', 'session_id', 'type', 'seq', 'time_created', 'data',
  ], ['id', 'session_id', 'type', 'data'], budget);
  const messagesBySession = new Map<string, UnknownRecord[]>();
  const usageBySession = new Map<string, TraceTokenUsage>();
  const v2SessionIds = new Set<string>();
  for (const row of messages) {
    const sessionId = firstString(row, [['session_id']]);
    const id = firstString(row, [['id']]);
    const type = firstString(row, [['type']]);
    const data = decodeMaybeJson(row.data);
    if (!sessionId || !id || !type || !isRecord(data)) continue;
    v2SessionIds.add(sessionId);
    const usage = extractUsage(data);
    usageBySession.set(sessionId, sumUsage(usageBySession.get(sessionId) ?? { provenance: 'unavailable' }, usage));
    const content = openCode2MessageContent(type, data);
    if (content.length === 0) continue;
    const role = normalizeRole(type) ?? (type === 'shell' ? 'tool' : undefined);
    if (!role) continue;
    const model = isRecord(data.model) ? data.model : undefined;
    const message: UnknownRecord = {
      id, role, content, usage,
      timestamp: row.time_created ?? valueAt(data, ['time', 'created']),
      model: model ? firstString(model, [['id'], ['modelID']]) : undefined,
      provider: model ? firstString(model, [['providerID']]) : undefined,
    };
    const existing = messagesBySession.get(sessionId) ?? [];
    existing.push(message);
    messagesBySession.set(sessionId, existing);
  }
  return assembleOpenCodeSessions(
    sessions.filter((session) => v2SessionIds.has(firstString(session, [['id']]) ?? '')),
    messagesBySession,
    usageBySession,
  );
}

function assembleOpenCodeSessions(
  sessions: UnknownRecord[],
  messagesBySession: ReadonlyMap<string, UnknownRecord[]>,
  usageBySession: ReadonlyMap<string, TraceTokenUsage>,
): UnknownRecord[] {
  return sessions.flatMap((session) => {
    const id = firstString(session, [['id']]);
    if (!id) return [];
    const model = decodeMaybeJson(session.model);
    const modelObject = isRecord(model) ? model : undefined;
    const sessionUsage = openCodeSessionUsage(session);
    return [{
      sessionId: id,
      parentSessionId: firstString(session, [['parent_id']]),
      projectPath: firstString(session, [['directory']]),
      agentVersion: firstString(session, [['version']]),
      model: typeof model === 'string' ? model : modelObject ? firstString(modelObject, [['modelID'], ['id']]) : undefined,
      provider: modelObject ? firstString(modelObject, [['providerID']]) : undefined,
      createdAt: session.time_created,
      endedAt: session.time_updated,
      usage: sessionUsage.provenance === 'actual' ? sessionUsage : usageBySession.get(id),
      messages: messagesBySession.get(id) ?? [],
    }];
  });
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
    ['model'], ['modelInfo', 'id'], ['message', 'model'], ['payload', 'model'], ['metadata', 'model'], ['lastUsedModel'],
  ]);
  trace.provider ??= firstString(record, [
    ['provider'], ['modelInfo', 'provider'], ['model_provider'], ['modelProvider'], ['payload', 'model_provider'], ['metadata', 'provider'],
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
    ?? toIsoTimestamp(valueAt(record, ['started_at']))
    ?? toIsoTimestamp(valueAt(record, ['startTime']))
    ?? toIsoTimestamp(valueAt(record, ['time_created']));
  trace.endedAt ??= toIsoTimestamp(valueAt(record, ['closedAt']))
    ?? toIsoTimestamp(valueAt(record, ['endedAt']))
    ?? toIsoTimestamp(valueAt(record, ['ended_at']))
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
  if (harness === 'opencode' || harness === 'opencode2') {
    const parentSessionId = firstString(record, [['parentSessionId']]);
    if (parentSessionId) {
      const relationship = {
        type: 'parent' as const,
        traceId: createCanonicalTraceId(harness, parentSessionId, trace.recordPath),
      };
      if (!trace.relationships.some((candidate) => (
        candidate.type === relationship.type && candidate.traceId === relationship.traceId
      ))) trace.relationships.push(relationship);
    }
  }
  if (harness === 'cline') {
    const parentSessionId = firstString(record, [['origin', 'parentThreadId']]);
    if (parentSessionId) {
      const parentFile = trace.recordPath.endsWith('.messages.json')
        ? `${parentSessionId}.messages.json`
        : `${parentSessionId}.json`;
      const targetPath = path.join(path.dirname(path.dirname(trace.recordPath)), parentSessionId, parentFile);
      const relationship = {
        type: 'parent' as const,
        traceId: createCanonicalTraceId(harness, parentSessionId, targetPath),
      };
      if (!trace.relationships.some((candidate) => (
        candidate.type === relationship.type && candidate.traceId === relationship.traceId
      ))) trace.relationships.push(relationship);
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
  const model = firstString(message, [['model'], ['modelInfo', 'id']]);
  return {
    id: messageId(trace.externalId, trace.recordPath, trace.messages.length, identityKey),
    ...(sourceKey ? { sourceKey } : {}),
    role,
    order: trace.messages.length,
    ...(timestamp ? { timestamp } : {}),
    ...(model ? { model } : {}),
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
  budget: ScanBudget,
  provenanceWarnings: readonly string[] = [],
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
        if (!isRecord(nested)) continue;
        if (budget.recordsRead >= budget.maxRecords) {
          budget.truncated = true;
          break;
        }
        budget.recordsRead += 1;
        processRecord({ ...nested, sessionId: externalId }, externalId);
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
      const computedTotal = deriveTraceTotalTokens(selectedUsage, definition.harness);
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
          completeness: provenanceWarnings.length > 0
            ? 'partial'
            : trace.messages.length > 0 ? 'complete' : 'metadata_only',
          warnings: [...provenanceWarnings],
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
    if (this.harness === 'cline') files = files.sort((left, right) => left.path.localeCompare(right.path));
    const consumed = new Set<string>();
    const traces: NormalizedTrace[] = [];
    const sourceFiles: TraceSourceFileSnapshot[] = [];
    const parsedAt = new Date().toISOString();

    for (const file of files) {
      options.signal?.throwIfAborted();
      if (consumed.has(file.path)) continue;
      const conversationFile = this.harness === 'autohand' && path.basename(file.path) === 'metadata.json'
        ? files.find((candidate) => candidate.path === path.join(path.dirname(file.path), 'conversation.jsonl'))
        : this.harness === 'cline' && isClineSessionManifest(file.path)
          ? files.find((candidate) => candidate.path === path.join(
            path.dirname(file.path), `${path.basename(file.path, '.json')}.messages.json`,
          ))
        : undefined;
      if (conversationFile) consumed.add(conversationFile.path);
      let walFile: SourceFile | undefined;
      try {
        walFile = file.format === 'sqlite' ? await sqliteWalSnapshot(file.path) : undefined;
      } catch {
        budget.truncated = true;
        budget.warnings.push(`Skipped unsafe SQLite WAL for ${path.basename(file.path)}.`);
        continue;
      }
      const relatedFiles = conversationFile ? [file, conversationFile] : walFile ? [file, walFile] : [file];
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
        let provenanceWarnings: string[] = [];
        if (file.format === 'sqlite') {
          records = await sqliteRecords(file, budget, this.harness);
          budget.bytesRead += sourceBytes;
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

        if (this.harness === 'pi') {
          const normalized = normalizePiSessionRecords(records, file.path);
          records = normalized.records;
          provenanceWarnings = normalized.warnings;
          if (provenanceWarnings.length > 0) {
            budget.truncated = true;
            budget.warnings.push(...provenanceWarnings);
          }
        }

        if (this.harness === 'cline' && isClineSessionManifest(file.path)) {
          const manifest = records[0];
          if (records.length !== 1 || manifest?.version !== 1
            || firstString(manifest, [['session_id']]) !== path.basename(path.dirname(file.path))) {
            throw new Error('Unsupported Cline session manifest.');
          }
        }
        if (this.harness === 'cline' && file.path.endsWith('.messages.json')) {
          const document = records[0];
          if (!document || !isClineMessagesV1(records, file.path)) {
            throw new Error('Unsupported Cline messages contract.');
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
            if (this.harness === 'cline') {
              const document = parseJson(conversation.toString('utf8'), budget, path.basename(conversationFile.path));
              if (!isClineMessagesV1(document, conversationFile.path)) {
                throw new Error('Unsupported Cline messages contract.');
              }
              records = [{ ...records[0], origin: document[0].origin, messages: document[0].messages }];
            } else {
              const messages = parseJsonLines(
                conversation.toString('utf8'),
                budget,
                path.basename(conversationFile.path),
              );
              records = [{ ...records[0], messages }];
            }
          }
        }

        const parsedTraces = recordsToTraces(
          this.definition,
          file,
          records,
          parsedAt,
          sourceFingerprint,
          budget,
          provenanceWarnings,
        );
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
