/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutohandAgent } from '../../../src/core/agent.js';

const originalDebug = process.env.AUTOHAND_DEBUG;

afterEach(() => {
  if (originalDebug === undefined) {
    delete process.env.AUTOHAND_DEBUG;
  } else {
    process.env.AUTOHAND_DEBUG = originalDebug;
  }
});

function createAgentHarness() {
  const agent = Object.create(AutohandAgent.prototype) as any;
  const memoryManager = {
    store: vi.fn(async (content: string, level: string, tags?: string[]) => ({
      id: 'mem-1',
      content,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tags,
    })),
  };
  const llm = {
    complete: vi.fn(async () => ({
      id: 'resp-1',
      created: Date.now(),
      content: JSON.stringify([
        {
          content: 'User prefers automatic memory updates between turns.',
          level: 'user',
          tags: ['workflow'],
        },
      ]),
      raw: {},
    })),
  };
  const conversation = {
    history: vi.fn(() => [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'please update memories between turns' },
      { role: 'assistant', content: 'I will.' },
    ]),
    addSystemNote: vi.fn(),
  };

  agent.runtime = {
    options: {},
    isCommandMode: false,
    workspaceRoot: '/workspace',
    config: { configPath: '/tmp/config.json', agent: {} },
  };
  agent.llm = llm;
  agent.memoryManager = memoryManager;
  agent.conversation = conversation;
  agent.writeDebugLine = vi.fn();

  return { agent, llm, memoryManager, conversation };
}

describe('turn memory reflection', () => {
  it('stores extracted memories in the background and injects an update for the next turn', async () => {
    const { agent, memoryManager, conversation } = createAgentHarness();

    agent.scheduleTurnMemoryReflection({ status: 'succeeded' });
    await agent.turnMemoryReflectionInFlight;

    expect(memoryManager.store).toHaveBeenCalledWith(
      'User prefers automatic memory updates between turns.',
      'user',
      ['workflow'],
      'turn-reflection',
    );
    expect(conversation.addSystemNote).toHaveBeenCalledWith(
      expect.stringContaining('[Auto Memory Update]'),
      '[Auto Memory Update]',
    );
  });

  it('does not write a success notice into the live terminal after background reflection', async () => {
    const { agent } = createAgentHarness();
    delete process.env.AUTOHAND_DEBUG;

    agent.scheduleTurnMemoryReflection({ status: 'succeeded' });
    await agent.turnMemoryReflectionInFlight;

    expect(agent.writeDebugLine).not.toHaveBeenCalled();
  });

  it('does not write a failure notice into the live terminal unless debug logging is enabled', async () => {
    const { agent, llm } = createAgentHarness();
    llm.complete.mockRejectedValueOnce(new Error('memory unavailable'));
    delete process.env.AUTOHAND_DEBUG;

    agent.scheduleTurnMemoryReflection({ status: 'succeeded' });
    await agent.turnMemoryReflectionInFlight;

    expect(agent.writeDebugLine).not.toHaveBeenCalled();
  });

  it('writes turn memory diagnostics when AUTOHAND_DEBUG is enabled', async () => {
    const { agent } = createAgentHarness();
    process.env.AUTOHAND_DEBUG = '1';

    agent.scheduleTurnMemoryReflection({ status: 'succeeded' });
    await agent.turnMemoryReflectionInFlight;

    expect(agent.writeDebugLine).toHaveBeenCalledWith('[memory] turn reflection saved 1 memory');
  });

  it('does not run when auto-memory is disabled', () => {
    const { agent, llm } = createAgentHarness();
    agent.runtime.config.agent.autoMemory = false;

    agent.scheduleTurnMemoryReflection({ status: 'succeeded' });

    expect(llm.complete).not.toHaveBeenCalled();
    expect(agent.turnMemoryReflectionInFlight).toBeUndefined();
  });

  it('reflects on failed turns with outcome context', async () => {
    const { agent, llm } = createAgentHarness();

    agent.scheduleTurnMemoryReflection({
      status: 'failed',
      category: 'quality',
      reason: 'Quality checks failed',
    });
    await agent.turnMemoryReflectionInFlight;

    const request = llm.complete.mock.calls[0]?.[0];
    expect(request.messages[0].content).toContain('Turn outcome: failed');
    expect(request.messages[0].content).toContain('Failure category: quality');
    expect(request.messages[0].content).toContain('Quality checks failed');
  });

  it('captures an immutable transcript when reflection is scheduled', async () => {
    const { agent, llm, conversation } = createAgentHarness();
    let releaseFirstResponse: (() => void) | undefined;
    llm.complete.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseFirstResponse = resolve;
      });
      return {
        id: 'resp-held',
        created: Date.now(),
        content: '[]',
        raw: {},
      };
    });

    agent.scheduleTurnMemoryReflection({ status: 'succeeded' });
    conversation.history.mockReturnValue([
      { role: 'user', content: 'a later turn that must not leak in' },
    ]);
    releaseFirstResponse?.();
    await agent.turnMemoryReflectionInFlight;

    const request = llm.complete.mock.calls[0]?.[0];
    expect(request.messages).toContainEqual({
      role: 'user',
      content: 'please update memories between turns',
    });
    expect(request.messages).not.toContainEqual({
      role: 'user',
      content: 'a later turn that must not leak in',
    });
  });

  it('processes queued turn snapshots in order', async () => {
    const { agent, llm, conversation } = createAgentHarness();
    let releaseFirstResponse: (() => void) | undefined;
    llm.complete.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseFirstResponse = resolve;
      });
      return {
        id: 'resp-held',
        created: Date.now(),
        content: '[]',
        raw: {},
      };
    });

    agent.scheduleTurnMemoryReflection({ status: 'succeeded' });
    conversation.history.mockReturnValue([
      { role: 'user', content: 'second turn' },
      { role: 'assistant', content: 'second response' },
    ]);
    agent.scheduleTurnMemoryReflection({
      status: 'failed',
      category: 'unexpected',
      reason: 'second failure',
    });
    releaseFirstResponse?.();
    await agent.turnMemoryReflectionInFlight;

    expect(llm.complete).toHaveBeenCalledTimes(2);
    const secondRequest = llm.complete.mock.calls[1]?.[0];
    expect(secondRequest.messages[0].content).toContain('Turn outcome: failed');
    expect(secondRequest.messages).toContainEqual({ role: 'user', content: 'second turn' });
  });
});
