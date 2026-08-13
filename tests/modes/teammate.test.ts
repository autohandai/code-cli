import { describe, it, expect, vi } from "vitest";
import { PassThrough } from "node:stream";

const actionExecutorConstructor = vi.hoisted(() => vi.fn());

// Mock heavy dependencies before importing
vi.mock("../../src/config.js", () => ({
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
    ];
    const opts = parseTeammateOptions(argv);
    expect(opts?.model).toBe("your-modelcard-id-here");
    expect(opts?.workspacePath).toBe("/tmp/workspace");
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

describe("teammate executeTask", () => {
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

  it("returns error string on agent not found", async () => {
    const { AgentRegistry } =
      await import("../../src/core/agents/AgentRegistry.js");
    (AgentRegistry.getInstance().getAgent as any).mockReturnValueOnce(
      undefined,
    );

    const result = await executeTask(
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
    expect(result).toContain("Error");
    expect(result).toContain("nonexistent");
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
