/** @license Apache-2.0 */
import path from 'node:path';

type UnknownRecord = Record<string, unknown>;

export interface GrokSessionSources {
  summary?: UnknownRecord;
  updates: UnknownRecord[];
  chatHistory: UnknownRecord[];
}

export interface GrokSessionNormalization {
  records: UnknownRecord[];
  warnings: string[];
}

interface GrokUsage {
  input?: number;
  output?: number;
  reasoning?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total?: number;
}

interface ToolState {
  name?: string;
  result?: UnknownRecord;
}

const CONVERSATION_UPDATES = new Set([
  'agent_message_chunk',
  'agent_thought_chunk',
  'user_message_chunk',
]);

const IGNORED_UPDATES = new Set([
  'available_commands_update',
  'image_compressed',
  'interaction_resolved',
  'pending_interaction',
  'plan',
  'response_completed',
  'session_summary_generated',
  'tool_call_delta_chunk',
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

function nestedRecord(record: UnknownRecord | undefined, key: string): UnknownRecord | undefined {
  const value = record?.[key];
  return isRecord(value) ? value : undefined;
}

function updateFrom(record: UnknownRecord): UnknownRecord | undefined {
  const params = nestedRecord(record, 'params');
  const nested = nestedRecord(params, 'update');
  if (nested) return nested;
  const direct = nestedRecord(record, 'update');
  if (direct) return direct;
  return nonemptyString(record.sessionUpdate) ? record : undefined;
}

function agentTimestamp(record: UnknownRecord, update: UnknownRecord): unknown {
  const params = nestedRecord(record, 'params');
  const candidates = [
    nestedRecord(update, '_meta')?.agentTimestampMs,
    nestedRecord(params, '_meta')?.agentTimestampMs,
    nestedRecord(record, '_meta')?.agentTimestampMs,
    record.timestamp,
  ];
  return candidates.find((candidate) => candidate !== undefined);
}

function firstGitRemote(summary: UnknownRecord): string | undefined {
  if (!Array.isArray(summary.git_remotes)) return undefined;
  for (const value of summary.git_remotes) {
    if (nonemptyString(value)) return nonemptyString(value);
    if (!isRecord(value)) continue;
    const remote = nonemptyString(value.url) ?? nonemptyString(value.origin);
    if (remote) return remote;
  }
  return undefined;
}

function contentText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const text = value.map(contentText).filter((part): part is string => part !== undefined).join('');
    return text || undefined;
  }
  if (!isRecord(value)) return undefined;
  if (typeof value.text === 'string') return value.text;
  return value.content === value ? undefined : contentText(value.content);
}

function usageFields(source: UnknownRecord): GrokUsage {
  const input = nonnegativeInteger(source.inputTokens ?? source.input_tokens ?? source.input);
  const output = nonnegativeInteger(source.outputTokens ?? source.output_tokens ?? source.output);
  const reasoning = nonnegativeInteger(
    source.reasoningTokens ?? source.reasoning_tokens ?? source.reasoning,
  );
  const cacheRead = nonnegativeInteger(
    source.cachedReadTokens ?? source.cacheReadTokens ?? source.cache_read_tokens ?? source.cacheRead,
  );
  const cacheWrite = nonnegativeInteger(
    source.cacheCreationTokens ?? source.cachedWriteTokens ?? source.cache_write_tokens ?? source.cacheWrite,
  );
  const total = nonnegativeInteger(source.totalTokens ?? source.total_tokens ?? source.total);
  return {
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(cacheRead === undefined ? {} : { cacheRead }),
    ...(cacheWrite === undefined ? {} : { cacheWrite }),
    ...(total === undefined ? {} : { total }),
  };
}

function hasUsage(usage: GrokUsage): boolean {
  return Object.values(usage).some((value) => value !== undefined);
}

function sumUsage(left: GrokUsage, right: GrokUsage): GrokUsage {
  const sum = (a: number | undefined, b: number | undefined): number | undefined => {
    if (a === undefined) return b;
    if (b === undefined) return a;
    return a + b;
  };
  const input = sum(left.input, right.input);
  const output = sum(left.output, right.output);
  const reasoning = sum(left.reasoning, right.reasoning);
  const cacheRead = sum(left.cacheRead, right.cacheRead);
  const cacheWrite = sum(left.cacheWrite, right.cacheWrite);
  const total = sum(left.total, right.total);
  return {
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(cacheRead === undefined ? {} : { cacheRead }),
    ...(cacheWrite === undefined ? {} : { cacheWrite }),
    ...(total === undefined ? {} : { total }),
  };
}

function usageFrom(update: UnknownRecord): GrokUsage | undefined {
  const usage = nestedRecord(update, 'usage');
  if (!usage) return undefined;
  const direct = usageFields(usage);
  const modelUsage = nestedRecord(usage, 'modelUsage') ?? nestedRecord(usage, 'model_usage');
  let modelAggregate: GrokUsage = {};
  if (modelUsage) {
    for (const value of Object.values(modelUsage)) {
      if (isRecord(value)) modelAggregate = sumUsage(modelAggregate, usageFields(value));
    }
  }
  const input = direct.input ?? modelAggregate.input;
  const output = direct.output ?? modelAggregate.output;
  const reasoning = direct.reasoning ?? modelAggregate.reasoning;
  const cacheRead = direct.cacheRead ?? modelAggregate.cacheRead;
  const cacheWrite = direct.cacheWrite ?? modelAggregate.cacheWrite;
  const total = direct.total ?? modelAggregate.total;
  const combined: GrokUsage = {
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(cacheRead === undefined ? {} : { cacheRead }),
    ...(cacheWrite === undefined ? {} : { cacheWrite }),
    ...(total === undefined ? {} : { total }),
  };
  return hasUsage(combined) ? combined : undefined;
}

function modelFromUsage(update: UnknownRecord): string | undefined {
  const usage = nestedRecord(update, 'usage');
  const modelUsage = nestedRecord(usage, 'modelUsage') ?? nestedRecord(usage, 'model_usage');
  if (!modelUsage) return undefined;
  const models = Object.keys(modelUsage).filter((model) => model.trim());
  return models.length === 1 ? models[0] : undefined;
}

function hookFailed(update: UnknownRecord): boolean {
  if (!Array.isArray(update.runs)) return false;
  return update.runs.some((value) => {
    if (!isRecord(value)) return false;
    const status = nestedRecord(value, 'status');
    return nonemptyString(status?.status)?.toLowerCase() === 'failed';
  });
}

function terminalToolStatus(value: unknown): boolean {
  const status = nonemptyString(value)?.toLowerCase();
  return status === 'completed' || status === 'failed' || status === 'error' || status === 'cancelled';
}

function xaiToolMetadata(update: UnknownRecord): UnknownRecord | undefined {
  const meta = nestedRecord(update, '_meta');
  return meta && isRecord(meta['x.ai/tool']) ? meta['x.ai/tool'] : undefined;
}

function toolName(update: UnknownRecord): string | undefined {
  return nonemptyString(xaiToolMetadata(update)?.name)
    ?? nonemptyString(update.toolName)
    ?? nonemptyString(update.tool_name)
    ?? nonemptyString(update.title);
}

function historyRecords(
  records: UnknownRecord[],
  sessionId: string,
  model: string | undefined,
  warnings: Set<string>,
): UnknownRecord[] {
  const normalized: UnknownRecord[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    const role = nonemptyString(record.role ?? record.type)?.toLowerCase();
    if (!role || !['assistant', 'system', 'tool', 'user'].includes(role)) {
      warnings.add(`Grok chat history contains unsupported role "${role ?? 'unknown'}".`);
      continue;
    }
    if (record.content === undefined) {
      warnings.add('Grok chat history contains a message without content.');
      continue;
    }
    normalized.push({
      id: nonemptyString(record.id) ?? `history:${index}`,
      sessionId,
      role,
      content: record.content,
      ...(record.timestamp === undefined ? {} : { timestamp: record.timestamp }),
      ...(role === 'assistant' && model ? { model } : {}),
    });
  }
  return normalized;
}

function isNativeSummary(summary: UnknownRecord | undefined): boolean {
  if (!summary) return false;
  return isRecord(summary.info)
    || summary.current_model_id !== undefined
    || summary.created_at !== undefined
    || summary.session_kind !== undefined;
}

export function normalizeGrokSessionRecords(
  sources: GrokSessionSources,
  summaryPath: string,
): GrokSessionNormalization {
  const { summary, updates, chatHistory } = sources;
  if (!isNativeSummary(summary)) {
    return { records: summary ? [summary] : [], warnings: [] };
  }

  const warnings = new Set<string>();
  const info = isRecord(summary?.info) ? summary.info : undefined;
  const sessionId = nonemptyString(info?.id) ?? path.basename(path.dirname(summaryPath));
  if (!nonemptyString(info?.id)) {
    warnings.add('Grok summary is missing info.id; the session directory name was used.');
  }
  const model = nonemptyString(summary?.current_model_id);
  const session: UnknownRecord = {
    sessionId,
    projectPath: nonemptyString(info?.cwd) ?? nonemptyString(summary?.git_root_dir),
    model,
    gitRemote: summary ? firstGitRemote(summary) : undefined,
    gitBranch: nonemptyString(summary?.head_branch),
    gitRef: nonemptyString(summary?.head_commit),
    createdAt: summary?.created_at,
    endedAt: summary?.updated_at ?? summary?.last_active_at,
    agentVersion: nonemptyString(summary?.chat_format_version),
    grokSessionKind: nonemptyString(summary?.session_kind),
    parentSessionId: nonemptyString(summary?.parent_session_id),
  };
  const normalized: UnknownRecord[] = [session];
  const hasConversationUpdates = updates.some((record) => {
    const update = updateFrom(record);
    return update ? CONVERSATION_UPDATES.has(nonemptyString(update.sessionUpdate) ?? '') : false;
  });
  if (!hasConversationUpdates) {
    normalized.push(...historyRecords(chatHistory, sessionId, model, warnings));
  }

  const tools = new Map<string, ToolState>();
  const seenPromptIds = new Set<string>();
  let aggregateUsage: GrokUsage = {};
  let currentUser: UnknownRecord | undefined;
  let currentAssistant: UnknownRecord | undefined;
  let lastAssistant: UnknownRecord | undefined;
  let generatedId = 0;

  const appendChunk = (
    role: 'assistant' | 'user',
    partType: 'reasoning' | 'text',
    text: string,
    timestamp: unknown,
  ): void => {
    let message = role === 'user' ? currentUser : currentAssistant;
    if (!message) {
      message = {
        id: `chunk:${generatedId++}`,
        sessionId,
        role,
        content: [],
        ...(timestamp === undefined ? {} : { timestamp }),
        ...(role === 'assistant' && model ? { model } : {}),
      };
      normalized.push(message);
      if (role === 'user') {
        currentUser = message;
        currentAssistant = undefined;
      } else {
        currentAssistant = message;
        currentUser = undefined;
        lastAssistant = message;
      }
    }
    const content = message.content as UnknownRecord[];
    const previous = content.at(-1);
    const previousText = isRecord(previous)
      ? partType === 'reasoning' ? previous.thinking : previous.text
      : undefined;
    if (isRecord(previous) && previous.type === (partType === 'reasoning' ? 'thinking' : 'text')
      && typeof previousText === 'string') {
      if (partType === 'reasoning') previous.thinking = previousText + text;
      else previous.text = previousText + text;
      return;
    }
    content.push(partType === 'reasoning'
      ? { type: 'thinking', thinking: text }
      : { type: 'text', text });
  };

  const appendToolResult = (
    state: ToolState,
    callId: string,
    update: UnknownRecord,
    timestamp: unknown,
  ): void => {
    if (!terminalToolStatus(update.status)) return;
    const status = nonemptyString(update.status)?.toLowerCase();
    const resultPart: UnknownRecord = {
      type: 'tool_result',
      call_id: callId,
      name: state.name ?? 'unknown',
      output: update.rawOutput ?? update.content ?? update.output ?? { status },
      ...(status === 'failed' || status === 'error' || status === 'cancelled' ? { isError: true } : {}),
    };
    if (state.result) {
      state.result.content = [resultPart];
      if (timestamp !== undefined) state.result.timestamp = timestamp;
      return;
    }
    state.result = {
      id: `tool-result:${callId}`,
      sessionId,
      role: 'tool',
      ...(timestamp === undefined ? {} : { timestamp }),
      content: [resultPart],
    };
    normalized.push(state.result);
  };

  for (let index = 0; index < updates.length; index += 1) {
    const envelope = updates[index]!;
    const update = updateFrom(envelope);
    if (!update) {
      warnings.add('Grok updates contain a record without an update object.');
      continue;
    }
    const kind = nonemptyString(update.sessionUpdate);
    if (!kind) {
      warnings.add('Grok updates contain a record without sessionUpdate.');
      continue;
    }
    const timestamp = agentTimestamp(envelope, update);
    if (kind === 'user_message_chunk' || kind === 'agent_message_chunk' || kind === 'agent_thought_chunk') {
      const text = contentText(update.content);
      if (!text) {
        warnings.add(`Grok ${kind} does not contain text content.`);
        continue;
      }
      appendChunk(
        kind === 'user_message_chunk' ? 'user' : 'assistant',
        kind === 'agent_thought_chunk' ? 'reasoning' : 'text',
        text,
        timestamp,
      );
      continue;
    }
    if (kind === 'tool_call') {
      currentUser = undefined;
      currentAssistant = undefined;
      const callId = nonemptyString(update.toolCallId ?? update.tool_call_id) ?? `tool:${generatedId++}`;
      const state = tools.get(callId) ?? {};
      state.name = toolName(update) ?? state.name ?? 'unknown';
      tools.set(callId, state);
      normalized.push({
        id: `tool-call:${callId}`,
        sessionId,
        role: 'assistant',
        ...(timestamp === undefined ? {} : { timestamp }),
        ...(model ? { model } : {}),
        content: [{
          type: 'tool_call',
          id: callId,
          name: state.name,
          arguments: update.rawInput ?? xaiToolMetadata(update)?.input,
        }],
      });
      lastAssistant = normalized.at(-1);
      appendToolResult(state, callId, update, timestamp);
      continue;
    }
    if (kind === 'tool_call_update') {
      const callId = nonemptyString(update.toolCallId ?? update.tool_call_id) ?? `tool:${generatedId++}`;
      const state = tools.get(callId) ?? {};
      state.name = toolName(update) ?? state.name ?? 'unknown';
      tools.set(callId, state);
      appendToolResult(state, callId, update, timestamp);
      continue;
    }
    if (kind === 'turn_completed') {
      const promptId = nonemptyString(update.prompt_id ?? update.promptId);
      const duplicate = promptId ? seenPromptIds.has(promptId) : false;
      if (promptId) seenPromptIds.add(promptId);
      const usage = usageFrom(update);
      if (!duplicate && usage) {
        aggregateUsage = sumUsage(aggregateUsage, usage);
        if (lastAssistant) {
          lastAssistant.usage = usage;
          lastAssistant.model ??= modelFromUsage(update) ?? model;
        }
        session.model ??= modelFromUsage(update);
      }
      const stopReason = nonemptyString(update.stop_reason ?? update.stopReason)?.toLowerCase();
      session.status = stopReason === 'cancelled' || stopReason === 'canceled'
        ? 'cancelled'
        : stopReason === 'error' ? 'failed' : 'completed';
      currentUser = undefined;
      currentAssistant = undefined;
      lastAssistant = undefined;
      continue;
    }
    if (kind === 'hook_execution') {
      if (hookFailed(update)) {
        const eventName = nonemptyString(update.event_name ?? update.eventName) ?? 'hook';
        normalized.push({
          id: `hook-error:${index}`,
          sessionId,
          role: 'system',
          ...(timestamp === undefined ? {} : { timestamp }),
          content: [{
            type: 'error',
            code: 'hook_execution_failed',
            message: `Grok ${eventName} hook failed.`,
          }],
        });
      }
      continue;
    }
    if (kind === 'subagent_spawned') {
      const childSessionId = nonemptyString(update.child_session_id ?? update.childSessionId);
      if (childSessionId) normalized.push({ sessionId, childSessionId });
      continue;
    }
    if (kind === 'retry_state') {
      if (nonemptyString(update.type)?.toLowerCase() === 'failed') {
        normalized.push({
          id: `retry-error:${index}`,
          sessionId,
          role: 'system',
          ...(timestamp === undefined ? {} : { timestamp }),
          content: [{
            type: 'error',
            code: nonemptyString(update.error_type) ?? 'grok_retry_failed',
            message: nonemptyString(update.message) ?? 'Grok retry failed.',
          }],
        });
      }
      continue;
    }
    if (kind === 'model_changed') {
      session.model = nonemptyString(update.modelId ?? update.model_id ?? update.model) ?? session.model;
      continue;
    }
    if (!IGNORED_UPDATES.has(kind)) {
      warnings.add(`Grok updates contain unsupported sessionUpdate "${kind}".`);
    }
  }

  if (hasUsage(aggregateUsage)) session.usage = aggregateUsage;
  return { records: normalized, warnings: [...warnings] };
}
