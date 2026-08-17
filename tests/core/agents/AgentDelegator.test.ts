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
