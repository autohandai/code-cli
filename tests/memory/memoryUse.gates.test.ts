/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * `agent.useMemories` must keep stored memories away from the model on every path that reads
 * them. Each test stores a real memory and drives the production function that builds the
 * model-facing text or tool list; nothing here re-implements a gate.
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionExecutor } from '../../src/core/actionExecutor.js';
import { AutohandAgent } from '../../src/core/agent.js';
import {
  buildAgentTurnContext,
  generateAgentSessionBootstrap,
  type AgentContextRuntimeHost,
} from '../../src/core/agent/AgentContextRuntime.js';
import { SystemPromptBuilder } from '../../src/core/agent/SystemPromptBuilder.js';
import { SubAgent } from '../../src/core/agents/SubAgent.js';
import { ConversationManager } from '../../src/core/conversationManager.js';
import { DEFAULT_TOOL_DEFINITIONS, ToolManager } from '../../src/core/toolManager.js';
import { MemoryManager, type ProjectMemoryAdapter } from '../../src/memory/MemoryManager.js';
import { MEMORY_READ_TOOLS, areMemoriesUsed, isMemoryReadToolWithheld } from '../../src/memory/memoryUse.js';
import type { LLMProvider } from '../../src/providers/LLMProvider.js';
import type { AgentRuntime, LoadedConfig } from '../../src/types.js';

const USER_FACT = 'Quokka-7741: the user wants answers in British English.';
const PROJECT_FACT = 'Wombat-9903: this repository runs tests with Vitest.';
const TEAM_FACT = 'Numbat-5512: the team deploys on Thursdays.';

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.remove(root)));
});

async function createFixture(options: { shared?: boolean } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-use-memories-'));
  roots.push(root);
  const workspaceRoot = path.join(root, 'workspace');
  const team: { directory?: string } = {};
  const adapter: ProjectMemoryAdapter = {
    refresh: async () => {},
    publish: async () => {},
    directory: () => team.directory,
    assertWritable: () => {},
  };
  const createManager = () => new MemoryManager(workspaceRoot, {
    userMemoryDir: path.join(root, 'user-memory'),
    ...(options.shared ? { projectMemory: adapter } : {}),
  });
  const memoryManager = createManager();
  await memoryManager.initialize();
  await memoryManager.store(USER_FACT, 'user');
  await memoryManager.store(PROJECT_FACT, 'project');
  if (options.shared) {
    team.directory = path.join(root, 'team-cache');
    await memoryManager.store(TEAM_FACT, 'project');
  }
  const config: LoadedConfig = {
    configPath: path.join(root, 'config.json'),
    // Code mode would replace the advertised tools with its two wrappers; these tests read the list itself.
    features: { adaptiveSkills: false, codeMode: false },
    agent: {},
  };
  const runtime = { config, workspaceRoot, options: {} } as AgentRuntime;
  return { root, workspaceRoot, memoryManager, config, runtime };
}

type Fixture = Awaited<ReturnType<typeof createFixture>>;

function promptBuilder({ runtime, memoryManager }: Fixture): SystemPromptBuilder {
  return new SystemPromptBuilder({
    runtime,
    getToolDefinitions: () => DEFAULT_TOOL_DEFINITIONS.filter((tool) => !isMemoryReadToolWithheld(tool.name, runtime.config)),
    getContextMemories: () => memoryManager.getContextMemories(),
    loadInstructionFiles: async () => [],
    listSkills: () => [],
    getActiveSkills: () => [],
    getTeam: () => null,
  });
}

function contextHost(fixture: Fixture): AgentContextRuntimeHost {
  const conversation = new ConversationManager();
  const host = {
    runtime: fixture.runtime,
    conversation,
    ignoreFilter: { isIgnored: () => false },
    mentionResolver: { flush: () => null },
    skillsRegistry: { activateMentionedSkills: () => [], getSkill: () => null, getActiveSkills: () => [] },
    memoryManager: fixture.memoryManager,
    buildSystemPrompt: () => promptBuilder(fixture).build(),
    generateSessionBootstrap: () => generateAgentSessionBootstrap(host),
  } as unknown as AgentContextRuntimeHost;
  return host;
}

const systemText = (conversation: ConversationManager): string =>
  conversation.history().filter((message) => message.role === 'system').map((message) => message.content).join('\n');

describe('the agent.useMemories setting', () => {
  it('is on unless explicitly turned off', () => {
    expect(areMemoriesUsed(undefined)).toBe(true);
    expect(areMemoriesUsed({})).toBe(true);
    expect(areMemoriesUsed({ agent: {} })).toBe(true);
    expect(areMemoriesUsed({ agent: { useMemories: true } })).toBe(true);
    expect(areMemoriesUsed({ agent: { useMemories: false } })).toBe(false);
  });

  it('withholds exactly the tools that read memories back to the model', () => {
    expect([...MEMORY_READ_TOOLS].sort()).toEqual(['inspect_memory', 'recall_memory']);
    const off = { agent: { useMemories: false } };
    expect(isMemoryReadToolWithheld('recall_memory', off)).toBe(true);
    expect(isMemoryReadToolWithheld('inspect_memory', off)).toBe(true);
    expect(isMemoryReadToolWithheld('save_memory', off)).toBe(false);
    expect(isMemoryReadToolWithheld('delete_memory', off)).toBe(false);
    expect(isMemoryReadToolWithheld('recall_memory', { agent: {} })).toBe(false);
  });
});

describe('system prompt', () => {
  it('carries stored memories and the recall guidance while memories are used', async () => {
    const prompt = await promptBuilder(await createFixture()).build();

    expect(prompt).toContain('## User Preferences & Memory');
    expect(prompt).toContain(USER_FACT);
    expect(prompt).toContain(PROJECT_FACT);
    expect(prompt).toContain('recall_memory');
  });

  it('carries no stored memory and no pointer to the read tools once turned off, but still explains saving', async () => {
    const fixture = await createFixture();
    fixture.config.agent = { useMemories: false };
    const read = vi.spyOn(fixture.memoryManager, 'getContextMemories');

    const prompt = await promptBuilder(fixture).build();

    expect(prompt).not.toContain(USER_FACT);
    expect(prompt).not.toContain(PROJECT_FACT);
    expect(prompt).not.toContain('## User Preferences & Memory');
    expect(prompt).not.toContain('recall_memory');
    expect(prompt).not.toContain('inspect_memory');
    expect(prompt).toContain('save_memory');
    expect(read).not.toHaveBeenCalled();
  });
});

describe('session bootstrap', () => {
  it('lists memories only while they are used', async () => {
    const fixture = await createFixture();
    const host = contextHost(fixture);

    const on = await generateAgentSessionBootstrap(host);
    fixture.config.agent = { useMemories: false };
    const off = await generateAgentSessionBootstrap(host);

    expect(on).toContain('## Memories & Preferences');
    expect(on).toContain(USER_FACT);
    expect(off).not.toContain(USER_FACT);
    expect(off).not.toContain(PROJECT_FACT);
    expect(off).not.toContain('## Memories & Preferences');
  });
});

describe('per-turn context and shared team project memory', () => {
  it('adds the team snapshot each turn only while memories are used', async () => {
    const fixture = await createFixture({ shared: true });
    const host = contextHost(fixture);
    host.conversation.reset('System instructions');

    const on = await buildAgentTurnContext(host, 'continue the work');
    fixture.config.agent = { useMemories: false };
    const read = vi.spyOn(fixture.memoryManager, 'getSharedProjectContext');
    const off = await buildAgentTurnContext(host, 'continue the work');

    expect(on).toContain(TEAM_FACT);
    expect(off).not.toContain(TEAM_FACT);
    expect(off).toContain('Workspace:');
    expect(read).not.toHaveBeenCalled();
  });
});

describe('toggling between two turns of a running conversation', () => {
  async function startedConversation(shared = false) {
    const fixture = await createFixture({ shared });
    const host = contextHost(fixture);
    const conversation = host.conversation as ConversationManager;
    conversation.reset(await host.buildSystemPrompt());
    conversation.addSystemNote(await host.generateSessionBootstrap(), '[Session Bootstrap]');
    conversation.addSystemNote(`[Auto Memory Update] Background reflection saved these memories for future turns:\n- user: ${USER_FACT}`, '[Auto Memory Update]');
    const runTurn = async (instruction: string) => {
      conversation.addMessage({ role: 'user', content: instruction });
      conversation.addSystemNote(await buildAgentTurnContext(host, instruction));
      conversation.addMessage({ role: 'assistant', content: `Done: ${instruction}` });
    };
    return { fixture, host, conversation, runTurn };
  }

  it('removes every injected memory before the next turn and keeps the transcript', async () => {
    const { fixture, conversation, runTurn } = await startedConversation(true);
    await runTurn('first request');
    expect(systemText(conversation)).toContain(USER_FACT);
    expect(systemText(conversation)).toContain(TEAM_FACT);

    fixture.config.agent = { useMemories: false };
    await runTurn('second request');

    const system = systemText(conversation);
    expect(system).not.toContain(USER_FACT);
    expect(system).not.toContain(PROJECT_FACT);
    expect(system).not.toContain(TEAM_FACT);
    expect(system).not.toContain('recall_memory');
    expect(conversation.history()[0].content).toContain('save_memory');
    expect(conversation.history().filter((message) => message.role !== 'system').map((message) => message.content)).toEqual([
      'first request', 'Done: first request', 'second request', 'Done: second request',
    ]);
  });

  it('brings memories back the turn after it is turned on again', async () => {
    const { fixture, conversation, runTurn } = await startedConversation(true);
    fixture.config.agent = { useMemories: false };
    await runTurn('first request');
    expect(systemText(conversation)).not.toContain(USER_FACT);

    fixture.config.agent = { useMemories: true };
    await runTurn('second request');

    expect(conversation.history()[0].content).toContain(USER_FACT);
    expect(systemText(conversation)).toContain(TEAM_FACT);
    expect(systemText(conversation)).toContain('## Memories & Preferences');
  });

  it('rebuilds the system prompt only when the setting changed', async () => {
    const { fixture, host, runTurn } = await startedConversation();
    const build = vi.spyOn(host, 'buildSystemPrompt');

    await runTurn('first request');
    await runTurn('second request');
    expect(build).not.toHaveBeenCalled();

    fixture.config.agent = { useMemories: false };
    await runTurn('third request');
    await runTurn('fourth request');
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('cleans a conversation that starts with the switch already off, such as a resumed session', async () => {
    const { fixture, conversation } = await startedConversation();
    const resumed = contextHost(fixture);
    const restored = new ConversationManager();
    restored.reset('System instructions');
    for (const message of conversation.history().slice(1)) restored.addMessage(message);
    resumed.conversation = restored;
    fixture.config.agent = { useMemories: false };

    restored.addSystemNote(await buildAgentTurnContext(resumed, 'continue'));

    expect(systemText(restored)).not.toContain(USER_FACT);
    expect(systemText(restored)).toContain('[Session Bootstrap]');
  });
});

describe('advertised tools', () => {
  function toolManager(config: LoadedConfig, executor = vi.fn(async () => 'ran')) {
    const manager = new ToolManager({
      executor,
      confirmApproval: async () => ({ decision: 'allow_once' }) as never,
      isToolWithheld: (name) => isMemoryReadToolWithheld(name, config),
    });
    return { manager, executor };
  }
  const names = (manager: ToolManager): string[] => manager.listDefinitions().map((tool) => tool.name);

  it('offers the memory read tools while memories are used', async () => {
    const { config } = await createFixture();
    const { manager } = toolManager(config);

    expect(names(manager)).toEqual(expect.arrayContaining(['recall_memory', 'inspect_memory', 'save_memory', 'delete_memory']));
    expect(manager.toFunctionDefinitions().map((tool) => tool.name)).toContain('recall_memory');
  });

  it('withholds them from every listing once turned off, live, and keeps the write tools', async () => {
    const { config } = await createFixture();
    const { manager } = toolManager(config);

    config.agent = { useMemories: false };

    expect(names(manager)).not.toContain('recall_memory');
    expect(names(manager)).not.toContain('inspect_memory');
    expect(names(manager)).toEqual(expect.arrayContaining(['save_memory', 'delete_memory']));
    expect(manager.toFunctionDefinitions().map((tool) => tool.name)).not.toContain('recall_memory');
    expect(manager.listToolNames()).not.toContain('inspect_memory');
    expect(manager.isToolAllowed('recall_memory')).toBe(false);
    expect(manager.isToolAllowed('save_memory')).toBe(true);
  });

  it('refuses a call to a withheld tool without running it', async () => {
    const { config } = await createFixture();
    config.agent = { useMemories: false };
    const { manager, executor } = toolManager(config);

    const [result] = await manager.execute([{ id: 'call-1', tool: 'recall_memory', args: { query: 'language' } }]);

    expect(result.success).toBe(false);
    expect(result.error).toContain('recall_memory');
    expect(executor).not.toHaveBeenCalled();
  });
});

describe('executing memory tools', () => {
  function executor({ runtime, memoryManager, workspaceRoot }: Fixture): ActionExecutor {
    return new ActionExecutor({
      runtime,
      files: {} as never,
      memoryManager,
      resolveWorkspacePath: (relativePath) => path.resolve(workspaceRoot, relativePath),
      confirmDangerousAction: async () => true,
    });
  }

  it('returns stored memories while memories are used', async () => {
    const fixture = await createFixture();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(await executor(fixture).execute({ type: 'recall_memory', query: 'British English' })).toContain(USER_FACT);
    expect(await executor(fixture).execute({ type: 'inspect_memory', operation: 'outline', level: 'user' })).toContain('Quokka-7741');
  });

  it('returns no memory content once turned off, whichever way the call arrived', async () => {
    const fixture = await createFixture();
    fixture.config.agent = { useMemories: false };
    const recall = vi.spyOn(fixture.memoryManager, 'recall');
    const outline = vi.spyOn(fixture.memoryManager, 'getMemoryOutline');

    const recalled = await executor(fixture).execute({ type: 'recall_memory' });
    const inspected = await executor(fixture).execute({ type: 'inspect_memory', operation: 'outline', level: 'user' });

    for (const output of [recalled, inspected]) {
      expect(output).toContain('Memory use is turned off');
      expect(output).not.toContain('Quokka-7741');
    }
    expect(recall).not.toHaveBeenCalled();
    expect(outline).not.toHaveBeenCalled();
  });

  it('still saves a memory while use is off: writing is a separate switch', async () => {
    const fixture = await createFixture();
    fixture.config.agent = { useMemories: false, autoMemory: true };
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await executor(fixture).execute({ type: 'save_memory', fact: 'Bilby-2210: prefers pnpm.', level: 'user' });

    expect((await fixture.memoryManager.list('user')).map((entry) => entry.content)).toContain('Bilby-2210: prefers pnpm.');
  });
});

describe('sub-agents', () => {
  function provider(requests: Array<Parameters<LLMProvider['complete']>[0]>): LLMProvider {
    return {
      getName: () => 'autohandai',
      complete: async (request) => { requests.push(request); return { content: 'Reviewed.' }; },
      getCapabilities: () => ({ nativeToolCalling: true }),
      listModels: async () => [], isAvailable: async () => true, setModel: () => {},
    } as unknown as LLMProvider;
  }

  async function runWorker(fixture: Fixture) {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const requests: Array<Parameters<LLMProvider['complete']>[0]> = [];
    const agent = new SubAgent({
      name: 'reader', description: 'Read source', systemPrompt: 'Inspect source.',
      tools: ['read_file', 'recall_memory', 'inspect_memory', 'save_memory'], path: '/tmp/reader.md',
    }, provider(requests), {} as ActionExecutor, {
      workspaceRoot: fixture.workspaceRoot, clientContext: 'cli', depth: 1, maxDepth: 1, featureConfig: fixture.config,
    });
    await agent.run('Review the tests without edits.');
    return {
      text: requests[0].messages.map((message) => String(message.content)).join('\n'),
      tools: requests[0].tools?.map((tool) => tool.name) ?? [],
    };
  }

  it('receive project lessons and the read tools while memories are used', async () => {
    const worker = await runWorker(await createFixture());

    expect(worker.text).toContain(PROJECT_FACT);
    expect(worker.tools).toEqual(expect.arrayContaining(['recall_memory', 'inspect_memory', 'save_memory']));
  });

  it('receive no stored lesson and no read tool once turned off, and can still save', async () => {
    const fixture = await createFixture();
    fixture.config.agent = { useMemories: false };
    const list = vi.spyOn(MemoryManager.prototype, 'list');

    const worker = await runWorker(fixture);

    expect(worker.text).not.toContain(PROJECT_FACT);
    expect(worker.text).toContain('Memory use is turned off');
    expect(worker.text).toContain('save_memory');
    expect(worker.tools).toEqual(['read_file', 'save_memory']);
    expect(list).not.toHaveBeenCalled();
  });
});

describe('automatic memory generation while use is off', () => {
  function reflectingAgent(fixture: Fixture) {
    const agent = Object.create(AutohandAgent.prototype) as Record<string, unknown> & {
      scheduleTurnMemoryReflection(outcome: { status: string }): void;
      turnMemoryReflectionInFlight?: Promise<void>;
    };
    const conversation = {
      history: () => [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'please remember how I like commits' },
        { role: 'assistant', content: 'I will.' },
      ],
      addSystemNote: vi.fn(),
    };
    const setCommandResult = vi.fn();
    agent.runtime = { ...fixture.runtime, isCommandMode: false };
    agent.llm = {
      complete: async () => ({
        id: 'reflection', created: Date.now(), raw: {},
        content: JSON.stringify([{ content: 'Bandicoot-3318: the user wants small commits.', level: 'user', tags: ['workflow'] }]),
      }),
    };
    agent.memoryManager = fixture.memoryManager;
    agent.conversation = conversation;
    agent.inkRenderer = { setCommandResult };
    agent.writeDebugLine = vi.fn();
    return { agent, conversation, setCommandResult };
  }

  it('stores the memory and shows the receipt, but does not feed it back into the conversation', async () => {
    const fixture = await createFixture();
    fixture.config.agent = { useMemories: false, autoMemory: true };
    const { agent, conversation, setCommandResult } = reflectingAgent(fixture);

    agent.scheduleTurnMemoryReflection({ status: 'succeeded' });
    await agent.turnMemoryReflectionInFlight;

    expect((await fixture.memoryManager.list('user')).map((entry) => entry.content)).toContain('Bandicoot-3318: the user wants small commits.');
    expect(setCommandResult).toHaveBeenCalledWith('/memory', expect.stringContaining('Bandicoot-3318'));
    expect(conversation.addSystemNote).not.toHaveBeenCalled();
  });

  it('feeds a newly saved memory into the conversation while memories are used', async () => {
    const fixture = await createFixture();
    const { agent, conversation } = reflectingAgent(fixture);

    agent.scheduleTurnMemoryReflection({ status: 'succeeded' });
    await agent.turnMemoryReflectionInFlight;

    expect(conversation.addSystemNote).toHaveBeenCalledWith(expect.stringContaining('Bandicoot-3318'), '[Auto Memory Update]');
  });
});
