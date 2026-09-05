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
