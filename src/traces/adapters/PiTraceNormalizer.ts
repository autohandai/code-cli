/** @license Apache-2.0 */
import path from 'node:path';

type UnknownRecord = Record<string, unknown>;

export interface PiNativeRecordNormalization {
  records: UnknownRecord[];
  warnings: string[];
}

const VERIFIED_SESSION_VERSION = 3;
const TOOL_CALL_TYPES = new Set(['toolcall', 'tool_call', 'tool_use', 'function_call']);
const TOOL_RESULT_TYPES = new Set(['toolresult', 'tool_result', 'tool_output', 'function_call_output']);

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

function decodeMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function normalizeContent(
  value: unknown,
  pendingToolNames: Map<string, string>,
  warnings: Set<string>,
): UnknownRecord[] {
  const blocks = typeof value === 'string' ? [{ type: 'text', text: value }] : value;
  if (!Array.isArray(blocks)) return [];
  const normalized: UnknownRecord[] = [];
  for (const blockValue of blocks) {
    if (typeof blockValue === 'string') {
      normalized.push({ type: 'text', text: blockValue });
      continue;
    }
    if (!isRecord(blockValue)) continue;
    const type = (firstString(blockValue, [['type']]) ?? 'text').toLowerCase();
    if (type === 'text') {
      normalized.push({ type: 'text', text: blockValue.text ?? blockValue.content });
      continue;
    }
    if (type === 'thinking' || type === 'reasoning') {
      normalized.push({
        type: 'thinking',
        thinking: blockValue.thinking ?? blockValue.reasoning ?? blockValue.text ?? blockValue.content,
      });
      continue;
    }
    if (TOOL_CALL_TYPES.has(type)) {
      const nested = isRecord(blockValue.toolCall)
        ? blockValue.toolCall
        : isRecord(blockValue.functionCall) ? blockValue.functionCall : undefined;
      const callId = firstString(blockValue, [['id'], ['callId'], ['toolCallId']])
        ?? (nested ? firstString(nested, [['id'], ['callId']]) : undefined);
      const name = firstString(blockValue, [['name'], ['toolName']])
        ?? (nested ? firstString(nested, [['name'], ['toolName']]) : undefined)
        ?? 'unknown';
      if (callId) pendingToolNames.set(callId, name);
      normalized.push({
        type: 'tool_call',
        name,
        ...(callId ? { id: callId } : {}),
        arguments: decodeMaybeJson(
          blockValue.arguments ?? blockValue.args ?? blockValue.input
          ?? nested?.arguments ?? nested?.args ?? nested?.input,
        ),
      });
      continue;
    }
    if (TOOL_RESULT_TYPES.has(type)) {
      const nested = isRecord(blockValue.toolResult)
        ? blockValue.toolResult
        : isRecord(blockValue.functionCallOutput) ? blockValue.functionCallOutput : undefined;
      const callId = firstString(blockValue, [['id'], ['callId'], ['toolCallId']])
        ?? (nested ? firstString(nested, [['id'], ['callId'], ['toolCallId']]) : undefined);
      const name = (callId ? pendingToolNames.get(callId) : undefined)
        ?? firstString(blockValue, [['name'], ['toolName']])
        ?? (nested ? firstString(nested, [['name'], ['toolName']]) : undefined);
      normalized.push({
        type: 'tool_result',
        ...(callId ? { call_id: callId } : {}),
        ...(name ? { name } : {}),
        content: blockValue.output ?? blockValue.result ?? blockValue.content
          ?? nested?.output ?? nested?.result ?? nested?.response,
        ...(
          blockValue.isError === true || blockValue.is_error === true
          || nested?.isError === true || nested?.is_error === true
            ? { isError: true }
            : {}
        ),
      });
      continue;
    }
    warnings.add(`Pi session contains unsupported content block type "${type}".`);
  }
  return normalized;
}

function normalizeToolResult(
  message: UnknownRecord,
  recordId: string | undefined,
  pendingToolNames: Map<string, string>,
): UnknownRecord {
  const nested = isRecord(message.result)
    ? message.result
    : isRecord(message.toolResult) ? message.toolResult : undefined;
  const callId = firstString(message, [['callId'], ['toolCallId']])
    ?? (nested ? firstString(nested, [['callId'], ['toolCallId']]) : undefined)
    ?? recordId;
  const name = (callId ? pendingToolNames.get(callId) : undefined)
    ?? firstString(message, [['toolName'], ['name']])
    ?? (nested ? firstString(nested, [['toolName'], ['name']]) : undefined);
  const status = firstString(message, [['status']])
    ?? (nested ? firstString(nested, [['status']]) : undefined);
  return {
    type: 'tool_result',
    ...(callId ? { call_id: callId } : {}),
    ...(name ? { name } : {}),
    content: message.output ?? message.result ?? message.content
      ?? nested?.output ?? nested?.response,
    ...(
      message.isError === true || message.is_error === true
      || nested?.isError === true || nested?.is_error === true
      || status === 'error' || status === 'failed'
        ? { isError: true }
        : {}
    ),
  };
}

export function normalizePiSessionRecords(
  records: UnknownRecord[],
  filePath: string,
): PiNativeRecordNormalization {
  const session = records.find((record) => firstString(record, [['type']])?.toLowerCase() === 'session');
  if (!session) return { records, warnings: [] };

  const warnings = new Set<string>();
  const externalId = firstString(session, [['id']])
    ?? path.basename(filePath).replace(/\.jsonl$/iu, '');
  const version = session.version;
  if (version !== VERIFIED_SESSION_VERSION) {
    warnings.add(`Pi session version ${String(version ?? 'unknown')} is not a verified native contract.`);
  }
  const sessionMetadata: UnknownRecord = {
    sessionId: externalId,
    ...(typeof version === 'number' || typeof version === 'string'
      ? { agentVersion: String(version) }
      : {}),
    projectPath: firstString(session, [['cwd']]),
    createdAt: session.timestamp,
  };
  const normalized: UnknownRecord[] = [sessionMetadata];
  const pendingToolNames = new Map<string, string>();
  const modelsSeen: Array<{ model: string; provider?: string }> = [];
  let currentModel: string | undefined;
  let currentProvider: string | undefined;
  let currentReasoningEffort: string | undefined;
  let firstSeenReasoningEffort: string | undefined;
  let initialModel: string | undefined;
  let initialProvider: string | undefined;
  let initialReasoningEffort: string | undefined;
  let sawFirstUser = false;

  const rememberModel = (model: string | undefined, provider: string | undefined): void => {
    if (!model) return;
    if (!modelsSeen.some((candidate) => candidate.model === model && candidate.provider === provider)) {
      modelsSeen.push({ model, ...(provider ? { provider } : {}) });
    }
  };

  for (const record of records) {
    const type = firstString(record, [['type']])?.toLowerCase();
    if (!type) {
      warnings.add('Pi session contains a record without a type.');
      continue;
    }
    if (type === 'session') continue;
    if (type === 'model_change') {
      currentModel = firstString(record, [['modelId'], ['model']]) ?? currentModel;
      currentProvider = firstString(record, [['provider']]) ?? currentProvider;
      rememberModel(currentModel, currentProvider);
      continue;
    }
    if (type === 'thinking_level_change') {
      currentReasoningEffort = firstString(record, [['thinkingLevel'], ['reasoningEffort']])
        ?? currentReasoningEffort;
      firstSeenReasoningEffort ??= currentReasoningEffort;
      continue;
    }
    if (type === 'message') {
      const message = isRecord(record.message) ? record.message : undefined;
      if (!message) {
        warnings.add('Pi session contains a message record without a message object.');
        continue;
      }
      const rawRole = firstString(message, [['role']])?.toLowerCase();
      const recordId = firstString(record, [['id']]);
      if (rawRole === 'user' && !sawFirstUser) {
        sawFirstUser = true;
        initialModel = currentModel;
        initialProvider = currentProvider;
        initialReasoningEffort = currentReasoningEffort;
      }
      const messageModel = firstString(message, [['model'], ['modelId']]) ?? currentModel;
      const messageProvider = firstString(message, [['provider']]) ?? currentProvider;
      if (messageModel) {
        currentModel = messageModel;
        currentProvider = messageProvider;
        rememberModel(messageModel, messageProvider);
      }
      let role: 'user' | 'assistant' | 'tool' | undefined;
      let content: UnknownRecord[];
      if (rawRole === 'user' || rawRole === 'assistant') {
        role = rawRole;
        content = normalizeContent(message.content, pendingToolNames, warnings);
      } else if (rawRole === 'toolresult' || rawRole === 'tool_result' || rawRole === 'tool') {
        role = 'tool';
        content = [normalizeToolResult(message, recordId, pendingToolNames)];
      } else {
        warnings.add(`Pi session contains unsupported message role "${rawRole ?? 'unknown'}".`);
        continue;
      }
      normalized.push({
        id: recordId,
        sessionId: externalId,
        role,
        content,
        timestamp: record.timestamp ?? message.timestamp,
        ...(messageModel ? { model: messageModel } : {}),
        ...(messageProvider ? { provider: messageProvider } : {}),
        ...(currentReasoningEffort ? { reasoningEffort: currentReasoningEffort } : {}),
        ...(isRecord(message.usage) ? { usage: message.usage } : {}),
      });
      continue;
    }
    if (TOOL_CALL_TYPES.has(type)) {
      const content = normalizeContent([{ ...record, type: 'tool_call' }], pendingToolNames, warnings);
      normalized.push({
        id: firstString(record, [['id']]), sessionId: externalId, role: 'assistant',
        content, timestamp: record.timestamp, ...(currentModel ? { model: currentModel } : {}),
      });
      continue;
    }
    if (TOOL_RESULT_TYPES.has(type)) {
      normalized.push({
        id: firstString(record, [['id']]), sessionId: externalId, role: 'tool',
        content: [normalizeToolResult(record, firstString(record, [['id']]), pendingToolNames)],
        timestamp: record.timestamp,
      });
      continue;
    }
    if (type === 'compaction') {
      normalized.push({
        id: firstString(record, [['id']]),
        sessionId: externalId,
        role: 'system',
        timestamp: record.timestamp,
        content: firstString(record, [['summary']]) ?? 'Session compacted.',
      });
      continue;
    }
    if (type === 'error') {
      const nested = isRecord(record.error) ? record.error : undefined;
      normalized.push({
        id: firstString(record, [['id']]),
        sessionId: externalId,
        role: 'system',
        timestamp: record.timestamp,
        content: [{
          type: 'error',
          message: firstString(record, [['message']])
            ?? (nested ? firstString(nested, [['message']]) : undefined)
            ?? 'Unknown Pi session error.',
        }],
      });
      continue;
    }
    warnings.add(`Pi session contains unsupported record type "${type}".`);
  }

  const primaryModel = initialModel ?? modelsSeen[0]?.model;
  const primaryProvider = initialProvider
    ?? modelsSeen.find((candidate) => candidate.model === primaryModel)?.provider;
  if (primaryModel) sessionMetadata.model = primaryModel;
  if (primaryProvider) sessionMetadata.provider = primaryProvider;
  const primaryReasoningEffort = initialReasoningEffort ?? firstSeenReasoningEffort;
  if (primaryReasoningEffort) sessionMetadata.reasoningEffort = primaryReasoningEffort;
  return { records: normalized, warnings: [...warnings] };
}
