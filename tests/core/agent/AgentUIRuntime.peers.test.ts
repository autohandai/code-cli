import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeAgentImmediateShellCommand, handleAgentInkSubmittedInstruction } from '../../../src/core/agent/AgentUIRuntime.js';
import { getCommandCoordination } from '../../../src/session/peers/CommandCoordinationGate.js';
import { ResourceCoordinator } from '../../../src/session/peers/ResourceCoordinator.js';
import { createPeerHarness, type PeerHarness } from '../../../src/testing/scenarios/peerCommunicationHarness.js';

let h: PeerHarness;
beforeEach(async () => { h = await createPeerHarness(); });
afterEach(async () => { await h.close(); });

describe('peer sends at the busy composer dispatch seam', () => {
  it('binds immediate user shell launches to the root resource principal while a model turn is busy', async () => {
    const coordinator = new ResourceCoordinator({ directory: h.home, principal: { peerId: 'root', instanceId: 'root-instance' }, canControl: false });
    const observed: unknown[] = [];
    const host = { isInstructionActive: true, resourceCoordinator: coordinator, inkRenderer: {},
      runtime: { config: {} }, executeImmediateShellCommandForInk: async () => {
        observed.push(getCommandCoordination()?.coordinator.principal);
        return { success: true };
      },
    };
    try {
      await executeAgentImmediateShellCommand(host, 'bun test');
      expect(observed).toEqual([coordinator.principal]);
    } finally { await coordinator.close(); }
  });

  it('sends a leading address immediately without queueing behind the active model turn', async () => {
    const sender = await h.create();
    const receiver = await h.create({ alias: 'builder' });
    const queued = vi.fn();
    const assistant = vi.fn();
    const resolver = vi.fn();
    const host = {
      isInstructionActive: true, peerMessaging: sender,
      parseSlashCommand: () => ({ command: '', args: [] }), handleSlashCommand: vi.fn(),
      executeImmediateShellCommand: vi.fn(), inkInstructionResolver: resolver,
      inkRenderer: { addUserMessage: vi.fn(), addAssistantMessage: assistant, addQueuedInstruction: queued, isRunning: () => true },
    };
    await handleAgentInkSubmittedInstruction(host as unknown as Parameters<typeof handleAgentInkSubmittedInstruction>[0], ':builder keep the current build');
    expect(queued).not.toHaveBeenCalled();
    expect(resolver).not.toHaveBeenCalled();
    expect(assistant).toHaveBeenCalledWith(expect.stringContaining('accepted'));
    expect((await receiver.messages()).messages[0].content).toBe('keep the current build');
  });

  it('keeps an inline peer reference in the ordinary instruction queue', async () => {
    const sender = await h.create();
    const queued = vi.fn();
    const host = {
      isInstructionActive: true, peerMessaging: sender,
      parseSlashCommand: () => ({ command: '', args: [] }), handleSlashCommand: vi.fn(),
      executeImmediateShellCommand: vi.fn(), inkInstructionResolver: null,
      inkRenderer: { addUserMessage: vi.fn(), addAssistantMessage: vi.fn(), addQueuedInstruction: queued, isRunning: () => true },
    };
    await handleAgentInkSubmittedInstruction(host as unknown as Parameters<typeof handleAgentInkSubmittedInstruction>[0], 'Tell :builder the patch is ready');
    expect(queued).toHaveBeenCalledWith('Tell :builder the patch is ready');
  });

  it('delivers a leading address to a local sub-agent run instead of the peer service', async () => {
    const sender = await h.create();
    const send = vi.spyOn(sender, 'send');
    const sendMessage = vi.fn().mockResolvedValue(true);
    const notification = vi.fn();
    const queued = vi.fn();
    const runs = [{ id: 'subagent-1', source: 'delegate', name: 'colon-worker', task: 'Read', status: 'running', startedAt: 0, updatedAt: 0, cancellable: true, messageable: true }];
    const host = {
      isInstructionActive: true, peerMessaging: sender,
      agentRunStore: { getSnapshot: () => ({ runs, updatedAt: 0 }), sendMessage },
      parseSlashCommand: () => ({ command: '', args: [] }), handleSlashCommand: vi.fn(),
      executeImmediateShellCommand: vi.fn(), inkInstructionResolver: null,
      inkRenderer: { addUserMessage: vi.fn(), addAssistantMessage: vi.fn(), addNotification: notification, addQueuedInstruction: queued, isRunning: () => true },
    };
    await handleAgentInkSubmittedInstruction(host as unknown as Parameters<typeof handleAgentInkSubmittedInstruction>[0], ':colon-worker check the fixture');
    expect(sendMessage).toHaveBeenCalledWith('subagent-1', 'check the fixture');
    expect(send).not.toHaveBeenCalled();
    expect(queued).not.toHaveBeenCalled();
    expect(notification).toHaveBeenCalledWith(expect.stringContaining('Message queued for colon-worker'));
  });
});

