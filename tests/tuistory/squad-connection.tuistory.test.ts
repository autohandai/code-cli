import { createServer } from 'node:http';
import type { Session } from 'tuistory';
import { expect, it } from 'vitest';
import { createTempAutohandHome, exitInteractive, launchBuiltAutohand } from './helpers/autohandTuistory.js';
import { invokeBuiltinSquadMcp, selectSquadAgentAndMessage } from '../../src/testing/scenarios/squadConnectionScenario.js';

it.each([false, true])('selects a desktop agent, sends and reads messages, and calls the built-in MCP (full screen: %s)', async fullScreenMode => {
  const messages: unknown[] = [];
  let modelCalls = 0;
  const advertisedTools = new Set<string>();
  let squadToolReply = false;
  let squadDiscovered = false;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://localhost');
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown> : {};
    let data: unknown;
    if (url.pathname === '/chat/completions') {
      modelCalls++;
      for (const tool of body.tools as Array<{ function?: { name?: string } }> || []) if (tool.function?.name) advertisedTools.add(tool.function.name);
      squadToolReply ||= (body.messages as Array<{ role?: string; content?: string }> || []).some(message => message.role === 'tool' && message.content?.includes('Kai'));
      squadDiscovered ||= (body.messages as Array<{ role?: string; content?: string }> || []).some(message => message.role === 'tool' && message.content?.includes('mcp__autohand-squad__list_members'));
      response.writeHead(200, { 'content-type': 'application/json' });
      const tool = modelCalls === 1 ? { name: 'tool_search', arguments: JSON.stringify({ query: 'mcp__autohand-squad__list_members' }) } : { name: 'run_tool_script', arguments: JSON.stringify({ script: 'return await tools["mcp__autohand-squad__list_members"]({});', description: 'List Squad agents' }) };
      response.end(JSON.stringify({ id: 'squad-fixture', created: 1, choices: [{ index: 0, finish_reason: modelCalls < 3 ? 'tool_calls' : 'stop', message: { role: 'assistant', content: modelCalls < 3 ? '' : 'BUILTIN_SQUAD_MCP_VERIFIED', ...(modelCalls < 3 ? { tool_calls: [{ id: `list-squad-${modelCalls}`, type: 'function', function: tool }] } : {}) } }], usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 } }));
      return;
    }
    if (url.pathname === '/api/status/snapshot') data = { members: [{ id: 'kai', name: 'Kai', role: 'Engineer' }] };
    else if (url.pathname === '/api/members/presence') data = { presence: { kai: { state: 'working' } } };
    else if (url.pathname === '/api/runs' || url.pathname === '/api/goals') data = [];
    else if (url.pathname === '/api/channels') data = { agentChannelAccess: { kai: { agent: { id: 'kai', name: 'Kai', role: 'Engineer', workspace: '/fixture/member-project' } } } };
    else if (url.pathname === '/api/queues/kai/items' && request.method === 'POST') { messages.push(body); data = { id: 'receipt-1', status: 'queued' }; }
    else if (url.pathname === '/api/queues/kai') data = { items: [], paused: false };
    else if (url.pathname === '/api/members/kai/transcript') data = { messages: [{ role: 'agent', body: 'SQUAD_DIRECT_REPLY' }], live: false };
    else { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ success: true, data }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server unavailable');
  const origin = `http://127.0.0.1:${address.port}`;
  const state = await createTempAutohandHome({ config: { openrouter: { baseUrl: origin, model: 'openai/gpt-4o-mini' }, mcp: { enabled: true, servers: [] }, agent: { autoMemory: false, maxIterations: 4 }, ui: { promptSuggestions: false }, features: { automaticSpecialists: false, fullScreenMode } } });
  let session: Session | undefined;
  try {
    const binary = process.env.AUTOHAND_SQUAD_TEST_BINARY;
    session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '--yes'], { ...(binary ? { runtimeCommand: binary, entrypoint: null } : {}), autohandHome: state.autohandHome, cwd: state.workspaceRoot, cols: 120, rows: 30, env: { AUTOHAND_DISABLE_SQUAD: '0', AUTOHAND_SQUAD_BRIDGE_URL: origin, AUTOHAND_SQUAD_TEAM_TOKEN: undefined, AUTOHAND_SQUAD_TEAM_URL: undefined, AUTOHAND_SQUAD_MEMBER: undefined } });
    await session.waitForText('❯', { timeout: 20000 });
    const frame = await selectSquadAgentAndMessage(session);
    expect(frame).toContain('SQUAD_DIRECT_REPLY');
    expect(messages).toEqual([{ text: 'Review the CLI fixture', workspace: '/fixture/member-project' }]);
    await invokeBuiltinSquadMcp(session);
    expect([...advertisedTools]).toContain('tool_search');
    expect(squadDiscovered).toBe(true);
    expect(squadToolReply).toBe(true);
    expect(modelCalls).toBe(3);
    await exitInteractive(session);
  } finally {
    session?.close();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await state.cleanup();
  }
}, 90000);
