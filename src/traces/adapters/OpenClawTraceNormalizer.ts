/** @license Apache-2.0 */
import path from 'node:path';

type UnknownRecord = Record<string, unknown>;

export interface OpenClawNativeRecordNormalization {
  records: UnknownRecord[];
  warnings: string[];
}

export const OPENCLAW_SQLITE_RECORD_KIND = '__openclawSqliteKind';

const VERIFIED_TRANSCRIPT_VERSION = 3;
const VERIFIED_SQLITE_SCHEMA_VERSION = 22;
const MAX_PENDING_TOOL_NAMES = 2_000;
const KNOWN_CONTROL_TYPES = new Set([
  'branch_summary',
  'compaction',
  'custom',
  'custom_message',
  'reset',
]);

interface OpenClawEventEnvelope {
  event: UnknownRecord;
  fallbackTimestamp?: unknown;
}

interface OpenClawNode {
  currentSessionId: string;
  entry?: UnknownRecord;
  sessionKey: string;
}

interface OpenClawWindow {
  createdAt?: unknown;
  endedAt?: unknown;
  model?: string;
  modelProvider?: string;
  parentSessionKey?: string;
  previousSessionId?: string;
  sessionId: string;
  sessionKey: string;
  spawnedBy?: string;
  startedAt?: unknown;
  status?: string;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonemptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function nonnegativeInteger(value: unknown): number | undefined {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric) : undefined;
}

function integer(value: unknown): number | undefined {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) ? Math.round(numeric) : undefined;
}

function decodeRecord(value: unknown): UnknownRecord | undefined {
  if (isRecord(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const decoded = JSON.parse(value) as unknown;
    return isRecord(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function normalizeStatus(value: unknown): 'active' | 'completed' | 'failed' | 'cancelled' | 'unknown' {
  const status = nonemptyString(value)?.toLowerCase();
  if (status === 'running' || status === 'active') return 'active';
  if (status === 'done' || status === 'complete' || status === 'completed' || status === 'success') {
    return 'completed';
  }
  if (status === 'failed' || status === 'error' || status === 'timeout') return 'failed';
  if (status === 'aborted' || status === 'cancelled' || status === 'canceled'
    || status === 'interrupted' || status === 'killed') return 'cancelled';
  return 'unknown';
}

function usageRecord(value: unknown): UnknownRecord | undefined {
  if (!isRecord(value)) return undefined;
  const input = nonnegativeInteger(value.input ?? value.inputTokens ?? value.input_tokens);
  const output = nonnegativeInteger(value.output ?? value.outputTokens ?? value.output_tokens);
  const cacheRead = nonnegativeInteger(
    value.cacheRead ?? value.cacheReadTokens ?? value.cache_read_tokens,
  );
  const cacheWrite = nonnegativeInteger(
    value.cacheWrite ?? value.cacheWriteTokens ?? value.cache_write_tokens,
  );
  const total = nonnegativeInteger(value.totalTokens ?? value.total ?? value.total_tokens);
  if ([input, output, cacheRead, cacheWrite, total].every((candidate) => candidate === undefined)) {
    return undefined;
  }
  return {
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
    ...(cacheRead === undefined ? {} : { cacheRead }),
    ...(cacheWrite === undefined ? {} : { cacheWrite }),
    ...(total === undefined ? {} : { total }),
  };
}

function rememberToolName(
  pendingToolNames: Map<string, string>,
  callId: string | undefined,
  name: string,
  warnings: Set<string>,
): void {
  if (!callId) return;
  if (pendingToolNames.size < MAX_PENDING_TOOL_NAMES || pendingToolNames.has(callId)) {
    pendingToolNames.set(callId, name);
    return;
  }
  warnings.add('OpenClaw transcript exceeds the pending tool-name join limit.');
}

function normalizeContent(
  value: unknown,
  pendingToolNames: Map<string, string>,
  warnings: Set<string>,
): UnknownRecord[] {
  const blocks = typeof value === 'string' ? [{ type: 'text', text: value }] : value;
  if (!Array.isArray(blocks)) {
    warnings.add('OpenClaw transcript contains message content that is not a block array or string.');
    return [];
  }
  const normalized: UnknownRecord[] = [];
  for (const block of blocks) {
    if (typeof block === 'string') {
      if (block) normalized.push({ type: 'text', text: block });
      continue;
    }
    if (!isRecord(block)) {
      warnings.add('OpenClaw transcript contains a non-object content block.');
      continue;
    }
    const type = nonemptyString(block.type)?.toLowerCase();
    if (type === 'text') {
      const text = nonemptyString(block.text);
      if (text) normalized.push({ type: 'text', text });
      continue;
    }
    if (type === 'thinking' || type === 'reasoning') {
      const text = nonemptyString(block.thinking ?? block.reasoning ?? block.text);
      if (text) normalized.push({ type: 'reasoning', text });
      continue;
    }
    if (type === 'toolcall' || type === 'tool_call' || type === 'tooluse'
      || type === 'tool_use' || type === 'functioncall' || type === 'function_call') {
      const callId = nonemptyString(block.id ?? block.callId ?? block.call_id);
      const name = nonemptyString(block.name ?? block.toolName) ?? 'unknown';
      rememberToolName(pendingToolNames, callId, name, warnings);
      normalized.push({
        type: 'tool_call',
        name,
        ...(callId ? { id: callId } : {}),
        ...(block.arguments === undefined && block.args === undefined && block.input === undefined
          ? {}
          : { arguments: block.arguments ?? block.args ?? block.input }),
      });
      continue;
    }
    if (type === 'image') {
      warnings.add('OpenClaw transcript image content is omitted from the text trace model.');
      continue;
    }
    warnings.add(`OpenClaw transcript contains unsupported content block type "${type ?? 'unknown'}".`);
  }
  return normalized;
}

function toolResultContent(value: unknown, warnings: Set<string>): unknown {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return value;
  const text: string[] = [];
  for (const block of value) {
    if (!isRecord(block)) continue;
    const type = nonemptyString(block.type)?.toLowerCase();
    if (type === 'text') {
      const candidate = nonemptyString(block.text);
      if (candidate) text.push(candidate);
    } else if (type === 'image') {
      warnings.add('OpenClaw transcript image content is omitted from the text trace model.');
    } else {
      warnings.add(`OpenClaw tool result contains unsupported content block type "${type ?? 'unknown'}".`);
    }
  }
  return text.length > 0 ? text.join('\n') : undefined;
}

function normalizeMessage(
  event: UnknownRecord,
  fallbackTimestamp: unknown,
  state: { model?: string; provider?: string; reasoningEffort?: string },
  pendingToolNames: Map<string, string>,
  warnings: Set<string>,
): { record?: UnknownRecord; terminalStatus?: 'failed' | 'cancelled' } {
  const message = decodeRecord(event.message);
  if (!message) {
    warnings.add('OpenClaw transcript contains a message record without a message object.');
    return {};
  }
  const rawRole = nonemptyString(message.role)?.toLowerCase();
  const id = nonemptyString(event.id);
  const timestamp = message.timestamp ?? event.timestamp ?? fallbackTimestamp;
  if (rawRole === 'toolresult' || rawRole === 'tool_result' || rawRole === 'tool') {
    const callId = nonemptyString(message.toolCallId ?? message.tool_call_id ?? message.callId);
    const name = nonemptyString(message.toolName ?? message.name)
      ?? (callId ? pendingToolNames.get(callId) : undefined);
    if (callId) pendingToolNames.delete(callId);
    const details = isRecord(message.details) ? message.details : undefined;
    const exitCode = integer(details?.exitCode ?? details?.exit_code);
    return {
      record: {
        ...(id ? { id } : {}),
        role: 'tool',
        content: [{
          type: 'tool_result',
          ...(callId ? { call_id: callId } : {}),
          ...(name ? { name } : {}),
          ...(message.content === undefined
            ? {}
            : { content: toolResultContent(message.content, warnings) }),
          ...(message.isError === true || message.is_error === true ? { isError: true } : {}),
          ...(exitCode === undefined ? {} : { exitCode }),
        }],
        ...(timestamp === undefined ? {} : { timestamp }),
      },
    };
  }
  if (rawRole !== 'user' && rawRole !== 'assistant' && rawRole !== 'system') {
    warnings.add(`OpenClaw transcript contains unsupported message role "${rawRole ?? 'unknown'}".`);
    return {};
  }
  const content = normalizeContent(message.content, pendingToolNames, warnings);
  const model = nonemptyString(message.model) ?? state.model;
  const provider = nonemptyString(message.provider) ?? state.provider;
  if (rawRole === 'assistant') {
    state.model = model;
    state.provider = provider;
  }
  const stopReason = nonemptyString(message.stopReason)?.toLowerCase();
  if (rawRole === 'assistant' && stopReason === 'error') {
    const errorMessage = nonemptyString(message.errorMessage ?? message.error);
    const errorCode = nonemptyString(message.errorCode);
    if (errorMessage || errorCode) {
      content.push({
        type: 'error',
        ...(errorCode ? { code: errorCode } : {}),
        ...(errorMessage ? { message: errorMessage } : {}),
      });
    }
  }
  if (content.length === 0) return {};
  const usage = rawRole === 'assistant' ? usageRecord(message.usage) : undefined;
  return {
    record: {
      ...(id ? { id } : {}),
      role: rawRole,
      content,
      ...(timestamp === undefined ? {} : { timestamp }),
      ...(model ? { model } : {}),
      ...(provider ? { provider } : {}),
      ...(state.reasoningEffort ? { reasoningEffort: state.reasoningEffort } : {}),
      ...(usage ? { usage } : {}),
    },
    ...(rawRole === 'assistant' && stopReason === 'error'
      ? { terminalStatus: 'failed' as const }
      : rawRole === 'assistant' && stopReason === 'aborted'
        ? { terminalStatus: 'cancelled' as const }
        : {}),
  };
}

function normalizeEvents(
  sessionId: string,
  events: OpenClawEventEnvelope[],
  initial: { model?: string; provider?: string; reasoningEffort?: string },
  warnings: Set<string>,
): { records: UnknownRecord[]; terminalStatus?: 'failed' | 'cancelled' } {
  const state = { ...initial };
  const pendingToolNames = new Map<string, string>();
  const records: UnknownRecord[] = [];
  let terminalStatus: 'failed' | 'cancelled' | undefined;
  for (const envelope of events) {
    const event = envelope.event;
    const type = nonemptyString(event.type)?.toLowerCase();
    if (!type) {
      warnings.add('OpenClaw transcript contains a record without a type.');
      continue;
    }
    if (type === 'session') continue;
    if (type === 'model_change') {
      state.model = nonemptyString(event.modelId ?? event.model) ?? state.model;
      state.provider = nonemptyString(event.provider) ?? state.provider;
      continue;
    }
    if (type === 'thinking_level_change') {
      state.reasoningEffort = nonemptyString(event.thinkingLevel ?? event.reasoningEffort)
        ?? state.reasoningEffort;
      continue;
    }
    if (type === 'message') {
      const normalized = normalizeMessage(
        event,
        envelope.fallbackTimestamp,
        state,
        pendingToolNames,
        warnings,
      );
      if (normalized.record) records.push({ sessionId, ...normalized.record });
      terminalStatus = normalized.terminalStatus ?? terminalStatus;
      continue;
    }
    if (KNOWN_CONTROL_TYPES.has(type)) continue;
    warnings.add(`OpenClaw transcript contains unsupported record type "${type}".`);
  }
  return { records, ...(terminalStatus ? { terminalStatus } : {}) };
}

function verifiedHeaderVersion(header: UnknownRecord | undefined, warnings: Set<string>): void {
  if (!header) {
    warnings.add('OpenClaw transcript is missing its native session header.');
    return;
  }
  if (header.version !== VERIFIED_TRANSCRIPT_VERSION) {
    warnings.add(
      `OpenClaw transcript version ${String(header.version ?? 'unknown')} is not a verified native contract.`,
    );
  }
}

function parentSessionId(value: unknown): string | undefined {
  const candidate = nonemptyString(value);
  if (!candidate) return undefined;
  const basename = candidate.split(/[\\/]/u).at(-1) ?? candidate;
  return basename.replace(/\.jsonl(?:\..*)?$/iu, '');
}

function normalizeLegacyRecords(
  records: UnknownRecord[],
  filePath: string,
  warnings: Set<string>,
): UnknownRecord[] {
  const header = records.find((record) => nonemptyString(record.type)?.toLowerCase() === 'session');
  verifiedHeaderVersion(header, warnings);
  const sessionId = nonemptyString(header?.id) ?? path.basename(filePath, '.jsonl');
  const parentId = parentSessionId(header?.parentSession);
  const metadata: UnknownRecord = {
    sessionId,
    ...(nonemptyString(header?.cwd) ? { projectPath: nonemptyString(header?.cwd) } : {}),
    ...(header?.timestamp === undefined ? {} : { createdAt: header.timestamp }),
    ...(parentId ? { parentSessionId: parentId } : {}),
    status: 'unknown',
  };
  const events = records.map((event) => ({ event }));
  const normalized = normalizeEvents(sessionId, events, {}, warnings);
  if (normalized.terminalStatus) metadata.status = normalized.terminalStatus;
  return [metadata, ...normalized.records];
}

function sqliteKind(record: UnknownRecord): string | undefined {
  return nonemptyString(record[OPENCLAW_SQLITE_RECORD_KIND]);
}

function sqliteNodes(records: UnknownRecord[], warnings: Set<string>): Map<string, OpenClawNode> {
  const nodes = new Map<string, OpenClawNode>();
  for (const record of records) {
    if (sqliteKind(record) !== 'node') continue;
    const sessionKey = nonemptyString(record.sessionKey);
    const currentSessionId = nonemptyString(record.currentSessionId);
    if (!sessionKey || !currentSessionId) {
      warnings.add('OpenClaw SQLite contains a session node without stable identity.');
      continue;
    }
    const entry = decodeRecord(record.entry);
    if (!entry) warnings.add(`OpenClaw SQLite session node "${sessionKey}" has invalid projected metadata.`);
    nodes.set(sessionKey, { sessionKey, currentSessionId, ...(entry ? { entry } : {}) });
  }
  return nodes;
}

function sqliteWindows(records: UnknownRecord[], warnings: Set<string>): OpenClawWindow[] {
  const windows: OpenClawWindow[] = [];
  for (const record of records) {
    if (sqliteKind(record) !== 'window') continue;
    const sessionId = nonemptyString(record.sessionId);
    const sessionKey = nonemptyString(record.sessionKey);
    if (!sessionId || !sessionKey) {
      warnings.add('OpenClaw SQLite contains a session window without stable identity.');
      continue;
    }
    windows.push({
      sessionId,
      sessionKey,
      previousSessionId: nonemptyString(record.previousSessionId),
      createdAt: record.createdAt,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      status: nonemptyString(record.status),
      modelProvider: nonemptyString(record.modelProvider),
      model: nonemptyString(record.model),
      parentSessionKey: nonemptyString(record.parentSessionKey),
      spawnedBy: nonemptyString(record.spawnedBy),
    });
  }
  return windows;
}

function sqliteEvents(
  records: UnknownRecord[],
  warnings: Set<string>,
): Map<string, OpenClawEventEnvelope[]> {
  const bySession = new Map<string, OpenClawEventEnvelope[]>();
  for (const record of records) {
    if (sqliteKind(record) !== 'event') continue;
    const sessionId = nonemptyString(record.sessionId);
    const event = decodeRecord(record.eventJson);
    if (!sessionId || !event) {
      warnings.add('OpenClaw SQLite contains an invalid active transcript event.');
      continue;
    }
    const current = bySession.get(sessionId) ?? [];
    current.push({ event, fallbackTimestamp: record.createdAt });
    bySession.set(sessionId, current);
  }
  return bySession;
}

function recordHeader(events: OpenClawEventEnvelope[]): UnknownRecord | undefined {
  return events.find(({ event }) => nonemptyString(event.type)?.toLowerCase() === 'session')?.event;
}

function entryProjectPath(entry: UnknownRecord | undefined): string | undefined {
  if (!entry) return undefined;
  const worktree = isRecord(entry.worktree) ? entry.worktree : undefined;
  return nonemptyString(entry.spawnedCwd)
    ?? nonemptyString(entry.execCwd)
    ?? nonemptyString(worktree?.canonicalWorkspaceDir)
    ?? nonemptyString(worktree?.repoRoot);
}

function createSqliteMetadata(
  window: OpenClawWindow,
  node: OpenClawNode | undefined,
  nodes: Map<string, OpenClawNode>,
  header: UnknownRecord | undefined,
  appVersion: string | undefined,
): UnknownRecord {
  const entry = node?.currentSessionId === window.sessionId ? node.entry : undefined;
  const parentKey = window.parentSessionKey
    ?? nonemptyString(entry?.parentSessionKey)
    ?? window.spawnedBy
    ?? nonemptyString(entry?.spawnedBy);
  const parentId = nonemptyString(entry?.parentSessionId)
    ?? (parentKey ? nodes.get(parentKey)?.currentSessionId : undefined);
  const forkSource = isRecord(entry?.forkSource) ? entry.forkSource : undefined;
  const projectPath = nonemptyString(header?.cwd) ?? entryProjectPath(entry);
  const reasoningEffort = nonemptyString(entry?.thinkingLevel ?? entry?.reasoningLevel);
  const contextWindow = nonnegativeInteger(entry?.contextWindow);
  const status = normalizeStatus(window.status ?? entry?.status);
  return {
    sessionId: window.sessionId,
    ...(appVersion ? { agentVersion: appVersion } : {}),
    ...(projectPath ? { projectPath } : {}),
    createdAt: header?.timestamp ?? window.startedAt ?? entry?.sessionStartedAt ?? window.createdAt,
    endedAt: window.endedAt ?? entry?.endedAt,
    status,
    ...(window.model ? { model: window.model } : nonemptyString(entry?.model) ? { model: entry?.model } : {}),
    ...(window.modelProvider
      ? { provider: window.modelProvider }
      : nonemptyString(entry?.modelProvider) ? { provider: entry?.modelProvider } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(parentId ? { parentSessionId: parentId } : {}),
    ...(window.previousSessionId ? { previousSessionId: window.previousSessionId } : {}),
    ...(nonemptyString(forkSource?.sessionId)
      ? { forkSourceSessionId: nonemptyString(forkSource?.sessionId) }
      : {}),
  };
}

function normalizeSqliteRecords(records: UnknownRecord[], warnings: Set<string>): UnknownRecord[] {
  const nodes = sqliteNodes(records, warnings);
  const windows = sqliteWindows(records, warnings);
  const eventsBySession = sqliteEvents(records, warnings);
  const schema = records.find((record) => sqliteKind(record) === 'schema');
  const schemaVersion = nonnegativeInteger(schema?.schemaVersion);
  if (schemaVersion === undefined) {
    warnings.add('OpenClaw SQLite schema metadata is missing.');
  } else if (schemaVersion !== VERIFIED_SQLITE_SCHEMA_VERSION) {
    warnings.add(
      `OpenClaw SQLite schema ${schemaVersion} is not a verified native contract.`,
    );
  }
  const appVersion = nonemptyString(schema?.appVersion);
  const windowsBySession = new Map(windows.map((window) => [window.sessionId, window]));
  for (const node of nodes.values()) {
    if (windowsBySession.has(node.currentSessionId)) continue;
    const fallback: OpenClawWindow = {
      sessionId: node.currentSessionId,
      sessionKey: node.sessionKey,
      createdAt: node.entry?.sessionStartedAt ?? node.entry?.createdAt,
      startedAt: node.entry?.startedAt,
      endedAt: node.entry?.endedAt,
      status: nonemptyString(node.entry?.status),
      modelProvider: nonemptyString(node.entry?.modelProvider),
      model: nonemptyString(node.entry?.model),
      parentSessionKey: nonemptyString(node.entry?.parentSessionKey),
      spawnedBy: nonemptyString(node.entry?.spawnedBy),
    };
    windows.push(fallback);
    windowsBySession.set(fallback.sessionId, fallback);
  }
  for (const sessionId of eventsBySession.keys()) {
    if (windowsBySession.has(sessionId)) continue;
    const fallback = { sessionId, sessionKey: sessionId };
    windows.push(fallback);
    windowsBySession.set(sessionId, fallback);
  }

  const normalized: UnknownRecord[] = [];
  for (const window of windows) {
    const events = eventsBySession.get(window.sessionId) ?? [];
    const header = recordHeader(events);
    if (header) verifiedHeaderVersion(header, warnings);
    const node = nodes.get(window.sessionKey);
    const metadata = createSqliteMetadata(window, node, nodes, header, appVersion);
    const eventRecords = normalizeEvents(window.sessionId, events, {
      model: nonemptyString(metadata.model),
      provider: nonemptyString(metadata.provider),
      reasoningEffort: nonemptyString(metadata.reasoningEffort),
    }, warnings);
    if (normalizeStatus(metadata.status) === 'unknown' && eventRecords.terminalStatus) {
      metadata.status = eventRecords.terminalStatus;
    }
    normalized.push(metadata, ...eventRecords.records);
  }
  return normalized;
}

export function normalizeOpenClawSessionRecords(
  records: UnknownRecord[],
  filePath: string,
): OpenClawNativeRecordNormalization {
  const warnings = new Set<string>();
  const sqlite = records.some((record) => sqliteKind(record) !== undefined);
  const normalized = sqlite
    ? normalizeSqliteRecords(records, warnings)
    : normalizeLegacyRecords(records, filePath, warnings);
  return { records: normalized, warnings: [...warnings] };
}
