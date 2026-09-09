import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { filterToolsByRelevance } from '../../src/core/toolFilter.js';
import path from 'node:path';
import { createPeerHarness, type PeerHarness } from '../../src/testing/scenarios/peerCommunicationHarness.js';
import { ActionExecutor } from '../../src/core/actionExecutor.js';
import { FileActionManager } from '../../src/actions/filesystem.js';
import { ToolManager, DEFAULT_TOOL_DEFINITIONS } from '../../src/core/toolManager.js';
import { ReactionParser } from '../../src/core/agent/ReactionParser.js';
import { SubAgent } from '../../src/core/agents/SubAgent.js';
import type { AgentRuntime, ToolCallRequest } from '../../src/types.js';
import type { PeerClient } from '../../src/session/peers/PeerMessaging.js';
import type { LLMProvider } from '../../src/providers/LLMProvider.js';

let h: PeerHarness;
beforeEach(async () => { h = await createPeerHarness(); });
afterEach(async () => { await h.close(); });

function executor(peerMessaging: PeerClient) {
  return new ActionExecutor({
    runtime: { workspaceRoot: h.workspaceRoot, config: {}, options: { yes: true } } as AgentRuntime,
    files: new FileActionManager(h.workspaceRoot),
    resolveWorkspacePath: relative => path.resolve(h.workspaceRoot, relative),
    confirmDangerousAction: async () => true,
    peerMessaging: () => peerMessaging,
  });
}

function manager(peerMessaging: PeerClient) {
  const actions = executor(peerMessaging);
  return new ToolManager({ executor: (action, context) => actions.executeForTool(action, context), confirmApproval: async () => true });
}

describe('peer tools through the real tool manager and executor', () => {
  it('preserves runtime automatic-turn provenance through tool scheduling', async () => {
    const sender = await h.create();
    const receiver = await h.create();
    const [result] = await manager(sender).execute([{ id: 'automatic-send', tool: 'send_peer_message', args: { to: receiver.self.peerId, content: 'no auto policy' } }], undefined, { peerAutomatic: true });
    expect(result.success).toBe(false);
    expect(result.error).toContain('CAPABILITY_DENIED');
    expect((await receiver.messages()).messages).toEqual([]);
  });

  it('keeps registered peer tools callable at a provider boundary with no peer keywords', () => {
    const tools = new ToolManager({ executor: async () => '', confirmApproval: async () => true });
    const selected = filterToolsByRelevance(tools.toFunctionDefinitions(), [{ role: 'user', content: 'Hello' }], { cache: false });
    expect(selected.map(tool => tool.name)).toEqual(expect.arrayContaining(['list_peers', 'send_peer_message', 'peer_messages', 'coordinate_resource']));
  });

  it('advertises the four implemented operations while classifying send as a side effect', () => {
    for (const name of ['list_peers', 'send_peer_message', 'peer_messages', 'coordinate_resource']) {
      expect(DEFAULT_TOOL_DEFINITIONS.find(definition => definition.name === name)).toBeDefined();
    }
    const send = DEFAULT_TOOL_DEFINITIONS.find(definition => definition.name === 'send_peer_message');
    expect(send?.parameters?.properties).not.toHaveProperty('from');
    expect(send?.parameters?.properties).not.toHaveProperty('endpoint');
  });

  it.each(['native', 'text'] as const)('executes %s peer discovery and send without substituting a prose success', async route => {
    const sender = await h.create();
    const receiver = await h.create();
    const tools = manager(sender);
    const calls: ToolCallRequest[] = [
      { id: 'discover', tool: 'list_peers', args: { scope: 'workspace' } },
      { id: 'send-1', tool: 'send_peer_message', args: { to: receiver.self.peerId, content: 'wired delivery' } },
    ];
    const parsed = route === 'native' ? calls : new ReactionParser().extractLegacyToolCalls(calls.map(call => `[TOOL_CALL]${JSON.stringify({ name: call.tool, arguments: call.args })}[/TOOL_CALL]`).join('\n'));
    const results = await tools.execute(parsed);
    expect(results).toHaveLength(2);
    expect(results.every(result => result.success)).toBe(true);
    expect(results[0].output).toContain(receiver.self.peerId);
    expect(results[1].output).toContain('accepted');
    expect((await receiver.messages()).messages[0].content).toBe('wired delivery');
  });

  it('reuses a tool-call message ID on retry and records only one delivery', async () => {
    const sender = await h.create();
    const receiver = await h.create();
    const tools = manager(sender);
    const call: ToolCallRequest = { id: 'stable-origin-tool-call', tool: 'send_peer_message', args: { to: receiver.self.peerId, content: 'retry-safe' } };
    await tools.execute([call]);
    await tools.execute([call]);
    expect((await receiver.messages()).messages).toHaveLength(1);
  });

  it('returns receiver refusal as a failed tool result', async () => {
    const sender = await h.create();
    const receiver = await h.create({ limits: { inboxMessages: 1 } });
    const tools = manager(sender);
    await sender.send({ to: receiver.self.peerId, content: 'already full' });
    const [result] = await tools.execute([{ id: 'refused', tool: 'send_peer_message', args: { to: receiver.self.peerId, content: 'overflow' } }]);
    expect(result.success).toBe(false);
    expect(`${result.error} ${result.output}`).toContain('QUEUE_FULL');
    expect(result.output ?? '').not.toMatch(/Message sent|state.*accepted/);
  });

  it('rejects model-supplied sender and endpoint fields before side effects', async () => {
    const sender = await h.create();
    const receiver = await h.create();
    const [result] = await manager(sender).execute([{ id: 'forged', tool: 'send_peer_message', args: { to: receiver.self.peerId, content: 'spoof', from: receiver.self.peerId, endpoint: '/tmp/unsafe' } }]);
    expect(result.success).toBe(false);
    expect((await receiver.messages()).messages).toEqual([]);
  });

  it('makes an inbox read consume only the owning principal’s content', async () => {
    const sender = await h.create();
    const receiver = await h.create();
    const receipt = await sender.send({ to: receiver.self.peerId, content: 'read via tool' });
    const [result] = await manager(receiver).execute([{ id: 'inbox-read', tool: 'peer_messages', args: {} }]);
    expect(result.success).toBe(true);
    expect(result.output).toContain('read via tool');
    expect(await sender.status(receipt.messageId)).toMatchObject({ state: 'consumed' });
  });

  it('validates resource operations as a discriminated contract', async () => {
    const root = await h.create();
    const tools = manager(root);
    for (const args of [
      { operation: 'grant' },
      { operation: 'request', resource: 'machine/build' },
      { operation: 'set_controller', resource: 'machine/build', controller: root.self.peerId },
      { operation: 'delete_everything' },
    ]) {
      const [result] = await tools.execute([{ tool: 'coordinate_resource', args }]);
      expect(result.success).toBe(false);
      expect(result.kind).toBe('validation');
    }
  });
});

describe('worker-originated peer tools', () => {
  it.each([true, false])('delivers a child model message with its bound identity (native=%s)', async nativeToolCalling => {
    const root = await h.create();
    const recipient = await h.create();
    const child = root.bindRun({ runId: 'worker-run', alias: 'writer', capabilities: ['message.send', 'message.receive', 'message.wait'] });
    const requests: Array<Parameters<LLMProvider['complete']>[0]> = [];
    const args = { to: recipient.self.peerId, content: 'from the worker model' };
    const llm: LLMProvider = {
      getName: () => 'autohandai', getCapabilities: () => ({ nativeToolCalling }),
      listModels: async () => [], isAvailable: async () => true, setModel: () => {},
      complete: async request => {
        requests.push(request);
        if (requests.length > 1) return { content: nativeToolCalling ? 'Done.' : '{"finalResponse":"Done."}' };
        return nativeToolCalling
          ? { content: '', toolCalls: [{ id: 'worker-send', type: 'function', function: { name: 'send_peer_message', arguments: JSON.stringify(args) } }] }
          : { content: `[TOOL_CALL]${JSON.stringify({ name: 'send_peer_message', arguments: args })}[/TOOL_CALL]` };
      },
    };
    const agent = new SubAgent({ name: 'writer', description: 'Coordinate implementation', systemPrompt: 'Follow the user task.', tools: ['send_peer_message', 'peer_messages'], path: '/fixture/writer.md' }, llm, executor(root), {
      clientContext: 'cli', depth: 1, maxDepth: 1, workspaceRoot: h.workspaceRoot,
      peerMessaging: child, confirmApproval: async () => true,
    });
    await expect(agent.run('Send the agreed update.')).resolves.toBe('Done.');
    const message = (await recipient.messages()).messages[0];
    expect(message).toMatchObject({ from: child.self.peerId, senderRunId: 'worker-run', content: args.content });
    expect(JSON.stringify(requests[0])).toContain('send_peer_message');
    expect(JSON.stringify(requests)).not.toContain('BEGIN PRIVATE');
  });

  it('omits writable peer tools when a child does not inherit send capability', async () => {
    const root = await h.create();
    const child = root.bindRun({ runId: 'reader', alias: 'reader', capabilities: ['message.receive'] });
    const complete = vi.fn<LLMProvider['complete']>(async () => ({ content: 'Read only.' }));
    const llm: LLMProvider = { getName: () => 'autohandai', getCapabilities: () => ({ nativeToolCalling: true }), complete, listModels: async () => [], isAvailable: async () => true, setModel: () => {} };
    const agent = new SubAgent({ name: 'reader', description: 'Read', systemPrompt: 'Read.', tools: ['*'], path: '/fixture/reader.md' }, llm, executor(root), {
      clientContext: 'cli', depth: 1, maxDepth: 1, workspaceRoot: h.workspaceRoot, peerMessaging: child,
    });
    await agent.run('Read the task.');
    expect(complete.mock.calls[0][0].tools?.map(tool => tool.name)).not.toContain('send_peer_message');
    expect(complete.mock.calls[0][0].tools?.map(tool => tool.name)).not.toContain('coordinate_resource');
  });
});
