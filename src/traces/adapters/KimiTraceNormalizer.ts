/** @license Apache-2.0 */
import path from 'node:path';

type UnknownRecord = Record<string, unknown>;

export interface KimiWireRecordNormalization {
  records: UnknownRecord[];
  warnings: string[];
}

const VERIFIED_PROTOCOLS = new Set(['1.4', '1.5']);
const IGNORED_RECORD_TYPES = new Set([
  'context.append_message',
  'full_compaction.begin',
  'full_compaction.complete',
  'goal.clear',
  'goal.create',
  'goal.update',
  'llm.tools_snapshot',
  'micro_compaction.apply',
  'permission.record_approval_result',
  'permission.set_mode',
  'plan_mode.enter',
  'plan_mode.exit',
  'swarm_mode.enter',
  'swarm_mode.exit',
  'tools.set_active_tools',
  'tools.update_store',
  'turn.steer',
]);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonemptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function firstString(record: UnknownRecord, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = nonemptyString(record[key]);
    if (value) return value;
  }
  return undefined;
}

function protocolVersion(metadata: UnknownRecord): string {
  const value = metadata.protocol_version;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return 'unknown';
}

function nonnegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : undefined;
}

function normalizeUsage(value: unknown): UnknownRecord | undefined {
  if (!isRecord(value)) return undefined;
  const input = nonnegativeInteger(value.inputOther);
  const output = nonnegativeInteger(value.output);
  const cacheRead = nonnegativeInteger(value.inputCacheRead);
  const cacheWrite = nonnegativeInteger(value.inputCacheCreation);
  if ([input, output, cacheRead, cacheWrite].every((item) => item === undefined)) return undefined;
  return {
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
    ...(cacheRead === undefined ? {} : { cacheRead }),
    ...(cacheWrite === undefined ? {} : { cacheWrite }),
  };
}

function sessionIdentity(filePath: string, state: UnknownRecord | undefined): {
  agentName: string;
  externalId: string;
  parentSessionId?: string;
  sessionId: string;
} {
  const agentDirectory = path.dirname(filePath);
  const agentName = path.basename(agentDirectory);
  const agentsDirectory = path.dirname(agentDirectory);
  const sessionDirectory = path.basename(agentsDirectory) === 'agents'
    ? path.dirname(agentsDirectory)
    : agentDirectory;
  const sessionId = firstString(state ?? {}, ['id']) ?? path.basename(sessionDirectory);
  if (agentName === 'main' || path.basename(agentsDirectory) !== 'agents') {
    return { agentName: 'main', externalId: sessionId, sessionId };
  }
  return {
    agentName,
    externalId: `${sessionId}:${agentName}`,
    parentSessionId: sessionId,
    sessionId,
  };
}

function agentState(state: UnknownRecord | undefined, agentName: string): UnknownRecord | undefined {
  if (!state || !isRecord(state.agents)) return undefined;
  const value = state.agents[agentName];
  return isRecord(value) ? value : undefined;
}

export function normalizeKimiWireRecords(
  records: UnknownRecord[],
  filePath: string,
  state?: UnknownRecord,
): KimiWireRecordNormalization {
  const metadata = records.find((record) => record.type === 'metadata' && record.protocol_version !== undefined);
  if (!metadata) return { records, warnings: [] };

  const warnings = new Set<string>();
  const version = protocolVersion(metadata);
  const identity = sessionIdentity(filePath, state);
  const currentAgent = agentState(state, identity.agentName);
  const configuredParent = firstString(currentAgent ?? {}, ['parentAgentId']);
  const session: UnknownRecord = {
    sessionId: identity.externalId,
    ...(identity.parentSessionId || configuredParent
      ? { parentSessionId: identity.parentSessionId ?? identity.sessionId }
      : {}),
    agentVersion: firstString(state ?? {}, ['version']),
    projectPath: firstString(state ?? {}, ['workDir', 'cwd']),
    createdAt: state?.createdAt ?? metadata.created_at,
    endedAt: state?.updatedAt,
  };

  if (version === '1.0') {
    warnings.add('Kimi wire protocol 1.0 is metadata-only because its event contract is not verified.');
    return { records: [session], warnings: [...warnings] };
  }
  if (!VERIFIED_PROTOCOLS.has(version)) {
    warnings.add(`Kimi wire protocol ${version} is not a verified native contract.`);
  }

  const normalized: UnknownRecord[] = [session];
  const toolNames = new Map<string, string>();
  let currentModel: string | undefined;
  let currentProvider: string | undefined;
  let currentReasoningEffort: string | undefined;
  let firstProvider: string | undefined;
  let firstReasoningEffort: string | undefined;
  let lastUsageTarget: UnknownRecord | undefined;
  let hasExplicitUsageModel = false;
  let generatedId = 0;

  const nextId = (prefix: string): string => `${prefix}:${generatedId++}`;
  const append = (record: UnknownRecord, acceptsUsage = false): void => {
    normalized.push(record);
    if (acceptsUsage) lastUsageTarget = record;
  };
  const attachUsage = (usageValue: unknown, modelValue?: unknown): void => {
    const usage = normalizeUsage(usageValue);
    if (!usage || !lastUsageTarget) return;
    lastUsageTarget.usage = usage;
    const explicitUsageModel = nonemptyString(modelValue);
    const usageModel = explicitUsageModel ?? currentModel;
    if (usageModel) {
      lastUsageTarget.model = usageModel;
      if (explicitUsageModel && !hasExplicitUsageModel) {
        session.model = explicitUsageModel;
        hasExplicitUsageModel = true;
      } else {
        session.model ??= usageModel;
      }
    }
  };

  for (const record of records) {
    const type = firstString(record, ['type']);
    if (!type) {
      warnings.add('Kimi wire contains a record without a type.');
      continue;
    }
    if (type === 'metadata') continue;
    if (type === 'config.update') {
      currentModel = firstString(record, ['modelAlias', 'model']) ?? currentModel;
      currentReasoningEffort = firstString(record, ['thinkingEffort', 'thinkingLevel'])
        ?? currentReasoningEffort;
      if (!session.projectPath) session.projectPath = firstString(record, ['cwd']);
      continue;
    }
    if (type === 'llm.request') {
      currentModel = firstString(record, ['model', 'modelAlias']) ?? currentModel;
      currentProvider = firstString(record, ['provider']) ?? currentProvider;
      currentReasoningEffort = firstString(record, ['thinkingEffort', 'thinkingLevel'])
        ?? currentReasoningEffort;
      firstProvider ??= currentProvider;
      firstReasoningEffort ??= currentReasoningEffort;
      continue;
    }
    if (type === 'turn.prompt') {
      append({
        id: firstString(record, ['turnId', 'id']) ?? nextId('prompt'),
        sessionId: identity.externalId,
        role: 'user',
        content: record.input,
        timestamp: record.time,
      });
      continue;
    }
    if (type === 'usage.record') {
      if (record.usageScope === 'turn') attachUsage(record.usage, record.model);
      lastUsageTarget = undefined;
      continue;
    }
    if (type === 'turn.cancel') {
      append({
        id: firstString(record, ['turnId', 'id']) ?? nextId('cancel'),
        sessionId: identity.externalId,
        role: 'system',
        timestamp: record.time,
        content: [{ type: 'error', code: 'turn_cancelled', message: 'Kimi turn cancelled.' }],
      });
      continue;
    }
    if (type === 'context.apply_compaction') {
      append({
        id: firstString(record, ['id']) ?? nextId('compaction'),
        sessionId: identity.externalId,
        role: 'system',
        timestamp: record.time,
        content: firstString(record, ['summary', 'contextSummary']) ?? 'Kimi context compacted.',
      });
      continue;
    }
    if (type === 'context.append_loop_event') {
      const event = isRecord(record.event) ? record.event : undefined;
      const eventType = event ? firstString(event, ['type']) : undefined;
      if (!event || !eventType) {
        warnings.add('Kimi wire contains a loop event without a typed event object.');
        continue;
      }
      if (eventType === 'step.begin') continue;
      if (eventType === 'step.end') {
        attachUsage(event.usage);
        continue;
      }
      if (eventType === 'content.part') {
        const part = isRecord(event.part) ? event.part : undefined;
        if (!part) {
          warnings.add('Kimi wire contains a content part without a part object.');
          continue;
        }
        const partType = firstString(part, ['type']);
        if (partType === 'think') {
          const text = firstString(part, ['think']);
          if (text) append({
            id: firstString(event, ['uuid']) ?? nextId('thinking'),
            sessionId: identity.externalId,
            role: 'assistant',
            timestamp: record.time,
            ...(currentModel ? { model: currentModel } : {}),
            content: [{ type: 'thinking', thinking: text }],
          });
          continue;
        }
        if (partType === 'text') {
          const text = firstString(part, ['text']);
          if (text) append({
            id: firstString(event, ['uuid']) ?? nextId('text'),
            sessionId: identity.externalId,
            role: 'assistant',
            timestamp: record.time,
            ...(currentModel ? { model: currentModel } : {}),
            content: [{ type: 'text', text }],
          }, true);
          continue;
        }
        warnings.add(`Kimi wire contains unsupported content part type "${partType ?? 'unknown'}".`);
        continue;
      }
      if (eventType === 'tool.call') {
        const callId = firstString(event, ['toolCallId', 'uuid']) ?? nextId('tool-call');
        const name = firstString(event, ['name']) ?? 'unknown';
        toolNames.set(callId, name);
        append({
          id: firstString(event, ['uuid']) ?? callId,
          sessionId: identity.externalId,
          role: 'assistant',
          timestamp: record.time,
          ...(currentModel ? { model: currentModel } : {}),
          content: [{ type: 'tool_call', id: callId, name, arguments: event.args }],
        }, true);
        continue;
      }
      if (eventType === 'tool.result') {
        const callId = firstString(event, ['toolCallId']) ?? nextId('tool-result');
        const result = isRecord(event.result) ? event.result : undefined;
        const name = toolNames.get(callId) ?? firstString(event, ['name']) ?? 'unknown';
        append({
          id: firstString(event, ['uuid']) ?? nextId(`${callId}:result`),
          sessionId: identity.externalId,
          role: 'tool',
          timestamp: record.time,
          content: [{
            type: 'tool_result',
            call_id: callId,
            name,
            content: result?.output ?? event.result,
            ...(result?.isError === true ? { isError: true } : {}),
          }],
        });
        continue;
      }
      warnings.add(`Kimi wire contains unsupported loop event type "${eventType}".`);
      continue;
    }
    if (!IGNORED_RECORD_TYPES.has(type)) {
      warnings.add(`Kimi wire contains unsupported record type "${type}".`);
    }
  }

  if (firstProvider) session.provider = firstProvider;
  if (firstReasoningEffort) session.reasoningEffort = firstReasoningEffort;
  return { records: normalized, warnings: [...warnings] };
}
