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

    agent.scheduleTurnMemoryReflection(true);
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

    agent.scheduleTurnMemoryReflection(true);
    await agent.turnMemoryReflectionInFlight;

    expect(agent.writeDebugLine).not.toHaveBeenCalled();
  });

  it('does not write a failure notice into the live terminal unless debug logging is enabled', async () => {
    const { agent, llm } = createAgentHarness();
    llm.complete.mockRejectedValueOnce(new Error('memory unavailable'));
    delete process.env.AUTOHAND_DEBUG;

    agent.scheduleTurnMemoryReflection(true);
    await agent.turnMemoryReflectionInFlight;

    expect(agent.writeDebugLine).not.toHaveBeenCalled();
  });

  it('writes turn memory diagnostics when AUTOHAND_DEBUG is enabled', async () => {
    const { agent } = createAgentHarness();
    process.env.AUTOHAND_DEBUG = '1';

    agent.scheduleTurnMemoryReflection(true);
    await agent.turnMemoryReflectionInFlight;

    expect(agent.writeDebugLine).toHaveBeenCalledWith('[memory] turn reflection saved 1 memory');
  });

  it('does not run when auto-memory is disabled', () => {
    const { agent, llm } = createAgentHarness();
    agent.runtime.config.agent.autoMemory = false;

    agent.scheduleTurnMemoryReflection(true);

    expect(llm.complete).not.toHaveBeenCalled();
    expect(agent.turnMemoryReflectionInFlight).toBeUndefined();
  });
});
