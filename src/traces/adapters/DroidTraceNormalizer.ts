/** @license Apache-2.0 */
import path from 'node:path';

type UnknownRecord = Record<string, unknown>;

export interface DroidSessionNormalization {
  records: UnknownRecord[];
  warnings: string[];
}

const VERIFIED_SCHEMA = '2';
const SUPPORTED_CONTENT_TYPES = new Set([
  'analysis',
  'reasoning',
  'text',
  'thinking',
  'tool_call',
  'tool_result',
  'tool_use',
]);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonemptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function schemaVersion(session: UnknownRecord | undefined): string | undefined {
  const version = session?.version;
  return typeof version === 'string' || typeof version === 'number'
    ? String(version)
    : undefined;
}

function settingsValue(settings: UnknownRecord | undefined, key: string): string | undefined {
  return settings ? nonemptyString(settings[key]) : undefined;
}

function normalizeMessageContent(
  content: unknown,
  toolNames: Map<string, string>,
  warnings: Set<string>,
): unknown {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) {
    warnings.add('Droid session contains a message without string or array content.');
    return content;
  }

  const normalized = content.map((part) => {
    if (!isRecord(part)) {
      warnings.add('Droid session contains a non-object message part.');
      return part;
    }
    const type = nonemptyString(part.type)?.toLowerCase();
    if (!type || !SUPPORTED_CONTENT_TYPES.has(type)) {
      warnings.add(`Droid session contains unsupported content part type "${type ?? 'unknown'}".`);
      return part;
    }
    if (type === 'tool_use' || type === 'tool_call') {
      const callId = nonemptyString(part.id) ?? nonemptyString(part.call_id);
      const name = nonemptyString(part.name);
      if (callId && name) toolNames.set(callId, name);
      return part;
    }
    if (type !== 'tool_result') return part;
    const callId = nonemptyString(part.tool_use_id)
      ?? nonemptyString(part.call_id)
      ?? nonemptyString(part.id);
    const name = nonemptyString(part.name) ?? (callId ? toolNames.get(callId) : undefined);
    return name ? { ...part, name } : part;
  });
  const collapsed: unknown[] = [];
  for (const part of normalized) {
    const previous = collapsed.at(-1);
    if (isRecord(previous) && previous.type === 'text' && typeof previous.text === 'string'
      && isRecord(part) && part.type === 'text' && typeof part.text === 'string') {
      collapsed[collapsed.length - 1] = { ...previous, text: `${previous.text}\n${part.text}` };
    } else {
      collapsed.push(part);
    }
  }
  return collapsed;
}

export function normalizeDroidSessionRecords(
  records: UnknownRecord[],
  filePath: string,
  settings?: UnknownRecord,
): DroidSessionNormalization {
  const warnings = new Set<string>();
  const sessionStart = records.find((record) => record.type === 'session_start');
  if (!sessionStart && records.some((record) => (
    nonemptyString(record.sessionId) !== undefined || Array.isArray(record.messages)
  ))) {
    return { records, warnings: [] };
  }
  const version = schemaVersion(sessionStart);
  if (!sessionStart) {
    warnings.add('Droid session is missing a session_start record; native identity and schema are unverified.');
  } else if (version !== VERIFIED_SCHEMA) {
    warnings.add(`Droid session schema ${version ?? 'unknown'} is not a verified native contract.`);
  }

  const fallbackId = path.basename(filePath, '.jsonl');
  const sessionId = nonemptyString(sessionStart?.id) ?? fallbackId;
  const model = settingsValue(settings, 'model');
  const provider = settingsValue(settings, 'providerLock');
  const reasoningEffort = settingsValue(settings, 'reasoningEffort');
  const normalized: UnknownRecord[] = [{
    sessionId,
    ...(version ? { agentVersion: version } : {}),
    ...(nonemptyString(sessionStart?.cwd) ? { projectPath: nonemptyString(sessionStart?.cwd) } : {}),
    ...(model ? { model } : {}),
    ...(provider ? { provider } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(sessionStart?.timestamp === undefined ? {} : { createdAt: sessionStart.timestamp }),
  }];

  const toolNames = new Map<string, string>();
  for (const record of records) {
    const type = nonemptyString(record.type);
    if (type === 'session_start') continue;
    if (type !== 'message') {
      warnings.add(`Droid session contains unsupported record type "${type ?? 'unknown'}".`);
      continue;
    }
    if (!isRecord(record.message)) {
      warnings.add('Droid session contains a message record without a message object.');
      continue;
    }
    const role = nonemptyString(record.message.role)?.toLowerCase();
    if (!role || !['assistant', 'system', 'tool', 'user'].includes(role)) {
      warnings.add(`Droid session contains unsupported message role "${role ?? 'unknown'}".`);
    }
    normalized.push({
      ...record,
      sessionId,
      message: {
        ...record.message,
        ...(role === 'assistant' && model && !nonemptyString(record.message.model) ? { model } : {}),
        content: normalizeMessageContent(record.message.content, toolNames, warnings),
      },
    });
  }

  return { records: normalized, warnings: [...warnings] };
}
