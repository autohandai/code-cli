import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { createPeerHarness } from '../../../src/testing/scenarios/peerCommunicationHarness.js';
import { AgentPeerRuntime } from '../../../src/core/agent/AgentPeerRuntime.js';
import { AgentDelegator } from '../../../src/core/agents/AgentDelegator.js';
import { AgentRegistry } from '../../../src/core/agents/AgentRegistry.js';
import { ActionExecutor } from '../../../src/core/actionExecutor.js';
import { FileActionManager } from '../../../src/actions/filesystem.js';
import type { AgentRuntime } from '../../../src/types.js';
import type { LLMProvider } from '../../../src/providers/LLMProvider.js';

afterEach(() => vi.restoreAllMocks());

describe('real delegated peer runtime wiring', () => {
  it.each([true, false])('records exact worker input before its provider request and sends a correlated reply (native=%s)', async nativeToolCalling => {
    const h = await createPeerHarness();
    const sender = await h.create();
    const root = await AgentPeerRuntime.start({
      home: h.home, workspaceRoot: h.workspaceRoot, sessionId: 'delegator-root', policy: { enabled: true },
      appendContext: async () => {}, addContext: () => {}, notify: () => {}, emitOutput: () => {}, requestAutoTurn: async () => {},
    });
    if (!root) throw new Error('Expected enabled runtime');
    let receiptId = '';
    let target = '';
    const requests: Array<Parameters<LLMProvider['complete']>[0]> = [];
    const provider: LLMProvider = {
      getName: () => 'autohandai', getCapabilities: () => ({ nativeToolCalling }),
      listModels: async () => [], isAvailable: async () => true, setModel: () => {},
      complete: async request => {
        requests.push(request);
        if (requests.length > 1) return { content: nativeToolCalling ? 'Done.' : '{"finalResponse":"Done."}' };
        const args = { to: sender.self.peerId, content: 'worker reply', replyTo: receiptId };
        return nativeToolCalling ? { content: '', toolCalls: [{ id: 'reply', type: 'function', function: { name: 'send_peer_message', arguments: JSON.stringify(args) } }] }
          : { content: `[TOOL_CALL]${JSON.stringify({ name: 'send_peer_message', arguments: args })}[/TOOL_CALL]` };
      },
    };
    const registry = AgentRegistry.getInstance();
    vi.spyOn(registry, 'loadAgents').mockResolvedValue(undefined);
    vi.spyOn(registry, 'getAgent').mockReturnValue({ name: 'worker', description: 'Peer worker', systemPrompt: 'Handle the assigned task.', tools: ['send_peer_message', 'peer_messages'], path: '/fixture/worker.md' });
    const executor = new ActionExecutor({ runtime: { workspaceRoot: h.workspaceRoot, config: {}, options: { yes: true } } as AgentRuntime,
      files: new FileActionManager(h.workspaceRoot), resolveWorkspacePath: relative => path.resolve(h.workspaceRoot, relative),
      confirmDangerousAction: async () => true, peerMessaging: () => root.messaging,
    });
    const delegator = new AgentDelegator(provider, executor, {
      workspaceRoot: h.workspaceRoot, maxDepth: 1, projectMemoryEnabled: false,
      confirmApproval: async () => true,
      bindPeerRun: (runId, alias) => root.bindRun(runId, alias),
      onSubagentStart: async context => {
        const peer = (await sender.list()).peers.find(candidate => candidate.runId === context.subagentId);
        if (!peer) throw new Error('Exact worker was not published before start');
        target = peer.peerId;
        receiptId = (await sender.send({ to: target, content: 'Message for this exact worker' })).messageId;
      },
    });
    try {
      const result = await delegator.delegateTaskForTool('worker', 'Reply to the external collaborator.');
      expect(result.success).toBe(true);
      expect(JSON.stringify(requests[0].messages)).toContain('Message for this exact worker');
      const received = (await sender.messages()).messages;
      expect(received).toEqual([expect.objectContaining({ from: target, replyTo: receiptId, content: 'worker reply' })]);
      expect((await root.messaging.messages({ consume: false })).messages).toEqual([]);
      await expect(sender.send({ to: target, content: 'after completion' })).rejects.toMatchObject({ code: 'TARGET_ENDED' });
    } finally { await root.close(); await h.close(); }
  });
});
