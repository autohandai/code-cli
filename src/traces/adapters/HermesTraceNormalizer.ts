/** @license Apache-2.0 */
import type { NormalizedTrace, TraceTokenUsage } from '../model.js';

type UnknownRecord = Record<string, unknown>;
type ModelUsage = NonNullable<NormalizedTrace['modelUsage']>[number];

export const HERMES_SQLITE_RECORD_KIND = '__ahtracesHermesSqliteRecord';
export const HERMES_SUPPORTED_SCHEMA_VERSION = 30;
const MAX_MODEL_USAGE_ENTRIES = 1_000;

export interface HermesNormalizationResult {
  records: UnknownRecord[];
  warnings: string[];
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function nonnegativeInteger(value: unknown): number | undefined {
  if (typeof value === 'bigint') {
    return value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : undefined;
  }
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string' || !value.trim()) return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function usageFromRecord(record: UnknownRecord, actualWhenPresent: boolean): TraceTokenUsage {
  const input = nonnegativeInteger(record.input_tokens);
  const output = nonnegativeInteger(record.output_tokens);
  const cacheRead = nonnegativeInteger(record.cache_read_tokens);
  const cacheWrite = nonnegativeInteger(record.cache_write_tokens);
  const reasoning = nonnegativeInteger(record.reasoning_tokens);
  const available = [input, output, cacheRead, cacheWrite, reasoning]
    .some((value) => value !== undefined && (actualWhenPresent || value > 0));
  if (!available) return { provenance: 'unavailable' };
  const resolvedInput = input ?? 0;
  const resolvedOutput = output ?? 0;
  const resolvedCacheRead = cacheRead ?? 0;
  const resolvedCacheWrite = cacheWrite ?? 0;
  return {
    input: resolvedInput,
    output: resolvedOutput,
    reasoning: reasoning ?? 0,
    cacheRead: resolvedCacheRead,
    cacheWrite: resolvedCacheWrite,
    total: resolvedInput + resolvedOutput + resolvedCacheRead + resolvedCacheWrite,
    provenance: 'actual',
  };
}

function addUsage(left: TraceTokenUsage, right: TraceTokenUsage): TraceTokenUsage {
  if (right.provenance === 'unavailable') return left;
  if (left.provenance === 'unavailable') return right;
  const input = (left.input ?? 0) + (right.input ?? 0);
  const output = (left.output ?? 0) + (right.output ?? 0);
  const cacheRead = (left.cacheRead ?? 0) + (right.cacheRead ?? 0);
  const cacheWrite = (left.cacheWrite ?? 0) + (right.cacheWrite ?? 0);
  return {
    input,
    output,
    reasoning: (left.reasoning ?? 0) + (right.reasoning ?? 0),
    cacheRead,
    cacheWrite,
    total: input + output + cacheRead + cacheWrite,
    provenance: 'actual',
  };
}

function modelUsageForSession(
  session: UnknownRecord,
  rows: readonly UnknownRecord[],
  warnings: Set<string>,
): { usage: TraceTokenUsage; modelUsage?: ModelUsage[] } {
  const grouped = new Map<string, ModelUsage>();
  for (const row of rows) {
    const model = stringValue(row.model);
    if (!model) continue;
    const usage = usageFromRecord(row, true);
    const apiCalls = nonnegativeInteger(row.api_call_count) ?? 0;
    if ((usage.total ?? 0) === 0 && (usage.reasoning ?? 0) === 0 && apiCalls === 0) continue;
    const provider = stringValue(row.billing_provider);
    const task = stringValue(row.task) ?? 'main';
    const key = `${model}\0${provider ?? ''}\0${task}`;
    const existing = grouped.get(key);
    grouped.set(key, existing
      ? { ...existing, usage: addUsage(existing.usage, usage) }
      : { model, ...(provider ? { provider } : {}), task, usage });
  }

  const sessionUsage = usageFromRecord(session, false);
  if (grouped.size === 0) return { usage: sessionUsage };

  let attributed = { provenance: 'unavailable' } as TraceTokenUsage;
  for (const entry of grouped.values()) attributed = addUsage(attributed, entry.usage);
  if (sessionUsage.provenance !== 'unavailable') {
    const residualInput = Math.max(0, (sessionUsage.input ?? 0) - (attributed.input ?? 0));
    const residualOutput = Math.max(0, (sessionUsage.output ?? 0) - (attributed.output ?? 0));
    const residualCacheRead = Math.max(0, (sessionUsage.cacheRead ?? 0) - (attributed.cacheRead ?? 0));
    const residualCacheWrite = Math.max(0, (sessionUsage.cacheWrite ?? 0) - (attributed.cacheWrite ?? 0));
    if (residualInput + residualOutput + residualCacheRead + residualCacheWrite > 0) {
      const model = stringValue(session.model) ?? 'unknown';
      const provider = stringValue(session.billing_provider);
      const key = `${model}\0${provider ?? ''}\0main`;
      const residual: TraceTokenUsage = {
        input: residualInput,
        output: residualOutput,
        reasoning: 0,
        cacheRead: residualCacheRead,
        cacheWrite: residualCacheWrite,
        total: residualInput + residualOutput + residualCacheRead + residualCacheWrite,
        provenance: 'actual',
      };
      const existing = grouped.get(key);
      grouped.set(key, existing
        ? { ...existing, usage: addUsage(existing.usage, residual) }
        : { model, ...(provider ? { provider } : {}), task: 'main', usage: residual });
    }
  }

  let usage = { provenance: 'unavailable' } as TraceTokenUsage;
  const allModelUsage = [...grouped.values()];
  for (const entry of allModelUsage) usage = addUsage(usage, entry.usage);
  if (allModelUsage.length > MAX_MODEL_USAGE_ENTRIES) {
    warnings.add('Hermes per-model attribution exceeded 1,000 entries; excess dimensions were omitted.');
  }
  return { usage, modelUsage: allModelUsage.slice(0, MAX_MODEL_USAGE_ENTRIES) };
}

function toolCallParts(value: unknown, warnings: Set<string>): UnknownRecord[] {
  if (value === null || value === undefined || value === '') return [];
  const decoded = parseJson(value);
  if (!Array.isArray(decoded)) {
    warnings.add('Hermes tool_calls contained an unsupported payload.');
    return [];
  }
  const parts: UnknownRecord[] = [];
  for (const item of decoded) {
    if (!isRecord(item) || !isRecord(item.function)) {
      warnings.add('Hermes tool_calls contained an unsupported entry.');
      continue;
    }
    const name = stringValue(item.function.name);
    if (!name) {
      warnings.add('Hermes tool_calls contained an entry without a function name.');
      continue;
    }
    const callId = stringValue(item.id);
    const rawArguments = item.function.arguments;
    const parsedArguments = parseJson(rawArguments);
    parts.push({
      type: 'tool_call',
      name,
      ...(callId ? { id: callId } : {}),
      ...(rawArguments === undefined ? {} : { input: parsedArguments ?? rawArguments }),
    });
  }
  return parts;
}

function codexTextParts(value: unknown, warnings: Set<string>): UnknownRecord[] {
  if (value === null || value === undefined || value === '') return [];
  const decoded = parseJson(value);
  if (!Array.isArray(decoded)) {
    warnings.add('Hermes codex_message_items contained an unsupported payload.');
    return [];
  }
  const parts: UnknownRecord[] = [];
  for (const item of decoded) {
    if (!isRecord(item) || item.type !== 'message' || item.role !== 'assistant' || !Array.isArray(item.content)) {
      warnings.add('Hermes codex_message_items contained an unsupported entry.');
      continue;
    }
    for (const content of item.content) {
      if (!isRecord(content) || content.type !== 'output_text') {
        warnings.add('Hermes codex_message_items contained unsupported assistant content.');
        continue;
      }
      const text = stringValue(content.text);
      if (text) parts.push({ type: 'text', text });
    }
  }
  return parts;
}

function messageFromRow(row: UnknownRecord, warnings: Set<string>): UnknownRecord | undefined {
  if (stringValue(row.display_kind)?.toLowerCase() === 'hidden') return undefined;
  const role = stringValue(row.role)?.toLowerCase();
  if (role !== 'user' && role !== 'assistant' && role !== 'system' && role !== 'tool') {
    warnings.add(`Hermes message role ${JSON.stringify(role ?? 'missing')} is unsupported.`);
    return undefined;
  }
  const parts: UnknownRecord[] = [];
  const content = stringValue(row.content);
  if (role === 'assistant') {
    const reasoning = [stringValue(row.reasoning), stringValue(row.reasoning_content)]
      .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);
    for (const text of reasoning) parts.push({ type: 'reasoning', text });
    if (content) parts.push({ type: 'text', text: content });
    parts.push(...toolCallParts(row.tool_calls, warnings));
    if (!content) parts.push(...codexTextParts(row.codex_message_items, warnings));
  } else if (role === 'tool') {
    if (content || stringValue(row.tool_call_id) || stringValue(row.tool_name)) {
      const disposition = stringValue(row.effect_disposition)?.toLowerCase();
      parts.push({
        type: 'tool_result',
        ...(stringValue(row.tool_name) ? { name: stringValue(row.tool_name) } : {}),
        ...(stringValue(row.tool_call_id) ? { call_id: stringValue(row.tool_call_id) } : {}),
        ...(content ? { content } : {}),
        ...(disposition && /^(?:error|failed|failure|rejected)$/u.test(disposition)
          ? { is_error: true }
          : {}),
      });
    }
  } else if (content) {
    parts.push({ type: 'text', text: content });
  }
  if (parts.length === 0) return undefined;
  return {
    id: String(row.id),
    role,
    content: parts,
    ...(row.timestamp === undefined ? {} : { timestamp: row.timestamp }),
  };
}

function statusForSession(session: UnknownRecord): NormalizedTrace['status'] {
  if (session.ended_at === null || session.ended_at === undefined) return 'active';
  const reason = stringValue(session.end_reason)?.toLowerCase() ?? '';
  if (/(?:cancel|abort|interrupt|killed)/u.test(reason)) return 'cancelled';
  if (/(?:error|fail)/u.test(reason)) return 'failed';
  return 'completed';
}

function deduplicateAdjacent(messages: UnknownRecord[]): UnknownRecord[] {
  const output: UnknownRecord[] = [];
  let previousSignature: string | undefined;
  for (const message of messages) {
    const signature = JSON.stringify({
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
    });
    if (signature === previousSignature) continue;
    previousSignature = signature;
    output.push(message);
  }
  return output;
}

export function normalizeHermesSessionRecords(
  input: readonly UnknownRecord[],
  _recordPath: string,
): HermesNormalizationResult {
  const warnings = new Set<string>();
  const tagged = input.filter((record) => HERMES_SQLITE_RECORD_KIND in record);
  const schema = tagged.find((record) => record[HERMES_SQLITE_RECORD_KIND] === 'schema');
  const schemaVersion = nonnegativeInteger(schema?.schemaVersion);
  if (schemaVersion === undefined) {
    warnings.add('Hermes SQLite schema version is unavailable.');
  } else if (schemaVersion > HERMES_SUPPORTED_SCHEMA_VERSION) {
    warnings.add(
      `Hermes SQLite schema ${schemaVersion} is newer than supported schema ${HERMES_SUPPORTED_SCHEMA_VERSION}; unknown fields were ignored.`,
    );
  }
  if (schema?.activeProjection !== true) {
    warnings.add('Hermes messages.active is unavailable; transcript history may include stale rows.');
  }
  if (schema?.modelUsageProjection !== true) {
    warnings.add('Hermes session_model_usage is unavailable; per-model attribution uses session aggregates.');
  }

  const sessions = tagged.filter((record) => record[HERMES_SQLITE_RECORD_KIND] === 'session');
  const sessionsById = new Map(sessions.flatMap((session) => {
    const id = stringValue(session.id);
    return id ? [[id, session] as const] : [];
  }));
  const messagesBySession = new Map<string, UnknownRecord[]>();
  for (const row of tagged.filter((record) => record[HERMES_SQLITE_RECORD_KIND] === 'message')) {
    const sessionId = stringValue(row.session_id);
    if (!sessionId) continue;
    const current = messagesBySession.get(sessionId) ?? [];
    current.push(row);
    messagesBySession.set(sessionId, current);
  }
  const usageBySession = new Map<string, UnknownRecord[]>();
  for (const row of tagged.filter((record) => record[HERMES_SQLITE_RECORD_KIND] === 'usage')) {
    const sessionId = stringValue(row.session_id);
    if (!sessionId) continue;
    const current = usageBySession.get(sessionId) ?? [];
    current.push(row);
    usageBySession.set(sessionId, current);
  }

  const records = sessions.flatMap((session): UnknownRecord[] => {
    const sessionId = stringValue(session.id);
    if (!sessionId) return [];
    const rows = [...(messagesBySession.get(sessionId) ?? [])].sort((left, right) => (
      (nonnegativeInteger(left.id) ?? 0) - (nonnegativeInteger(right.id) ?? 0)
    ));
    const messages = deduplicateAdjacent(rows.flatMap((row) => {
      const message = messageFromRow(row, warnings);
      return message ? [message] : [];
    }));
    const { usage, modelUsage } = modelUsageForSession(
      session,
      usageBySession.get(sessionId) ?? [],
      warnings,
    );
    const parentSessionId = stringValue(session.parent_session_id);
    const parent = parentSessionId ? sessionsById.get(parentSessionId) : undefined;
    const parentRelationshipType = parent?.end_reason === 'compression' ? 'resume' : 'parent';
    return [{
      sessionId,
      model: stringValue(session.model),
      provider: stringValue(session.billing_provider),
      cwd: stringValue(session.cwd) ?? stringValue(session.git_repo_root),
      git_branch: stringValue(session.git_branch),
      created_at: session.started_at,
      ended_at: session.ended_at,
      status: statusForSession(session),
      authoritativeLifecycle: true,
      ...(parentSessionId ? { parentSessionId, parentRelationshipType } : {}),
      usage,
      ...(modelUsage ? { modelUsage } : {}),
      messages,
    }];
  });
  return { records, warnings: [...warnings] };
}
