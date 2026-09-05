/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentDelegator } from '../../../src/core/agents/AgentDelegator.js';
import { AgentRegistry } from '../../../src/core/agents/AgentRegistry.js';
import type { ActionExecutor } from '../../../src/core/actionExecutor.js';
import type { LLMProvider } from '../../../src/providers/LLMProvider.js';
import type { TeamModelAssignment } from '../../../src/core/teams/TeamModelPolicy.js';
import { SessionThreadBudget } from '../../../src/core/agents/SessionThreadBudget.js';

function createDelegator(): AgentDelegator {
  return new AgentDelegator(
    { complete: vi.fn() } as unknown as LLMProvider,
    { executeForTool: vi.fn() } as unknown as ActionExecutor,
  );
}

describe('AgentDelegator typed outcomes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a cancelled outcome when the parent aborts a native subagent', async () => {
    const registry = AgentRegistry.getInstance();
    vi.spyOn(registry, 'loadAgents').mockResolvedValue();
    vi.spyOn(registry, 'getAgent').mockReturnValue({
      name: 'reader', description: 'Reader', systemPrompt: 'Read source.',
      tools: ['read_file'], path: '/tmp/reader.md',
    });
    const controller = new AbortController();
    const onSubagentStop = vi.fn();
    const delegator = new AgentDelegator({
      getName: () => 'autohandai',
      complete: async () => { controller.abort(); return { content: 'Late answer.' }; },
      getCapabilities: () => ({ nativeToolCalling: true }),
      listModels: async () => [], isAvailable: async () => true, setModel: () => {},
    }, { executeForTool: vi.fn() } as unknown as ActionExecutor, { onSubagentStop });

    await expect(delegator.delegateTaskForTool('reader', 'Read source.', { signal: controller.signal }))
      .resolves.toMatchObject({ success: false, kind: 'aborted' });
    expect(onSubagentStop).toHaveBeenCalledWith(expect.objectContaining({
      success: false, status: 'cancelled',
    }));
  });

  it('shares the session thread limit across independent calls and releases a finished child', async () => {
    const registry = AgentRegistry.getInstance();
    vi.spyOn(registry, 'loadAgents').mockResolvedValue();
    vi.spyOn(registry, 'getAgent').mockReturnValue({
      name: 'reader', description: 'Reader', systemPrompt: 'Read source.',
      tools: ['read_file'], path: '/tmp/reader.md',
    });
    const budget = new SessionThreadBudget(() => 2);
    const pending = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const complete = vi.fn(async () => {
      started.resolve();
      await pending.promise;
      return { content: 'Read complete.' };
    });
    const delegator = new AgentDelegator({
      getName: () => 'autohandai', complete,
      getCapabilities: () => ({ nativeToolCalling: true }),
      listModels: async () => [], isAvailable: async () => true, setModel: () => {},
    }, { executeForTool: vi.fn() } as unknown as ActionExecutor, { threadBudget: budget });

    const first = delegator.delegateTaskForTool('reader', 'First task');
    await started.promise;
    const rejected = delegator.delegateTaskForTool('reader', 'Excess task');
    pending.resolve();
    await expect(rejected).resolves.toMatchObject({ success: false, kind: 'validation' });
    await expect(first).resolves.toMatchObject({ success: true });
    await expect(delegator.delegateTaskForTool('reader', 'Next task')).resolves.toMatchObject({ success: true });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(budget.activeChildren).toBe(0);
  });

  it('runs eight parallel children within the default nine-thread session', async () => {
    const registry = AgentRegistry.getInstance();
    vi.spyOn(registry, 'loadAgents').mockResolvedValue();
    vi.spyOn(registry, 'getAgent').mockReturnValue({
      name: 'reader', description: 'Reader', systemPrompt: 'Read source.',
      tools: ['read_file'], path: '/tmp/reader.md',
    });
    const budget = new SessionThreadBudget();
    let peakChildren = 0;
    const complete = vi.fn(async () => {
      peakChildren = Math.max(peakChildren, budget.activeChildren);
      return { content: 'Verified.' };
    });
    const delegator = new AgentDelegator({
      getName: () => 'autohandai', complete,
      getCapabilities: () => ({ nativeToolCalling: true }),
      listModels: async () => [], isAvailable: async () => true, setModel: () => {},
    }, { executeForTool: vi.fn() } as unknown as ActionExecutor, { threadBudget: budget });

    await expect(delegator.delegateParallelForTool(Array.from({ length: 8 }, (_, index) => ({
      agent_name: 'reader', task: `Read independent file ${index}`,
    })))).resolves.toMatchObject({ success: true });
    expect(complete).toHaveBeenCalledTimes(8);
    expect(peakChildren).toBe(8);
    expect(budget.activeChildren).toBe(0);
  });

  it('preserves a live lease and delegation options when replacing the provider', async () => {
    const registry = AgentRegistry.getInstance();
    vi.spyOn(registry, 'loadAgents').mockResolvedValue();
    vi.spyOn(registry, 'getAgent').mockReturnValue({
      name: 'reader', description: 'Reader', systemPrompt: 'Read source.',
      tools: ['read_file'], path: '/tmp/reader.md',
    });
    const started = Promise.withResolvers<void>();
    const pending = Promise.withResolvers<void>();
    const budget = new SessionThreadBudget(() => 2);
    const onSubagentStart = vi.fn();
    const onSubagentStop = vi.fn();
    const onSubagentProgress = vi.fn();
    const authorization = {};
    const confirmApproval = vi.fn(async () => false);
    const getToolDefinitions = () => [];
    const provider: LLMProvider = {
      getName: () => 'autohandai', getCapabilities: () => ({ nativeToolCalling: true }),
      listModels: async () => [], isAvailable: async () => true, setModel: () => {},
      complete: async () => {
        started.resolve();
        await pending.promise;
        return { id: 'before', created: 0, raw: null, content: 'Before switch.' };
      },
    };
    const previous = new AgentDelegator(provider, {} as ActionExecutor, {
      threadBudget: budget, onSubagentStart, onSubagentStop, onSubagentProgress,
      authorization, confirmApproval, getToolDefinitions, currentDepth: 1, maxDepth: 2,
    });
    const first = previous.delegateTaskForTool('reader', 'First task');
    await started.promise;
    const changed = previous.withProvider({ ...provider, complete: async () => ({
      id: 'after', created: 0, raw: null, content: 'After switch.',
    }) });
    await expect(changed.delegateTaskForTool('reader', 'Excess task'))
      .resolves.toMatchObject({ success: false, kind: 'validation' });
    pending.resolve();
    await expect(first).resolves.toMatchObject({ success: true, output: 'Before switch.' });
    await expect(changed.delegateTaskForTool('reader', 'Next task'))
      .resolves.toMatchObject({ success: true, output: 'After switch.' });
    expect(changed.getAuthorizationOptions()).toBe(authorization);
    expect(changed.getConfirmApproval()).toBe(confirmApproval);
    expect(changed.getRuntimeToolDefinitions()).toBe(getToolDefinitions);
    expect(changed.getDepth()).toBe(1);
    expect(onSubagentStart).toHaveBeenCalledTimes(2);
    expect(onSubagentStop).toHaveBeenCalledTimes(2);
    expect(onSubagentProgress).toHaveBeenCalled();
    expect(budget.activeChildren).toBe(0);
  });

  it('releases the lease and reports failure when isolated provider construction fails', async () => {
    const registry = AgentRegistry.getInstance();
    vi.spyOn(registry, 'loadAgents').mockResolvedValue();
    vi.spyOn(registry, 'getAgent').mockReturnValue({
      name: 'reader', description: 'Reader', systemPrompt: 'Read source.',
      tools: ['read_file'], path: '/tmp/reader.md',
    });
    const budget = new SessionThreadBudget(() => 2);
    const onSubagentStop = vi.fn();
    const delegator = new AgentDelegator({} as LLMProvider, {} as ActionExecutor, {
      threadBudget: budget, onSubagentStop,
      resolveSubagentAssignment: () => ({ provider: 'autohandai', model: 'moa', source: 'active-session' }),
      createSubagentProvider: () => { throw new Error('Provider unavailable'); },
    });
    await expect(delegator.delegateTaskForTool('reader', 'Read source.')).resolves.toMatchObject({
      success: false, kind: 'operational', error: 'Provider unavailable',
    });
    expect(onSubagentStop).toHaveBeenCalledOnce();
    expect(onSubagentStop).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
    expect(budget.activeChildren).toBe(0);
  });

  it('keeps nested children in the same budget and observable parent hierarchy', async () => {
    const registry = AgentRegistry.getInstance();
    vi.spyOn(registry, 'loadAgents').mockResolvedValue();
    vi.spyOn(registry, 'getAgent').mockReturnValue({
      name: 'reader', description: 'Reader', systemPrompt: 'Read source.',
      tools: ['read_file'], path: '/tmp/reader.md',
    });
    const budget = new SessionThreadBudget(() => 3);
    const onSubagentStart = vi.fn();
    const onSubagentStop = vi.fn();
    let peakChildren = 0;
    const delegator = new AgentDelegator({
      getName: () => 'autohandai',
      complete: async (request) => {
        peakChildren = Math.max(peakChildren, budget.activeChildren);
        if (request.messages.some(message => message.role === 'tool')) return { content: 'Parent finished.' };
        if (request.messages.at(-1)?.content === 'Child work') return { content: 'Child finished.' };
        return { content: '', toolCalls: [{ id: 'delegate-child', type: 'function', function: {
          name: 'delegate_task', arguments: JSON.stringify({ agent_name: 'reader', task: 'Child work' }),
        } }] };
      },
      getCapabilities: () => ({ nativeToolCalling: true }),
      listModels: async () => [], isAvailable: async () => true, setModel: () => {},
    }, { executeForTool: vi.fn() } as unknown as ActionExecutor, {
      threadBudget: budget, onSubagentStart, onSubagentStop,
    });

    await expect(delegator.delegateTaskForTool('reader', 'Parent work')).resolves.toMatchObject({ success: true });
    expect(onSubagentStart).toHaveBeenCalledTimes(2);
    expect(onSubagentStart.mock.calls[1]?.[0]).toMatchObject({
      parentId: onSubagentStart.mock.calls[0]?.[0].subagentId, depth: 2,
    });
    expect(onSubagentStop).toHaveBeenCalledTimes(2);
    expect(peakChildren).toBe(2);
    expect(budget.activeChildren).toBe(0);
  });

  it('lets the live run observer cancel a child before it calls the provider', async () => {
    const registry = AgentRegistry.getInstance();
    vi.spyOn(registry, 'loadAgents').mockResolvedValue();
    vi.spyOn(registry, 'getAgent').mockReturnValue({
      name: 'reader', description: 'Reader', systemPrompt: 'Read source.',
      tools: ['read_file'], path: '/tmp/reader.md',
    });
    const complete = vi.fn(async () => ({ content: 'Must not execute.' }));
    const budget = new SessionThreadBudget(() => 2);
    const delegator = new AgentDelegator({
      getName: () => 'autohandai', complete,
      getCapabilities: () => ({ nativeToolCalling: true }),
      listModels: async () => [], isAvailable: async () => true, setModel: () => {},
    }, { executeForTool: vi.fn() } as unknown as ActionExecutor, {
      threadBudget: budget,
      onSubagentStart: async context => { context.cancel?.(); },
    });

    await expect(delegator.delegateTaskForTool('reader', 'Read source.'))
      .resolves.toMatchObject({ success: false, kind: 'aborted' });
    expect(complete).not.toHaveBeenCalled();
    expect(budget.activeChildren).toBe(0);
  });

  it('returns child output and usage to the same live run observers', async () => {
    const registry = AgentRegistry.getInstance();
    vi.spyOn(registry, 'loadAgents').mockResolvedValue();
    vi.spyOn(registry, 'getAgent').mockReturnValue({
      name: 'reader', description: 'Reader', systemPrompt: 'Read source.',
      tools: ['read_file'], path: '/tmp/reader.md',
    });
    const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };
    const onSubagentProgress = vi.fn();
    const onSubagentStop = vi.fn();
    const delegator = new AgentDelegator({
      getName: () => 'autohandai', complete: vi.fn(async () => ({ content: 'Read verified.', usage })),
      getCapabilities: () => ({ nativeToolCalling: true }),
      listModels: async () => [], isAvailable: async () => true, setModel: () => {},
    }, { executeForTool: vi.fn() } as unknown as ActionExecutor, { onSubagentProgress, onSubagentStop });

    await delegator.delegateTaskForTool('reader', 'Read source.');
    expect(onSubagentProgress).toHaveBeenLastCalledWith(expect.objectContaining({ usage }));
    expect(onSubagentStop).toHaveBeenCalledWith(expect.objectContaining({ result: 'Read verified.', usage }));
  });

  it('keeps sibling outcomes intact when a lifecycle observer fails', async () => {
    const registry = AgentRegistry.getInstance();
    vi.spyOn(registry, 'loadAgents').mockResolvedValue();
    vi.spyOn(registry, 'getAgent').mockReturnValue({
      name: 'reader', description: 'Reader', systemPrompt: 'Read source.',
      tools: ['read_file'], path: '/tmp/reader.md',
    });
    const onSubagentStop = vi.fn(async () => { throw new Error('Observer disconnected.'); });
    const budget = new SessionThreadBudget();
    const delegator = new AgentDelegator({
      getName: () => 'autohandai', complete: vi.fn(async () => ({ content: 'Verified.' })),
      getCapabilities: () => ({ nativeToolCalling: true }),
      listModels: async () => [], isAvailable: async () => true, setModel: () => {},
    }, { executeForTool: vi.fn() } as unknown as ActionExecutor, { threadBudget: budget, onSubagentStop });

    await expect(delegator.delegateParallelForTool([
      { agent_name: 'reader', task: 'Inspect first.' }, { agent_name: 'reader', task: 'Inspect second.' },
    ])).resolves.toMatchObject({ success: true });
    expect(onSubagentStop).toHaveBeenCalledTimes(2);
    expect(budget.activeChildren).toBe(0);
  });

  it.each([true, false])('does not let a read-only parent grant write tools to a descendant (native=%s)', async native => {
    const registry = AgentRegistry.getInstance();
    vi.spyOn(registry, 'loadAgents').mockResolvedValue();
    vi.spyOn(registry, 'getAgent').mockImplementation(name => ({
      name, description: name, systemPrompt: name,
      tools: name === 'reader' ? ['read_file'] : ['write_file'], path: `/tmp/${name}.md`,
    }));
    const executeForTool = vi.fn(async () => ({ success: true, output: 'File written.' }));
    let writerPrompt = '';
    const delegator = new AgentDelegator({
      getName: () => native ? 'autohandai' : 'ollama',
      complete: async request => {
        const prompt = String(request.messages[0]?.content);
        const writer = prompt.startsWith('writer');
        if (writer) writerPrompt = prompt;
        if (request.messages.some(message => message.role === 'tool')) return { content: 'Reviewed result.' };
        const tool = writer ? 'write_file' : 'delegate_task';
        const args = writer ? { path: 'source.ts', contents: 'Unauthorized mutation' } : { agent_name: 'writer', task: 'Write source' };
        return native
          ? { content: '', toolCalls: [{ id: `${tool}-1`, type: 'function', function: { name: tool, arguments: JSON.stringify(args) } }] }
          : { content: JSON.stringify({ toolCalls: [{ tool, args }] }) };
      },
      getCapabilities: () => ({ nativeToolCalling: native }),
      listModels: async () => [], isAvailable: async () => true, setModel: () => {},
    }, { executeForTool } as unknown as ActionExecutor);

    await delegator.delegateTaskForTool('reader', 'Inspect source');
    expect(writerPrompt).not.toContain('- write_file(');
    expect(executeForTool).not.toHaveBeenCalled();
  });

  it('preserves validation when every parallel task fails validation', async () => {
    const registry = AgentRegistry.getInstance();
    vi.spyOn(registry, 'loadAgents').mockResolvedValue();
    vi.spyOn(registry, 'getAgent').mockReturnValue(undefined);

    const outcome = await createDelegator().delegateParallelForTool([
      { agent_name: 'missing-reviewer', task: 'review the change' },
      { agent_name: 'missing-tester', task: 'test the change' },
    ]);

    expect(outcome).toMatchObject({
      success: false,
      kind: 'validation',
      error: "Agent 'missing-reviewer' not found.; Agent 'missing-tester' not found.",
    });
  });

  it('runs serial delegation through the native SubAgent protocol', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const registry = AgentRegistry.getInstance();
    vi.spyOn(registry, 'loadAgents').mockResolvedValue();
    vi.spyOn(registry, 'getAgent').mockReturnValue({
      name: 'repo-reader',
      description: 'Repository reader',
      systemPrompt: 'Inspect repositories.',
      tools: ['read_file'],
      path: '/tmp/repo-reader.md',
      source: 'builtin',
    });
    const complete = vi.fn().mockResolvedValue({ content: 'Serial done.' });
    const llm = {
      getName: () => 'autohandai',
      complete,
      getCapabilities: () => ({ nativeToolCalling: true }),
      listModels: vi.fn().mockResolvedValue([]),
      isAvailable: vi.fn().mockResolvedValue(true),
      setModel: vi.fn(),
    } satisfies LLMProvider;
    const delegator = new AgentDelegator(
      llm,
      { executeForTool: vi.fn() } as unknown as ActionExecutor,
      { maxDepth: 2 },
    );

    try {
      await expect(delegator.delegateTaskForTool('repo-reader', 'Inspect package.json')).resolves.toMatchObject({
        success: true,
        output: 'Serial done.',
      });
      const request = complete.mock.calls[0]?.[0];
      expect(request?.tools).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'read_file' }),
      ]));
      const prompt = request?.messages.find((message) => message.role === 'system')?.content;
      expect(prompt).toContain('Use the native tool interface');
      expect(prompt).not.toContain('Always respond with structured JSON');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('publishes subagent activity before execution and preserves the same id on completion', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const registry = AgentRegistry.getInstance();
    vi.spyOn(registry, 'loadAgents').mockResolvedValue();
    vi.spyOn(registry, 'getAgent').mockReturnValue({
      name: 'repo-reader',
      description: 'Repository reader',
      systemPrompt: 'Inspect repositories.',
      tools: ['read_file'],
      path: '/tmp/repo-reader.md',
      source: 'builtin',
    });
    const onSubagentStart = vi.fn().mockResolvedValue(undefined);
    const onSubagentStop = vi.fn().mockResolvedValue(undefined);
    const delegator = new AgentDelegator(
      {
        getName: () => 'autohandai',
        complete: vi.fn().mockResolvedValue({ content: 'Done.' }),
        getCapabilities: () => ({ nativeToolCalling: true }),
        listModels: vi.fn().mockResolvedValue([]),
        isAvailable: vi.fn().mockResolvedValue(true),
        setModel: vi.fn(),
      } satisfies LLMProvider,
      { executeForTool: vi.fn() } as unknown as ActionExecutor,
      { onSubagentStart, onSubagentStop },
    );

    try {
      await delegator.delegateTaskForTool('repo-reader', 'Inspect package.json');

      expect(onSubagentStart).toHaveBeenCalledWith(expect.objectContaining({
        subagentName: 'repo-reader',
        subagentType: 'builtin',
        task: 'Inspect package.json',
      }));
      expect(onSubagentStop).toHaveBeenCalledWith(expect.objectContaining({
        subagentId: onSubagentStart.mock.calls[0]?.[0].subagentId,
        subagentName: 'repo-reader',
        success: true,
      }));
      expect(onSubagentStart.mock.invocationCallOrder[0]).toBeLessThan(
        onSubagentStop.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
      );
    } finally {
      logSpy.mockRestore();
    }
  });

  it('runs an in-process subagent with its resolved provider and model assignment', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const registry = AgentRegistry.getInstance();
    vi.spyOn(registry, 'loadAgents').mockResolvedValue();
    vi.spyOn(registry, 'getAgent').mockReturnValue({
      name: 'repo-reader',
      description: 'Repository reader',
      systemPrompt: 'Inspect repositories.',
      tools: ['read_file'],
      path: '/tmp/repo-reader.md',
      source: 'builtin',
    });
    const primaryComplete = vi.fn().mockResolvedValue({ content: 'Primary called.' });
    const assignedComplete = vi.fn().mockResolvedValue({ content: 'Assignment applied.' });
    const assignedProvider = {
      getName: () => 'autohandai',
      complete: assignedComplete,
      getCapabilities: () => ({ nativeToolCalling: true }),
      listModels: vi.fn().mockResolvedValue([]),
      isAvailable: vi.fn().mockResolvedValue(true),
      setModel: vi.fn(),
    } satisfies LLMProvider;
    const assignment: TeamModelAssignment = {
      provider: 'autohandai',
      model: 'fantail',
      source: 'team-default',
    };
    const createSubagentProvider = vi.fn().mockReturnValue(assignedProvider);
    const onSubagentStart = vi.fn().mockResolvedValue(undefined);
    const delegator = new AgentDelegator(
      {
        getName: () => 'openrouter',
        complete: primaryComplete,
        getCapabilities: () => ({ nativeToolCalling: true }),
        listModels: vi.fn().mockResolvedValue([]),
        isAvailable: vi.fn().mockResolvedValue(true),
        setModel: vi.fn(),
      } satisfies LLMProvider,
      { executeForTool: vi.fn() } as unknown as ActionExecutor,
      {
        resolveSubagentAssignment: vi.fn().mockReturnValue(assignment),
        createSubagentProvider,
        onSubagentStart,
      },
    );

    try {
      await expect(delegator.delegateTaskForTool('repo-reader', 'Inspect package.json')).resolves.toMatchObject({
        success: true,
        output: 'Assignment applied.',
      });

      expect(createSubagentProvider).toHaveBeenCalledWith(assignment);
      expect(primaryComplete).not.toHaveBeenCalled();
      expect(assignedComplete.mock.calls[0]?.[0]).toMatchObject({ model: 'fantail' });
      expect(onSubagentStart).toHaveBeenCalledWith(expect.objectContaining({
        provider: 'autohandai',
        model: 'fantail',
        modelSource: 'team-default',
      }));
    } finally {
      logSpy.mockRestore();
    }
  });

  it('runs every parallel delegation through the native SubAgent protocol', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const registry = AgentRegistry.getInstance();
    vi.spyOn(registry, 'loadAgents').mockResolvedValue();
    vi.spyOn(registry, 'getAgent').mockImplementation((name) => ({
      name,
      description: `${name} agent`,
      systemPrompt: 'Inspect repositories.',
      tools: ['read_file'],
      path: `/tmp/${name}.md`,
      source: 'builtin',
    }));
    const complete = vi.fn().mockResolvedValue({ content: 'Parallel done.' });
    const llm = {
      getName: () => 'autohandai',
      complete,
      getCapabilities: () => ({ nativeToolCalling: true }),
      listModels: vi.fn().mockResolvedValue([]),
      isAvailable: vi.fn().mockResolvedValue(true),
      setModel: vi.fn(),
    } satisfies LLMProvider;
    const delegator = new AgentDelegator(
      llm,
      { executeForTool: vi.fn() } as unknown as ActionExecutor,
      { maxDepth: 2 },
    );

    try {
      await expect(delegator.delegateParallelForTool([
        { agent_name: 'reader-one', task: 'Inspect package.json' },
        { agent_name: 'reader-two', task: 'Inspect src' },
      ])).resolves.toMatchObject({ success: true });
      expect(complete).toHaveBeenCalledTimes(2);
      for (const [request] of complete.mock.calls) {
        expect(request.tools).toEqual(expect.arrayContaining([
          expect.objectContaining({ name: 'read_file' }),
        ]));
        const prompt = request.messages.find((message) => message.role === 'system')?.content;
        expect(prompt).toContain('Use the native tool interface');
        expect(prompt).not.toContain('Always respond with structured JSON');
      }
    } finally {
      logSpy.mockRestore();
    }
  });
});
