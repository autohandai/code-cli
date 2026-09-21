/** @license Apache-2.0 */
import path from 'node:path';

type UnknownRecord = Record<string, unknown>;

interface AmpUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total?: number;
}

export interface AmpNativeRecordNormalization {
  records: UnknownRecord[];
  warnings: string[];
}

const MAX_PENDING_TOOL_NAMES = 2_000;

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

function nonnegativeInteger(value: unknown): number | undefined {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric) : undefined;
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

function fileUriToPath(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('file://')) return undefined;
  try {
    const decoded = decodeURIComponent(new URL(value).pathname);
    if (/^\/[A-Za-z]:\//u.test(decoded)) return decoded.slice(1).replaceAll('/', '\\');
    return decoded;
  } catch {
    return undefined;
  }
}

function normalizeUsage(value: unknown): AmpUsage | undefined {
  if (!isRecord(value)) return undefined;
  const input = nonnegativeInteger(value.inputTokens);
  const output = nonnegativeInteger(value.outputTokens);
  const cacheRead = nonnegativeInteger(value.cacheReadInputTokens);
  const cacheWrite = nonnegativeInteger(value.cacheCreationInputTokens);
  const totalInput = nonnegativeInteger(value.totalInputTokens);
  const explicitTotal = nonnegativeInteger(value.totalTokens);
  if ([input, output, cacheRead, cacheWrite, totalInput, explicitTotal]
    .every((candidate) => candidate === undefined)) return undefined;
  const total = explicitTotal
    ?? (totalInput === undefined
      ? (input ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0) + (output ?? 0)
      : totalInput + (output ?? 0));
  return {
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
    ...(cacheRead === undefined ? {} : { cacheRead }),
    ...(cacheWrite === undefined ? {} : { cacheWrite }),
    total,
  };
}

function addUsage(total: AmpUsage, incoming: AmpUsage | undefined): void {
  if (!incoming) return;
  for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'total'] as const) {
    const value = incoming[key];
    if (value !== undefined) total[key] = (total[key] ?? 0) + value;
  }
}

function usageRecord(usage: AmpUsage | undefined): UnknownRecord | undefined {
  if (!usage) return undefined;
  return {
    ...(usage.input === undefined ? {} : { input: usage.input }),
    ...(usage.output === undefined ? {} : { output: usage.output }),
    ...(usage.cacheRead === undefined ? {} : { cacheRead: usage.cacheRead }),
    ...(usage.cacheWrite === undefined ? {} : { cacheWrite: usage.cacheWrite }),
    ...(usage.total === undefined ? {} : { total: usage.total }),
  };
}

function textFromError(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value;
  if (isRecord(value)) {
    const message = firstString(value, [['message'], ['error'], ['reason']]);
    if (message) return message;
  }
  return 'Tool call failed';
}

function normalizeToolResult(
  block: UnknownRecord,
  pendingToolNames: Map<string, string>,
  warnings: Set<string>,
): UnknownRecord | undefined {
  const callId = firstString(block, [['toolUseID'], ['toolUseId'], ['tool_use_id'], ['id']]);
  const run = isRecord(block.run) ? block.run : undefined;
  if (!run) {
    warnings.add('Amp thread contains a tool result without a run object.');
    return undefined;
  }
  const status = firstString(run, [['status']])?.toLowerCase();
  const name = (callId ? pendingToolNames.get(callId) : undefined)
    ?? firstString(block, [['name'], ['toolName']]);
  if (callId) pendingToolNames.delete(callId);
  if (status === 'done') {
    const result = run.result;
    const exitCode = isRecord(result) ? nonnegativeInteger(result.exitCode ?? result.exit_code) : undefined;
    return {
      type: 'tool_result',
      ...(callId ? { call_id: callId } : {}),
      ...(name ? { name } : {}),
      ...(result === undefined ? {} : { content: result }),
      ...(exitCode === undefined ? {} : { exitCode }),
    };
  }
  if (status === 'error') {
    return {
      type: 'tool_result',
      ...(callId ? { call_id: callId } : {}),
      ...(name ? { name } : {}),
      content: textFromError(run.error),
      isError: true,
    };
  }
  if (status === 'cancelled' || status === 'rejected-by-user') {
    return {
      type: 'tool_result',
      ...(callId ? { call_id: callId } : {}),
      ...(name ? { name } : {}),
      content: firstString(run, [['reason']]) ?? (status === 'cancelled' ? 'cancelled' : 'rejected by user'),
      isError: true,
    };
  }
  warnings.add(`Amp thread contains unsupported tool result status "${status ?? 'unknown'}".`);
  return undefined;
}

function normalizeContent(
  role: 'user' | 'assistant',
  value: unknown,
  pendingToolNames: Map<string, string>,
  warnings: Set<string>,
): { parts: UnknownRecord[]; onlyToolResults: boolean } {
  const blocks = typeof value === 'string' ? [{ type: 'text', text: value }] : value;
  if (!Array.isArray(blocks)) {
    warnings.add('Amp thread contains message content that is not a block array.');
    return { parts: [], onlyToolResults: false };
  }
  const parts: UnknownRecord[] = [];
  let sawNonToolResult = false;
  let sawToolResult = false;
  for (const valueBlock of blocks) {
    if (!isRecord(valueBlock)) {
      warnings.add('Amp thread contains a non-object content block.');
      continue;
    }
    const type = firstString(valueBlock, [['type']])?.toLowerCase();
    if (type === 'text') {
      const text = firstString(valueBlock, [['text']]);
      if (text) parts.push({ type: 'text', text });
      sawNonToolResult = true;
      continue;
    }
    if (role === 'assistant' && type === 'thinking') {
      const thinking = firstString(valueBlock, [['thinking'], ['text']]);
      if (thinking) parts.push({ type: 'reasoning', reasoning: thinking });
      sawNonToolResult = true;
      continue;
    }
    if (role === 'assistant' && type === 'tool_use') {
      const callId = firstString(valueBlock, [['id']]);
      const name = firstString(valueBlock, [['name']]) ?? 'unknown';
      if (callId) {
        if (pendingToolNames.size < MAX_PENDING_TOOL_NAMES || pendingToolNames.has(callId)) {
          pendingToolNames.set(callId, name);
        } else {
          warnings.add('Amp thread exceeds the pending tool-name join limit.');
        }
      }
      parts.push({
        type: 'tool_call',
        name,
        ...(callId ? { id: callId } : {}),
        ...(valueBlock.input === undefined ? {} : { arguments: valueBlock.input }),
      });
      sawNonToolResult = true;
      continue;
    }
    if (role === 'user' && type === 'tool_result') {
      const result = normalizeToolResult(valueBlock, pendingToolNames, warnings);
      if (result) parts.push(result);
      sawToolResult = true;
      continue;
    }
    warnings.add(`Amp thread contains unsupported content block type "${type ?? 'unknown'}".`);
  }
  return { parts, onlyToolResults: sawToolResult && !sawNonToolResult };
}

function stateStatus(message: UnknownRecord): 'active' | 'completed' | 'failed' | 'cancelled' | undefined {
  const state = isRecord(message.state) ? message.state : undefined;
  const type = state ? firstString(state, [['type']])?.toLowerCase() : undefined;
  if (type === 'streaming') return 'active';
  if (type === 'cancelled') return 'cancelled';
  if (type !== 'complete') return undefined;
  return firstString(state!, [['stopReason']])?.toLowerCase() === 'error' ? 'failed' : 'completed';
}

function modelFromTags(initial: UnknownRecord | undefined): string | undefined {
  const tags = initial?.tags;
  if (!Array.isArray(tags)) return undefined;
  for (const value of tags) {
    if (typeof value === 'string' && value.startsWith('model:') && value.length > 'model:'.length) {
      return value.slice('model:'.length);
    }
  }
  return undefined;
}

export function normalizeAmpThreadRecords(
  records: UnknownRecord[],
  filePath: string,
  maximumMessages = Number.POSITIVE_INFINITY,
): AmpNativeRecordNormalization {
  const thread = records[0];
  if (!thread || typeof thread.v !== 'number' || !Number.isFinite(thread.v)) {
    return {
      records: [],
      warnings: [`Amp source ${path.basename(filePath)} is not a verified native thread document.`],
    };
  }

  const warnings = new Set<string>();
  const externalId = firstString(thread, [['id']]) ?? path.basename(filePath, '.json');
  const rawMessages = Array.isArray(thread.messages) ? thread.messages : [];
  if (!Array.isArray(thread.messages)) {
    warnings.add('Amp thread has no native messages array.');
  }
  const boundedMessages = rawMessages.slice(0, Math.max(0, maximumMessages));
  if (boundedMessages.length !== rawMessages.length) {
    warnings.add('Amp thread message count exceeds the scan record budget.');
  }

  const env = isRecord(thread.env) ? thread.env : undefined;
  const initial = env && isRecord(env.initial) ? env.initial : undefined;
  const trees = initial && Array.isArray(initial.trees) ? initial.trees : [];
  const tree = isRecord(trees[0]) ? trees[0] : undefined;
  const repository = tree && isRecord(tree.repository) ? tree.repository : undefined;
  const platform = initial && isRecord(initial.platform) ? initial.platform : undefined;
  const pendingToolNames = new Map<string, string>();
  const normalizedMessages: UnknownRecord[] = [];
  const aggregateUsage: AmpUsage = {};
  let lastTimestamp = toIsoTimestamp(thread.created);
  let latestTimestamp = lastTimestamp;
  let status: 'active' | 'completed' | 'failed' | 'cancelled' | 'unknown' = 'unknown';
  let model = modelFromTags(initial);
  let contextWindow: number | undefined;

  for (let index = 0; index < boundedMessages.length; index += 1) {
    const message = boundedMessages[index];
    if (!isRecord(message)) {
      warnings.add('Amp thread contains a non-object message.');
      continue;
    }
    const rawRole = firstString(message, [['role']])?.toLowerCase();
    if (rawRole !== 'user' && rawRole !== 'assistant') {
      warnings.add(`Amp thread contains unsupported message role "${rawRole ?? 'unknown'}".`);
      continue;
    }
    const usageSource = isRecord(message.usage) ? message.usage : undefined;
    const usage = normalizeUsage(usageSource);
    addUsage(aggregateUsage, usage);
    model ??= usageSource ? firstString(usageSource, [['model']]) : undefined;
    const messageModel = usageSource ? firstString(usageSource, [['model']]) : undefined;
    const messageContext = usageSource ? nonnegativeInteger(usageSource.maxInputTokens) : undefined;
    if (messageContext !== undefined) contextWindow = Math.max(contextWindow ?? 0, messageContext);
    const directTimestamp = rawRole === 'assistant'
      ? toIsoTimestamp(usageSource?.timestamp ?? message.timestamp ?? message.createdAt)
      : toIsoTimestamp(valueAt(message, ['meta', 'sentAt']) ?? message.timestamp ?? message.createdAt);
    if (directTimestamp) lastTimestamp = directTimestamp;
    const timestamp = directTimestamp ?? lastTimestamp;
    if (timestamp && (!latestTimestamp || timestamp > latestTimestamp)) latestTimestamp = timestamp;
    if (rawRole === 'assistant') status = stateStatus(message) ?? status;
    const normalizedContent = normalizeContent(rawRole, message.content, pendingToolNames, warnings);
    if (normalizedContent.parts.length === 0) continue;
    const rawMessageId = message.messageId ?? message.id ?? index;
    normalizedMessages.push({
      id: String(rawMessageId),
      role: rawRole === 'user' && normalizedContent.onlyToolResults ? 'tool' : rawRole,
      content: normalizedContent.parts,
      ...(timestamp ? { timestamp } : {}),
      ...(messageModel ? { model: messageModel } : {}),
      ...(usage ? { usage: usageRecord(usage) } : {}),
    });
  }

  const repositoryRef = repository ? firstString(repository, [['ref']]) : undefined;
  const parentSessionId = firstString(thread, [['parentThreadID'], ['mainThreadID']]);
  const childSessionIds = Array.isArray(thread.subThreads)
    ? thread.subThreads.flatMap((candidate) => {
        if (typeof candidate === 'string' && candidate.trim()) return [candidate.trim()];
        if (!isRecord(candidate)) return [];
        const id = firstString(candidate, [['id']]);
        return id ? [id] : [];
      })
    : [];
  const normalizedThread: UnknownRecord = {
    sessionId: externalId,
    agentVersion: platform ? firstString(platform, [['clientVersion']]) : undefined,
    projectName: tree ? firstString(tree, [['displayName']]) : undefined,
    projectPath: tree ? fileUriToPath(tree.uri) : undefined,
    gitRemote: repository ? firstString(repository, [['url'], ['remote']]) : undefined,
    gitBranch: repositoryRef?.replace(/^refs\/heads\//u, ''),
    gitRef: repository ? firstString(repository, [['sha']]) : undefined,
    createdAt: thread.created,
    endedAt: latestTimestamp,
    status,
    model,
    contextWindow,
    ...(Object.keys(aggregateUsage).length > 0 ? { usage: usageRecord(aggregateUsage) } : {}),
    ...(parentSessionId ? { parentSessionId } : {}),
    ...(childSessionIds.length > 0 ? { childSessionIds } : {}),
    messages: normalizedMessages,
  };
  return { records: [normalizedThread], warnings: [...warnings] };
}
