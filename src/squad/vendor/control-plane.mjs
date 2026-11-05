// Pure control-plane logic (ADR-0109): tool definitions, argument validation,
// loopback checks, secret redaction, outcome mapping and the two stdio
// framings. No I/O here so scripts/check-control-plane.mjs can import it
// without a bridge. The stdio entry point is mcp-server.mjs.

export const SERVER_NAME = 'autohand-squad-control-plane';
export const SERVER_VERSION = '1';
export const PROTOCOL_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18'];
export const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:19821';
export const NOT_AVAILABLE_CODE = 'not_available_from_bridge';
export const MAX_MESSAGES = 200;
export const MAX_TAIL_LINES = 60;
export const MAX_WAIT_MS = 600_000;
export const DEFAULT_WAIT_MS = 60_000;
export const POLL_INTERVAL_MS = 400;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** Parse and accept only a loopback bridge origin; throws with the reason otherwise. */
export function parseBridgeUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('bridge URL is required');
  let url;
  try { url = new URL(raw); } catch { throw new Error(`bridge URL is not a valid URL: ${raw}`); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`bridge URL must be http or https: ${raw}`);
  const host = url.hostname.toLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(`bridge URL must point at this machine (127.0.0.1, localhost or ::1); refusing ${host}. The control plane never exposes a remote bridge.`);
  }
  if (url.username || url.password) throw new Error('bridge URL must not carry credentials');
  return url.origin;
}

// Anything that looks like a credential is replaced before it leaves the
// bridge: vendor API keys, GitHub and Slack tokens, AWS access keys, JWTs,
// bearer headers, key=value secrets and long bare hex or base64 runs. Paths
// are kept (the long-run patterns exclude '/').
const SECRET_PATTERNS = [
  /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi,
  /\b[A-Fa-f0-9]{40,}\b/g,
  /\b[A-Za-z0-9_-]{48,}={0,2}(?![A-Za-z0-9_\/-])/g,
];
const KEY_VALUE_SECRET = /\b(api[_-]?key|secret|token|password|passwd|authorization|credential)(s?["']?\s*[:=]\s*["']?)([^\s"',;]{6,})/gi;

export function redactSecrets(text) {
  let value = String(text ?? '');
  for (const pattern of SECRET_PATTERNS) value = value.replace(pattern, '[redacted]');
  value = value.replace(KEY_VALUE_SECRET, (_match, key, separator) => `${key}${separator}[redacted]`);
  return value;
}

/** Last `lines` log lines of a run summary, redacted. */
export function redactedTail(logs, lines = 20) {
  const take = Math.max(1, Math.min(Number(lines) || 20, MAX_TAIL_LINES));
  return (Array.isArray(logs) ? logs : [])
    .map((entry) => (typeof entry === 'string' ? entry : `${entry?.source ? `[${entry.source}] ` : ''}${entry?.line || ''}`))
    .filter(Boolean)
    .slice(-take)
    .map((line) => redactSecrets(line).slice(0, 500));
}

/** Map a bridge run summary to a wait outcome, or null while it is still live. */
export function runOutcome(run) {
  const status = String(run?.status || '');
  if (['queued', 'launching', 'running'].includes(status)) return null;
  const actions = Array.isArray(run?.channelActions) ? run.channelActions : [];
  if (actions.some((action) => action?.status === 'proposed')) {
    return { outcome: 'needs-you', reason: 'The member proposed a channel action that is waiting for your approval in the app.' };
  }
  if (status === 'completed') return { outcome: 'settled', reason: '' };
  if (status === 'stopped') return { outcome: 'failed', reason: 'The run was stopped.' };
  if (status === 'failed') return { outcome: 'failed', reason: lastErrorLine(run?.logs) || 'The run failed.' };
  return { outcome: 'failed', reason: `Unknown run status ${status || '(empty)'}.` };
}

/** Map a bridge goal record to a wait outcome, or null while it is running. */
export function goalOutcome(goal) {
  const status = String(goal?.status || '');
  if (status === 'running') return null;
  if (status === 'completed') return { outcome: 'settled', reason: '' };
  if (status === 'paused') return { outcome: 'needs-you', reason: goal?.pauseReason || 'The goal is paused and waits for you to resume it.' };
  if (status === 'blocked') return { outcome: 'needs-you', reason: 'The member reported the goal as blocked.' };
  if (status === 'failed') return { outcome: 'failed', reason: goal?.error || 'The goal failed.' };
  if (status === 'cancelled') return { outcome: 'failed', reason: 'The goal was cancelled.' };
  return { outcome: 'failed', reason: `Unknown goal status ${status || '(empty)'}.` };
}

function lastErrorLine(logs) {
  const entries = Array.isArray(logs) ? logs : [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.source === 'stderr' && entry.line) return redactSecrets(entry.line).slice(0, 300);
  }
  return '';
}

// ---- tool schemas ---------------------------------------------------------

const id = (description) => ({ type: 'string', minLength: 1, maxLength: 200, description });

export const TOOLS = [
  {
    name: 'list_members',
    description: 'List Squad agents by id, name, role, presence, harness and workspace. Uses registered profiles and live presence, supplemented by the app\'s status mirror. Use member ids to address messages unambiguously.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_channels',
    description: 'Channels with their members, projects and thread and message counts from the bridge\'s channel state.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_messages',
    description: 'Read a channel\'s threads and messages, or a member\'s bridge-owned run and goal summaries with redacted replies and log tails. Use get_conversation for the actual direct-message transcript.',
    inputSchema: {
      type: 'object',
      properties: {
        channel_id: id('Channel to read.'),
        thread_id: id('Only this thread of the channel.'),
        member_id: id('Member whose bridge-owned runs and goals to read.'),
        limit: { type: 'integer', minimum: 1, maximum: MAX_MESSAGES, description: `Newest items to return (default 50, max ${MAX_MESSAGES}).` },
        before: { type: 'string', maxLength: 40, description: 'ISO timestamp; only items created before it.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'search',
    description: 'Search the bridge index: channel messages, channels, runs, and whatever the app has pushed (members, tasks, handoffs, canvases, workflow runs). Snippets wrap hits in <mark>.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 500 },
        types: { type: 'string', maxLength: 200, description: 'Comma list of message,channel,member,run,task,handoff,canvas,workflow.' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_member',
    description: 'Not available from the bridge: members are created and stored by the Squad app. This tool always returns the documented error so clients learn where to create one.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', maxLength: 120 }, role: { type: 'string', maxLength: 120 } },
      additionalProperties: false,
    },
  },
  {
    name: 'create_channel',
    description: 'Create a channel on the bridge. It appears in the app on its next channel reload.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 80 },
        visibility: { type: 'string', enum: ['public', 'private'] },
        member_ids: { type: 'array', items: id('Member id.'), maxItems: 50 },
        section: { type: 'string', maxLength: 80 },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'send_message',
    description: 'Post text to a channel (channel_id) and, when member_id is also given, start a bridge-owned run for that member in the new thread. Or send directly to a member (member_id only): starts a bridge-owned run (mode "run", default) or a durable goal (mode "goal") and returns its id for wait_for_reply. The bridge has no automatic channel responder: a channel message without member_id is posted but nobody is dispatched. Runs need a workspace folder; when omitted, the member\'s last bridge-owned workspace is reused.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', minLength: 1, maxLength: 20000 },
        channel_id: id('Channel to post in.'),
        thread_id: id('Reply inside this existing thread instead of opening one.'),
        member_id: id('Member to dispatch.'),
        workspace: { type: 'string', maxLength: 1000, description: 'Absolute project folder the member works in.' },
        mode: { type: 'string', enum: ['run', 'goal'] },
        author: { type: 'string', maxLength: 80, description: 'Display name recorded on the channel message (default "Control plane").' },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'wait_for_reply',
    description: `Wait for a run (run_id) or goal (goal_id) started by send_message. Returns settled, needs-you, failed or timed-out with the reply and a redacted log tail; keys and tokens are replaced with [redacted]. A settled channel run also posts its reply into the thread.`,
    inputSchema: {
      type: 'object',
      properties: {
        run_id: id('Run to wait for.'),
        goal_id: id('Goal to wait for.'),
        timeout_ms: { type: 'integer', minimum: 1000, maximum: MAX_WAIT_MS, description: `Default ${DEFAULT_WAIT_MS}.` },
        tail_lines: { type: 'integer', minimum: 1, maximum: MAX_TAIL_LINES, description: 'Log lines in the tail (default 20).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'interrupt',
    description: 'Stop a run (run_id), pause a goal (goal_id), or stop everything the bridge holds for a member (member_id): its warm sessions and live runs, and pause its goals.',
    inputSchema: {
      type: 'object',
      properties: { run_id: id('Run to stop.'), goal_id: id('Goal to pause.'), member_id: id('Member to stop.') },
      additionalProperties: false,
    },
  },
  {
    name: 'set_model',
    description: 'Not available from the bridge: a member\'s harness and model are chosen in the app and sent with each turn; the bridge only holds the global provider settings. This tool always returns the documented error.',
    inputSchema: {
      type: 'object',
      properties: { member_id: id('Member.'), model: { type: 'string', maxLength: 120 }, provider: { type: 'string', maxLength: 60 } },
      additionalProperties: false,
    },
  },
  {
    name: 'message_member',
    description: 'Send a real direct message to an existing Squad member. Returns a durable message_id immediately. Messages run in queue order without interrupting current work, reuse the member\'s saved workspace when omitted, and appear in the app conversation. Does not resume a paused queue. Use wait_for_message for the reply.',
    inputSchema: { type: 'object', properties: { member_id: id('Recipient member id from list_members.'), text: { type: 'string', minLength: 1, maxLength: 20000 }, workspace: { type: 'string', minLength: 1, maxLength: 1000, description: 'Explicit project override; otherwise reuse the member workspace.' } }, required: ['member_id', 'text'], additionalProperties: false },
  },
  {
    name: 'get_conversation',
    description: 'Read recent direct-message turns, including messages sent from the app or CLI, from the bridge history. Up to 60 turns; use since to filter a conversation boundary. Does not read archived chat files.',
    inputSchema: { type: 'object', properties: { member_id: id('Member id.'), limit: { type: 'integer', minimum: 1, maximum: 60 }, since: { type: 'string', maxLength: 40, description: 'Only turns after this ISO timestamp.' } }, required: ['member_id'], additionalProperties: false },
  },
  {
    name: 'get_member_queue',
    description: 'Read a member\'s queued messages and delivery receipts, replies, failures and pause reason. Does not change queue state.',
    inputSchema: { type: 'object', properties: { member_id: id('Member id.'), limit: { type: 'integer', minimum: 1, maximum: 200 } }, required: ['member_id'], additionalProperties: false },
  },
  {
    name: 'wait_for_message',
    description: 'Wait for a direct-message receipt from message_member. Returns settled, failed, needs-you (paused queue), or timed-out; waiting never cancels or resends the message.',
    inputSchema: { type: 'object', properties: { member_id: id('Recipient member id.'), message_id: id('Durable message receipt id.'), timeout_ms: { type: 'integer', minimum: 1000, maximum: 25000, description: 'Default 20000; repeat with the same receipt if timed out.' } }, required: ['member_id', 'message_id'], additionalProperties: false },
  },
  {
    name: 'list_artifacts',
    description: 'Find published agent artifacts in the Squad Library. Returns metadata and local preview/download links, without executing artifact content.',
    inputSchema: { type: 'object', properties: { member_id: id('Filter by owner.'), query: { type: 'string', maxLength: 500 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, additionalProperties: false },
  },
  {
    name: 'get_artifact',
    description: 'Read metadata for one published artifact, including its local preview/download links. Does not read arbitrary workspace files.',
    inputSchema: { type: 'object', properties: { artifact_id: id('Artifact id from list_artifacts.') }, required: ['artifact_id'], additionalProperties: false },
  },
  {
    name: 'list_memories',
    description: 'Search the Squad knowledge library, optionally by member. This operator connection reads memories visible to the person; it is never supplied to a managed Squad member.',
    inputSchema: { type: 'object', properties: { member_id: id('Filter by owner.'), query: { type: 'string', maxLength: 500 }, limit: { type: 'integer', minimum: 1, maximum: 100 }, offset: { type: 'integer', minimum: 0, maximum: 100000 } }, additionalProperties: false },
  },
  {
    name: 'read_memory',
    description: 'Read one entry from the Squad knowledge library. Read-only operator access; does not edit or share memories.',
    inputSchema: { type: 'object', properties: { memory_id: id('Memory id from list_memories.') }, required: ['memory_id'], additionalProperties: false },
  },
];

export const TOOL_NAMES = TOOLS.map((tool) => tool.name);

/** Small JSON-schema subset validator: types, enums, bounds, required, unknown fields. */
export function validateArgs(schema, input, path = 'arguments') {
  const errors = [];
  const check = (node, value, at) => {
    if (node.type === 'object') {
      if (value === undefined || value === null) value = {};
      if (typeof value !== 'object' || Array.isArray(value)) { errors.push(`${at} must be an object`); return; }
      const properties = node.properties || {};
      for (const key of Object.keys(value)) {
        if (!(key in properties)) { if (node.additionalProperties === false) errors.push(`${at}.${key} is not a known field`); }
        else if (value[key] !== undefined) check(properties[key], value[key], `${at}.${key}`);
      }
      for (const key of node.required || []) {
        if (value[key] === undefined || value[key] === null || value[key] === '') errors.push(`${at}.${key} is required`);
      }
      return;
    }
    if (node.type === 'array') {
      if (!Array.isArray(value)) { errors.push(`${at} must be an array`); return; }
      if (node.maxItems !== undefined && value.length > node.maxItems) errors.push(`${at} has more than ${node.maxItems} items`);
      value.forEach((item, index) => check(node.items || {}, item, `${at}[${index}]`));
      return;
    }
    if (node.type === 'string') {
      if (typeof value !== 'string') { errors.push(`${at} must be a string`); return; }
      if (node.minLength !== undefined && value.trim().length < node.minLength) errors.push(`${at} must not be empty`);
      if (node.maxLength !== undefined && value.length > node.maxLength) errors.push(`${at} is longer than ${node.maxLength} characters`);
      if (node.enum && !node.enum.includes(value)) errors.push(`${at} must be one of ${node.enum.join(', ')}`);
      return;
    }
    if (node.type === 'integer' || node.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value) || (node.type === 'integer' && !Number.isInteger(value))) { errors.push(`${at} must be ${node.type === 'integer' ? 'an integer' : 'a number'}`); return; }
      if (node.minimum !== undefined && value < node.minimum) errors.push(`${at} must be at least ${node.minimum}`);
      if (node.maximum !== undefined && value > node.maximum) errors.push(`${at} must be at most ${node.maximum}`);
      return;
    }
    if (node.type === 'boolean' && typeof value !== 'boolean') errors.push(`${at} must be true or false`);
  };
  check(schema, input, path);
  return errors;
}

// ---- stdio framing --------------------------------------------------------

/** Encode one JSON-RPC message in the given framing ('newline' | 'header'). */
export function encodeFrame(message, framing) {
  const encoded = Buffer.from(JSON.stringify(message));
  return framing === 'header'
    ? Buffer.concat([Buffer.from(`Content-Length: ${encoded.length}\r\n\r\n`), encoded])
    : Buffer.concat([encoded, Buffer.from('\n')]);
}

/**
 * Pull every complete frame off `buffer`. Returns `{ frames: [{ body, framing }], rest }`.
 * A frame that starts with a Content-Length header is read by length; anything
 * else is one JSON document per line. Blank lines are skipped.
 */
export function decodeFrames(buffer) {
  const frames = [];
  let rest = buffer;
  for (;;) {
    while (rest.length && (rest[0] === 0x0a || rest[0] === 0x0d || rest[0] === 0x20 || rest[0] === 0x09)) rest = rest.subarray(1);
    if (!rest.length) break;
    if (/^content-length:/i.test(rest.subarray(0, 15).toString())) {
      const headerEnd = rest.indexOf('\r\n\r\n');
      const looseEnd = headerEnd < 0 ? rest.indexOf('\n\n') : -1;
      const end = headerEnd >= 0 ? headerEnd : looseEnd;
      const separator = headerEnd >= 0 ? 4 : 2;
      if (end < 0) break;
      const match = rest.subarray(0, end).toString().match(/content-length:\s*(\d+)/i);
      const size = Number(match?.[1]);
      if (!Number.isFinite(size)) { rest = rest.subarray(end + separator); continue; }
      if (rest.length < end + separator + size) break;
      frames.push({ body: rest.subarray(end + separator, end + separator + size), framing: 'header' });
      rest = rest.subarray(end + separator + size);
      continue;
    }
    const lineEnd = rest.indexOf('\n');
    if (lineEnd < 0) break;
    const body = rest.subarray(0, lineEnd);
    rest = rest.subarray(lineEnd + 1);
    if (body.toString().trim()) frames.push({ body, framing: 'newline' });
  }
  return { frames, rest };
}

/** Choose the protocol version to answer initialize with. */
export function negotiateProtocol(requested) {
  return PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS.at(-1);
}

/** Documented refusal for tools the bridge cannot honour. */
export function notAvailable(tool, why, next) {
  return Object.assign(new Error(`${tool} is not available from the bridge: ${why} ${next}`), { code: NOT_AVAILABLE_CODE });
}
