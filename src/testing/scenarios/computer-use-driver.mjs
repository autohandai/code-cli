import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import path from 'node:path';

let theme;
let starts = 0;
let motionCalls = 0;
const sessions = new Map();
const calls = [];
const motionMode = process.env.CUA_TEST_CURSOR_MOTION;
const tools = [
  { name: 'start_session', inputSchema: { type: 'object', properties: { session: { type: 'string' }, cursor_theme: { type: 'object' },
    ...(motionMode === 'modern' ? { cursor_motion: { type: 'object' } } : {}) } } },
  { name: 'end_session', inputSchema: { type: 'object', properties: { session: { type: 'string' } } } },
  { name: 'get_agent_cursor_state', inputSchema: { type: 'object', properties: {} } },
];
if (motionMode === 'legacy' || motionMode === 'modern') {
  tools.push({ name: 'set_agent_cursor_motion', inputSchema: { type: 'object', properties: {
    session: { type: 'string' }, glide_duration_ms: { type: 'number', minimum: 0, maximum: 5000 },
  } } });
}
tools.push({ name: 'move_cursor', inputSchema: { type: 'object', properties: { session: { type: 'string' } } } });
tools.push({ name: 'get_cursor_fixture_state', inputSchema: { type: 'object', properties: { session: { type: 'string' } } } });
createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result = {};
  if (request.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'computer-use-fixture', version: '1' } };
  if (request.method === 'tools/list') result = { tools };
  if (request.method === 'tools/call') {
    const { name, arguments: args } = request.params;
    const session = args.session ?? 'implicit';
    calls.push({ name, session });
    if (calls.length > 256) calls.shift();
    if (name === 'start_session') {
      theme = args.cursor_theme?.theme_id;
      starts++;
      if (process.env.CUA_TEST_REJECT_START === '1' && starts === 1) {
        result = { isError: true, content: [{ type: 'text', text: 'Fixture initialization failed' }] };
      } else if (theme === 'autohand.light-gray' && !existsSync(path.join(process.env.CUA_DRIVER_CURSOR_THEME_DIR, `${theme}.cua-theme`))) {
        result = { isError: true, content: [{ type: 'text', text: 'Theme is not installed' }] };
      } else {
        sessions.set(session, { theme, motion: args.cursor_motion ?? null });
        result = { structuredContent: { session } };
      }
    } else if (name === 'set_agent_cursor_motion') {
      motionCalls++;
      if (process.env.CUA_TEST_REJECT_MOTION === '1' && motionCalls === 1) {
        result = { isError: true, content: [{ type: 'text', text: 'Fixture motion failed' }] };
      } else {
        const state = sessions.get(session) ?? { theme: 'default', motion: null };
        state.motion = { glide_duration_ms: args.glide_duration_ms };
        sessions.set(session, state);
      }
    } else if (name === 'end_session') {
      theme = undefined;
      sessions.delete(session);
    } else if (name === 'get_cursor_fixture_state' || name === 'move_cursor') {
      result = { structuredContent: { ...sessions.get(session), starts, motionCalls, calls } };
    }
    else result = { structuredContent: { theme: theme ?? 'default', starts } };
  }
  const reply = () => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
  if (request.method === 'tools/call' && request.params.name === 'start_session' && process.env.CUA_TEST_START_DELAY_MS) {
    setTimeout(reply, Number(process.env.CUA_TEST_START_DELAY_MS));
  } else reply();
});
