import { randomUUID } from 'node:crypto';

const text = (maxLength = 2000) => ({ type: 'string', minLength: 1, maxLength });
const id = () => text(200);
const ids = (minimum = 0) => ({ type: 'array', items: id(), minItems: minimum, maxItems: 20 });
const revision = { type: 'integer', minimum: 0 };
const mode = { type: 'string', enum: ['allow', 'ask', 'block'] };
const policies = { type: 'array', maxItems: 200, items: { type: 'object', properties: { id: id(), mode }, required: ['id', 'mode'], additionalProperties: false } };
const schedule = {
  type: 'object', additionalProperties: false, required: ['kind', 'timeZone'],
  properties: {
    kind: { type: 'string', enum: ['once', 'weekdays', 'interval', 'monthly', 'yearly', 'cron'] },
    timeZone: text(100), time: text(5), date: text(10),
    days: { type: 'array', maxItems: 7, items: { type: 'integer', minimum: 0, maximum: 6 } },
    everyMinutes: { type: 'integer', minimum: 1, maximum: 1440 }, startDate: text(10), startTime: text(5),
    month: { type: 'integer', minimum: 1, maximum: 12 },
    day: { anyOf: [{ type: 'integer', minimum: 1, maximum: 31 }, { type: 'string', enum: ['last'] }] },
    cron: text(120),
  },
};
const tool = (name, description, properties, required = [], readOnly = false) => ({ name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false }, annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: ['send_channel_message', 'run_routine'].includes(name) } });
const member = { member_id: id(), expected_revision: revision };
const routineFields = { title: text(160), instructions: text(20000), workspace: text(1000), schedule, enabled: { type: 'boolean' }, max_run_minutes: { type: 'integer', minimum: 1, maximum: 1440 } };

export const MANAGEMENT_TOOLS = [
  tool('get_member_profile', 'Read a member\'s saved name, personality, operating instructions, skills, folders and abilities, with its revision and available ability IDs. Operator access.', { member_id: id() }, ['member_id'], true),
  tool('update_member_profile', 'Change a saved member name, role, personality or operating instructions. Preserves other fields and current work. expected_revision rejects stale edits; changes apply to later turns.', { ...member, name: text(60), role: text(80), description: { type: 'string', maxLength: 600 }, instructions: { type: 'string', maxLength: 1200 }, personality: { type: 'string', maxLength: 600 } }, ['member_id']),
  tool('set_member_abilities', 'Set specific capability/tool policies to allow, ask or block. Get supported IDs from get_member_profile. Preserves unmentioned policies and workspace overrides. Optional workspace edits that folder\'s override. Does not grant OS permissions or disable safety guards.', { ...member, capabilities: policies, tool_policies: policies, workspace: text(1000) }, ['member_id']),
  tool('add_member_directory', 'Grant an existing project folder to a member, equivalent to --add-dir on later turns. Persists the folder on the member, validates its real path, and preserves other folders. Does not restart current work.', { ...member, path: text(1000) }, ['member_id', 'path']),
  tool('remove_member_directory', 'Remove an extra folder grant for later turns. Does not delete files or interrupt current work. The current primary workspace cannot be removed here.', { ...member, path: text(1000) }, ['member_id', 'path']),
  tool('list_skills', 'Discover local and registry skill packages available for a member\'s workspace. Choose package IDs for set_member_skills; offset supports catalog pagination.', { member_id: id(), query: { type: 'string', maxLength: 500 }, offset: { type: 'integer', minimum: 0, maximum: 100000 } }, ['member_id'], true),
  tool('set_member_skills', 'Replace a member\'s selected skill-package IDs (empty clears selections). Validates references against the catalog. Packages are installed/pinned by the existing engine preparation on the next turn; this receipt is assignment, not installation.', { ...member, skill_ids: { type: 'array', maxItems: 32, items: text(500) } }, ['member_id', 'skill_ids']),
  tool('get_channel', 'Read one channel\'s saved settings, member IDs and projects.', { channel_id: id() }, ['channel_id'], true),
  tool('update_channel', 'Change a channel name, purpose or section without replacing its members or history.', { channel_id: id(), name: text(80), purpose: { type: 'string', maxLength: 20000 }, section: { type: 'string', maxLength: 80 } }, ['channel_id']),
  tool('set_channel_members', 'Add/remove existing members atomically from a channel roster. Does not dispatch work or delete messages.', { channel_id: id(), add: ids(), remove: ids() }, ['channel_id']),
  tool('list_channel_threads', 'List a channel\'s newest conversation threads. Use get_messages with thread_id to read replies.', { channel_id: id(), limit: { type: 'integer', minimum: 1, maximum: 100 } }, ['channel_id'], true),
  tool('create_group_chat', 'Create a persistent private channel for two or more existing agents. Does not send a message or start work until explicitly requested.', { name: text(80), member_ids: ids(2) }, ['name', 'member_ids']),
  tool('send_channel_message', 'Post into a channel/group thread and optionally dispatch the explicitly named channel members. Omit member_ids to publish only. Replies persist in the thread even if this MCP client disconnects. Returns per-member run receipts/errors for wait_for_reply.', { channel_id: id(), thread_id: id(), text: text(20000), member_ids: ids() }, ['channel_id', 'text']),
  tool('list_routines', 'Read scheduled routines, pause/enabled state, next occurrences and recent runs; optionally filter by member.', { member_id: id() }, [], true),
  tool('get_routine', 'Read one routine and its run history.', { routine_id: id() }, ['routine_id'], true),
  tool('preview_routine', 'Validate an explicit IANA-timezone schedule and show its next three occurrences without saving or running it.', { schedule }, ['schedule'], true),
  tool('create_routine', 'Save a routine for an existing member. Disabled by default; enabled:true explicitly schedules it. Uses the member workspace unless overridden. Does not run it immediately.', { member_id: id(), ...routineFields }, ['member_id', 'title', 'instructions', 'schedule']),
  tool('update_routine', 'Edit a routine or set enabled:false/true to pause/resume scheduling. Preserves unmentioned fields, member ownership and history; does not stop an active run.', { routine_id: id(), ...routineFields }, ['routine_id']),
  tool('run_routine', 'Explicitly run a saved routine now using its saved member, workspace and permissions. Returns a run receipt; refuses overlap with an already active run.', { routine_id: id() }, ['routine_id']),
];

export function createManagementTools(bridge, legacy) {
  const profile = memberId => bridge.get(`/api/control-plane/members/${encodeURIComponent(memberId)}`);
  async function patchMember(memberId, patch, expectedRevision) {
    const current = await profile(memberId);
    return bridge.patch(`/api/control-plane/members/${encodeURIComponent(memberId)}`, { ...patch, expectedRevision: expectedRevision ?? current.revision });
  }
  async function known(idsToCheck) {
    const roster = await legacy.list_members();
    for (const memberId of idsToCheck) if (!roster.members.some(item => item.id === memberId)) throw new Error(`Member ${memberId} was not found. Choose an ID from list_members.`);
  }
  async function channelFor(channelId) {
    const state = await bridge.get('/api/channels');
    const channel = (state.channels || []).find(item => item.id === channelId);
    if (!channel) throw Object.assign(new Error('Channel not found.'), { status: 404 });
    return { channel, state };
  }
  const routineBody = args => Object.fromEntries(Object.entries(args).filter(([key]) => !['member_id', 'routine_id', 'max_run_minutes'].includes(key)).concat(args.max_run_minutes !== undefined ? [['maxRunMinutes', args.max_run_minutes]] : []));

  return {
    get_member_profile: ({ member_id }) => profile(member_id),
    update_member_profile: ({ member_id, expected_revision, ...patch }) => patchMember(member_id, patch, expected_revision),
    set_member_abilities: ({ member_id, expected_revision, ...abilities }) => patchMember(member_id, { abilities }, expected_revision),
    async add_member_directory({ member_id, path, expected_revision }) {
      const current = await profile(member_id);
      return bridge.post(`/api/control-plane/members/${encodeURIComponent(member_id)}/directories`, { operation: 'add', path, expectedRevision: expected_revision ?? current.revision });
    },
    async remove_member_directory({ member_id, path, expected_revision }) {
      const current = await profile(member_id);
      return bridge.post(`/api/control-plane/members/${encodeURIComponent(member_id)}/directories`, { operation: 'remove', path, expectedRevision: expected_revision ?? current.revision });
    },
    async list_skills({ member_id, query = '', offset = 0 }) {
      const current = await profile(member_id);
      return bridge.get(`/api/skills/catalog?${new URLSearchParams({ q: query, workspace: current.workspace || '', offset: String(offset) })}`);
    },
    set_member_skills: ({ member_id, expected_revision, skill_ids }) => patchMember(member_id, { skills: skill_ids }, expected_revision),
    async get_channel({ channel_id }) { return (await channelFor(channel_id)).channel; },
    async update_channel({ channel_id, ...patch }) {
      if (!Object.keys(patch).length) throw new Error('Provide at least one channel setting to change.');
      return bridge.patch(`/api/channels/${encodeURIComponent(channel_id)}`, patch);
    },
    async set_channel_members({ channel_id, add = [], remove = [] }) {
      await channelFor(channel_id);
      if (!add.length && !remove.length) throw new Error('Choose members to add or remove.');
      if (add.some(id => remove.includes(id))) throw new Error('A member cannot be both added and removed.');
      await known(add);
      return bridge.post(`/api/channels/${encodeURIComponent(channel_id)}/members`, { add, remove });
    },
    async list_channel_threads({ channel_id, limit = 50 }) {
      await channelFor(channel_id);
      const threads = await bridge.get(`/api/channels/${encodeURIComponent(channel_id)}/threads`);
      return { threads: [...threads].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))).slice(0, limit) };
    },
    async create_group_chat({ name, member_ids }) {
      const members = [...new Set(member_ids)];
      if (members.length < 2) throw new Error('Choose at least two different members.');
      await known(members);
      return { channel: await bridge.post('/api/channels', { name, visibility: 'private', memberIds: members }) };
    },
    async send_channel_message({ channel_id, thread_id, text, member_ids = [] }) {
      const { channel, state } = await channelFor(channel_id);
      const recipients = [...new Set(member_ids)];
      if (recipients.some(id => !channel.memberIds.includes(id))) throw new Error('Every recipient must belong to the channel. Add them with set_channel_members first.');
      await known(recipients);
      if (thread_id && !(state.threads || []).some(thread => thread.id === thread_id && thread.channelId === channel_id)) throw new Error('The thread does not belong to this channel.');
      const profiles = await Promise.all(recipients.map(id => profile(id)));
      if (profiles.some(item => !item.workspace)) throw new Error('Each recipient needs a saved workspace before dispatch.');
      const messageId = `operator-${randomUUID()}`;
      const threadId = thread_id || `thread-${randomUUID()}`;
      const at = new Date().toISOString();
      await bridge.put('/api/channels/sync', {
        ...(!thread_id ? { threads: [{ id: threadId, channelId: channel_id, parentMessageId: messageId, title: text.slice(0, 160), creatorId: 'person', memberIds: channel.memberIds, createdAt: at, updatedAt: at }] } : {}),
        messages: { [channel_id]: [{ id: messageId, role: 'user', body: text, authorName: 'You', threadId, status: 'complete', createdAt: at, updatedAt: at }] },
      });
      const deliveries = await Promise.all(recipients.map(async (memberId, index) => {
        try {
          const run = await bridge.post('/api/runs', { agentId: memberId, prompt: text, workspace: profiles[index].workspace, title: text.slice(0, 120), channel: { channelId: channel_id, channelName: channel.name, threadId, parentMessageId: messageId, operatorReply: true } });
          return { member_id: memberId, run_id: run.id, status: run.status };
        } catch (error) { return { member_id: memberId, status: 'failed', error: String(error.message || error) }; }
      }));
      return { channel_id, thread_id: threadId, message_id: messageId, deliveries, note: recipients.length ? 'Dispatched only the requested members. Check each run receipt; retrying this send creates a new message.' : 'Published without dispatching any member.' };
    },
    list_routines: ({ member_id } = {}) => bridge.get(`/api/routines${member_id ? `?memberId=${encodeURIComponent(member_id)}` : ''}`),
    get_routine: ({ routine_id }) => bridge.get(`/api/routines/${encodeURIComponent(routine_id)}`),
    preview_routine: ({ schedule }) => bridge.post('/api/routines/preview', { schedule }),
    async create_routine({ member_id, ...args }) {
      const current = await profile(member_id);
      return bridge.post('/api/routines', { ...routineBody(args), memberId: member_id, workspace: args.workspace || current.workspace, enabled: args.enabled === true });
    },
    async update_routine({ routine_id, ...args }) {
      if (!Object.keys(args).length) throw new Error('Provide at least one routine setting to change.');
      return bridge.patch(`/api/routines/${encodeURIComponent(routine_id)}`, routineBody(args));
    },
    run_routine: ({ routine_id }) => bridge.post(`/api/routines/${encodeURIComponent(routine_id)}/run`, {}),
  };
}
