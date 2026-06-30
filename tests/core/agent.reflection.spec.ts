/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for the "Reflect Before Acting" feature:
 * - `reflection` field extraction in parseAssistantReactPayload
 * - `reflection` field extraction in parseAssistantResponse (native tool calls)
 * - `reflection` field extraction in parseAssistantResponse (XML tool calls)
 * - Reflection loop guard logic
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AutohandAgent } from '../../src/core/agent.js';
import { ReactionParser } from '../../src/core/agent/ReactionParser.js';
import { runAgentReactLoop } from '../../src/core/agent/ReactLoopRunner.js';
import type {
  AgentRuntime,
  AssistantReactPayload,
  LLMMessage,
  LLMResponse,
  ToolCallRequest,
  ToolExecutionResult,
} from '../../src/types.js';

/* ── Helpers ──────────────────────────────────────────────── */

function createParser(): ReactionParser {
  return new ReactionParser({ cleanupModelResponse: (text) => text });
}

function createMinimalAgent(): any {
  const agent = Object.create(AutohandAgent.prototype);
  agent.cleanupModelResponse = (text: string) => text;
  return agent;
}

function createNativeToolCall(id: string, name = 'read_file', args: Record<string, unknown> = { path: 'a.ts' }) {
  return {
    id,
    function: {
      name,
      arguments: JSON.stringify(args),
    },
  };
}

function createReactLoopHarness(completions: LLMResponse[]) {
  const parser = createParser();
  const messages: LLMMessage[] = [{ role: 'user', content: 'check reflection' }];
  const systemNotes: string[] = [];
  const executedCalls: ToolCallRequest[] = [];
  const emittedMessages: string[] = [];
  const runtime: AgentRuntime = {
    workspaceRoot: process.cwd(),
    options: {},
    config: {
      agent: { maxIterations: 8 },
      ui: { silentToolOutput: true },
    },
  };

  const host = {
    activeProvider: 'openai' as const,
    autoReportManager: { reportError: vi.fn(async () => {}) },
    consecutiveCancellations: 0,
    contextOrchestrator: {
      setModel: vi.fn(),
      setContextWindow: vi.fn(),
      prepareRequest: vi.fn(async () => ({ messages, wasCropped: false, croppedCount: 0 })),
      handleOverflow: vi.fn(async () => ({ croppedCount: 0 })),
      checkMidTurnCompaction: vi.fn(async () => false),
    },
    contextPercentLeft: 100,
    conversation: {
      addMessage: vi.fn((message: LLMMessage) => messages.push(message)),
      addSystemNote: vi.fn((note: string) => {
        systemNotes.push(note);
        messages.push({ role: 'system', content: note });
      }),
      history: vi.fn(() => messages),
    },
    inkRenderer: null,
    lastAssistantResponseForNotification: '',
    llm: {
      getCapabilities: vi.fn(() => ({ nativeToolCalling: true })),
      complete: vi.fn(async () => {
        const completion = completions.shift();
        if (!completion) {
          throw new Error('No queued completion');
        }
        return completion;
      }),
    },
    projectManager: {
      recordFailure: vi.fn(async () => {}),
      recordSuccess: vi.fn(async () => {}),
    },
    runtime,
    searchQueries: [],
    sessionManager: { getCurrentSession: vi.fn(() => ({ metadata: { sessionId: 'test-session' } })) },
    sessionStartedAt: Date.now(),
    sessionTokensUsed: 0,
    taskStartedAt: null,
    toolManager: {
      execute: vi.fn(async (calls: ToolCallRequest[]): Promise<ToolExecutionResult[]> => {
        executedCalls.push(...calls);
        return calls.map((call) => ({
          tool: call.tool,
          success: true,
          output: `output for ${call.tool}`,
        }));
      }),
      listToolNames: vi.fn(() => ['read_file']),
      register: vi.fn(),
      registerMetaTools: vi.fn(),
      toFunctionDefinitions: vi.fn(() => [{
        name: 'read_file',
        description: 'Read a file',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
      }]),
      unregister: vi.fn(),
    },
    contextWindow: 128000,
    totalTokensUsed: 0,
    currentTurnActualUsage: { kind: 'unavailable' as const, provider: 'openai' as const, reason: 'not_reported' as const },
    currentTurnHadUnavailableUsage: false,
    sessionActualTokensUsed: 0,
    sessionTokenUsageUnavailable: false,
    sessionPromptTokens: 0,
    sessionCompletionTokens: 0,
    lastContextTokens: 0,
    cleanupModelResponse: (content: string) => content,
    emitOutput: vi.fn((event: { type: string; content?: string }) => {
      if (event.type === 'message' && event.content) emittedMessages.push(event.content);
    }),
    ensureSpinnerRunning: vi.fn(),
    forceRenderSpinner: vi.fn(),
    getMessagesWithImages: vi.fn(async () => messages),
    getReactionParser: vi.fn(() => parser),
    handleSmartContextCrop: vi.fn(async () => 'cropped'),
    isContextOverflowError: vi.fn(() => false),
    saveAssistantMessage: vi.fn(async () => {}),
    saveToolMessage: vi.fn(async () => {}),
    setComposerFinalResponse: vi.fn(),
    setComposerIdle: vi.fn(),
    setSpinnerStatus: vi.fn(),
    startStatusUpdates: vi.fn(),
    stopStatusUpdates: vi.fn(),
    updateContextUsage: vi.fn(),
    writeDebugLine: vi.fn(),
  };

  return { host, systemNotes, executedCalls, emittedMessages };
}

/* ── Tests ────────────────────────────────────────────────── */

describe('parseAssistantReactPayload reflection extraction', () => {
  let parser: ReactionParser;

  beforeEach(() => {
    parser = createParser();
  });

  it('extracts reflection from JSON payload', () => {
    const raw = '{"thought": "I need to check the file", "reflection": "The file exists but is empty, so I need to create content", "toolCalls": [{"tool": "write_file", "args": {"path": "src/foo.ts"}}]}';
    const result: AssistantReactPayload = parser.parseAssistantReactPayload(raw);

    expect(result.thought).toBe('I need to check the file');
    expect(result.reflection).toBe('The file exists but is empty, so I need to create content');
    expect(result.toolCalls).toHaveLength(1);
  });

  it('extracts reflection alongside finalResponse', () => {
    const raw = '{"thought": "Analyzed the code", "reflection": "The bug is in line 42 - off by one error", "finalResponse": "The bug is on line 42."}';
    const result: AssistantReactPayload = parser.parseAssistantReactPayload(raw);

    expect(result.reflection).toBe('The bug is in line 42 - off by one error');
    expect(result.finalResponse).toBe('The bug is on line 42.');
  });

  it('returns undefined reflection when not present', () => {
    const raw = '{"thought": "Thinking...", "toolCalls": []}';
    const result: AssistantReactPayload = parser.parseAssistantReactPayload(raw);

    expect(result.reflection).toBeUndefined();
  });

  it('extracts reflection from single tool call format', () => {
    const raw = '{"thought": "Need to read", "reflection": "Previous search found the file at src/bar.ts", "tool": "read_file", "args": {"path": "src/bar.ts"}}';
    const result: AssistantReactPayload = parser.parseAssistantReactPayload(raw);

    expect(result.reflection).toBe('Previous search found the file at src/bar.ts');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].tool).toBe('read_file');
  });

  it('ignores non-string reflection values', () => {
    const raw = '{"thought": "Hmm", "reflection": 42, "finalResponse": "Done"}';
    const result: AssistantReactPayload = parser.parseAssistantReactPayload(raw);

    expect(result.reflection).toBeUndefined();
  });

  it('extracts reflection from malformed JSON via regex fallback', () => {
    // Malformed JSON (missing closing brace) with complete quoted thought and reflection
    const raw = '{"thought": "partial thought", "reflection": "partial reflection", "toolCalls": [';
    const result: AssistantReactPayload = parser.parseAssistantReactPayload(raw);

    expect(result.thought).toBe('partial thought');
    expect(result.reflection).toBe('partial reflection');
  });

  it('extracts reflection alone when thought is missing in malformed JSON', () => {
    // Malformed JSON with only reflection (unusual but possible)
    const raw = '{"reflection": "standalone reflection", "toolCalls": [';
    const result: AssistantReactPayload = parser.parseAssistantReactPayload(raw);

    expect(result.reflection).toBe('standalone reflection');
    expect(result.thought).toBeUndefined();
  });
});

describe('parseAssistantResponse reflection extraction (native tool calls)', () => {
  let parser: ReactionParser;

  beforeEach(() => {
    parser = createParser();
  });

  it('extracts reflection from JSON content with native tool calls', () => {
    const completion = {
      content: '{"thought": "Need to check", "reflection": "The config shows the port is 8080"}',
      toolCalls: [{
        id: 'call_1',
        function: { name: 'read_file', arguments: '{"path": "config.json"}' }
      }]
    };
    const result: AssistantReactPayload = parser.parseAssistantResponse(completion);

    expect(result.thought).toBe('Need to check');
    expect(result.reflection).toBe('The config shows the port is 8080');
    expect(result.toolCalls).toHaveLength(1);
  });

  it('returns undefined reflection when content is plain text with native tool calls', () => {
    const completion = {
      content: 'Let me read the file',
      toolCalls: [{
        id: 'call_1',
        function: { name: 'read_file', arguments: '{"path": "foo.ts"}' }
      }]
    };
    const result: AssistantReactPayload = parser.parseAssistantResponse(completion);

    expect(result.thought).toBe('Let me read the file');
    expect(result.reflection).toBeUndefined();
  });

  it('extracts reflection from JSON content even without thought', () => {
    const completion = {
      content: '{"reflection": "The test passed, moving to next step"}',
      toolCalls: [{
        id: 'call_1',
        function: { name: 'run_command', arguments: '{"command": "npm test"}' }
      }]
    };
    const result: AssistantReactPayload = parser.parseAssistantResponse(completion);

    expect(result.thought).toBeUndefined();
    expect(result.reflection).toBe('The test passed, moving to next step');
  });
});

describe('Reflection loop guard logic', () => {
  it('triggers guard when model calls tools without reflection after tool results', () => {
    // Simulate the guard logic as it appears in runReactLoop
    const needsReflection = true;
    let reflectionViolationCount = 0;

    const payload: AssistantReactPayload = {
      thought: 'short', // < 50 chars, not substantive
      toolCalls: [{ tool: 'read_file', args: { path: 'bar.ts' } }]
    };

    const hasReflection = Boolean(payload.reflection);
    const thoughtIsSubstantive = (payload.thought?.length ?? 0) > 50;

    expect(needsReflection).toBe(true);
    expect(hasReflection).toBe(false);
    expect(thoughtIsSubstantive).toBe(false);

    // Guard should trigger
    if (needsReflection && payload.toolCalls && payload.toolCalls.length > 0) {
      if (!hasReflection && !thoughtIsSubstantive) {
        reflectionViolationCount++;
      }
    }

    expect(reflectionViolationCount).toBe(1);
  });

  it('does not trigger guard when reflection field is present', () => {
    const needsReflection = true;
    let reflectionViolationCount = 0;

    const payload: AssistantReactPayload = {
      thought: 'short',
      reflection: 'The file contains the expected exports, I can now proceed to edit it',
      toolCalls: [{ tool: 'write_file', args: { path: 'bar.ts' } }]
    };

    const hasReflection = Boolean(payload.reflection);
    const thoughtIsSubstantive = (payload.thought?.length ?? 0) > 50;

    expect(hasReflection).toBe(true);

    if (needsReflection && payload.toolCalls && payload.toolCalls.length > 0) {
      if (!hasReflection && !thoughtIsSubstantive) {
        reflectionViolationCount++;
      }
    }

    expect(reflectionViolationCount).toBe(0);
  });

  it('does not trigger guard when thought is substantive (>50 chars)', () => {
    const needsReflection = true;
    let reflectionViolationCount = 0;

    const payload: AssistantReactPayload = {
      thought: 'The search results show that the function is defined in utils.ts and exported as a named export. I should read that file next to understand the implementation.',
      toolCalls: [{ tool: 'read_file', args: { path: 'utils.ts' } }]
    };

    const hasReflection = Boolean(payload.reflection);
    const thoughtIsSubstantive = (payload.thought?.length ?? 0) > 50;

    expect(thoughtIsSubstantive).toBe(true);

    if (needsReflection && payload.toolCalls && payload.toolCalls.length > 0) {
      if (!hasReflection && !thoughtIsSubstantive) {
        reflectionViolationCount++;
      }
    }

    expect(reflectionViolationCount).toBe(0);
  });

  it('clears needsReflection when reflection is satisfied', () => {
    let needsReflection = true;
    let reflectionViolationCount = 1;

    const payload: AssistantReactPayload = {
      reflection: 'The tool output confirms the file exists',
      toolCalls: [{ tool: 'write_file', args: { path: 'test.ts' } }]
    };

    // Reflection satisfied check
    if (needsReflection && (payload.reflection || (payload.thought?.length ?? 0) > 50 || !payload.toolCalls?.length)) {
      needsReflection = false;
      reflectionViolationCount = 0;
    }

    expect(needsReflection).toBe(false);
    expect(reflectionViolationCount).toBe(0);
  });

  it('clears needsReflection when model provides finalResponse without tool calls', () => {
    let needsReflection = true;

    const payload: AssistantReactPayload = {
      thought: 'I have enough information to answer',
      finalResponse: 'The answer is 42.'
    };

    if (needsReflection && (payload.reflection || (payload.thought?.length ?? 0) > 50 || !payload.toolCalls?.length)) {
      needsReflection = false;
    }

    expect(needsReflection).toBe(false);
  });

  it('allows tool calls through and resets state after violation limit exceeded', () => {
    let needsReflection = true;
    let reflectionViolationCount = 1;
    const reflectionViolationLimit = 2;

    const payload: AssistantReactPayload = {
      toolCalls: [{ tool: 'read_file', args: { path: 'a.ts' } }]
    };
    const hasReflection = Boolean(payload.reflection);
    const thoughtIsSubstantive = (payload.thought?.length ?? 0) > 50;

    // Simulate the guard's limit-exceeded branch
    if (needsReflection && payload.toolCalls && payload.toolCalls.length > 0) {
      if (!hasReflection && !thoughtIsSubstantive) {
        reflectionViolationCount++;
        if (reflectionViolationCount < reflectionViolationLimit) {
          // block (not hit in this test)
        } else {
          // Limit exceeded: allow tool calls through and reset state
          needsReflection = false;
          reflectionViolationCount = 0;
        }
      }
    }

    // State should be reset to prevent unbounded counter growth in the same turn
    expect(needsReflection).toBe(false);
    expect(reflectionViolationCount).toBe(0);
  });

  it('does not trigger guard on first iteration (no prior tool results)', () => {
    const needsReflection = false; // Not set yet — no tool results received

    const payload: AssistantReactPayload = {
      toolCalls: [{ tool: 'read_file', args: { path: 'a.ts' } }]
    };

    // Guard should NOT trigger because needsReflection is false
    let guardTriggered = false;
    if (needsReflection && payload.toolCalls && payload.toolCalls.length > 0) {
      const hasReflection = Boolean(payload.reflection);
      const thoughtIsSubstantive = (payload.thought?.length ?? 0) > 50;
      if (!hasReflection && !thoughtIsSubstantive) {
        guardTriggered = true;
      }
    }

    expect(guardTriggered).toBe(false);
  });
});

describe('Reflection guard integration', () => {
  it('blocks a follow-up native tool call until the assistant reflects on tool results', async () => {
    const { host, systemNotes, executedCalls, emittedMessages } = createReactLoopHarness([
      {
        content: 'Initial lookup',
        toolCalls: [createNativeToolCall('call_1', 'read_file', { path: 'first.ts' })],
      },
      {
        content: 'short',
        toolCalls: [createNativeToolCall('call_2', 'read_file', { path: 'blocked.ts' })],
      },
      {
        content: '{"reflection":"The first tool output confirms the next file to inspect.","thought":"Proceeding after reflection"}',
        toolCalls: [createNativeToolCall('call_3', 'read_file', { path: 'allowed.ts' })],
      },
      {
        content: '{"finalResponse":"Reflection flow completed."}',
      },
    ]);

    await runAgentReactLoop(host, new AbortController());

    expect(systemNotes.some((note) => note.startsWith('[Reflection Required]'))).toBe(true);
    expect(executedCalls.map((call) => call.args?.path)).toEqual(['first.ts', 'allowed.ts']);
    expect(executedCalls.map((call) => call.args?.path)).not.toContain('blocked.ts');
    expect(emittedMessages).toContain('Reflection flow completed.');
  });

  it('treats whitespace-only reflection as missing before follow-up tool calls', async () => {
    const { host, systemNotes, executedCalls, emittedMessages } = createReactLoopHarness([
      {
        content: 'Initial lookup',
        toolCalls: [createNativeToolCall('call_1', 'read_file', { path: 'first.ts' })],
      },
      {
        content: '{"reflection":"   ","thought":"short"}',
        toolCalls: [createNativeToolCall('call_2', 'read_file', { path: 'blocked.ts' })],
      },
      {
        content: '{"finalResponse":"Stopped after reminder."}',
      },
    ]);

    await runAgentReactLoop(host, new AbortController());

    expect(systemNotes.some((note) => note.startsWith('[Reflection Required]'))).toBe(true);
    expect(executedCalls.map((call) => call.args?.path)).toEqual(['first.ts']);
    expect(emittedMessages).toContain('Stopped after reminder.');
  });
});

describe('System prompt includes reflection instructions', () => {
  it('buildSystemPrompt contains "Reflect Before Acting" section', async () => {
    const agent = createMinimalAgent();
    agent.runtime = {
      options: {},
      workspaceRoot: process.cwd(),
      config: {},
    };
    agent.toolManager = {
      listDefinitions: vi.fn(() => []),
    };
    agent.memoryManager = {
      getContextMemories: vi.fn(async () => ''),
    };
    agent.loadInstructionFiles = vi.fn(async () => []);
    agent.skillsRegistry = {
      listSkills: vi.fn(() => []),
      getActiveSkills: vi.fn(() => []),
    };
    agent.teamManager = {
      getTeam: vi.fn(() => null),
    };

    const prompt = await agent.buildSystemPrompt();
    expect(prompt).toContain('Reflect Before Acting');
    expect(prompt).toContain('reflection');
    expect(prompt).toContain('Reason + Reflect + Act');
  });
});
