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
});
