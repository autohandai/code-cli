/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutohandAgent } from '../../../src/core/agent.js';
import { MemoryManager } from '../../../src/memory/MemoryManager.js';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';

const originalDebug = process.env.AUTOHAND_DEBUG;
const temporaryRoots: string[] = [];

afterEach(async () => {
  if (originalDebug === undefined) {
    delete process.env.AUTOHAND_DEBUG;
  } else {
    process.env.AUTOHAND_DEBUG = originalDebug;
  }
  await Promise.all(temporaryRoots.splice(0).map(root => fs.remove(root)));
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
  it.each(['account', 'workspace'])('does not publish delayed project reflection after a %s switch while preserving personal memories', async switchKind => {
    const { agent, llm } = createAgentHarness();
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-reflection-scope-'));
    temporaryRoots.push(workspaceRoot);
    let account = 'team-a';
    const published: string[] = [];
    const manager = new MemoryManager(workspaceRoot, {
      userMemoryDir: path.join(workspaceRoot, 'private-memory'),
      projectMemory: {
        refresh: async () => {},
        directory: workspace => path.join(workspace, account),
        scope: () => account,
        assertWritable: () => {},
        publish: async () => { published.push(account); },
      },
    });
    await manager.initialize();
    agent.memoryManager = manager;
    agent.runtime.workspaceRoot = workspaceRoot;
    let releaseResponse: (() => void) | undefined;
    llm.complete.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { releaseResponse = resolve; });
      return {
        id: 'delayed-reflection', created: Date.now(), raw: {},
        content: JSON.stringify([
          { content: 'Project A requires its own test convention', level: 'project', tags: ['testing'] },
          { content: 'The user prefers concise progress updates', level: 'user', tags: ['workflow'] },
        ]),
      };
    });
    agent.scheduleTurnMemoryReflection({ status: 'succeeded' });
    if (switchKind === 'account') {
      account = 'team-b';
    } else {
      const nextWorkspace = path.join(workspaceRoot, 'project-b');
      manager.setWorkspace(nextWorkspace);
      agent.runtime.workspaceRoot = nextWorkspace;
    }
    releaseResponse?.();
    await agent.turnMemoryReflectionInFlight;

    expect(await manager.list('project')).toEqual([]);
    expect(published).toEqual([]);
    expect((await manager.list('user')).map(entry => entry.content)).toEqual(['The user prefers concise progress updates']);
    expect(agent.conversation.addSystemNote).toHaveBeenCalledWith(expect.not.stringContaining('Project A requires'), '[Auto Memory Update]');
  });

  it('passes captured project scope only to project stores and marks their update notes', async () => {
    const { agent, llm, memoryManager, conversation } = createAgentHarness();
    agent.memoryManager.getProjectMemoryScope = () => 'same-account-project-scope';
    let shared = true;
    agent.memoryManager.hasSharedProjectMemory = () => shared;
    agent.sessionManager = { getCurrentSession: () => ({ metadata: { sessionId: 'origin-session' } }) };
    llm.complete.mockResolvedValueOnce({
      id: 'scoped-response', created: Date.now(), raw: {},
      content: JSON.stringify([
        { content: 'Project uses focused Vitest suites', level: 'project', tags: ['testing'] },
        { content: 'User prefers concise explanations', level: 'user', tags: ['workflow'] },
      ]),
    });
    agent.scheduleTurnMemoryReflection({ status: 'succeeded' });
    shared = false;
    await agent.turnMemoryReflectionInFlight;

    expect(memoryManager.store).toHaveBeenCalledWith('Project uses focused Vitest suites', 'project', ['testing'], 'turn-reflection', { sessionId: 'origin-session' }, 'same-account-project-scope');
    expect(memoryManager.store).toHaveBeenCalledWith('User prefers concise explanations', 'user', ['workflow'], 'turn-reflection', { sessionId: 'origin-session' });
    const note = String(conversation.addSystemNote.mock.calls[0]?.[0]);
    expect(note).toContain('<autohand_shared_project_memory>\n- project: Project uses focused Vitest suites\n</autohand_shared_project_memory>');
    expect(note.split('</autohand_shared_project_memory>')[1]).toContain('- user: User prefers concise explanations');
  });

  it('keeps local project reflection notes outside shared markers', async () => {
    const { agent, llm, conversation } = createAgentHarness();
    agent.memoryManager.getProjectMemoryScope = () => 'local-project-scope';
    agent.memoryManager.hasSharedProjectMemory = () => false;
    llm.complete.mockResolvedValueOnce({
      id: 'local-response', created: Date.now(), raw: {},
      content: JSON.stringify([{ content: 'Local project uses Vitest', level: 'project', tags: [] }]),
    });
    agent.scheduleTurnMemoryReflection({ status: 'succeeded' });
    await agent.turnMemoryReflectionInFlight;
    const note = String(conversation.addSystemNote.mock.calls[0]?.[0]);
    expect(note).toContain('- project: Local project uses Vitest');
    expect(note).not.toContain('<autohand_shared_project_memory>');
  });

  it('keeps the originating session when reflection finishes after a session switch', async () => {
    const { agent, memoryManager } = createAgentHarness();
    let sessionId = 'original-session';
    agent.sessionManager = { getCurrentSession: () => ({ metadata: { sessionId } }) };
    agent.scheduleTurnMemoryReflection({ status: 'succeeded' });
    sessionId = 'new-session';
    await agent.turnMemoryReflectionInFlight;
    expect(memoryManager.store).toHaveBeenCalledWith(
      'User prefers automatic memory updates between turns.', 'user', ['workflow'], 'turn-reflection', { sessionId: 'original-session' },
    );
  });
  it('stores extracted memories in the background and injects an update for the next turn', async () => {
    const { agent, memoryManager, conversation } = createAgentHarness();

    agent.scheduleTurnMemoryReflection({ status: 'succeeded' });
    await agent.turnMemoryReflectionInFlight;

    expect(memoryManager.store).toHaveBeenCalledWith(
      'User prefers automatic memory updates between turns.',
      'user',
      ['workflow'],
      'turn-reflection',
      null,
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

  it('cancels in-flight and queued reflections before a fresh session reset', async () => {
    const { agent, llm, memoryManager, conversation } = createAgentHarness();
    let releaseResponse: (() => void) | undefined;
    llm.complete.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseResponse = resolve;
      });
      return {
        id: 'resp-held',
        created: Date.now(),
        content: JSON.stringify([
          {
            content: 'This old-session memory must not enter the fresh conversation.',
            level: 'user',
            tags: ['stale'],
          },
        ]),
        raw: {},
      };
    });

    agent.scheduleTurnMemoryReflection({ status: 'succeeded' });
    agent.scheduleTurnMemoryReflection({ status: 'succeeded' });
    const reflection = agent.turnMemoryReflectionInFlight as Promise<void>;
    expect(agent.turnMemoryReflectionQueue).toHaveLength(1);

    agent.cancelPendingTurnMemoryReflections();
    expect(agent.turnMemoryReflectionQueue).toEqual([]);

    releaseResponse?.();
    await reflection;

    expect(memoryManager.store).not.toHaveBeenCalled();
    expect(conversation.addSystemNote).not.toHaveBeenCalled();
    expect(llm.complete).toHaveBeenCalledOnce();
  });
});
