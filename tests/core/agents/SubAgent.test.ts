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

function nativeToolCall(name: string, args: Record<string, unknown>, id = `call-${name}`) {
  return {
    id,
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
      const systemPrompt = complete.mock.calls[0]?.[0]?.messages.find(
        (message) => message.role === 'system',
      )?.content;
      expect(systemPrompt).toContain('"reflection"');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('uses the shared legacy reaction protocol and carries tool result ids into the next request', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const executeForTool = vi.fn().mockResolvedValue({
      success: true,
      output: 'package contents',
    });
    const complete = vi.fn()
      .mockResolvedValueOnce({
        id: 'tool-turn',
        created: 1,
        content: '[TOOL_CALL]{"name":"read_file","arguments":{"path":"package.json"}}[/TOOL_CALL]',
        raw: {},
      })
      .mockResolvedValueOnce({
        id: 'answer',
        created: 2,
        content: '{"finalResponse":"Done."}',
        raw: {},
      });
    const llm = {
      getName: () => 'legacy',
      complete,
      listModels: vi.fn().mockResolvedValue([]),
      isAvailable: vi.fn().mockResolvedValue(true),
      setModel: vi.fn(),
    } satisfies LLMProvider;
    const subAgent = new SubAgent({
      name: 'legacy-reader',
      description: 'Legacy reader',
      systemPrompt: 'Read repository files.',
      tools: ['read_file'],
      path: '/tmp/legacy-reader.md',
      source: 'external',
    }, llm, { executeForTool } as unknown as ActionExecutor, {
      clientContext: 'cli',
      depth: 0,
      maxDepth: 0,
    });

    try {
      await expect(subAgent.run('Read package.json')).resolves.toBe('Done.');
      expect(executeForTool).toHaveBeenCalledOnce();
      expect(complete).toHaveBeenCalledTimes(2);
      const secondRequest = complete.mock.calls[1]?.[0];
      expect(secondRequest?.messages).toContainEqual(expect.objectContaining({
        role: 'tool',
        content: 'package contents',
        tool_call_id: expect.any(String),
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
      const firstRequest = complete.mock.calls[0]?.[0];
      const systemPrompt = firstRequest?.messages.find(
        (message) => message.role === 'system',
      )?.content;
      expect(systemPrompt).toContain('Use the native tool interface');
      expect(systemPrompt).not.toContain('Always respond with structured JSON');
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

  it('resolves an extension agent allowlist against active extension tool definitions', () => {
    const agentDefinition: AgentDefinition = {
      name: 'code-health-reviewer',
      description: 'Code Health Reviewer',
      systemPrompt: 'Review maintainability risks.',
      tools: ['find_todos'],
      path: '/tmp/code-health-reviewer.md',
      source: 'extension',
      extensionId: 'autohand.code-health',
      extensionVersion: '1.0.0',
      extensionScope: 'user',
    };
    const llm = {
      getName: () => 'test',
      complete: vi.fn(),
      listModels: vi.fn().mockResolvedValue([]),
      isAvailable: vi.fn().mockResolvedValue(true),
      setModel: vi.fn(),
    } satisfies LLMProvider;
    const actionExecutor = {
      executeForTool: vi.fn(),
    } as unknown as ActionExecutor;

    const subAgent = new SubAgent(agentDefinition, llm, actionExecutor, {
      clientContext: 'cli',
      depth: 0,
      maxDepth: 0,
      getToolDefinitions: () => [{
        name: 'find_todos',
        description: 'Find TODO and FIXME markers',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      }],
    });

    const toolNames = (subAgent as unknown as {
      toolManager: { listToolNames: () => string[] };
    }).toolManager.listToolNames();

    expect(toolNames).toContain('find_todos');
    expect(toolNames).not.toContain('read_file');
  });

  it('records native tool_calls on assistant messages so Responses API providers can continue multi-turn tool use', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const executeForTool = vi.fn().mockResolvedValue({
      success: true,
      output: 'file contents',
    });
    const complete = vi.fn()
      .mockResolvedValueOnce({
        id: 'tool-turn',
        created: 1,
        content: '',
        toolCalls: [nativeToolCall('read_file', { path: 'package.json' })],
        raw: {},
      })
      .mockResolvedValueOnce({
        id: 'answer',
        created: 2,
        content: 'Done.',
        raw: {},
      });
    const llm = {
      getName: () => 'xai',
      complete,
      getCapabilities: () => ({ nativeToolCalling: true }),
      listModels: vi.fn().mockResolvedValue([]),
      isAvailable: vi.fn().mockResolvedValue(true),
      setModel: vi.fn(),
    } satisfies LLMProvider;
    const actionExecutor = { executeForTool } as unknown as ActionExecutor;

    const subAgent = new SubAgent({
      name: 'researcher',
      description: 'Built-in researcher',
      systemPrompt: 'You research codebases.',
      tools: ['read_file'],
      path: '/tmp/researcher.md',
      source: 'builtin',
    }, llm, actionExecutor, {
      clientContext: 'cli',
      depth: 0,
      maxDepth: 0,
    });

    try {
      await expect(subAgent.run('Read package.json')).resolves.toBe('Done.');
      expect(complete).toHaveBeenCalledTimes(2);

      const secondCallMessages = complete.mock.calls[1]?.[0]?.messages as Array<Record<string, unknown>>;
      const assistantWithTools = secondCallMessages.find(
        (message) => message.role === 'assistant' && Array.isArray(message.tool_calls),
      );
      expect(assistantWithTools).toEqual(expect.objectContaining({
        role: 'assistant',
        tool_calls: [expect.objectContaining({
          id: 'call-read_file',
          type: 'function',
          function: expect.objectContaining({
            name: 'read_file',
          }),
        })],
      }));

      const toolResult = secondCallMessages.find((message) => message.role === 'tool');
      expect(toolResult).toEqual(expect.objectContaining({
        role: 'tool',
        tool_call_id: 'call-read_file',
        content: 'file contents',
      }));
    } finally {
      logSpy.mockRestore();
    }
  });

  it('promotes a native-capable provider JSON fallback into matched assistant and tool history', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const executeForTool = vi.fn().mockResolvedValue({
      success: true,
      output: 'fallback file contents',
    });
    const complete = vi.fn()
      .mockResolvedValueOnce({
        id: 'fallback-tool-turn',
        created: 1,
        content: JSON.stringify({
          thought: 'Read the requested file.',
          toolCalls: [{ tool: 'read_file', args: { path: 'package.json' } }],
        }),
        raw: {},
      })
      .mockResolvedValueOnce({
        id: 'answer',
        created: 2,
        content: 'Done.',
        raw: {},
      });
    const llm = {
      getName: () => 'autohandai',
      complete,
      getCapabilities: () => ({ nativeToolCalling: true }),
      listModels: vi.fn().mockResolvedValue([]),
      isAvailable: vi.fn().mockResolvedValue(true),
      setModel: vi.fn(),
    } satisfies LLMProvider;
    const subAgent = new SubAgent({
      name: 'fallback-reader',
      description: 'Fallback reader',
      systemPrompt: 'Inspect repository files.',
      tools: ['read_file'],
      path: '/tmp/fallback-reader.md',
      source: 'builtin',
    }, llm, { executeForTool } as unknown as ActionExecutor, {
      clientContext: 'cli',
      depth: 0,
      maxDepth: 0,
    });

    try {
      await expect(subAgent.run('Read package.json')).resolves.toBe('Done.');
      const secondRequestMessages = complete.mock.calls[1]?.[0]?.messages as Array<Record<string, unknown>>;
      const assistantCall = secondRequestMessages.find(
        (message) => message.role === 'assistant' && Array.isArray(message.tool_calls),
      )?.tool_calls as Array<{ id: string; function: { name: string } }> | undefined;
      expect(assistantCall?.[0]).toEqual(expect.objectContaining({
        type: 'function',
        function: expect.objectContaining({ name: 'read_file' }),
      }));
      expect(secondRequestMessages).toContainEqual(expect.objectContaining({
        role: 'tool',
        tool_call_id: assistantCall?.[0]?.id,
        content: 'fallback file contents',
      }));
    } finally {
      logSpy.mockRestore();
    }
  });

  it('stops a repeated call-and-result loop before executing the fourth duplicate', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const executeForTool = vi.fn().mockResolvedValue({
      success: true,
      output: 'the same package contents',
    });
    const repeatedCalls = [1, 2, 3, 4].map((sequence) => ({
      id: `tool-turn-${sequence}`,
      created: sequence,
      content: sequence === 1
        ? 'Reading package.json.'
        : '{"reflection":"The prior output is unchanged and I am deliberately checking the same file again.","thought":"Repeating the read."}',
      toolCalls: [nativeToolCall('read_file', { path: 'package.json' }, `call-${sequence}`)],
      raw: {},
    }));
    const complete = vi.fn()
      .mockResolvedValueOnce(repeatedCalls[0])
      .mockResolvedValueOnce(repeatedCalls[1])
      .mockResolvedValueOnce(repeatedCalls[2])
      .mockResolvedValueOnce(repeatedCalls[3])
      .mockResolvedValueOnce({
        id: 'answer',
        created: 5,
        content: 'Done from the existing result.',
        raw: {},
      });
    const llm = {
      getName: () => 'autohandai',
      complete,
      getCapabilities: () => ({ nativeToolCalling: true }),
      listModels: vi.fn().mockResolvedValue([]),
      isAvailable: vi.fn().mockResolvedValue(true),
      setModel: vi.fn(),
    } satisfies LLMProvider;
    const subAgent = new SubAgent({
      name: 'looping-reader',
      description: 'Looping reader',
      systemPrompt: 'Inspect repository files.',
      tools: ['read_file'],
      path: '/tmp/looping-reader.md',
      source: 'builtin',
    }, llm, { executeForTool } as unknown as ActionExecutor, {
      clientContext: 'cli',
      depth: 0,
      maxDepth: 0,
    });

    try {
      await expect(subAgent.run('Read package.json')).resolves.toBe('Done from the existing result.');
      expect(executeForTool).toHaveBeenCalledTimes(3);
      expect(complete).toHaveBeenCalledTimes(5);
      expect(complete.mock.calls[3]?.[0]?.tools).toBeUndefined();
      expect(complete.mock.calls[4]?.[0]?.tools).toBeUndefined();
      const finalRequestMessages = complete.mock.calls[4]?.[0]?.messages as Array<Record<string, unknown>>;
      const rejectedAssistantIndex = finalRequestMessages.findIndex((message) =>
        message.role === 'assistant'
        && Array.isArray(message.tool_calls)
        && message.tool_calls.some((call: { id?: string }) => call.id === 'call-4')
      );
      expect(finalRequestMessages[rejectedAssistantIndex + 1]).toEqual(expect.objectContaining({
        role: 'tool',
        tool_call_id: 'call-4',
        content: expect.stringContaining('not executed'),
      }));
    } finally {
      logSpy.mockRestore();
    }
  });

  it('stops when reflection reports missing tool outputs instead of blindly retrying', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const executeForTool = vi.fn().mockResolvedValue({ success: true, output: 'package contents' });
    const complete = vi.fn()
      .mockResolvedValueOnce({
        id: 'initial-read',
        created: 1,
        content: 'Reading package.json.',
        toolCalls: [nativeToolCall('read_file', { path: 'package.json' }, 'call-1')],
        raw: {},
      })
      .mockResolvedValueOnce({
        id: 'blind-retry',
        created: 2,
        content: '{"reflection":"The previous tool output was not visible.","thought":"Retrying it."}',
        toolCalls: [nativeToolCall('read_file', { path: 'package.json' }, 'call-2')],
        raw: {},
      })
      .mockResolvedValueOnce({
        id: 'answer',
        created: 3,
        content: 'Stopped without repeating the read.',
        raw: {},
      });
    const llm = {
      getName: () => 'autohandai',
      complete,
      getCapabilities: () => ({ nativeToolCalling: true }),
      listModels: vi.fn().mockResolvedValue([]),
      isAvailable: vi.fn().mockResolvedValue(true),
      setModel: vi.fn(),
    } satisfies LLMProvider;
    const subAgent = new SubAgent({
      name: 'integrity-reader',
      description: 'Integrity reader',
      systemPrompt: 'Inspect repository files.',
      tools: ['read_file'],
      path: '/tmp/integrity-reader.md',
      source: 'builtin',
    }, llm, { executeForTool } as unknown as ActionExecutor, {
      clientContext: 'cli',
      depth: 0,
      maxDepth: 0,
    });

    try {
      await expect(subAgent.run('Read package.json')).resolves.toBe('Stopped without repeating the read.');
      expect(executeForTool).toHaveBeenCalledTimes(1);
      expect(complete.mock.calls[2]?.[0]?.tools).toBeUndefined();
      expect(complete.mock.calls[2]?.[0]?.messages).toContainEqual(expect.objectContaining({
        role: 'tool',
        tool_call_id: 'call-2',
        content: expect.stringContaining('not executed'),
      }));
    } finally {
      logSpy.mockRestore();
    }
  });

  it('requires reflection before a delegated agent can call another tool', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const executedIds: string[] = [];
    const executeForTool = vi.fn().mockImplementation((_action, context) => {
      executedIds.push(context?.toolCallId);
      return Promise.resolve({ success: true, output: 'observed output' });
    });
    const complete = vi.fn()
      .mockResolvedValueOnce({
        id: 'first-read',
        created: 1,
        content: 'Initial read.',
        toolCalls: [nativeToolCall('read_file', { path: 'first.ts' }, 'call-1')],
        raw: {},
      })
      .mockResolvedValueOnce({
        id: 'unreflected-read',
        created: 2,
        content: 'Next read.',
        toolCalls: [nativeToolCall('read_file', { path: 'blocked.ts' }, 'call-2')],
        raw: {},
      })
      .mockResolvedValueOnce({
        id: 'reflected-read',
        created: 3,
        content: '{"reflection":"The first file identified the exact dependency I need to inspect next.","thought":"Reading that dependency."}',
        toolCalls: [nativeToolCall('read_file', { path: 'allowed.ts' }, 'call-3')],
        raw: {},
      })
      .mockResolvedValueOnce({ id: 'answer', created: 4, content: 'Done.', raw: {} });
    const llm = {
      getName: () => 'autohandai',
      complete,
      getCapabilities: () => ({ nativeToolCalling: true }),
      listModels: vi.fn().mockResolvedValue([]),
      isAvailable: vi.fn().mockResolvedValue(true),
      setModel: vi.fn(),
    } satisfies LLMProvider;
    const subAgent = new SubAgent({
      name: 'reflective-reader',
      description: 'Reflective reader',
      systemPrompt: 'Inspect repository files.',
      tools: ['read_file'],
      path: '/tmp/reflective-reader.md',
      source: 'builtin',
    }, llm, { executeForTool } as unknown as ActionExecutor, {
      clientContext: 'cli',
      depth: 0,
      maxDepth: 0,
    });

    try {
      await expect(subAgent.run('Inspect dependencies')).resolves.toBe('Done.');
      expect(executedIds).toEqual(['call-1', 'call-3']);
      expect(complete.mock.calls[2]?.[0]?.messages).toContainEqual(expect.objectContaining({
        role: 'tool',
        tool_call_id: 'call-2',
        content: expect.stringContaining('not executed'),
      }));
    } finally {
      logSpy.mockRestore();
    }
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
