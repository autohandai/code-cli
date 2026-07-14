/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { SubAgent } from '../../../src/core/agents/SubAgent.js';
import type { AgentDefinition } from '../../../src/core/agents/AgentRegistry.js';
import type { LLMProvider } from '../../../src/providers/LLMProvider.js';
import type { ActionExecutor } from '../../../src/core/actionExecutor.js';
import { PermissionManager } from '../../../src/permissions/PermissionManager.js';
import type { ToolAuthorizationOptions } from '../../../src/core/toolManager.js';

function nativeToolCall(name: string, args: Record<string, unknown>) {
  return {
    id: `call-${name}`,
    type: 'function' as const,
    function: { name, arguments: JSON.stringify(args) },
  };
}

describe('SubAgent', () => {
  it('does not send native tool schemas to providers without native tool-call capability', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const agentDefinition: AgentDefinition = {
      name: 'repo-reader',
      description: 'Repo Reader',
      systemPrompt: 'You inspect repositories.',
      tools: ['read_file'],
      path: '/tmp/repo-reader.md',
      source: 'external'
    };
    const complete = vi.fn().mockResolvedValue({
      id: 'answer',
      created: 1,
      content: '{"finalResponse":"Done.","toolCalls":[]}',
      raw: {}
    });
    const llm = {
      getName: () => 'openrouter',
      complete,
      listModels: vi.fn().mockResolvedValue([]),
      isAvailable: vi.fn().mockResolvedValue(true),
      setModel: vi.fn()
    } satisfies LLMProvider;
    const actionExecutor = {
      execute: vi.fn()
    } as unknown as ActionExecutor;

    const subAgent = new SubAgent(agentDefinition, llm, actionExecutor, {
      clientContext: 'cli',
      depth: 0,
      maxDepth: 0
    });

    try {
      await expect(subAgent.run('inspect package')).resolves.toBe('Done.');
      expect(complete).toHaveBeenCalledWith(expect.not.objectContaining({
        tools: expect.any(Array),
        toolChoice: expect.anything()
      }));
    } finally {
      logSpy.mockRestore();
    }
  });

  it('sends native tool schemas to providers with native tool-call capability', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const agentDefinition: AgentDefinition = {
      name: 'repo-reader',
      description: 'Repo Reader',
      systemPrompt: 'You inspect repositories.',
      tools: ['read_file'],
      path: '/tmp/repo-reader.md',
      source: 'external'
    };
    const complete = vi.fn().mockResolvedValue({
      id: 'answer',
      created: 1,
      content: 'Done.',
      raw: {}
    });
    const llm = {
      getName: () => 'openai',
      complete,
      getCapabilities: () => ({ nativeToolCalling: true }),
      listModels: vi.fn().mockResolvedValue([]),
      isAvailable: vi.fn().mockResolvedValue(true),
      setModel: vi.fn()
    } satisfies LLMProvider;
    const actionExecutor = {
      execute: vi.fn()
    } as unknown as ActionExecutor;

    const subAgent = new SubAgent(agentDefinition, llm, actionExecutor, {
      clientContext: 'cli',
      depth: 0,
      maxDepth: 0
    });

    try {
      await expect(subAgent.run('inspect package')).resolves.toBe('Done.');
      expect(complete).toHaveBeenCalledWith(expect.objectContaining({
        tools: [
          expect.objectContaining({
            name: 'read_file'
          })
        ],
        toolChoice: 'auto'
      }));
    } finally {
      logSpy.mockRestore();
    }
  });

  it('treats wildcard tool access as all default tools for Markdown agents without explicit tools', () => {
    const agentDefinition: AgentDefinition = {
      name: 'react-expert',
      description: 'React Expert',
      systemPrompt: 'You are a React expert.',
      tools: ['*'],
      path: '/tmp/react-expert.md',
      source: 'external'
    };
    const llm = {
      getName: () => 'test',
      complete: vi.fn(),
      listModels: vi.fn().mockResolvedValue([]),
      isAvailable: vi.fn().mockResolvedValue(true),
      setModel: vi.fn()
    } satisfies LLMProvider;
    const actionExecutor = {
      execute: vi.fn()
    } as unknown as ActionExecutor;

    const subAgent = new SubAgent(agentDefinition, llm, actionExecutor, {
      clientContext: 'cli',
      depth: 0,
      maxDepth: 1
    });

    const toolNames = (subAgent as unknown as {
      toolManager: { listToolNames: () => string[] };
    }).toolManager.listToolNames();

    expect(toolNames).toContain('read_file');
    expect(toolNames).toContain('create_meta_tool');
  });

  it('uses the parent authorization policy before nested tool execution', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const executeForTool = vi.fn().mockResolvedValue({ success: true, output: 'should not run' });
    const complete = vi.fn()
      .mockResolvedValueOnce({
        id: 'tool-turn',
        created: 1,
        content: 'Checking environment',
        toolCalls: [nativeToolCall('run_command', { command: 'echo blocked' })],
        raw: {},
      })
      .mockResolvedValueOnce({
        id: 'answer',
        created: 2,
        content: 'Done after denial.',
        raw: {},
      });
    const llm = {
      getName: () => 'openai',
      complete,
      getCapabilities: () => ({ nativeToolCalling: true }),
      listModels: vi.fn().mockResolvedValue([]),
      isAvailable: vi.fn().mockResolvedValue(true),
      setModel: vi.fn(),
    } satisfies LLMProvider;
    const actionExecutor = { executeForTool } as unknown as ActionExecutor;
    const authorization: ToolAuthorizationOptions = {
      permissionManager: new PermissionManager({
        mode: 'interactive',
        denyList: ['run_command:echo blocked'],
      }),
    };
    const subAgent = new SubAgent({
      name: 'nested-runner',
      description: 'Nested Runner',
      systemPrompt: 'Run nested checks.',
      tools: ['run_command'],
      path: '/tmp/nested-runner.md',
      source: 'external',
    }, llm, actionExecutor, {
      clientContext: 'cli',
      depth: 1,
      maxDepth: 1,
      authorization,
    });

    try {
      await expect(subAgent.run('inspect environment')).resolves.toBe('Done after denial.');
      expect(executeForTool).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it('uses the parent confirmation result for nested prompts before shared executor side effects', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const executeForTool = vi.fn().mockResolvedValue({ success: true, output: 'should not run' });
    const confirmApproval = vi.fn().mockResolvedValue(false);
    const complete = vi.fn()
      .mockResolvedValueOnce({
        id: 'tool-turn',
        created: 1,
        content: 'Running command',
        toolCalls: [nativeToolCall('run_command', { command: 'echo nested' })],
        raw: {},
      })
      .mockResolvedValueOnce({
        id: 'answer',
        created: 2,
        content: 'Done after confirmation denial.',
        raw: {},
      });
    const llm = {
      getName: () => 'openai',
      complete,
      getCapabilities: () => ({ nativeToolCalling: true }),
      listModels: vi.fn().mockResolvedValue([]),
      isAvailable: vi.fn().mockResolvedValue(true),
      setModel: vi.fn(),
    } satisfies LLMProvider;
    const actionExecutor = { executeForTool } as unknown as ActionExecutor;
    const subAgent = new SubAgent({
      name: 'nested-runner',
      description: 'Nested Runner',
      systemPrompt: 'Run nested checks.',
      tools: ['run_command'],
      path: '/tmp/nested-runner.md',
      source: 'external',
    }, llm, actionExecutor, {
      clientContext: 'cli',
      depth: 1,
      maxDepth: 1,
      authorization: {
        permissionManager: new PermissionManager({ mode: 'interactive' }),
      },
      confirmApproval,
    });

    try {
      await expect(subAgent.run('run command')).resolves.toBe('Done after confirmation denial.');
      expect(confirmApproval).toHaveBeenCalledWith(
        expect.stringContaining('Run this command'),
        expect.objectContaining({ tool: 'run_command', command: 'echo nested' }),
      );
      expect(executeForTool).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it('runs parent pre-tool hooks for nested calls and fails closed on a block', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const executeForTool = vi.fn().mockResolvedValue({ success: true, output: 'should not run' });
    const runPreToolHooks = vi.fn().mockResolvedValue([{
      hook: { event: 'pre-tool', command: 'nested-policy' },
      success: true,
      duration: 1,
      response: { decision: 'block', reason: 'nested hook blocked the read' },
    }]);
    const complete = vi.fn()
      .mockResolvedValueOnce({
        id: 'tool-turn',
        created: 1,
        content: 'Reading file',
        toolCalls: [nativeToolCall('read_file', { path: 'src/index.ts' })],
        raw: {},
      })
      .mockResolvedValueOnce({
        id: 'answer',
        created: 2,
        content: 'Done after hook block.',
        raw: {},
      });
    const llm = {
      getName: () => 'openai',
      complete,
      getCapabilities: () => ({ nativeToolCalling: true }),
      listModels: vi.fn().mockResolvedValue([]),
      isAvailable: vi.fn().mockResolvedValue(true),
      setModel: vi.fn(),
    } satisfies LLMProvider;
    const actionExecutor = { executeForTool } as unknown as ActionExecutor;
    const authorization: ToolAuthorizationOptions = {
      permissionManager: new PermissionManager({ mode: 'unrestricted' }),
      runPreToolHooks,
    };
    const subAgent = new SubAgent({
      name: 'nested-reader',
      description: 'Nested Reader',
      systemPrompt: 'Read nested files.',
      tools: ['read_file'],
      path: '/tmp/nested-reader.md',
      source: 'external',
    }, llm, actionExecutor, {
      clientContext: 'cli',
      depth: 1,
      maxDepth: 1,
      authorization,
    });

    try {
      await expect(subAgent.run('inspect file')).resolves.toBe('Done after hook block.');
      expect(runPreToolHooks).toHaveBeenCalledWith(expect.objectContaining({
        tool: 'read_file',
        args: { path: 'src/index.ts' },
      }));
      expect(executeForTool).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });
});
