/** @license Apache-2.0 */
import path from 'node:path';

type UnknownRecord = Record<string, unknown>;

export interface AntigravityTraceNormalization {
  records: UnknownRecord[];
  warnings: string[];
}

interface IndexedRecord {
  lineIndex: number;
  record: UnknownRecord;
}

interface PendingToolCall {
  callId: string;
  name: string;
  plannerStep?: number;
  sequence: number;
}

interface UsageValues {
  input?: number;
  output?: number;
  reasoning?: number;
  cacheRead?: number;
  total?: number;
}

const TRANSCRIPT_NAMES = new Set(['transcript.jsonl', 'transcript_full.jsonl']);
const MAX_PENDING_TOOL_CALLS = 2_000;
const IGNORED_RECORD_TYPES = new Set([
  'CONVERSATION_HISTORY',
  'KNOWLEDGE_ARTIFACTS',
  'SYSTEM_MESSAGE',
]);
const TOOL_RESULT_NAMES: Readonly<Record<string, string>> = {
  CODE_ACTION: 'code_action',
  GENERIC: 'generic',
  GREP_SEARCH: 'grep_search',
  LIST_DIRECTORY: 'list_dir',
  READ_URL_CONTENT: 'read_url_content',
  RUN_COMMAND: 'run_command',
  SEARCH_WEB: 'search_web',
  VIEW_FILE: 'view_file',
};
const FAILED_STATUSES = new Set([
  'ABORTED',
  'CANCELED',
  'CANCELLED',
  'ERROR',
  'FAILED',
  'FAILURE',
  'TIMED_OUT',
  'TIMEOUT',
]);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonemptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function nonnegativeInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value);
}

function firstString(record: UnknownRecord, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = nonemptyString(record[key]);
    if (value) return value;
  }
  return undefined;
}

function stepIndex(record: UnknownRecord): number | undefined {
  const value = record.step_index;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stepKey(record: UnknownRecord, lineIndex: number): string {
  return String(stepIndex(record) ?? `line-${lineIndex + 1}`);
}

function timestampMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1_000_000_000_000 ? value * 1_000 : value;
  }
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric < 1_000_000_000_000 ? numeric * 1_000 : numeric;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function isoTimestamp(value: number | undefined): string | undefined {
  return value === undefined ? undefined : new Date(value).toISOString();
}

function transcriptIdentity(filePath: string): string {
  const logsDirectory = path.dirname(filePath);
  const generatedDirectory = path.dirname(logsDirectory);
  return path.basename(path.dirname(generatedDirectory));
}

function extractUserRequest(value: unknown): string | undefined {
  const content = nonemptyString(value);
  if (!content) return undefined;
  const match = content.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/iu);
  return nonemptyString(match?.[1] ?? content);
}

function extractModelName(record: UnknownRecord): string | undefined {
  const direct = firstString(record, ['modelName', 'model_name', 'model']);
  if (direct) return direct;
  const content = nonemptyString(record.content);
  if (!content?.includes('Model Selection')) return undefined;
  return nonemptyString(
    content.match(/Model Selection`[\s\S]*?\s+to\s+([\s\S]*?)\.\s+No need/iu)?.[1],
  );
}

function normalizeFileUri(value: string): string {
  if (!value.startsWith('file://')) return value;
  try {
    return decodeURIComponent(new URL(value).pathname);
  } catch {
    return value.replace(/^file:\/\//u, '');
  }
}

function directWorkingDirectory(args: UnknownRecord): string | undefined {
  const value = firstString(args, ['Cwd', 'cwd', 'Workdir', 'workdir']);
  return value ? normalizeFileUri(value) : undefined;
}

function directoryFromArgs(args: UnknownRecord): string | undefined {
  const directory = firstString(args, ['DirectoryPath', 'directoryPath', 'SearchPath']);
  if (directory) return normalizeFileUri(directory);
  const file = firstString(args, ['AbsolutePath', 'FilePath', 'filePath']);
  return file ? path.dirname(normalizeFileUri(file)) : undefined;
}

function projectPath(records: readonly IndexedRecord[]): string | undefined {
  for (const { record } of records) {
    if (!Array.isArray(record.tool_calls)) continue;
    for (const value of record.tool_calls) {
      if (!isRecord(value) || !isRecord(value.args)) continue;
      const directory = directWorkingDirectory(value.args);
      if (directory) return directory;
    }
  }
  for (const { record } of records) {
    if (!Array.isArray(record.tool_calls)) continue;
    for (const value of record.tool_calls) {
      if (!isRecord(value) || !isRecord(value.args)) continue;
      const directory = directoryFromArgs(value.args);
      if (directory) return directory;
    }
  }
  return undefined;
}

function usageFromRecord(record: UnknownRecord): UsageValues | undefined {
  const source = [record.usage_metadata, record.usageMetadata, record.usage].find(isRecord);
  if (!source) return undefined;
  const input = nonnegativeInteger(
    source.prompt_token_count ?? source.promptTokenCount ?? source.input_tokens ?? source.inputTokens,
  );
  const output = nonnegativeInteger(
    source.candidates_token_count ?? source.candidatesTokenCount
    ?? source.output_tokens ?? source.outputTokens,
  );
  const reasoning = nonnegativeInteger(
    source.thoughts_token_count ?? source.thoughtsTokenCount
    ?? source.reasoning_tokens ?? source.reasoningTokens,
  );
  const cacheRead = nonnegativeInteger(
    source.cached_content_token_count ?? source.cachedContentTokenCount
    ?? source.cache_read_tokens ?? source.cacheReadTokens,
  );
  const total = nonnegativeInteger(
    source.total_token_count ?? source.totalTokenCount ?? source.total_tokens ?? source.totalTokens,
  );
  if ([input, output, reasoning, cacheRead, total].every((value) => value === undefined)) {
    return undefined;
  }
  return {
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(cacheRead === undefined ? {} : { cacheRead }),
    ...(total === undefined ? {} : { total }),
  };
}

function childConversationIds(record: UnknownRecord): string[] {
  const ids = new Set<string>();
  const direct = firstString(record, ['conversationId', 'conversation_id', 'childConversationId']);
  if (direct) ids.add(direct);
  if (isRecord(record.content)) {
    const nested = firstString(record.content, ['conversationId', 'conversation_id']);
    if (nested) ids.add(nested);
  }
  const content = nonemptyString(record.content);
  if (content) {
    const pattern = /"conversationId"\s*:\s*"([^"]+)"/gu;
    for (const match of content.matchAll(pattern)) {
      const id = nonemptyString(match[1]);
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

function failedStatus(value: unknown): boolean {
  const status = nonemptyString(value)?.toUpperCase();
  return status ? FAILED_STATUSES.has(status) : false;
}

function takePendingToolCall(
  pending: PendingToolCall[],
  record: UnknownRecord,
): PendingToolCall | undefined {
  const directId = firstString(record, ['tool_call_id', 'toolCallId', 'call_id']);
  if (directId) {
    const directIndex = pending.findIndex((candidate) => candidate.callId === directId);
    if (directIndex >= 0) return pending.splice(directIndex, 1)[0];
  }
  if (pending.length === 0) return undefined;
  const resultStep = stepIndex(record);
  let selected = -1;
  if (resultStep !== undefined) {
    for (let index = 0; index < pending.length; index += 1) {
      const candidate = pending[index]!;
      if (candidate.plannerStep === undefined || candidate.plannerStep >= resultStep) continue;
      const current = selected < 0 ? undefined : pending[selected];
      if (!current
        || candidate.plannerStep > (current.plannerStep ?? Number.NEGATIVE_INFINITY)
        || (candidate.plannerStep === current.plannerStep && candidate.sequence < current.sequence)) {
        selected = index;
      }
    }
  }
  if (selected < 0) selected = 0;
  return pending.splice(selected, 1)[0];
}

export function normalizeAntigravityTranscriptRecords(
  records: UnknownRecord[],
  filePath: string,
): AntigravityTraceNormalization {
  if (!TRANSCRIPT_NAMES.has(path.basename(filePath))) return { records, warnings: [] };

  const warnings = new Set<string>();
  const indexed = records
    .map((record, lineIndex): IndexedRecord => ({ record, lineIndex }))
    .sort((left, right) => {
      const leftStep = stepIndex(left.record) ?? Number.POSITIVE_INFINITY;
      const rightStep = stepIndex(right.record) ?? Number.POSITIVE_INFINITY;
      return leftStep - rightStep || left.lineIndex - right.lineIndex;
    });
  const externalId = transcriptIdentity(filePath);
  const timestamps = indexed
    .map(({ record }) => timestampMs(record.created_at))
    .filter((value): value is number => value !== undefined);
  const selectedModel = indexed
    .map(({ record }) => extractModelName(record))
    .find((value): value is string => value !== undefined);
  const selectedProjectPath = projectPath(indexed);
  const metadata: UnknownRecord = {
    sessionId: externalId,
    status: 'unknown',
    ...(timestamps.length === 0 ? {} : { createdAt: isoTimestamp(Math.min(...timestamps)) }),
    ...(timestamps.length === 0 ? {} : { endedAt: isoTimestamp(Math.max(...timestamps)) }),
    ...(selectedModel ? { model: selectedModel } : {}),
    ...(selectedProjectPath ? { projectPath: selectedProjectPath } : {}),
  };
  const normalized: UnknownRecord[] = [metadata];
  const pendingTools: PendingToolCall[] = [];
  let currentModel = selectedModel;
  let toolSequence = 0;

  for (const { record, lineIndex } of indexed) {
    const type = nonemptyString(record.type);
    if (!type) {
      warnings.add('Antigravity transcript contains a record without a type.');
      continue;
    }
    currentModel = extractModelName(record) ?? currentModel;
    const key = `step-${stepKey(record, lineIndex)}`;
    const timestamp = record.created_at;

    if (type === 'USER_INPUT') {
      const content = extractUserRequest(record.content);
      if (!content) {
        warnings.add('Antigravity USER_INPUT record is missing readable user content.');
        continue;
      }
      normalized.push({
        id: `${key}:user`,
        sessionId: externalId,
        role: 'user',
        timestamp,
        content,
      });
      continue;
    }

    if (type === 'PLANNER_RESPONSE') {
      const parts: UnknownRecord[] = [];
      const thinking = nonemptyString(record.thinking);
      if (thinking) parts.push({ type: 'reasoning', text: thinking });
      if (Array.isArray(record.tool_calls)) {
        for (let index = 0; index < record.tool_calls.length; index += 1) {
          const tool = record.tool_calls[index];
          if (!isRecord(tool)) {
            warnings.add('Antigravity planner response contains a non-object tool call.');
            continue;
          }
          const name = firstString(tool, ['name', 'tool_name']);
          if (!name) {
            warnings.add('Antigravity planner response contains a tool call without a name.');
            continue;
          }
          const callId = firstString(tool, ['id', 'tool_call_id', 'toolCallId'])
            ?? `call-${stepKey(record, lineIndex)}-${index + 1}`;
          const args = tool.args;
          parts.push({
            type: 'tool_call',
            id: callId,
            name,
            ...(args === undefined ? {} : { arguments: args }),
          });
          pendingTools.push({
            callId,
            name,
            plannerStep: stepIndex(record),
            sequence: toolSequence,
          });
          if (pendingTools.length > MAX_PENDING_TOOL_CALLS) pendingTools.shift();
          toolSequence += 1;
        }
      }
      const content = nonemptyString(record.content);
      if (content) parts.push({ type: 'text', text: content });
      if (parts.length === 0) {
        warnings.add('Antigravity PLANNER_RESPONSE record has no supported content.');
        continue;
      }
      const usage = usageFromRecord(record);
      normalized.push({
        id: `${key}:assistant`,
        sessionId: externalId,
        role: 'assistant',
        timestamp,
        ...(currentModel ? { model: currentModel } : {}),
        ...(usage ? { usage } : {}),
        content: parts,
      });
      continue;
    }

    if (Object.hasOwn(TOOL_RESULT_NAMES, type)) {
      const pending = takePendingToolCall(pendingTools, record);
      const callId = pending?.callId
        ?? firstString(record, ['tool_call_id', 'toolCallId', 'call_id'])
        ?? `call-${stepKey(record, lineIndex)}-result`;
      const name = pending?.name
        ?? firstString(record, ['tool_name', 'toolName'])
        ?? TOOL_RESULT_NAMES[type]!;
      const content = record.content ?? record.error ?? '(empty result)';
      normalized.push({
        id: `${key}:tool-result`,
        sessionId: externalId,
        role: 'tool',
        timestamp,
        content: [{
          type: 'tool_result',
          call_id: callId,
          name,
          content,
          ...(failedStatus(record.status) ? { isError: true } : {}),
        }],
      });
      continue;
    }

    if (type === 'ERROR_MESSAGE') {
      const pending = takePendingToolCall(pendingTools, record);
      const message = firstString(record, ['error', 'content']) ?? 'Antigravity error.';
      normalized.push(pending
        ? {
            id: `${key}:tool-result`,
            sessionId: externalId,
            role: 'tool',
            timestamp,
            content: [{
              type: 'tool_result',
              call_id: pending.callId,
              name: pending.name,
              content: message,
              isError: true,
            }],
          }
        : {
            id: `${key}:error`,
            sessionId: externalId,
            role: 'system',
            timestamp,
            content: [{ type: 'error', code: 'antigravity_error', message }],
          });
      continue;
    }

    if (type === 'CHECKPOINT') {
      const content = nonemptyString(record.content);
      const prefix = content?.match(/^\{\{\s*CHECKPOINT\s+\d+\s*\}\}\s*\n?/u)?.[0];
      const summary = nonemptyString(content?.slice(prefix?.length ?? 0)) ?? 'Antigravity context compacted.';
      normalized.push({
        id: `${key}:compaction`,
        sessionId: externalId,
        role: 'system',
        timestamp,
        content: summary,
      });
      continue;
    }

    if (type === 'INVOKE_SUBAGENT') {
      for (const childSessionId of childConversationIds(record)) {
        if (childSessionId === externalId) continue;
        normalized.push({ sessionId: externalId, childSessionId });
      }
      continue;
    }

    if (IGNORED_RECORD_TYPES.has(type)) continue;
    warnings.add(`Antigravity transcript contains unsupported record type "${type}".`);
  }

  return { records: normalized, warnings: [...warnings] };
}
