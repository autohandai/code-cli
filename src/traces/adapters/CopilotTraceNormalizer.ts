/** @license Apache-2.0 */
import path from 'node:path';

type UnknownRecord = Record<string, unknown>;

export interface CopilotSessionNormalization {
  records: UnknownRecord[];
  warnings: string[];
}

interface UsageValues {
  input?: number;
  output?: number;
  reasoning?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total?: number;
}

interface MutationReplay {
  snapshot?: UnknownRecord;
  warnings: string[];
}

const VERIFIED_CLI_VERSION = 1;
const VERIFIED_VSCODE_VERSIONS = new Set([1, 2, 3]);
const UNSAFE_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

const IGNORED_CLI_EVENTS = new Set([
  'assistant.intent',
  'assistant.message_delta',
  'assistant.reasoning_delta',
  'assistant.streaming_delta',
  'assistant.turn_end',
  'assistant.turn_start',
  'command.completed',
  'command.queued',
  'elicitation.completed',
  'elicitation.requested',
  'exit_plan_mode.completed',
  'exit_plan_mode.requested',
  'external_tool.completed',
  'external_tool.requested',
  'hook.end',
  'hook.start',
  'permission.completed',
  'permission.requested',
  'session.compaction_start',
  'session.idle',
  'session.mode_changed',
  'session.plan_changed',
  'session.session_limits_changed',
  'session.task_complete',
  'session.title_changed',
  'session.usage_checkpoint',
  'session_limits_exhausted.completed',
  'session_limits_exhausted.requested',
  'skill.invoked',
  'subagent.completed',
  'subagent.deselected',
  'subagent.failed',
  'subagent.selected',
  'subagent.started',
  'tool.execution_partial_result',
  'tool.execution_progress',
  'user_input.completed',
  'user_input.requested',
]);

const KNOWN_CLI_EVENTS = new Set([
  ...IGNORED_CLI_EVENTS,
  'assistant.message',
  'assistant.reasoning',
  'assistant.usage',
  'session.auto_mode_resolved',
  'session.compaction_complete',
  'session.context_changed',
  'session.error',
  'session.model_change',
  'session.resume',
  'session.shutdown',
  'session.start',
  'session.usage_info',
  'system.message',
  'tool.execution_complete',
  'tool.execution_start',
  'tool.user_requested',
  'user.message',
]);

const IGNORED_VSCODE_PARTS = new Set([
  'autoModeResolution',
  'clearToPreviousToolInvocation',
  'codeblockUri',
  'command',
  'confirmation',
  'disabledClaudeHooks',
  'elicitationSerialized',
  'extensions',
  'inlineReference',
  'mcpAuthenticationRequired',
  'mcpServersStartingSerialized',
  'mcpServersStartingSlow',
  'multiDiffData',
  'notebookEditGroup',
  'planReview',
  'progressMessage',
  'progressTask',
  'progressTaskResult',
  'progressTaskSerialized',
  'pullRequest',
  'questionCarousel',
  'reference',
  'treeData',
  'undoStop',
  'voiceProgress',
]);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonemptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function nonnegativeInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value);
}

function nestedRecord(record: UnknownRecord | undefined, key: string): UnknownRecord | undefined {
  const value = record?.[key];
  return isRecord(value) ? value : undefined;
}

function decodeMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string' || !value.trim()) return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function hasUsage(usage: UsageValues): boolean {
  return Object.values(usage).some((value) => value !== undefined);
}

function usageFromFields(source: UnknownRecord | undefined): UsageValues {
  if (!source) return {};
  const input = nonnegativeInteger(
    source.input ?? source.inputTokens ?? source.input_tokens ?? source.promptTokens ?? source.prompt_tokens,
  );
  const output = nonnegativeInteger(
    source.output ?? source.outputTokens ?? source.output_tokens
    ?? source.completionTokens ?? source.completion_tokens,
  );
  const reasoning = nonnegativeInteger(
    source.reasoning ?? source.reasoningTokens ?? source.reasoning_tokens,
  );
  const cacheRead = nonnegativeInteger(
    source.cacheRead ?? source.cacheReadTokens ?? source.cache_read_tokens
    ?? source.cachedTokens ?? source.cachedInput,
  );
  const cacheWrite = nonnegativeInteger(
    source.cacheWrite ?? source.cacheWriteTokens ?? source.cache_write_tokens,
  );
  const total = nonnegativeInteger(source.total ?? source.totalTokens ?? source.total_tokens);
  return {
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(cacheRead === undefined ? {} : { cacheRead }),
    ...(cacheWrite === undefined ? {} : { cacheWrite }),
    ...(total === undefined ? {} : { total }),
  };
}

function sumUsage(left: UsageValues, right: UsageValues): UsageValues {
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

function usageRecord(usage: UsageValues): UnknownRecord {
  return {
    ...(usage.input === undefined ? {} : { input: usage.input }),
    ...(usage.output === undefined ? {} : { output: usage.output }),
    ...(usage.reasoning === undefined ? {} : { reasoning: usage.reasoning }),
    ...(usage.cacheRead === undefined ? {} : { cacheRead: usage.cacheRead }),
    ...(usage.cacheWrite === undefined ? {} : { cacheWrite: usage.cacheWrite }),
    ...(usage.total === undefined ? {} : { total: usage.total }),
  };
}

function tokenDetailUsage(source: UnknownRecord | undefined): UsageValues {
  if (!source) return {};
  const tokenCount = (key: string): number | undefined => {
    const detail = nestedRecord(source, key);
    return nonnegativeInteger(detail?.tokenCount);
  };
  const input = tokenCount('input');
  const output = tokenCount('output');
  const cacheRead = tokenCount('cache_read');
  const cacheWrite = tokenCount('cache_write');
  return {
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
    ...(cacheRead === undefined ? {} : { cacheRead }),
    ...(cacheWrite === undefined ? {} : { cacheWrite }),
  };
}

function shutdownUsage(data: UnknownRecord): UsageValues {
  const modelMetrics = nestedRecord(data, 'modelMetrics');
  let aggregate: UsageValues = {};
  if (modelMetrics) {
    for (const metric of Object.values(modelMetrics)) {
      if (!isRecord(metric)) continue;
      const usage = usageFromFields(nestedRecord(metric, 'usage'));
      const fallback = tokenDetailUsage(nestedRecord(metric, 'tokenDetails'));
      aggregate = sumUsage(aggregate, hasUsage(usage) ? usage : fallback);
    }
  }
  if (hasUsage(aggregate)) return aggregate;
  const direct = usageFromFields(data);
  return hasUsage(direct) ? direct : tokenDetailUsage(nestedRecord(data, 'tokenDetails'));
}

function cliSessionId(records: UnknownRecord[], filePath: string): string {
  for (const record of records) {
    if (record.type !== 'session.start') continue;
    const data = nestedRecord(record, 'data');
    const id = nonemptyString(data?.sessionId);
    if (id) return id;
  }
  return path.basename(filePath) === 'events.jsonl'
    ? path.basename(path.dirname(filePath))
    : path.basename(filePath, path.extname(filePath));
}

function toolResultContent(data: UnknownRecord): unknown {
  const result = nestedRecord(data, 'result');
  if (result) {
    return result.detailedContent ?? result.content ?? result.contents ?? result;
  }
  const error = nestedRecord(data, 'error');
  return error?.message ?? data.error;
}

function normalizeCopilotCli(
  records: UnknownRecord[],
  filePath: string,
): CopilotSessionNormalization {
  const warnings = new Set<string>();
  const externalId = cliSessionId(records, filePath);
  const sessionStart = records.find((record) => record.type === 'session.start');
  const startData = sessionStart ? nestedRecord(sessionStart, 'data') : undefined;
  if (!sessionStart) {
    warnings.add('Copilot CLI session is missing a session.start event; native identity is unverified.');
  } else if (startData?.version !== VERIFIED_CLI_VERSION) {
    warnings.add(
      `Copilot CLI session version ${String(startData?.version ?? 'unknown')} is not a verified native contract.`,
    );
  }

  const context = nestedRecord(startData, 'context');
  const metadata: UnknownRecord = {
    sessionId: externalId,
    status: 'active',
    ...(nonemptyString(startData?.copilotVersion)
      ? { agentVersion: nonemptyString(startData?.copilotVersion) }
      : {}),
    ...(nonemptyString(context?.repository) ? { projectName: nonemptyString(context?.repository) } : {}),
    ...(nonemptyString(context?.cwd) ?? nonemptyString(context?.gitRoot)
      ? { projectPath: nonemptyString(context?.cwd) ?? nonemptyString(context?.gitRoot) }
      : {}),
    ...(nonemptyString(context?.gitRemote) ? { gitRemote: nonemptyString(context?.gitRemote) } : {}),
    ...(nonemptyString(context?.branch) ? { gitBranch: nonemptyString(context?.branch) } : {}),
    ...(nonemptyString(context?.headCommit) ?? nonemptyString(context?.baseCommit)
      ? { gitRef: nonemptyString(context?.headCommit) ?? nonemptyString(context?.baseCommit) }
      : {}),
    ...(startData?.startTime !== undefined || sessionStart?.timestamp !== undefined
      ? { createdAt: startData?.startTime ?? sessionStart?.timestamp }
      : {}),
  };
  const normalized: UnknownRecord[] = [metadata];
  const toolParts = new Map<string, { part: UnknownRecord; name: string }>();
  let liveUsage: UsageValues = {};
  let finalUsage: UsageValues | undefined;
  let model: string | undefined;
  let reasoningEffort: string | undefined;
  let contextWindow: number | undefined;

  const updateContext = (data: UnknownRecord): void => {
    const cwd = nonemptyString(data.cwd) ?? nonemptyString(data.gitRoot);
    if (cwd) metadata.projectPath = cwd;
    const repository = nonemptyString(data.repository);
    if (repository) metadata.projectName = repository;
    const branch = nonemptyString(data.branch);
    if (branch) metadata.gitBranch = branch;
  };

  const addToolCall = (
    record: UnknownRecord,
    data: UnknownRecord,
    preferredName?: string,
  ): void => {
    const callId = nonemptyString(data.toolCallId);
    if (!callId) {
      warnings.add('Copilot CLI contains a tool event without a toolCallId.');
      return;
    }
    const name = preferredName ?? nonemptyString(data.toolName) ?? nonemptyString(data.name) ?? 'unknown';
    const existing = toolParts.get(callId);
    if (existing) {
      if (existing.name === 'unknown' && name !== 'unknown') {
        existing.name = name;
        existing.part.name = name;
      }
      if (data.arguments !== undefined) existing.part.arguments = data.arguments;
      return;
    }
    const part: UnknownRecord = {
      type: 'tool_call', name, id: callId,
      ...(data.arguments === undefined ? {} : { arguments: data.arguments }),
    };
    toolParts.set(callId, { part, name });
    normalized.push({
      id: nonemptyString(record.id),
      sessionId: externalId,
      role: 'assistant',
      timestamp: record.timestamp,
      ...(model ? { model } : {}),
      content: [part],
    });
  };

  for (const record of records) {
    const type = nonemptyString(record.type);
    if (!type) {
      warnings.add('Copilot CLI contains a record without an event type.');
      continue;
    }
    const data = nestedRecord(record, 'data') ?? {};
    if (type === 'session.start') continue;
    if (type === 'session.resume') {
      metadata.status = 'active';
      updateContext(data);
      continue;
    }
    if (type === 'session.context_changed') {
      updateContext(data);
      continue;
    }
    if (type === 'session.model_change') {
      model = nonemptyString(data.newModel) ?? nonemptyString(data.model) ?? model;
      reasoningEffort = nonemptyString(data.reasoningEffort) ?? reasoningEffort;
      continue;
    }
    if (type === 'session.auto_mode_resolved') {
      model = nonemptyString(data.chosenModel) ?? model;
      reasoningEffort = nonemptyString(data.reasoningBucket) ?? reasoningEffort;
      continue;
    }
    if (type === 'session.usage_info') {
      contextWindow = nonnegativeInteger(data.tokenLimit) ?? contextWindow;
      continue;
    }
    if (type === 'assistant.usage') {
      liveUsage = sumUsage(liveUsage, usageFromFields(data));
      model = nonemptyString(data.model) ?? model;
      reasoningEffort = nonemptyString(data.reasoningEffort) ?? reasoningEffort;
      continue;
    }
    if (type === 'session.compaction_complete') {
      const compaction = usageFromFields(nestedRecord(data, 'compactionTokensUsed'));
      liveUsage = sumUsage(liveUsage, compaction);
      continue;
    }
    if (type === 'session.shutdown') {
      const usage = shutdownUsage(data);
      if (hasUsage(usage)) finalUsage = usage;
      model = nonemptyString(data.currentModel) ?? model;
      metadata.status = data.shutdownType === 'error' ? 'failed' : 'completed';
      metadata.endedAt = record.timestamp;
      if (data.shutdownType === 'error' && nonemptyString(data.errorReason)) {
        normalized.push({
          id: nonemptyString(record.id), sessionId: externalId, role: 'system', timestamp: record.timestamp,
          content: [{ type: 'error', code: 'copilot_shutdown_error', message: data.errorReason }],
        });
      }
      continue;
    }
    if (type === 'system.message' || type === 'user.message') {
      if (data.content === undefined) {
        warnings.add(`Copilot CLI ${type} event is missing content.`);
        continue;
      }
      normalized.push({
        id: nonemptyString(record.id),
        sessionId: externalId,
        role: type === 'user.message' ? 'user' : 'system',
        timestamp: record.timestamp,
        content: data.content,
      });
      continue;
    }
    if (type === 'assistant.reasoning') {
      const content = nonemptyString(data.content);
      if (content) {
        normalized.push({
          id: nonemptyString(data.reasoningId) ?? nonemptyString(record.id),
          sessionId: externalId,
          role: 'assistant',
          timestamp: record.timestamp,
          ...(model ? { model } : {}),
          content: [{ type: 'reasoning', text: content }],
        });
      }
      continue;
    }
    if (type === 'assistant.message') {
      const messageParts: UnknownRecord[] = [];
      const readableReasoning = nonemptyString(data.reasoningText);
      const text = nonemptyString(data.content);
      if (readableReasoning) messageParts.push({ type: 'reasoning', text: readableReasoning });
      if (text) messageParts.push({ type: 'text', text });
      if (Array.isArray(data.toolRequests)) {
        for (const value of data.toolRequests) {
          if (!isRecord(value)) {
            warnings.add('Copilot CLI assistant message contains a non-object tool request.');
            continue;
          }
          const callId = nonemptyString(value.toolCallId);
          const name = nonemptyString(value.name) ?? 'unknown';
          if (!callId) {
            warnings.add('Copilot CLI assistant message contains a tool request without a toolCallId.');
            continue;
          }
          const part: UnknownRecord = {
            type: 'tool_call', id: callId, name,
            ...(value.arguments === undefined ? {} : { arguments: value.arguments }),
          };
          toolParts.set(callId, { part, name });
          messageParts.push(part);
        }
      }
      model = nonemptyString(data.model) ?? model;
      const output = nonnegativeInteger(data.outputTokens);
      if (messageParts.length > 0) {
        normalized.push({
          id: nonemptyString(data.messageId) ?? nonemptyString(record.id),
          sessionId: externalId,
          role: 'assistant',
          timestamp: record.timestamp,
          ...(model ? { model } : {}),
          ...(output === undefined ? {} : { usage: { output } }),
          content: messageParts,
        });
      }
      continue;
    }
    if (type === 'tool.user_requested' || type === 'tool.execution_start') {
      addToolCall(record, data);
      continue;
    }
    if (type === 'tool.execution_complete') {
      const callId = nonemptyString(data.toolCallId);
      const known = callId ? toolParts.get(callId) : undefined;
      const name = nonemptyString(data.toolName) ?? known?.name;
      normalized.push({
        id: nonemptyString(record.id),
        sessionId: externalId,
        role: 'tool',
        timestamp: record.timestamp,
        content: [{
          type: 'tool_result',
          ...(callId ? { call_id: callId } : {}),
          ...(name ? { name } : {}),
          content: toolResultContent(data),
          ...(data.success === false ? { isError: true } : {}),
        }],
      });
      continue;
    }
    if (type === 'session.error') {
      metadata.status = 'failed';
      normalized.push({
        id: nonemptyString(record.id), sessionId: externalId, role: 'system', timestamp: record.timestamp,
        content: [{
          type: 'error',
          ...(nonemptyString(data.errorType) ? { code: nonemptyString(data.errorType) } : {}),
          message: nonemptyString(data.message) ?? 'Unknown Copilot session error.',
        }],
      });
      continue;
    }
    if (IGNORED_CLI_EVENTS.has(type)) continue;
    warnings.add(`Copilot CLI contains unsupported event type "${type}".`);
  }

  if (model) metadata.model = model;
  if (reasoningEffort) metadata.reasoningEffort = reasoningEffort;
  if (contextWindow !== undefined) metadata.contextWindow = contextWindow;
  const usage = finalUsage ?? liveUsage;
  if (hasUsage(usage)) metadata.usage = usageRecord(usage);
  return { records: normalized, warnings: [...warnings] };
}

function safeMutationPath(value: unknown): value is Array<string | number> {
  return Array.isArray(value) && value.every((segment) => (
    typeof segment === 'number'
      ? Number.isSafeInteger(segment) && segment >= 0
      : typeof segment === 'string' && !UNSAFE_PATH_SEGMENTS.has(segment)
  ));
}

function valueAtMutationPath(root: unknown, segments: readonly (string | number)[]): unknown {
  let current = root;
  for (const segment of segments) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current)) return undefined;
      current = current[segment];
    } else {
      if (!isRecord(current)) return undefined;
      current = current[segment];
    }
  }
  return current;
}

function mutationParent(
  root: unknown,
  segments: readonly (string | number)[],
): { parent: UnknownRecord | unknown[]; key: string | number } | undefined {
  if (segments.length === 0) return undefined;
  const key = segments.at(-1)!;
  const parent = valueAtMutationPath(root, segments.slice(0, -1));
  if (Array.isArray(parent) || isRecord(parent)) return { parent, key };
  return undefined;
}

function replayVsCodeMutationLog(records: UnknownRecord[]): MutationReplay {
  const warnings = new Set<string>();
  const initial = records[0];
  if (initial?.kind !== 0 || !isRecord(initial.v)) {
    return {
      warnings: ['Copilot VS Code mutation log is missing a valid initial snapshot.'],
    };
  }
  let snapshot: UnknownRecord = initial.v;
  for (let index = 1; index < records.length; index += 1) {
    const entry = records[index]!;
    const kind = entry.kind;
    if (kind !== 1 && kind !== 2 && kind !== 3) {
      warnings.add(`Copilot VS Code mutation log contains unsupported entry kind "${String(kind)}".`);
      continue;
    }
    if (!safeMutationPath(entry.k)) {
      warnings.add('Copilot VS Code mutation log contains an unsafe or invalid object path.');
      continue;
    }
    if (kind === 1) {
      if (entry.k.length === 0) {
        if (isRecord(entry.v)) snapshot = entry.v;
        else warnings.add('Copilot VS Code mutation log contains an invalid root replacement.');
        continue;
      }
      const target = mutationParent(snapshot, entry.k);
      if (!target) {
        warnings.add('Copilot VS Code mutation log contains a set operation with an unresolved path.');
        continue;
      }
      if (Array.isArray(target.parent) && typeof target.key === 'number') {
        target.parent[target.key] = entry.v;
      } else if (isRecord(target.parent) && typeof target.key === 'string') {
        target.parent[target.key] = entry.v;
      } else {
        warnings.add('Copilot VS Code mutation log contains a set operation with an invalid target.');
      }
      continue;
    }
    if (kind === 2) {
      const target = valueAtMutationPath(snapshot, entry.k);
      if (!Array.isArray(target)) {
        warnings.add('Copilot VS Code mutation log contains an array update with an unresolved path.');
        continue;
      }
      const startIndex = nonnegativeInteger(entry.i);
      if (startIndex !== undefined) target.length = Math.min(startIndex, target.length);
      if (entry.v !== undefined && !Array.isArray(entry.v)) {
        warnings.add('Copilot VS Code mutation log contains an array update with invalid values.');
      } else if (Array.isArray(entry.v)) {
        target.push(...entry.v);
      }
      continue;
    }
    const target = mutationParent(snapshot, entry.k);
    if (!target) {
      warnings.add('Copilot VS Code mutation log contains a delete operation with an unresolved path.');
      continue;
    }
    if (Array.isArray(target.parent) && typeof target.key === 'number') {
      target.parent.splice(target.key, 1);
    } else if (isRecord(target.parent) && typeof target.key === 'string') {
      delete target.parent[target.key];
    } else {
      warnings.add('Copilot VS Code mutation log contains a delete operation with an invalid target.');
    }
  }
  return { snapshot, warnings: [...warnings] };
}

function markdownText(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() ? value : undefined;
  if (Array.isArray(value)) {
    const text = value.map(markdownText).filter((part): part is string => part !== undefined).join('');
    return text.trim() ? text : undefined;
  }
  if (!isRecord(value)) return undefined;
  if (typeof value.value === 'string') return value.value.trim() ? value.value : undefined;
  if (typeof value.text === 'string') return value.text.trim() ? value.text : undefined;
  return value.content === value ? undefined : markdownText(value.content);
}

function requestText(message: unknown): string | undefined {
  if (typeof message === 'string') return nonemptyString(message);
  if (!isRecord(message)) return undefined;
  const direct = nonemptyString(message.text);
  if (direct) return direct;
  if (!Array.isArray(message.parts)) return undefined;
  const text = message.parts
    .map((part) => markdownText(part))
    .filter((part): part is string => part !== undefined)
    .join('');
  return text.trim() ? text : undefined;
}

function uriPath(value: unknown): string | undefined {
  if (typeof value === 'string') return nonemptyString(value);
  if (!isRecord(value)) return undefined;
  return nonemptyString(value.fsPath) ?? nonemptyString(value.path) ?? nonemptyString(value.external);
}

function vsCodeToolArguments(part: UnknownRecord): unknown {
  const direct = part.arguments ?? part.parameters ?? part.rawInput ?? part.input;
  if (direct !== undefined) return decodeMaybeJson(direct);
  const specific = nestedRecord(part, 'toolSpecificData');
  const command = nonemptyString(specific?.command);
  if (command) return { command };
  const result = nestedRecord(part, 'resultDetails');
  if (result?.input !== undefined) return decodeMaybeJson(result.input);
  return undefined;
}

function fileChangeParts(part: UnknownRecord): UnknownRecord[] {
  if (part.kind === 'textEditGroup' || part.kind === 'externalEdit') {
    const filePath = uriPath(part.uri);
    return filePath ? [{ type: 'file_change', path: filePath }] : [];
  }
  if (part.kind !== 'workspaceEdit' || !Array.isArray(part.edits)) return [];
  return part.edits.flatMap((edit) => {
    if (!isRecord(edit)) return [];
    const filePath = uriPath(edit.newResource) ?? uriPath(edit.oldResource);
    return filePath ? [{ type: 'file_change', path: filePath }] : [];
  });
}

function vsCodeResponseParts(value: unknown, warnings: Set<string>): UnknownRecord[] {
  const response = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const normalized: UnknownRecord[] = [];
  for (const partValue of response) {
    if (typeof partValue === 'string') {
      if (partValue.trim()) normalized.push({ type: 'text', text: partValue });
      continue;
    }
    if (!isRecord(partValue)) {
      warnings.add('Copilot VS Code response contains a non-object part.');
      continue;
    }
    const kind = nonemptyString(partValue.kind);
    if (!kind) {
      const text = markdownText(partValue);
      if (text) normalized.push({ type: 'text', text });
      else warnings.add('Copilot VS Code response contains an unsupported part without a kind.');
      continue;
    }
    if (kind === 'markdownContent' || kind === 'markdownVuln') {
      const text = markdownText(partValue.content);
      if (text) normalized.push({ type: 'text', text });
      continue;
    }
    if (kind === 'thinking') {
      const text = markdownText(partValue.value);
      if (text) normalized.push({ type: 'reasoning', text });
      continue;
    }
    if (kind === 'toolInvocationSerialized') {
      const callId = nonemptyString(partValue.toolCallId);
      const name = nonemptyString(partValue.toolId) ?? nonemptyString(partValue.toolName) ?? 'unknown';
      const args = vsCodeToolArguments(partValue);
      normalized.push({
        type: 'tool_call', name,
        ...(callId ? { id: callId } : {}),
        ...(args === undefined ? {} : { arguments: args }),
      });
      const resultDetails = partValue.resultDetails;
      const resultRecord = isRecord(resultDetails) ? resultDetails : undefined;
      const fallbackResult = markdownText(partValue.pastTenseMessage);
      if (partValue.isComplete === true || resultDetails !== undefined) {
        normalized.push({
          type: 'tool_result', name,
          ...(callId ? { call_id: callId } : {}),
          ...(resultDetails === undefined
            ? fallbackResult === undefined ? {} : { content: fallbackResult }
            : { content: resultDetails }),
          ...(resultRecord?.isError === true ? { isError: true } : {}),
        });
      }
      continue;
    }
    if (kind === 'warning') {
      normalized.push({
        type: 'error', code: 'copilot_warning',
        ...(markdownText(partValue.content) ? { message: markdownText(partValue.content) } : {}),
      });
      continue;
    }
    if (kind === 'hook') {
      const stopReason = nonemptyString(partValue.stopReason);
      if (stopReason) normalized.push({ type: 'error', code: 'copilot_hook_stopped', message: stopReason });
      continue;
    }
    if (kind === 'textEditGroup' || kind === 'externalEdit' || kind === 'workspaceEdit') {
      normalized.push(...fileChangeParts(partValue));
      continue;
    }
    if (IGNORED_VSCODE_PARTS.has(kind)) continue;
    warnings.add(`Copilot VS Code response contains unsupported part kind "${kind}".`);
  }
  return normalized;
}

function vsCodeRequestUsage(request: UnknownRecord): UsageValues {
  if (Array.isArray(request.modelTotals)) {
    let aggregate: UsageValues = {};
    for (const value of request.modelTotals) {
      if (isRecord(value)) aggregate = sumUsage(aggregate, usageFromFields(value));
    }
    if (hasUsage(aggregate)) {
      return {
        ...aggregate,
        total: (aggregate.input ?? 0) + (aggregate.output ?? 0),
      };
    }
  }
  const usage = usageFromFields(request);
  if (!hasUsage(usage)) return usage;
  return {
    ...usage,
    total: usage.total ?? (usage.input ?? 0) + (usage.output ?? 0),
  };
}

function normalizeVsCodeSnapshot(
  snapshot: UnknownRecord,
  filePath: string,
  replayWarnings: readonly string[],
): CopilotSessionNormalization {
  const warnings = new Set<string>();
  const version = snapshot.version;
  if (version !== undefined && (
    typeof version !== 'number' || !VERIFIED_VSCODE_VERSIONS.has(version)
  )) {
    warnings.add(`Copilot VS Code chat version ${String(version)} is not a verified native contract.`);
  }
  for (const warning of replayWarnings) warnings.add(warning);
  const externalId = nonemptyString(snapshot.sessionId)
    ?? path.basename(filePath, path.extname(filePath));
  const requests = Array.isArray(snapshot.requests) ? snapshot.requests : [];
  if (!Array.isArray(snapshot.requests)) {
    warnings.add('Copilot VS Code chat snapshot is missing its requests array.');
  }
  if (requests.length === 0) return { records: [], warnings: [...warnings] };
  const requestRecords = requests.filter(isRecord);
  if (requestRecords.length !== requests.length) {
    warnings.add('Copilot VS Code chat snapshot contains a non-object request.');
  }
  const lastRequest = requestRecords.at(-1);
  const lastResponseMissing = lastRequest !== undefined && lastRequest.response === undefined;
  const lastCancelled = lastRequest?.isCanceled === true;
  const repo = nestedRecord(snapshot, 'repoData');
  const metadata: UnknownRecord = {
    sessionId: externalId,
    ...(snapshot.creationDate === undefined ? {} : { createdAt: snapshot.creationDate }),
    ...(snapshot.lastMessageDate === undefined ? {} : { endedAt: snapshot.lastMessageDate }),
    status: lastCancelled ? 'cancelled' : lastResponseMissing ? 'active' : requests.length > 0 ? 'completed' : 'unknown',
    ...(nonemptyString(snapshot.workingDirectory)
      ? { projectPath: nonemptyString(snapshot.workingDirectory) }
      : {}),
    ...(nonemptyString(repo?.remoteUrl) ? { gitRemote: nonemptyString(repo?.remoteUrl) } : {}),
    ...(nonemptyString(repo?.branch) ? { gitBranch: nonemptyString(repo?.branch) } : {}),
    ...(nonemptyString(repo?.localHeadCommit) ? { gitRef: nonemptyString(repo?.localHeadCommit) } : {}),
  };
  const normalized: UnknownRecord[] = [metadata];
  let latestModel: string | undefined;
  for (const request of requestRecords) {
    const requestId = nonemptyString(request.requestId);
    const userText = requestText(request.message);
    if (userText) {
      normalized.push({
        id: requestId,
        sessionId: externalId,
        role: 'user',
        timestamp: request.timestamp,
        content: userText,
      });
    }
    latestModel = nonemptyString(request.modelId) ?? latestModel;
    const parts = vsCodeResponseParts(request.response, warnings);
    const result = nestedRecord(request, 'result');
    const errorDetails = nestedRecord(result, 'errorDetails');
    if (errorDetails) {
      parts.push({
        type: 'error',
        ...(nonemptyString(errorDetails.code) ? { code: nonemptyString(errorDetails.code) } : {}),
        ...(nonemptyString(errorDetails.message) ? { message: nonemptyString(errorDetails.message) } : {}),
      });
    }
    if (parts.length === 0) continue;
    const usage = vsCodeRequestUsage(request);
    normalized.push({
      id: nonemptyString(request.responseId) ?? (requestId ? `${requestId}:response` : undefined),
      sessionId: externalId,
      role: 'assistant',
      timestamp: request.responseTimestamp ?? request.timestamp,
      ...(latestModel ? { model: latestModel } : {}),
      ...(hasUsage(usage) ? { usage: usageRecord(usage) } : {}),
      content: parts,
    });
  }
  if (latestModel) metadata.model = latestModel;
  return { records: normalized, warnings: [...warnings] };
}

function looksLikeCli(records: UnknownRecord[]): boolean {
  return records.some((record) => (
    typeof record.type === 'string'
    && isRecord(record.data)
    && KNOWN_CLI_EVENTS.has(record.type)
  ));
}

function looksLikeVsCodeSnapshot(record: UnknownRecord | undefined): record is UnknownRecord {
  return Boolean(record && nonemptyString(record.sessionId) && Array.isArray(record.requests));
}

function looksLikeVsCodeMutationLog(records: UnknownRecord[]): boolean {
  return records[0]?.kind === 0
    && isRecord(records[0].v)
    && (nonemptyString(records[0].v.sessionId) !== undefined || Array.isArray(records[0].v.requests));
}

export function normalizeCopilotSessionRecords(
  records: UnknownRecord[],
  filePath: string,
): CopilotSessionNormalization {
  if (looksLikeCli(records)) return normalizeCopilotCli(records, filePath);
  if (looksLikeVsCodeMutationLog(records)) {
    const replay = replayVsCodeMutationLog(records);
    if (!replay.snapshot) return { records: [], warnings: replay.warnings };
    return normalizeVsCodeSnapshot(replay.snapshot, filePath, replay.warnings);
  }
  if (records.length === 1 && looksLikeVsCodeSnapshot(records[0])) {
    return normalizeVsCodeSnapshot(records[0], filePath, []);
  }
  return { records, warnings: [] };
}
