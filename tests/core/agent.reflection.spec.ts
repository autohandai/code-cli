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
import { ToolReflectionGuard } from '../../src/core/agent/ToolLoopPolicy.js';
import {
  DEFAULT_RESPONSE_COMPLETION_HOOKS,
  type ResponseCompletionHook,
} from '../../src/core/agent/ResponseCompletionClassifier.js';
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

function createReactLoopHarness(
  completions: LLMResponse[],
  harnessOptions: {
    responseCompletionHooks?: readonly ResponseCompletionHook[];
    nativeToolCalling?: boolean;
    hasIncompleteTodoActivity?: () => boolean;
  } = {},
) {
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
  const complete = vi.fn(async () => {
    const completion = completions.shift();
    if (!completion) {
      throw new Error('No queued completion');
    }
    return completion;
  });

  const host = {
    activeProvider: 'openai' as const,
    ...(harnessOptions.responseCompletionHooks
      ? { responseCompletionHooks: harnessOptions.responseCompletionHooks }
      : {}),
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
      getCapabilities: vi.fn(() => ({ nativeToolCalling: harnessOptions.nativeToolCalling ?? true })),
      complete,
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
    ...(harnessOptions.hasIncompleteTodoActivity
      ? { hasIncompleteTodoActivity: harnessOptions.hasIncompleteTodoActivity }
      : {}),
  };

  return { host, systemNotes, executedCalls, emittedMessages, complete };
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

  it('stops blocking after one reminder instead of stranding the turn', () => {
    const guard = new ToolReflectionGuard();
    const payload: AssistantReactPayload = {
      toolCalls: [{ tool: 'read_file', args: { path: 'a.ts' } }]
    };
    guard.expectReflection();

    expect(guard.evaluate(payload)).toEqual({ type: 'require_reflection' });
    expect(guard.evaluate(payload)).toEqual({ type: 'proceed_unreflected' });
  });

  it('resets after standing down so a later reminder still fires once', () => {
    const guard = new ToolReflectionGuard();
    const payload: AssistantReactPayload = {
      toolCalls: [{ tool: 'read_file', args: { path: 'a.ts' } }]
    };

    guard.expectReflection();
    expect(guard.evaluate(payload)).toEqual({ type: 'require_reflection' });
    expect(guard.evaluate(payload)).toEqual({ type: 'proceed_unreflected' });

    guard.expectReflection();
    expect(guard.evaluate(payload)).toEqual({ type: 'require_reflection' });
  });

  it('does not accumulate false reflection violations across a long native tool sequence', () => {
    const guard = new ToolReflectionGuard();

    for (let index = 0; index < 500; index += 1) {
      guard.expectReflection();
      expect(guard.evaluate({
        toolCalls: [{ tool: 'read_file', args: { path: `file-${index}.ts` } }],
      }, { requireExplicitReflection: false })).toEqual({ type: 'allow' });
    }
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
  it('executes consecutive native tool calls without requiring synthetic reflection prose', async () => {
    const { host, systemNotes, executedCalls, emittedMessages } = createReactLoopHarness([
      {
        content: '',
        toolCalls: [createNativeToolCall('call_1', 'read_file', { path: 'first.ts' })],
      },
      {
        content: '',
        toolCalls: [createNativeToolCall('call_2', 'read_file', { path: 'second.ts' })],
      },
      { content: 'Both files were inspected.' },
    ]);

    await runAgentReactLoop(host, new AbortController());

    expect(executedCalls.map((call) => call.args?.path)).toEqual(['first.ts', 'second.ts']);
    expect(systemNotes.some((note) => note.startsWith('[Reflection Required]'))).toBe(false);
    expect(emittedMessages).toContain('Both files were inspected.');
  });

  it('emits at most one completion reminder after a sustained successful tool run', async () => {
    const reflectiveContent =
      'The prior output identified another independent file that must be inspected before answering.';
    const { host, systemNotes, executedCalls } = createReactLoopHarness([
      {
        content: reflectiveContent,
        toolCalls: [createNativeToolCall('call_1', 'read_file', { path: 'one.ts' })],
      },
      {
        content: reflectiveContent,
        toolCalls: [createNativeToolCall('call_2', 'read_file', { path: 'two.ts' })],
      },
      {
        content: reflectiveContent,
        toolCalls: [createNativeToolCall('call_3', 'read_file', { path: 'three.ts' })],
      },
      {
        content: reflectiveContent,
        toolCalls: [createNativeToolCall('call_4', 'read_file', { path: 'four.ts' })],
      },
      { content: 'Inspection complete.' },
    ]);

    await runAgentReactLoop(host, new AbortController());

    expect(executedCalls).toHaveLength(4);
    expect(systemNotes.filter((note) => note.startsWith('[Reminder]'))).toHaveLength(1);
  });

  it('restores tools when a one-shot final-answer recovery still narrates unfinished work', async () => {
    const { host, complete, executedCalls, emittedMessages } = createReactLoopHarness(
      [
        { content: 'I will inspect the implementation now.' },
        { content: 'I will run the focused regression test now.' },
        { content: 'I will edit the implementation next.' },
        {
          content: '',
          toolCalls: [createNativeToolCall('call_recovered', 'read_file', { path: 'recovered.ts' })],
        },
        { content: 'Recovered and completed the inspection.' },
      ],
      { responseCompletionHooks: DEFAULT_RESPONSE_COMPLETION_HOOKS },
    );

    await runAgentReactLoop(host, new AbortController());

    expect(complete).toHaveBeenCalledTimes(5);
    expect(complete.mock.calls[2]?.[0]?.tools).toBeUndefined();
    expect(complete.mock.calls[3]?.[0]?.tools).toBeDefined();
    expect(executedCalls.map((call) => call.id)).toEqual(['call_recovered']);
    expect(emittedMessages).toContain('Recovered and completed the inspection.');
    expect(emittedMessages).not.toContain('I will edit the implementation next.');
  });

  it('rejects a tool emitted during the tool-free recovery and restores tools afterward', async () => {
    const { host, complete, executedCalls } = createReactLoopHarness(
      [
        { content: 'I will inspect the implementation now.' },
        { content: 'I will run the focused regression test now.' },
        {
          content: '',
          toolCalls: [createNativeToolCall('call_withheld', 'read_file', { path: 'withheld.ts' })],
        },
        {
          content: '',
          toolCalls: [createNativeToolCall('call_restored', 'read_file', { path: 'restored.ts' })],
        },
        { content: 'Recovered after the guarded response.' },
      ],
      { responseCompletionHooks: DEFAULT_RESPONSE_COMPLETION_HOOKS },
    );

    await runAgentReactLoop(host, new AbortController());

    expect(complete.mock.calls[2]?.[0]?.tools).toBeUndefined();
    expect(complete.mock.calls[3]?.[0]?.tools).toBeDefined();
    expect(executedCalls.map((call) => call.id)).toEqual(['call_restored']);
  });

  it('keeps a truncated partial response in provider history before requesting continuation', async () => {
    const { host, complete, emittedMessages } = createReactLoopHarness([
      {
        content: 'Partial explanation that the next response must be able to see.',
        finishReason: 'length',
      },
      { content: 'The complete explanation is now available.' },
    ]);

    await runAgentReactLoop(host, new AbortController());

    const continuationMessages = complete.mock.calls[1]?.[0]?.messages as LLMMessage[];
    expect(continuationMessages).toContainEqual({
      role: 'assistant',
      content: 'Partial explanation that the next response must be able to see.',
    });
    expect(emittedMessages).toContain('The complete explanation is now available.');
  });

  it('fails explicitly after bounded consecutive truncation repairs', async () => {
    const { host, complete, emittedMessages } = createReactLoopHarness([
      { content: 'First truncated fragment.', finishReason: 'length' },
      { content: 'Second truncated fragment.', finishReason: 'length' },
      { content: 'Third truncated fragment.', finishReason: 'length' },
    ]);

    await expect(runAgentReactLoop(host, new AbortController())).rejects.toThrow(
      /truncated 3 consecutive responses/i,
    );

    expect(complete).toHaveBeenCalledTimes(3);
    expect(emittedMessages).toContainEqual(expect.stringContaining('stopped without marking the task complete'));
    expect(emittedMessages).not.toContain('Third truncated fragment.');
  });

  it('does not publish a final response while the current turn still has unfinished todos', async () => {
    const hasIncompleteTodoActivity = vi.fn()
      .mockReturnValueOnce(true)
      .mockReturnValue(false);
    const { host, complete, systemNotes, emittedMessages } = createReactLoopHarness(
      [
        { content: 'The work is done.' },
        { content: 'The todos are complete and the work is verified.' },
      ],
      { hasIncompleteTodoActivity },
    );

    await runAgentReactLoop(host, new AbortController());

    expect(complete).toHaveBeenCalledTimes(2);
    expect(systemNotes.some((note) => note.includes('unfinished todo'))).toBe(true);
    expect(emittedMessages).toEqual(['The todos are complete and the work is verified.']);
  });

  it('ends the turn as incomplete instead of looping when todos stay unfinished after the completion check', async () => {
    const { host, complete, systemNotes, emittedMessages } = createReactLoopHarness(
      [
        { content: 'The work is done.' },
        { content: 'The implementation is in place; two todo items remain open.' },
      ],
      { hasIncompleteTodoActivity: () => true },
    );

    const result = await runAgentReactLoop(host, new AbortController());

    expect(complete).toHaveBeenCalledTimes(2);
    expect(systemNotes.filter((note) => note.includes('unfinished todo'))).toHaveLength(1);
    expect(emittedMessages).toEqual(['The implementation is in place; two todo items remain open.']);
    expect(result).toEqual({ status: 'incomplete', reason: 'pending_todos' });
  });

  it('does not demand a todo update once the loop guard has withheld tools', async () => {
    const repeatedRead = (id: string) => ({
      content: 'Reading the same file again.',
      toolCalls: [createNativeToolCall(id, 'read_file', { path: 'same.ts' })],
    });
    const { host, complete, systemNotes, emittedMessages } = createReactLoopHarness(
      [
        repeatedRead('call_1'),
        repeatedRead('call_2'),
        repeatedRead('call_3'),
        { content: 'The same file was read three times and its content is unchanged.' },
      ],
      { hasIncompleteTodoActivity: () => true },
    );

    const result = await runAgentReactLoop(host, new AbortController());

    expect(complete).toHaveBeenCalledTimes(4);
    expect(complete.mock.calls[3]?.[0]?.tools).toBeUndefined();
    expect(systemNotes.some((note) => note.includes('unfinished todo'))).toBe(false);
    expect(emittedMessages).toEqual(['The same file was read three times and its content is unchanged.']);
    expect(result).toEqual({ status: 'incomplete', reason: 'pending_todos' });
  });

  it('stops after bounded tool-free recoveries instead of cycling narration until the iteration limit', async () => {
    const narration = (step: string) => ({ content: `I will ${step} now.` });
    const { host, complete, emittedMessages } = createReactLoopHarness(
      [
        narration('inspect the implementation'),
        narration('run the focused test'),
        narration('edit the implementation'),
        narration('inspect the second file'),
        narration('run the second test'),
        narration('edit the second file'),
        narration('inspect the third file'),
        narration('run the third test'),
      ],
      { responseCompletionHooks: DEFAULT_RESPONSE_COMPLETION_HOOKS },
    );

    await expect(runAgentReactLoop(host, new AbortController())).rejects.toThrow(
      /tool-free recover/i,
    );

    expect(complete).toHaveBeenCalledTimes(6);
    expect(complete.mock.calls[2]?.[0]?.tools).toBeUndefined();
    expect(complete.mock.calls[3]?.[0]?.tools).toBeDefined();
    expect(complete.mock.calls[5]?.[0]?.tools).toBeUndefined();
    expect(emittedMessages).toContainEqual(expect.stringContaining('without marking the task complete'));
    expect(emittedMessages).not.toContainEqual(expect.stringMatching(/^I will /));
  });

  it('asks once more for a complete answer when the loop guard has disabled repeated tools', async () => {
    const repeatedRead = (id: string) => ({
      content: 'Reading the same file again.',
      toolCalls: [createNativeToolCall(id, 'read_file', { path: 'same.ts' })],
    });
    const { host, complete, systemNotes, emittedMessages } = createReactLoopHarness(
      [
        repeatedRead('call_1'),
        repeatedRead('call_2'),
        repeatedRead('call_3'),
        { content: 'I will read the file one more time now.' },
        { content: 'The file content is stable across all three reads.' },
      ],
      { responseCompletionHooks: DEFAULT_RESPONSE_COMPLETION_HOOKS },
    );

    await runAgentReactLoop(host, new AbortController());

    expect(complete).toHaveBeenCalledTimes(5);
    expect(complete.mock.calls[4]?.[0]?.tools).toBeUndefined();
    expect(systemNotes.some((note) => note.includes('Repeated tools remain disabled'))).toBe(true);
    expect(emittedMessages).toEqual(['The file content is stable across all three reads.']);
  });

  it('aborts when the model narrates twice after the loop guard has disabled repeated tools', async () => {
    const repeatedRead = (id: string) => ({
      content: 'Reading the same file again.',
      toolCalls: [createNativeToolCall(id, 'read_file', { path: 'same.ts' })],
    });
    const { host, complete, emittedMessages } = createReactLoopHarness(
      [
        repeatedRead('call_1'),
        repeatedRead('call_2'),
        repeatedRead('call_3'),
        { content: 'I will read the file one more time now.' },
        { content: 'I will check the reads once more now.' },
        { content: 'Unreachable final answer.' },
      ],
      { responseCompletionHooks: DEFAULT_RESPONSE_COMPLETION_HOOKS },
    );

    await expect(runAgentReactLoop(host, new AbortController())).rejects.toThrow(
      /repeated-tool loop guard/i,
    );

    expect(complete).toHaveBeenCalledTimes(5);
    expect(emittedMessages).not.toContain('Unreachable final answer.');
  });

  it('promotes legacy JSON tool calls into valid native history before the next reflection', async () => {
    const { host, systemNotes, executedCalls, emittedMessages, complete } = createReactLoopHarness([
      {
        content: JSON.stringify({
          thought: 'Inspect the first file.',
          toolCalls: [{ tool: 'read_file', args: { path: 'first.ts' } }],
        }),
      },
      {
        content: JSON.stringify({
          reflection: 'The first file points to the second file.',
          thought: 'Inspect the referenced file.',
          toolCalls: [{ tool: 'read_file', args: { path: 'second.ts' } }],
        }),
      },
      {
        content: '{"finalResponse":"Legacy fallback completed."}',
      },
    ]);

    await runAgentReactLoop(host, new AbortController());

    expect(executedCalls.map((call) => call.args?.path)).toEqual(['first.ts', 'second.ts']);
    expect(systemNotes.some((note) => note.startsWith('[Tool Result Integrity]'))).toBe(false);
    const secondRequestMessages = complete.mock.calls[1]?.[0]?.messages as LLMMessage[];
    const firstAssistantCall = secondRequestMessages.find(
      (message) => message.role === 'assistant' && message.tool_calls?.length,
    )?.tool_calls?.[0];
    expect(firstAssistantCall).toEqual(expect.objectContaining({
      type: 'function',
      function: expect.objectContaining({ name: 'read_file' }),
    }));
    expect(secondRequestMessages).toContainEqual(expect.objectContaining({
      role: 'tool',
      tool_call_id: firstAssistantCall?.id,
      content: 'output for read_file',
    }));
    expect(emittedMessages).toContain('Legacy fallback completed.');
  });

  it('blocks a follow-up structured tool call until the assistant reflects on tool results', async () => {
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
    ], { nativeToolCalling: false });

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
    ], { nativeToolCalling: false });

    await runAgentReactLoop(host, new AbortController());

    expect(systemNotes.some((note) => note.startsWith('[Reflection Required]'))).toBe(true);
    expect(executedCalls.map((call) => call.args?.path)).toEqual(['first.ts']);
    expect(emittedMessages).toContain('Stopped after reminder.');
  });

  it('blocks the follow-up call once and then lets the next attempt through', async () => {
    const { host, systemNotes, executedCalls, emittedMessages, complete } = createReactLoopHarness([
      {
        content: 'Initial lookup',
        toolCalls: [createNativeToolCall('call_1', 'read_file', { path: 'first.ts' })],
      },
      {
        content: 'short',
        toolCalls: [createNativeToolCall('call_2', 'read_file', { path: 'blocked-once.ts' })],
      },
      {
        content: 'still short',
        toolCalls: [createNativeToolCall('call_3', 'read_file', { path: 'allowed-after-reminder.ts' })],
      },
      {
        content: '{"finalResponse":"Finished after one reflection reminder."}',
      },
    ], { nativeToolCalling: false });

    await runAgentReactLoop(host, new AbortController());

    expect(executedCalls.map((call) => call.id)).toEqual(['call_1', 'call_3']);
    expect(systemNotes.some((note) => note.startsWith('[Reflection Required]'))).toBe(true);
    expect(systemNotes.some((note) => note.startsWith('[Critical Reflection Guard]'))).toBe(false);
    expect(complete.mock.calls[3]?.[0]?.tools).toBeUndefined();
    expect(emittedMessages).toContain('Finished after one reflection reminder.');
  });

  it('treats a missing-tool-output reflection as an integrity failure instead of re-running tools', async () => {
    const { host, systemNotes, executedCalls, emittedMessages, complete } = createReactLoopHarness([
      {
        content: 'Initial lookup',
        toolCalls: [createNativeToolCall('call_1', 'read_file', { path: 'package.json' })],
      },
      {
        content: '{"reflection":"The previous tool outputs weren\'t visible in my context.","thought":"I should retry."}',
        toolCalls: [createNativeToolCall('call_2', 'read_file', { path: 'package.json' })],
      },
      {
        content: '{"finalResponse":"I stopped instead of repeating the read."}',
      },
    ]);

    await runAgentReactLoop(host, new AbortController());

    expect(executedCalls.map((call) => call.id)).toEqual(['call_1']);
    const reflectionRequestMessages = complete.mock.calls[1]?.[0]?.messages as LLMMessage[];
    expect(reflectionRequestMessages).toContainEqual(expect.objectContaining({
      role: 'assistant',
      tool_calls: [expect.objectContaining({ id: 'call_1' })],
    }));
    expect(reflectionRequestMessages).toContainEqual(expect.objectContaining({
      role: 'tool',
      tool_call_id: 'call_1',
      content: 'output for read_file',
    }));
    expect(systemNotes.some((note) => note.startsWith('[Tool Result Integrity]'))).toBe(true);
    expect(complete.mock.calls[2]?.[0]?.tools).toBeUndefined();
    const thirdRequestMessages = complete.mock.calls[2]?.[0]?.messages as LLMMessage[];
    expect(thirdRequestMessages).toContainEqual(expect.objectContaining({
      role: 'tool',
      tool_call_id: 'call_2',
      content: expect.stringContaining('not executed'),
    }));
    expect(emittedMessages).toContain('I stopped instead of repeating the read.');
  });

  it('verifies the last tool result is present in the outbound native payload before reflection', async () => {
    const { host, systemNotes, executedCalls, emittedMessages, complete } = createReactLoopHarness([
      {
        content: 'Initial lookup',
        toolCalls: [createNativeToolCall('call_1', 'read_file', { path: 'package.json' })],
      },
      {
        content: '{"finalResponse":"Stopped after repairing tool history."}',
      },
    ]);
    let outboundReadCount = 0;
    host.getMessagesWithImages = vi.fn(async () => {
      outboundReadCount += 1;
      const messages = host.conversation.history();
      return outboundReadCount === 2
        ? messages.filter((message) => message.role !== 'tool')
        : messages;
    });

    await runAgentReactLoop(host, new AbortController());

    expect(executedCalls.map((call) => call.id)).toEqual(['call_1']);
    expect(systemNotes.some((note) => note.startsWith('[Tool Result Integrity]'))).toBe(true);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1]?.[0]?.tools).toBeUndefined();
    expect(complete.mock.calls[1]?.[0]?.messages).toContainEqual(expect.objectContaining({
      role: 'tool',
      tool_call_id: 'call_1',
      content: expect.stringContaining('not available in the outbound payload'),
    }));
    expect(emittedMessages).toContain('Stopped after repairing tool history.');
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

/* ── Regression: reflection guard must not strand a turn ──── */

/**
 * Reported symptom: the agent printed a reflection ending in "Let me try
 * reading those files now." and then stopped, never reading anything.
 *
 * Two independent defects produced it:
 *  1. The reflection guard escalated to a permanent tool ban, so the assistant
 *     could no longer act even after it produced the reflection it was asked
 *     for.
 *  2. `responseCompletionHooks` was never wired onto the real react-loop host,
 *     so an announced-but-unexecuted action was rendered as the final answer
 *     instead of being rejected and retried.
 */
describe('Reflection guard dead-end regression', () => {
  it('lets a native assistant keep working across consecutive tool calls without reflection prose', async () => {
    const { host, systemNotes, executedCalls, emittedMessages, complete } = createReactLoopHarness([
      {
        content: 'Initial lookup',
        toolCalls: [createNativeToolCall('call_1', 'read_file', { path: 'first.ts' })],
      },
      {
        content: 'short',
        toolCalls: [createNativeToolCall('call_2', 'read_file', { path: 'reminded.ts' })],
      },
      {
        content: 'still short',
        toolCalls: [createNativeToolCall('call_3', 'read_file', { path: 'recovered.ts' })],
      },
      {
        content: '{"finalResponse":"Both files read."}',
      },
    ]);

    await runAgentReactLoop(host, new AbortController());

    expect(executedCalls.map((call) => call.args?.path)).toEqual(['first.ts', 'reminded.ts', 'recovered.ts']);
    expect(systemNotes.some((note) => note.startsWith('[Reflection Required]'))).toBe(false);
    expect(systemNotes.some((note) => note.startsWith('[Critical Reflection Guard]'))).toBe(false);
    expect(complete.mock.calls[2]?.[0]?.tools).toBeDefined();
    expect(emittedMessages).toContain('Both files read.');
  });

  it('does not ban tools for the rest of the turn once a reminder is ignored', async () => {
    const { host, complete, emittedMessages } = createReactLoopHarness([
      {
        content: 'Initial lookup',
        toolCalls: [createNativeToolCall('call_1', 'read_file', { path: 'first.ts' })],
      },
      {
        content: 'short',
        toolCalls: [createNativeToolCall('call_2', 'read_file', { path: 'reminded.ts' })],
      },
      {
        content: 'still short',
        toolCalls: [createNativeToolCall('call_3', 'read_file', { path: 'recovered.ts' })],
      },
      {
        content: '{"reflection":"Both files described the delegator.","thought":"Now I can answer."}',
        toolCalls: [createNativeToolCall('call_4', 'read_file', { path: 'follow-up.ts' })],
      },
      {
        content: '{"finalResponse":"Answered after recovering."}',
      },
    ]);

    await runAgentReactLoop(host, new AbortController());

    for (const call of complete.mock.calls) {
      expect(call[0]?.tools).toBeDefined();
    }
    expect(emittedMessages).toContain('Answered after recovering.');
  });

  it('rejects an announced-but-unexecuted action instead of presenting it as the answer', async () => {
    const announcement = [
      "I need to stop and reflect on what I've gathered so far before proceeding.",
      '',
      'I was trying to read the actual implementation files but the tool calls were blocked.',
      'I need to read `src/commands/agents.ts` and `src/core/agents/AgentDelegator.ts` implementation',
      'before I can plan the "kill/stop" feature.',
      '',
      'Let me try reading those files now.',
    ].join('\n');

    const { host, systemNotes, executedCalls, emittedMessages } = createReactLoopHarness(
      [
        { content: announcement },
        {
          content: 'Reading the delegator now.',
          toolCalls: [createNativeToolCall('call_1', 'read_file', { path: 'AgentDelegator.ts' })],
        },
        { content: '{"finalResponse":"`/agents` delegates through AgentDelegator."}' },
      ],
      { responseCompletionHooks: DEFAULT_RESPONSE_COMPLETION_HOOKS },
    );

    await runAgentReactLoop(host, new AbortController());

    expect(systemNotes.some((note) => note.includes('announced an action but emitted no tool calls'))).toBe(true);
    expect(executedCalls.map((call) => call.args?.path)).toEqual(['AgentDelegator.ts']);
    expect(emittedMessages).toContain('`/agents` delegates through AgentDelegator.');
    expect(emittedMessages).not.toContain(announcement);
  });

  it('restores tools when integrity recovery still announces an unfinished action', async () => {
    const { host, systemNotes, executedCalls, emittedMessages, complete } = createReactLoopHarness(
      [
        {
          content: 'Initial lookup',
          toolCalls: [createNativeToolCall('call_1', 'read_file', { path: 'same.ts' })],
        },
        {
          content: '{"reflection":"The previous tool outputs weren\'t visible in my context.","thought":"I should retry."}',
          toolCalls: [createNativeToolCall('call_2', 'read_file', { path: 'same.ts' })],
        },
        { content: 'I need to read the file again before I can answer.' },
        {
          content: '',
          toolCalls: [createNativeToolCall('call_3', 'read_file', { path: 'recovered.ts' })],
        },
        { content: 'Recovered after re-reading the required file.' },
      ],
      { responseCompletionHooks: DEFAULT_RESPONSE_COMPLETION_HOOKS },
    );

    await runAgentReactLoop(host, new AbortController());

    expect(systemNotes.some((note) => note.startsWith('[Tool Result Integrity]'))).toBe(true);
    expect(systemNotes.some((note) => note.includes('Tool access is restored'))).toBe(true);
    expect(complete.mock.calls[2]?.[0]?.tools).toBeUndefined();
    expect(complete.mock.calls[3]?.[0]?.tools).toBeDefined();
    expect(executedCalls.map((call) => call.id)).toEqual(['call_1', 'call_3']);
    expect(emittedMessages).toContain('Recovered after re-reading the required file.');
    expect(emittedMessages).not.toContain('I need to read the file again before I can answer.');
  });

  it('wires the response-completion hooks onto the real react-loop host', () => {
    const agent = createMinimalAgent();
    const host = agent.createReactLoopHost();

    expect(host.responseCompletionHooks).toEqual(DEFAULT_RESPONSE_COMPLETION_HOOKS);
    expect(host.responseCompletionHooks.length).toBeGreaterThan(0);
  });
});
