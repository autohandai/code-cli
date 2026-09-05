/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createServer, type Server, type ServerResponse } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { FileActionManager } from '../../../src/actions/filesystem.js';
import { ActionExecutor } from '../../../src/core/actionExecutor.js';
import { ConversationManager } from '../../../src/core/conversationManager.js';
import { AgentRegistry, type AgentDefinition } from '../../../src/core/agents/AgentRegistry.js';
import { SubAgent } from '../../../src/core/agents/SubAgent.js';
import { SessionThreadBudget } from '../../../src/core/agents/SessionThreadBudget.js';
import { resolveTeamModelAssignment } from '../../../src/core/teams/TeamModelPolicy.js';
import { ProviderFactory } from '../../../src/providers/ProviderFactory.js';
import type { AgentRuntime, LLMToolCall, LoadedConfig, MultimodalMessage } from '../../../src/types.js';

type WireMessage = MultimodalMessage;

interface WireRequest {
  model: string;
  messages: WireMessage[];
  tools: Array<{ type: string; function: { name: string; parameters: Record<string, unknown> } }>;
  tool_choice: string;
  extra_body: { chat_template_kwargs: { reasoning_effort: string } };
}

const servers: Server[] = [];
const workspaces: string[] = [];

function toolCall(name: string, args: Record<string, unknown>, id: string): LLMToolCall {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

function reply(response: ServerResponse, content: string, calls?: LLMToolCall[]): void {
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({
    id: 'native-response', created: 123,
    choices: [{ message: { role: 'assistant', content, ...(calls ? { tool_calls: calls } : {}) },
      finish_reason: calls ? 'tool_calls' : 'stop' }],
    usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
  }));
}

async function fixture(mode: 'success' | 'failure' | 'cancel' | 'image' | 'missing-image') {
  const requests: WireRequest[] = [];
  const requestPaths: string[] = [];
  const childRequested = Promise.withResolvers<void>();
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-native-delegation-'));
  workspaces.push(workspaceRoot);
  await fs.writeFile(path.join(workspaceRoot, 'fixture.txt'), 'NATIVE_CHILD_FILE_CONTENT');
  const imagePath = path.join(workspaceRoot, '.autohand/test-evidence/run-fixture/frame-001.png');
  const imageBytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ff0000' } }).png().toBuffer();
  if (mode === 'image') {
    await fs.mkdir(path.dirname(imagePath), { recursive: true });
    await fs.writeFile(imagePath, imageBytes);
  }
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body: WireRequest = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      requests.push(body);
      requestPaths.push(request.url ?? '');
      const child = typeof body.messages[0].content === 'string' && body.messages[0].content.startsWith('WIRE_CHILD');
      const result = body.messages.find(message => message.role === 'tool');
      if (!child) {
        if (!result) reply(response, '', [toolCall('delegate_task', {
          agent_name: 'wire-reader', task: 'Read fixture.txt and report its contents.',
        }, 'parent-delegate-call')]);
        else reply(response, mode === 'failure' ? 'PARENT_OBSERVED_CHILD_FAILURE' : 'PARENT_VERIFIED_CHILD_RESULT');
      } else if (mode === 'cancel') {
        childRequested.resolve();
      } else if (mode === 'failure') {
        response.writeHead(500, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'Native child unavailable' } }));
      } else if (!result) {
        reply(response, '', [toolCall('read_file', { path: 'fixture.txt' }, 'child-read-call')]);
      } else {
        reply(response, `CHILD_VERIFIED: ${result.content}`);
      }
    })().catch(error => {
      response.writeHead(500);
      response.end(String(error));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected local HTTP address');
  const config: LoadedConfig = {
    configPath: path.join(workspaceRoot, 'config.json'),
    provider: 'autohandai',
    features: { autohand_inference: true },
    autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'local-test-key', model: 'moa',
      reasoningEffort: 'xhigh', baseUrl: `http://127.0.0.1:${address.port}/v1` },
    network: { maxRetries: 0, retryDelay: 0 },
  };
  const definition: AgentDefinition = {
    name: 'wire-reader', description: 'Read a source file through native tools.',
    systemPrompt: 'WIRE_CHILD: Inspect the delegated source file.', tools: ['read_file'],
    model: 'gpt-5.4', path: path.join(workspaceRoot, 'wire-reader.md'), source: 'user',
  };
  const registry = AgentRegistry.getInstance();
  vi.spyOn(registry, 'loadAgents').mockResolvedValue();
  vi.spyOn(registry, 'getAgent').mockImplementation(name => name === definition.name ? definition : undefined);
  vi.spyOn(registry, 'getAllAgents').mockReturnValue([definition]);
  const runtime: AgentRuntime = { workspaceRoot, config, options: {} };
  const executor = new ActionExecutor({
    runtime, files: new FileActionManager(workspaceRoot),
    resolveWorkspacePath: relativePath => path.resolve(workspaceRoot, relativePath),
    confirmDangerousAction: async () => false,
  });
  const executeForTool = vi.spyOn(executor, 'executeForTool');
  if (mode === 'image' || mode === 'missing-image') {
    const execute = ActionExecutor.prototype.executeForTool.bind(executor);
    executeForTool.mockImplementation(async (action, context) => ({
      ...await execute(action, context), imagePaths: [imagePath],
    }));
  }
  const addMessage = vi.spyOn(ConversationManager.prototype, 'addMessage');
  const budget = new SessionThreadBudget(() => 2);
  const onSubagentStart = vi.fn();
  const onSubagentStop = vi.fn();
  const onSubagentProgress = vi.fn();
  const parent = new SubAgent({ ...definition, name: 'wire-parent', model: 'moa', systemPrompt: 'WIRE_PARENT: Delegate source inspection.' },
    ProviderFactory.create(config), executor, {
      clientContext: 'cli', depth: 0, maxDepth: 2, model: 'moa', featureConfig: config, workspaceRoot,
      threadBudget: budget, parentId: 'main-session', onSubagentStart, onSubagentStop, onSubagentProgress,
      resolveSubagentAssignment: agent => resolveTeamModelAssignment({
        config, active: { provider: 'autohandai', model: 'moa' },
        agentName: agent.name, agentModel: agent.model, environment: {},
      }),
      createSubagentProvider: assignment => {
        const provider = ProviderFactory.create({ ...config, provider: assignment.provider });
        provider.setModel(assignment.model);
        return provider;
      },
    });
  return { parent, requests, requestPaths, childRequested, budget, executeForTool,
    onSubagentStart, onSubagentStop, onSubagentProgress, addMessage, imageBytes };
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  for (const workspace of workspaces.splice(0)) await fs.rm(workspace, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('Autohand AI native delegation wire protocol', () => {
  it('delivers real child screenshot bytes after native tool results without persisting base64', async () => {
    const state = await fixture('image');
    await expect(state.parent.run('Verify the screenshot with the reader.')).resolves.toBe('PARENT_VERIFIED_CHILD_RESULT');
    const childRequest = state.requests[2];
    const resultIndex = childRequest.messages.findIndex(message => message.tool_call_id === 'child-read-call');
    const carrier = childRequest.messages[resultIndex + 1];
    expect(carrier).toMatchObject({ role: 'user', content: expect.arrayContaining([
      { type: 'image_url', image_url: { url: expect.stringMatching(/^data:image\/png;base64,/) } },
    ]) });
    const image = Array.isArray(carrier.content) ? carrier.content.find(part => part.type === 'image_url') : undefined;
    if (image?.type !== 'image_url') throw new Error('Expected child screenshot image');
    const decoded = sharp(Buffer.from(image.image_url.url.split(',')[1], 'base64'));
    expect(await decoded.metadata()).toMatchObject({ format: 'png', width: 8, height: 8 });
    expect([...await decoded.raw().toBuffer()]).toEqual([...await sharp(state.imageBytes).raw().toBuffer()]);
    expect(childRequest.messages[resultIndex]).toMatchObject({
      role: 'tool', tool_call_id: 'child-read-call', content: expect.stringContaining('NATIVE_CHILD_FILE_CONTENT'),
    });
    expect(state.addMessage.mock.calls.every(([message]) => typeof message.content === 'string')).toBe(true);
    expect(JSON.stringify(state.addMessage.mock.calls)).not.toContain('data:image/');
    expect(state.budget.activeChildren).toBe(0);
  });

  it('reports unavailable child screenshot evidence in the native result instead of implying inspection', async () => {
    const state = await fixture('missing-image');
    await state.parent.run('Verify the screenshot with the reader.');
    const result = state.requests[2].messages.find(message => message.tool_call_id === 'child-read-call');
    expect(result?.content).toEqual(expect.stringMatching(/image.*unavailable|unable.*image|image.*failed/i));
    expect(JSON.stringify(state.requests[2].messages)).not.toContain('data:image/');
  });

  it('round-trips parent delegation, child native filesystem tools, reasoning, and result IDs', async () => {
    const state = await fixture('success');
    await expect(state.parent.run('Verify the fixture using the installed reader.'))
      .resolves.toBe('PARENT_VERIFIED_CHILD_RESULT');
    expect(state.requests).toHaveLength(4);
    expect(state.requestPaths).toEqual(Array(4).fill('/v1/chat/completions'));
    for (const request of state.requests) {
      expect(request.model).toBe('moa');
      expect(request.extra_body.chat_template_kwargs.reasoning_effort).toBe('xhigh');
      expect(request.tool_choice).toBe('auto');
      expect(request.tools.every(tool => tool.type === 'function')).toBe(true);
    }
    const [parent, child, childResult, parentResult] = state.requests;
    expect(parent.messages[0].content).toContain('wire-reader');
    expect(parent.tools.find(tool => tool.function.name === 'delegate_parallel')?.function.parameters)
      .toMatchObject({ properties: { tasks: { type: 'array', items: { type: 'object' } } } });
    expect(child.tools.map(tool => tool.function.name)).toContain('read_file');
    expect(child.tools.map(tool => tool.function.name)).not.toContain('write_file');
    expect(childResult.messages).toContainEqual(expect.objectContaining({
      role: 'assistant', tool_calls: [toolCall('read_file', { path: 'fixture.txt' }, 'child-read-call')],
    }));
    expect(childResult.messages).toContainEqual(expect.objectContaining({
      role: 'tool', tool_call_id: 'child-read-call', content: expect.stringContaining('NATIVE_CHILD_FILE_CONTENT'),
    }));
    expect(parentResult.messages).toContainEqual(expect.objectContaining({
      role: 'assistant', tool_calls: [toolCall('delegate_task', {
        agent_name: 'wire-reader', task: 'Read fixture.txt and report its contents.',
      }, 'parent-delegate-call')],
    }));
    expect(parentResult.messages).toContainEqual(expect.objectContaining({
      role: 'tool', tool_call_id: 'parent-delegate-call', content: expect.stringContaining('CHILD_VERIFIED:'),
    }));
    expect(state.executeForTool).toHaveBeenCalledOnce();
    expect(state.onSubagentStart).toHaveBeenCalledWith(expect.objectContaining({
      parentId: 'main-session', depth: 1, model: 'moa', provider: 'autohandai',
    }));
    expect(state.onSubagentStop).toHaveBeenCalledWith(expect.objectContaining({
      status: 'completed', success: true, usage: { promptTokens: 22, completionTokens: 14, totalTokens: 36 },
      result: expect.stringContaining('NATIVE_CHILD_FILE_CONTENT'),
    }));
    expect(state.budget.activeChildren).toBe(0);
  });

  it('returns a native child HTTP failure to the parent without claiming child completion', async () => {
    const state = await fixture('failure');
    await expect(state.parent.run('Verify the fixture.')).resolves.toBe('PARENT_OBSERVED_CHILD_FAILURE');
    expect(state.requests).toHaveLength(3);
    expect(state.requests[2].messages).toContainEqual(expect.objectContaining({
      role: 'tool', tool_call_id: 'parent-delegate-call', content: expect.stringContaining('Native child unavailable'),
    }));
    expect(state.onSubagentStop).toHaveBeenCalledOnce();
    expect(state.onSubagentStop).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', success: false }));
    expect(state.executeForTool).not.toHaveBeenCalled();
    expect(state.budget.activeChildren).toBe(0);
  });

  it('aborts an in-flight child HTTP request and releases the shared session slot', async () => {
    const state = await fixture('cancel');
    const controller = new AbortController();
    const run = state.parent.run('Verify the fixture.', { signal: controller.signal });
    const outcome = expect(run).rejects.toMatchObject({ name: 'AbortError' });
    await state.childRequested.promise;
    expect(state.budget.activeChildren).toBe(1);
    controller.abort();
    await outcome;
    expect(state.requests).toHaveLength(2);
    expect(state.executeForTool).not.toHaveBeenCalled();
    expect(state.onSubagentStop).toHaveBeenCalledOnce();
    expect(state.onSubagentStop).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled', success: false }));
    expect(state.budget.activeChildren).toBe(0);
  });
});
