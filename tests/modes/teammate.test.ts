import { describe, it, expect, vi } from "vitest";
import { PassThrough } from "node:stream";
import { BackgroundProcessRegistry } from "../../src/core/agent/BackgroundProcessRegistry.js";
import * as commandActions from '../../src/actions/command.js';

const actionExecutorConstructor = vi.hoisted(() => vi.fn());
const executeTeammateTool = vi.hoisted(() => vi.fn(async () => ({ success: true, output: 'written' })));

// Mock heavy dependencies before importing
vi.mock("../../src/config.js", () => ({
  getProviderConfig: vi.fn().mockReturnValue({ model: 'test-model' }),
  loadConfig: vi.fn().mockResolvedValue({
    provider: "openrouter",
    openrouter: {
      apiKey: "test-key",
      baseUrl: "https://test.com",
      model: "test-model",
    },
    configPath: "/tmp/config.json",
    isNewConfig: false,
  }),
}));

vi.mock("../../src/providers/ProviderFactory.js", () => ({
  ProviderFactory: {
    create: vi.fn().mockReturnValue({
      getName: () => "mock",
      getCapabilities: () => ({ nativeToolCalling: true }),
      complete: vi
        .fn()
        .mockResolvedValue({ content: '{"finalResponse": "Done"}' }),
      setModel: vi.fn(),
    }),
  },
}));

vi.mock("../../src/core/agents/AgentRegistry.js", () => ({
  AgentRegistry: {
    getInstance: vi.fn().mockReturnValue({
      configureExternalAgents: vi.fn(),
      loadAgents: vi.fn().mockResolvedValue(undefined),
      getAllAgents: vi.fn().mockReturnValue([]),
      setExtensionAgents: vi.fn(),
      getAgent: vi.fn().mockReturnValue({
        name: "tester",
        description: "Writes tests",
        systemPrompt: "You write tests.",
        tools: ["*"],
        path: "/tmp/tester.md",
        source: "builtin" as const,
      }),
    }),
  },
}));

vi.mock("../../src/core/toolsRegistry.js", () => ({
  createToolsRegistry: vi.fn().mockReturnValue({
    initialize: vi.fn().mockResolvedValue(undefined),
    listMetaTools: vi.fn().mockReturnValue([]),
    setExtensionTools: vi.fn(),
    toToolDefinitions: vi.fn().mockReturnValue([]),
  }),
}));

vi.mock("../../src/core/agent/dynamicRuntimeExtensions.js", () => ({
  syncDynamicRuntimeExtensions: vi.fn().mockImplementation(async (host) => {
    host.toolManager.replaceRuntimeMetaTools([{
      name: "find_todos",
      description: "Find TODO and FIXME markers",
      parameters: { type: "object", properties: {} },
    }]);
    return { extensions: [], tools: [], agents: [], diagnostics: [] };
  }),
}));

vi.mock("../../src/core/actionExecutor.js", () => ({
  ActionExecutor: class {
    constructor(options: unknown) {
      actionExecutorConstructor(options);
    }
    getPermissionContext() { return undefined; }
    executeForTool = executeTeammateTool;
  },
}));

vi.mock("../../src/actions/filesystem.js", () => ({
  FileActionManager: class {
    constructor() {}
  },
}));

import {
  executeTask,
  parseTeammateOptions,
  runTeammateModeWithStreams,
  withTeammateTaskEnvironment,
} from "../../src/modes/teammate.js";
import type { TeammateOptions } from "../../src/modes/teammate.js";

describe("parseTeammateOptions", () => {
  it("should parse all required options", () => {
    const argv = [
      "node",
      "autohand",
      "--mode",
      "teammate",
      "--team",
      "code-cleanup",
      "--name",
      "hunter",
      "--agent",
      "code-cleaner",
      "--lead-session",
      "session-123",
    ];
    const opts = parseTeammateOptions(argv);
    expect(opts).toEqual({
      teamName: "code-cleanup",
      name: "hunter",
      agentName: "code-cleaner",
      leadSessionId: "session-123",
      model: undefined,
      workspacePath: undefined,
      configPath: undefined,
    });
  });

  it("should parse optional model and path", () => {
    const argv = [
      "node",
      "autohand",
      "--mode",
      "teammate",
      "--team",
      "test-team",
      "--name",
      "tester",
      "--agent",
      "tester",
      "--lead-session",
      "session-456",
      "--model",
      "your-modelcard-id-here",
      "--path",
      "/tmp/workspace",
      "--config",
      "/tmp/team-config.json",
    ];
    const opts = parseTeammateOptions(argv);
    expect(opts?.model).toBe("your-modelcard-id-here");
    expect(opts?.workspacePath).toBe("/tmp/workspace");
    expect(opts?.configPath).toBe("/tmp/team-config.json");
  });

  it("should return null when required options are missing", () => {
    const argv = ["node", "autohand", "--mode", "teammate", "--team", "test"];
    expect(parseTeammateOptions(argv)).toBeNull();
  });

  it("should return null when no teammate flags are present", () => {
    const argv = ["node", "autohand"];
    expect(parseTeammateOptions(argv)).toBeNull();
  });
});

describe('headless teammate tool authorization', () => {
  it('does not execute a write without a live lead authorization seam', async () => {
    const { ProviderFactory } = await import('../../src/providers/ProviderFactory.js');
    const provider = ProviderFactory.create({} as never);
    const complete = vi.mocked(provider.complete);
    complete.mockClear();
    executeTeammateTool.mockClear();
    complete.mockResolvedValueOnce({ content: '', toolCalls: [{
      id: 'write-call', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'protected.txt', contents: 'x' }) },
    }] });
    await executeTask({ teamName: 'test', name: 'writer', agentName: 'tester', leadSessionId: 'session' }, {
      id: 'task', runId: 'attempt', subject: 'Write', description: 'Write a file', status: 'in_progress', blockedBy: [], createdAt: '',
    });
    expect(executeTeammateTool).not.toHaveBeenCalled();
    expect(complete.mock.calls[1][0].messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'tool', content: expect.stringContaining('authorization') }),
    ]));
  });

  it('requests the lead decision for the current attempt before executing a native write', async () => {
    const { ProviderFactory } = await import('../../src/providers/ProviderFactory.js');
    const complete = vi.mocked(ProviderFactory.create({} as never).complete);
    complete.mockResolvedValueOnce({ content: '', toolCalls: [{
      id: 'write-call', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'original.txt', contents: 'x' }) },
    }] });
    executeTeammateTool.mockClear();
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const requests: Record<string, unknown>[] = [];
    stdout.on('data', (data) => {
      for (const line of data.toString().trim().split('\n')) {
        const message = JSON.parse(line);
        if (message.method === 'team.authorizeTool') {
          requests.push(message.params);
          expect(executeTeammateTool).not.toHaveBeenCalled();
          stdin.write(JSON.stringify({ method: 'team.authorizationResult', params: {
            requestId: message.params.requestId,
            result: { allowed: true, args: { path: 'reviewed.txt', contents: 'x' } },
          } }) + '\n');
        }
        if (message.method === 'team.idle') stdin.write(JSON.stringify({ method: 'team.shutdown', params: {} }) + '\n');
      }
    });
    const task = { id: 'task', runId: 'attempt', subject: 'Write', description: 'Write a file', status: 'in_progress', blockedBy: [], createdAt: '' };
    const run = runTeammateModeWithStreams({ teamName: 'test', name: 'writer', agentName: 'tester', leadSessionId: 'session' }, stdin, stdout);
    stdin.write(JSON.stringify({ method: 'team.assignTask', params: { task } }) + '\n');
    await run;
    expect(requests).toEqual([expect.objectContaining({ taskId: 'task', runId: 'attempt', call: expect.objectContaining({ tool: 'write_file' }) })]);
    expect(executeTeammateTool).toHaveBeenCalledWith(expect.objectContaining({ type: 'write_file', path: 'reviewed.txt' }), expect.anything());
  });
});

describe("teammate executeTask", () => {
  it('loads project lessons and supplies the teammate executor with workspace-scoped memory', async () => {
    const fs = await import('fs-extra');
    const os = await import('node:os');
    const path = await import('node:path');
    const { MemoryManager } = await import('../../src/memory/MemoryManager.js');
    const { ProviderFactory } = await import('../../src/providers/ProviderFactory.js');
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'teammate-project-lessons-'));
    const memory = new MemoryManager(workspaceRoot);
    const complete = vi.mocked(ProviderFactory.create({ provider: 'openrouter' }).complete);
    const captured: { memoryManager?: InstanceType<typeof MemoryManager> } = {};
    actionExecutorConstructor.mockImplementationOnce((deps: { memoryManager?: InstanceType<typeof MemoryManager> }) => {
      captured.memoryManager = deps.memoryManager;
    });
    try {
      await memory.store('The payment fixture verifies the selected checkout.', 'project');
      complete.mockClear();
      await executeTask({
        teamName: 'lessons', name: 'reader', agentName: 'tester', leadSessionId: 'lead', workspacePath: workspaceRoot,
      }, { id: 'lesson-task', subject: 'Review', description: 'Review the fixture without edits.', status: 'in_progress', blockedBy: [], createdAt: '' });

      expect(captured.memoryManager).toBeInstanceOf(MemoryManager);
      expect(complete.mock.calls[0][0].messages.map(message => String(message.content)).join('\n'))
        .toContain('The payment fixture verifies the selected checkout.');
      await captured.memoryManager?.store('The authorized writer verified the checkout build command.', 'project');
      expect((await memory.list('project')).map(entry => entry.content))
        .toContain('The authorized writer verified the checkout build command.');
    } finally {
      await fs.remove(workspaceRoot);
    }
  });

  it('preserves the original user request from IPC through the worker provider request', async () => {
    const { ProviderFactory } = await import('../../src/providers/ProviderFactory.js');
    const complete = vi.mocked(ProviderFactory.create({ provider: 'openrouter' }).complete);
    complete.mockClear();
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    stdout.on('data', (data: Buffer) => {
      for (const line of data.toString().trim().split('\n')) {
        const message: { method: string } = JSON.parse(line);
        if (message.method === 'team.idle') stdin.write(JSON.stringify({ method: 'team.shutdown', params: {} }) + '\n');
      }
    });
    const running = runTeammateModeWithStreams({
      teamName: 'scope', name: 'reader', agentName: 'tester', leadSessionId: 'lead',
      workspacePath: '/selected-repository/worktree',
    }, stdin, stdout);
    stdin.write(JSON.stringify({ method: 'team.assignTask', params: { task: {
      id: 'queued-review', runId: 'attempt', subject: 'Review payments', description: 'Inspect payment validation.',
      userRequest: 'Review the selected repository. Do not edit files.',
      status: 'in_progress', blockedBy: [], createdAt: '',
    } } }) + '\n');
    await running;

    expect(complete.mock.calls[0][0].messages).toEqual(expect.arrayContaining([
      { role: 'user', content: 'Original user request:\nReview the selected repository. Do not edit files.' },
      { role: 'user', content: 'Inspect payment validation.' },
      expect.objectContaining({ role: 'system', content: expect.stringContaining('/selected-repository/worktree') }),
    ]));
  });

  it('owns and cleans background processes when executed without a persistent teammate loop', async () => {
    const kill = vi.spyOn(commandActions, 'killProcessGroup').mockResolvedValue(undefined);
    actionExecutorConstructor.mockImplementationOnce((deps: { backgroundProcessRegistry?: BackgroundProcessRegistry }) => {
      deps.backgroundProcessRegistry?.register(4242, 'standalone command');
    });
    try {
      await executeTask({ teamName: 'standalone', name: 'worker', agentName: 'tester', leadSessionId: 'lead' }, {
        id: 'standalone-task', subject: 'Standalone', description: '', status: 'in_progress', blockedBy: [], createdAt: '',
      });
      expect(kill).toHaveBeenCalledWith(4242, 250);
    } finally {
      kill.mockRestore();
    }
  });

  it('shares the teammate background process registry with its action executor', async () => {
    const backgroundProcessRegistry = new BackgroundProcessRegistry();
    actionExecutorConstructor.mockClear();

    await executeTask({
      teamName: 'background', name: 'worker', agentName: 'tester', leadSessionId: 'lead',
    }, {
      id: 'background-task', subject: 'Start a server', description: 'Start a server',
      status: 'in_progress', blockedBy: [], createdAt: '',
    }, { backgroundProcessRegistry });

    expect(actionExecutorConstructor).toHaveBeenCalledWith(expect.objectContaining({ backgroundProcessRegistry }));
  });

  it("scopes task identity environment variables to one execution", async () => {
    const originalTaskId = process.env.AUTOHAND_TEAM_TASK_ID;
    delete process.env.AUTOHAND_TEAM_TASK_ID;

    try {
      await withTeammateTaskEnvironment(
        {
          teamName: "release-readiness",
          name: "planner",
          agentName: "repo-reader",
          leadSessionId: "lead-123",
        },
        {
          id: "task-17",
          subject: "Plan the rollout",
          description: "Produce the implementation sequence.",
          status: "in_progress",
          owner: "planner",
          blockedBy: [],
          createdAt: "",
        },
        async () => {
          expect(process.env).toMatchObject({
            AUTOHAND_TEAM_NAME: "release-readiness",
            AUTOHAND_TEAMMATE_NAME: "planner",
            AUTOHAND_TEAMMATE_AGENT: "repo-reader",
            AUTOHAND_TEAM_LEAD_SESSION_ID: "lead-123",
            AUTOHAND_TEAM_TASK_ID: "task-17",
            AUTOHAND_TEAM_TASK_SUBJECT: "Plan the rollout",
            AUTOHAND_TEAM_TASK_OWNER: "planner",
          });
        },
      );

      expect(process.env.AUTOHAND_TEAM_TASK_ID).toBeUndefined();
    } finally {
      if (originalTaskId === undefined) delete process.env.AUTOHAND_TEAM_TASK_ID;
      else process.env.AUTOHAND_TEAM_TASK_ID = originalTaskId;
    }
  });

  it("scopes goal tools to the teammate lead-session boundary", async () => {
    await executeTask(
      {
        teamName: "test",
        name: "worker",
        agentName: "tester",
        leadSessionId: "sess-goal-owner",
      },
      {
        id: "task-goal-owner",
        subject: "Inspect goal",
        description: "Inspect the active goal",
        status: "in_progress",
        blockedBy: [],
        createdAt: "",
      },
    );

    const options = actionExecutorConstructor.mock.calls.at(-1)?.[0] as {
      getCurrentSessionId?: () => string | undefined;
    };
    expect(options.getCurrentSessionId?.()).toBe("sess-goal-owner");
  });

  it("loads the configuration explicitly forwarded by the lead", async () => {
    const { loadConfig } = await import("../../src/config.js");
    const loadConfigMock = vi.mocked(loadConfig);
    loadConfigMock.mockClear();

    await executeTask(
      {
        teamName: "test",
        name: "worker",
        agentName: "tester",
        leadSessionId: "sess-config",
        workspacePath: "/tmp/workspace",
        configPath: "/tmp/team-config.json",
      },
      {
        id: "task-config",
        subject: "Inspect config",
        description: "Use the lead configuration",
        status: "in_progress",
        blockedBy: [],
        createdAt: "",
      },
    );

    expect(loadConfigMock).toHaveBeenCalledWith("/tmp/team-config.json", "/tmp/workspace");
  });

  it("loads registered agent definitions before resolving a headless teammate", async () => {
    const { AgentRegistry } = await import("../../src/core/agents/AgentRegistry.js");
    const registry = AgentRegistry.getInstance();
    registry.loadAgents.mockClear();

    await executeTask(
      {
        teamName: "test",
        name: "worker",
        agentName: "tester",
        leadSessionId: "sess-registry",
      },
      {
        id: "task-registry",
        subject: "Load agent",
        description: "Use the registered tester agent.",
        status: "in_progress",
        blockedBy: [],
        createdAt: "",
      },
    );

    expect(registry.loadAgents).toHaveBeenCalledOnce();
  });

  it("runs SubAgent and returns result", async () => {
    const result = await executeTask(
      {
        teamName: "test",
        name: "worker",
        agentName: "tester",
        leadSessionId: "sess-1",
      },
      {
        id: "task-1",
        subject: "Write tests",
        description: "Write unit tests for auth module",
        status: "in_progress",
        blockedBy: [],
        createdAt: "",
      },
    );
    expect(result).toContain("Done");
  });

  it("runs the teammate SubAgent engine with native tools instead of the legacy JSON protocol", async () => {
    const { ProviderFactory } = await import("../../src/providers/ProviderFactory.js");
    const provider = ProviderFactory.create({} as never) as {
      complete: ReturnType<typeof vi.fn>;
      getCapabilities(): { nativeToolCalling: boolean };
    };
    provider.complete.mockClear();

    await executeTask(
      {
        teamName: "test",
        name: "worker",
        agentName: "tester",
        leadSessionId: "sess-native",
      },
      {
        id: "task-native",
        subject: "Inspect tools",
        description: "Inspect the repository",
        status: "in_progress",
        blockedBy: [],
        createdAt: "",
      },
    );

    expect(provider.getCapabilities()).toEqual({ nativeToolCalling: true });
    const request = provider.complete.mock.calls[0]?.[0];
    expect(request?.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "read_file" }),
    ]));
    const prompt = request?.messages.find((message: { role: string }) => message.role === "system")?.content;
    expect(prompt).toContain("Use the native tool interface");
    expect(prompt).not.toContain("Always respond with structured JSON");
  });

  it("rejects an unknown agent instead of returning a successful-looking error string", async () => {
    const { AgentRegistry } =
      await import("../../src/core/agents/AgentRegistry.js");
    (AgentRegistry.getInstance().getAgent as any).mockReturnValueOnce(
      undefined,
    );

    const result = executeTask(
      {
        teamName: "test",
        name: "worker",
        agentName: "nonexistent",
        leadSessionId: "sess-1",
      },
      {
        id: "task-2",
        subject: "Fail",
        description: "",
        status: "in_progress",
        blockedBy: [],
        createdAt: "",
      },
    );
    await expect(result).rejects.toThrow('Agent "nonexistent" not found');
  });

  it("calls provider.setModel when opts.model is provided", async () => {
    const { ProviderFactory } =
      await import("../../src/providers/ProviderFactory.js");
    const mockProvider = ProviderFactory.create({} as any) as any;

    await executeTask(
      {
        teamName: "test",
        name: "worker",
        agentName: "tester",
        leadSessionId: "sess-1",
        model: "custom-model",
      },
      {
        id: "task-3",
        subject: "Test",
        description: "test",
        status: "in_progress",
        blockedBy: [],
        createdAt: "",
      },
    );
    expect(mockProvider.setModel).toHaveBeenCalledWith("custom-model");
  });

  it("creates the teammate provider selected by the lead", async () => {
    const { ProviderFactory } = await import("../../src/providers/ProviderFactory.js");
    const createMock = ProviderFactory.create as ReturnType<typeof vi.fn>;
    createMock.mockClear();

    await executeTask(
      {
        teamName: "test",
        name: "worker",
        agentName: "tester",
        leadSessionId: "sess-provider",
        provider: "autohandai",
        model: "fantail",
      },
      {
        id: "task-provider",
        subject: "Use Fantail",
        description: "Use the team provider assignment.",
        status: "in_progress",
        blockedBy: [],
        createdAt: "",
      },
    );

    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ provider: "autohandai" }));
  });

  it('isolates provider clients for nested teammates and retains the lead-selected model', async () => {
    const { ProviderFactory } = await import('../../src/providers/ProviderFactory.js');
    const { SessionThreadBudget } = await import('../../src/core/agents/SessionThreadBudget.js');
    const factory = vi.mocked(ProviderFactory.create);
    const provider = factory({} as never);
    const complete = vi.mocked(provider.complete);
    factory.mockClear();
    complete.mockResolvedValueOnce({ content: '', toolCalls: [{ id: 'nested-call', type: 'function', function: {
      name: 'delegate_task', arguments: JSON.stringify({ agent_name: 'tester', task: 'Nested review' }),
    } }] });
    complete.mockResolvedValueOnce({ content: 'Nested review complete' });
    complete.mockResolvedValueOnce({ content: 'Parent complete' });

    await executeTask({ teamName: 'nested', name: 'worker', agentName: 'tester', leadSessionId: 'session', provider: 'autohandai', model: 'fantail' },
      { id: 'nested-model', subject: 'Review', description: 'Parent task', status: 'in_progress', blockedBy: [], createdAt: '' },
      { threadBudget: new SessionThreadBudget(() => 3), authorizeTool: async context => ({ allowed: true, args: context.args }) });

    expect(factory).toHaveBeenCalledTimes(2);
    expect(factory).toHaveBeenNthCalledWith(2, expect.objectContaining({ provider: 'autohandai' }));
    expect(provider.setModel).toHaveBeenLastCalledWith('fantail');
  });

  it("discovers extension agents and tools before starting the teammate sub-agent", async () => {
    const { syncDynamicRuntimeExtensions } = await import(
      "../../src/core/agent/dynamicRuntimeExtensions.js"
    );
    const { ProviderFactory } = await import("../../src/providers/ProviderFactory.js");
    const extensionsMock = syncDynamicRuntimeExtensions as unknown as { mockClear(): void };
    const provider = ProviderFactory.create({} as never) as {
      complete: ReturnType<typeof vi.fn>;
    };
    extensionsMock.mockClear();
    provider.complete.mockClear();

    await executeTask(
      {
        teamName: "test",
        name: "worker",
        agentName: "tester",
        leadSessionId: "sess-extension",
        workspacePath: "/tmp/extension-workspace",
      },
      {
        id: "task-extension",
        subject: "Inspect TODOs",
        description: "Inspect TODOs with the extension tool",
        status: "in_progress",
        blockedBy: [],
        createdAt: "",
      },
    );

    expect(syncDynamicRuntimeExtensions).toHaveBeenCalledOnce();
    const request = provider.complete.mock.calls[0]?.[0];
    expect(request?.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "find_todos" }),
    ]));
  });
});

describe("runTeammateModeWithStreams (keep-alive)", () => {
  const defaultOpts: TeammateOptions = {
    teamName: "test-team",
    name: "worker",
    agentName: "tester",
    leadSessionId: "sess-1",
  };

  function collectOutput(stdout: PassThrough): string[] {
    const lines: string[] = [];
    stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      for (const line of text.split("\n")) {
        if (line.trim()) lines.push(line.trim());
      }
    });
    return lines;
  }

  function parseMessages(
    lines: string[],
  ): Array<{ method: string; params: Record<string, unknown> }> {
    return lines
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  it('reports failed tasks and becomes idle after execution rejects', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const lines = collectOutput(stdout);
    const execute = vi.fn().mockRejectedValue(new Error('Provider unavailable'));
    const running = runTeammateModeWithStreams(defaultOpts, stdin, stdout, { execute });
    writeMessage(stdin, 'team.assignTask', { task: taskFixture('failed-task') });
    await vi.waitFor(() => expect(parseMessages(lines)).toContainEqual(expect.objectContaining({
      method: 'team.taskUpdate', params: expect.objectContaining({ taskId: 'failed-task', status: 'failed', error: 'Provider unavailable' }),
    })));
    expect(parseMessages(lines).some((message) => message.params.status === 'completed')).toBe(false);
    writeMessage(stdin, 'team.shutdown', {});
    await running;
  });

  it('delivers teammate messages and fresh context to the executing agent', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    let finish!: (result: string) => void;
    const execute = vi.fn().mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
    const running = runTeammateModeWithStreams(defaultOpts, stdin, stdout, { execute });
    writeMessage(stdin, 'team.assignTask', { task: taskFixture('running-task') });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    writeMessage(stdin, 'team.message', { from: 'lead', content: 'Check the changed API' });
    writeMessage(stdin, 'team.updateContext', { tasks: [taskFixture('dependency')] });
    const runtime = execute.mock.calls[0][2];
    expect(runtime.getPendingInstructions().join('\n')).toContain('Check the changed API');
    expect(runtime.getPendingInstructions()).toEqual([]);
    finish('Done');
    writeMessage(stdin, 'team.shutdown', {});
    await running;
  });

  it('aborts active execution on shutdown and never announces it completed', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const lines = collectOutput(stdout);
    const execute = vi.fn().mockImplementation((_opts, _task, runtime) => new Promise((_resolve, reject) => {
      runtime.signal.addEventListener('abort', () => reject(runtime.signal.reason), { once: true });
    }));
    const running = runTeammateModeWithStreams(defaultOpts, stdin, stdout, { execute });
    writeMessage(stdin, 'team.assignTask', { task: taskFixture('cancelled-task') });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    writeMessage(stdin, 'team.shutdown', {});
    await running;
    expect(parseMessages(lines)).toContainEqual(expect.objectContaining({
      method: 'team.taskUpdate', params: expect.objectContaining({ taskId: 'cancelled-task', status: 'cancelled' }),
    }));
    expect(parseMessages(lines).some((message) => message.params.status === 'completed')).toBe(false);
  });

  it('acknowledges only the active run and bounds its message inbox without dropping accepted messages', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const lines = collectOutput(stdout);
    let finish: (result: string) => void = () => {};
    const execute = vi.fn<typeof executeTask>(() => new Promise<string>((resolve) => { finish = resolve; }));
    const running = runTeammateModeWithStreams(defaultOpts, stdin, stdout, { execute });
    try {
      writeMessage(stdin, 'team.assignTask', { task: { ...taskFixture('task'), runId: 'attempt' } });
      await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
      const request = { taskId: 'task', runId: 'attempt', targetRunId: 'attempt', content: 'Inspect this path' };
      writeMessage(stdin, 'team.runMessage', { ...request, requestId: 'stale', runId: 'old-attempt' });
      writeMessage(stdin, 'team.runMessage', { ...request, requestId: 'oversized', content: 'x'.repeat(8_001) });
      writeMessage(stdin, 'team.runMessage', { ...request, requestId: 'empty', content: '   ' });
      for (let index = 0; index < 33; index++) {
        writeMessage(stdin, 'team.runMessage', { ...request, requestId: `message-${index}`, content: `Message ${index}` });
      }
      const acknowledgements = parseMessages(lines).filter((message) => message.method === 'team.runMessageResult');
      expect(acknowledgements).toHaveLength(36);
      for (const requestId of ['stale', 'oversized', 'empty', 'message-32']) {
        expect(acknowledgements).toContainEqual({ jsonrpc: '2.0', method: 'team.runMessageResult', params: expect.objectContaining({ requestId, accepted: false }) });
      }
      expect(acknowledgements.filter((message) => message.params.accepted)).toHaveLength(32);
      const instructions = execute.mock.calls[0][2]?.getPendingInstructions?.();
      expect(instructions).toHaveLength(32);
      expect(instructions?.[0]).toContain('Message 0');
      expect(instructions?.at(-1)).toContain('Message 31');
      expect(execute.mock.calls[0][2]?.getPendingInstructions?.()).toEqual([]);
      writeMessage(stdin, 'team.cancelTask', { taskId: 'task', runId: 'attempt' });
      writeMessage(stdin, 'team.runMessage', { ...request, requestId: 'cancelled' });
      expect(parseMessages(lines).at(-1)).toEqual({ jsonrpc: '2.0', method: 'team.runMessageResult', params: expect.objectContaining({ requestId: 'cancelled', accepted: false }) });
    } finally {
      finish('Stopped');
      writeMessage(stdin, 'team.shutdown', {});
      await running;
    }
  });

  it('never carries unread run messages into a later task or accepts an old attempt after retry', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const lines = collectOutput(stdout);
    let finish: (result: string) => void = () => {};
    const execute = vi.fn<typeof executeTask>(() => new Promise<string>((resolve) => { finish = resolve; }));
    const running = runTeammateModeWithStreams(defaultOpts, stdin, stdout, { execute });
    try {
      writeMessage(stdin, 'team.assignTask', { task: { ...taskFixture('same-task'), runId: 'first-attempt' } });
      await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
      const oldRequest = { taskId: 'same-task', runId: 'first-attempt', targetRunId: 'first-attempt', content: 'Only the first attempt' };
      writeMessage(stdin, 'team.runMessage', { ...oldRequest, requestId: 'queued' });
      expect(parseMessages(lines).at(-1)).toEqual({ jsonrpc: '2.0', method: 'team.runMessageResult', params: expect.objectContaining({ requestId: 'queued', accepted: true }) });
      finish('First completed');
      await vi.waitFor(() => expect(parseMessages(lines).at(-1)?.method).toBe('team.idle'));
      writeMessage(stdin, 'team.assignTask', { task: { ...taskFixture('same-task'), runId: 'second-attempt' } });
      await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
      writeMessage(stdin, 'team.runMessage', { ...oldRequest, requestId: 'stale' });
      expect(parseMessages(lines).at(-1)).toEqual({ jsonrpc: '2.0', method: 'team.runMessageResult', params: expect.objectContaining({ requestId: 'stale', accepted: false }) });
      expect(execute.mock.calls[1][2]?.getPendingInstructions?.()).toEqual([]);
    } finally {
      finish('Second completed');
      writeMessage(stdin, 'team.shutdown', {});
      await running;
    }
  });

  it('routes nested messages to the exact child callback and rejects stopped or previous-task children', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const lines = collectOutput(stdout);
    let finish: (result: string) => void = () => {};
    const execute = vi.fn<typeof executeTask>(() => new Promise<string>((resolve) => { finish = resolve; }));
    const running = runTeammateModeWithStreams(defaultOpts, stdin, stdout, { execute });
    const sendMessage = vi.fn(() => true);
    try {
      writeMessage(stdin, 'team.assignTask', { task: { ...taskFixture('task'), runId: 'attempt' } });
      await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
      const runtime = execute.mock.calls[0][2];
      const context = { subagentId: 'nested', subagentName: 'reader', subagentType: 'researcher', task: 'Read changes', parentId: 'attempt', sendMessage };
      await runtime?.onSubagentStart?.(context);
      expect(parseMessages(lines).at(-1)).toEqual({ jsonrpc: '2.0', method: 'team.subagentStart', params: expect.objectContaining({ subagentId: 'nested', messageable: true }) });
      const request = { taskId: 'task', runId: 'attempt', targetRunId: 'nested', content: 'Inspect the nested scope' };
      writeMessage(stdin, 'team.runMessage', { ...request, requestId: 'nested-message' });
      expect(sendMessage).toHaveBeenCalledExactlyOnceWith('Inspect the nested scope');
      expect(runtime?.getPendingInstructions?.()).toEqual([]);
      expect(parseMessages(lines).at(-1)?.params).toMatchObject({ requestId: 'nested-message', accepted: true });
      sendMessage.mockReturnValueOnce(false);
      writeMessage(stdin, 'team.runMessage', { ...request, requestId: 'nested-full' });
      expect(parseMessages(lines).at(-1)?.params).toMatchObject({ requestId: 'nested-full', accepted: false });
      await runtime?.onSubagentStop?.({ ...context, success: true, result: 'Done', duration: 1 });
      writeMessage(stdin, 'team.runMessage', { ...request, requestId: 'nested-stopped' });
      expect(parseMessages(lines).at(-1)?.params).toMatchObject({ requestId: 'nested-stopped', accepted: false });
      await runtime?.onSubagentStart?.({ ...context, subagentId: 'unread-child' });
      finish('First done');
      await vi.waitFor(() => expect(parseMessages(lines).at(-1)?.method).toBe('team.idle'));
      writeMessage(stdin, 'team.assignTask', { task: { ...taskFixture('next-task'), runId: 'next-attempt' } });
      await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
      writeMessage(stdin, 'team.runMessage', { ...request, taskId: 'next-task', runId: 'next-attempt', targetRunId: 'unread-child', requestId: 'previous-child' });
      expect(parseMessages(lines).at(-1)?.params).toMatchObject({ requestId: 'previous-child', accepted: false });
      expect(sendMessage).toHaveBeenCalledTimes(2);
    } finally {
      finish('Stopped');
      writeMessage(stdin, 'team.shutdown', {});
      await running;
    }
  });

  it('echoes execution identifiers and ignores a stale cancellation for the same task', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const lines = collectOutput(stdout);
    let finish!: (value: string) => void;
    const execute = vi.fn().mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
    const running = runTeammateModeWithStreams(defaultOpts, stdin, stdout, { execute });
    writeMessage(stdin, 'team.assignTask', { task: { ...taskFixture('retried-task'), runId: 'new-run' } });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    writeMessage(stdin, 'team.cancelTask', { taskId: 'retried-task', runId: 'old-run' });
    expect(execute.mock.calls[0][2].signal.aborted).toBe(false);
    finish('Current execution finished');
    await vi.waitFor(() => expect(parseMessages(lines)).toContainEqual(expect.objectContaining({
      method: 'team.taskUpdate', params: expect.objectContaining({ taskId: 'retried-task', runId: 'new-run', status: 'completed' }),
    })));
    expect(parseMessages(lines)).toContainEqual(expect.objectContaining({ method: 'team.idle', params: { lastTask: 'retried-task', runId: 'new-run' } }));
    writeMessage(stdin, 'team.shutdown', {});
    await running;
  });

  it('does not invoke a nested provider when the lead denies nested startup', async () => {
    const { ProviderFactory } = await import('../../src/providers/ProviderFactory.js');
    const provider = vi.mocked(ProviderFactory.create)({} as never);
    const complete = vi.mocked(provider.complete);
    complete.mockReset().mockResolvedValue({ content: 'Parent finished after cancellation' });
    complete.mockResolvedValueOnce({ content: '', toolCalls: [{ id: 'nested-call', type: 'function', function: {
      name: 'delegate_task', arguments: JSON.stringify({ agent_name: 'tester', task: 'Nested review' }),
    } }] });
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const lines = collectOutput(stdout);
    stdout.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().trim().split('\n')) {
        const message: { method: string; params: Record<string, unknown> } = JSON.parse(line);
        if (message.method === 'team.runReady') writeMessage(stdin, 'team.runReadyResult', {
          ...message.params, allowed: message.params.targetRunId === message.params.runId,
        });
        if (message.method === 'team.threadAcquire') writeMessage(stdin, 'team.threadResult', { requestId: message.params.requestId, granted: true });
        if (message.method === 'team.authorizeTool') {
          const call = message.params.call as { args: Record<string, unknown> };
          writeMessage(stdin, 'team.authorizationResult', { requestId: message.params.requestId, result: { allowed: true, args: call.args } });
        }
        if (message.method === 'team.idle') writeMessage(stdin, 'team.shutdown', {});
      }
    });
    const running = runTeammateModeWithStreams(defaultOpts, stdin, stdout);
    try {
      writeMessage(stdin, 'team.assignTask', { task: { ...taskFixture('nested-parent'), runId: 'parent-attempt' }, waitForRunReady: true });
      await running;
      expect(parseMessages(lines)).toContainEqual(expect.objectContaining({
        method: 'team.subagentStop', params: expect.objectContaining({ status: 'cancelled', success: false }),
      }));
      expect(complete).toHaveBeenCalledTimes(2);
    } finally {
      writeMessage(stdin, 'team.shutdown', {});
      await running;
    }
  });

  it('ignores a mismatched readiness acknowledgement and stops waiting when stdout closes', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const lines = collectOutput(stdout);
    const execute = vi.fn<typeof executeTask>().mockResolvedValue('Must not launch');
    const settled = vi.fn();
    const running = runTeammateModeWithStreams(defaultOpts, stdin, stdout, { execute }).then(settled);
    try {
      writeMessage(stdin, 'team.assignTask', { task: { ...taskFixture('task'), runId: 'attempt' }, waitForRunReady: true });
      await vi.waitFor(() => expect(parseMessages(lines).some((message) => message.method === 'team.runReady')).toBe(true));
      const request = parseMessages(lines).find((message) => message.method === 'team.runReady');
      writeMessage(stdin, 'team.runReadyResult', { ...request?.params, targetRunId: 'another-run', allowed: true });
      await Promise.resolve();
      expect(execute).not.toHaveBeenCalled();
      stdout.destroy();
      await vi.waitFor(() => expect(settled).toHaveBeenCalledOnce());
      expect(execute).not.toHaveBeenCalled();
    } finally {
      stdin.end();
      await running;
    }
  });

  it("sends team.ready on startup", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const lines = collectOutput(stdout);

    // Start teammate mode (don't await — it blocks until shutdown)
    const promise = runTeammateModeWithStreams(defaultOpts, stdin, stdout);

    // Give it a tick to send ready message
    await new Promise((r) => setTimeout(r, 50));

    const messages = parseMessages(lines);
    expect(messages.some((m) => m.method === "team.ready")).toBe(true);

    // Clean up: send shutdown
    stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method: "team.shutdown", params: {} }) +
        "\n",
    );
    await promise;
  });

  it("stays alive when stdin has no data (does not exit prematurely)", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();

    const promise = runTeammateModeWithStreams(defaultOpts, stdin, stdout);

    // Wait 200ms — if the bug exists, the promise resolves immediately
    let resolved = false;
    promise.then(() => {
      resolved = true;
    });
    await new Promise((r) => setTimeout(r, 200));

    expect(resolved).toBe(false);

    // Clean up: send shutdown
    stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method: "team.shutdown", params: {} }) +
        "\n",
    );
    await promise;
  });

  it("exits gracefully on team.shutdown message", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const lines = collectOutput(stdout);

    const promise = runTeammateModeWithStreams(defaultOpts, stdin, stdout);
    await new Promise((r) => setTimeout(r, 50));

    // Send shutdown
    stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method: "team.shutdown", params: {} }) +
        "\n",
    );
    await promise; // Should resolve (not hang)

    const messages = parseMessages(lines);
    expect(messages.some((m) => m.method === "team.shutdownAck")).toBe(true);
  });

  it("exits when stdin closes (parent process died)", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();

    const promise = runTeammateModeWithStreams(defaultOpts, stdin, stdout);
    await new Promise((r) => setTimeout(r, 50));

    // Simulate parent death by ending stdin
    stdin.end();

    // Should resolve within a reasonable time
    const result = await Promise.race([
      promise.then(() => "resolved"),
      new Promise<string>((r) => setTimeout(() => r("timeout"), 2000)),
    ]);
    expect(result).toBe("resolved");
  });
});

function writeMessage(stdin: PassThrough, method: string, params: Record<string, unknown>): void {
  stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

function taskFixture(id: string) {
  return { id, subject: 'Inspect changes', description: 'Review changes', status: 'in_progress', blockedBy: [], createdAt: '' };
}
