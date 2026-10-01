import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import path from 'node:path';

let theme;
let starts = 0;
const tools = [
  { name: 'start_session', inputSchema: { type: 'object', properties: { session: { type: 'string' }, cursor_theme: { type: 'object' } } } },
  { name: 'end_session', inputSchema: { type: 'object', properties: { session: { type: 'string' } } } },
  { name: 'get_agent_cursor_state', inputSchema: { type: 'object', properties: {} } },
];
createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result = {};
  if (request.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'computer-use-fixture', version: '1' } };
  if (request.method === 'tools/list') result = { tools };
  if (request.method === 'tools/call') {
    const { name, arguments: args } = request.params;
    if (name === 'start_session') {
      theme = args.cursor_theme?.theme_id;
      starts++;
      if (process.env.CUA_TEST_REJECT_START === '1' && starts === 1) {
        result = { isError: true, content: [{ type: 'text', text: 'Fixture initialization failed' }] };
      } else if (theme === 'autohand.light-gray' && !existsSync(path.join(process.env.CUA_DRIVER_CURSOR_THEME_DIR, `${theme}.cua-theme`))) {
        result = { isError: true, content: [{ type: 'text', text: 'Theme is not installed' }] };
      } else result = { structuredContent: { session: args.session ?? 'implicit' } };
    } else if (name === 'end_session') theme = undefined;
    else result = { structuredContent: { theme: theme ?? 'default', starts } };
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
});
