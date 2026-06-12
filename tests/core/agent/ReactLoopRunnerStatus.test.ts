/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  type AgentReactLoopHost,
  formatComposerToolCallStatus,
  isDeferredFinalResponse,
  runAgentReactLoop,
  shouldDisplayToolOutput,
} from '../../../src/core/agent/ReactLoopRunner.js';
import { ReactionParser } from '../../../src/core/agent/ReactionParser.js';

describe('ReactLoopRunner composer status', () => {
  it('keeps the react loop behind an explicit typed host adapter', () => {
    const loopSource = readFileSync('src/core/agent/ReactLoopRunner.ts', 'utf-8');
    const agentSource = readFileSync('src/core/agent.ts', 'utf-8');

    expect(loopSource).not.toContain('[key: string]: any');
    expect(agentSource).not.toContain('runAgentReactLoop(this as unknown as AgentReactLoopHost');
  });

  it('does not include model-provided tool names in composer status', () => {
    expect(formatComposerToolCallStatus(1)).toBe('Calling tool...');
    expect(formatComposerToolCallStatus(3)).toBe('Calling 3 tools...');
  });

  it('shows completed tool output by default and only hides it when explicitly silenced', () => {
    expect(shouldDisplayToolOutput({ ui: {} } as any)).toBe(true);
    expect(shouldDisplayToolOutput({ ui: { silentToolOutput: false } } as any)).toBe(true);
    expect(shouldDisplayToolOutput({ ui: { silentToolOutput: true } } as any)).toBe(false);
  });

  it('logs parsed tool calls to Ink by default before completed tool output', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const parser = new ReactionParser();
    const addToolCall = vi.fn();
    const addToolOutput = vi.fn();
    const llmComplete = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'tool-call',
        created: 1,
        content: JSON.stringify({
          thought: 'I need to inspect the entrypoint before answering.',
          toolCalls: [
            {
              tool: 'read_file',
              args: { path: 'src/index.ts' },
            },
          ],
        }),
        raw: {},
      })
      .mockResolvedValueOnce({
        id: 'answer',
        created: 2,
        content: '{"finalResponse":"The entrypoint is src/index.ts."}',
        raw: {},
      });

    const host = createReactLoopTestHost(llmComplete, parser);
    host.runtime.config.ui = { showThinking: true, silentToolOutput: false };
    host.inkRenderer = {
      setStatus: vi.fn(),
      addToolCall,
      addToolOutputBatch: vi.fn(),
      addToolOutput,
      setThinking: vi.fn(),
      setElapsed: vi.fn(),
      setTokens: vi.fn(),
      setWorking: vi.fn(),
      setFinalResponse: vi.fn(),
    };
    host.toolManager.execute = vi.fn(async (_calls, onResult) => {
      const result = {
        tool: 'read_file' as const,
        success: true,
        output: 'console.log("hello");',
      };
      onResult(0, result);
      return [result];
    });

    try {
      await runAgentReactLoop(host, new AbortController());

      expect(addToolCall).toHaveBeenCalledWith('read_file', 'src/index.ts');
      expect(addToolCall.mock.invocationCallOrder[0]).toBeLessThan(addToolOutput.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER);
      expect(addToolOutput).toHaveBeenCalledWith(
        'read_file',
        true,
        expect.stringContaining('src/index.ts'),
        'I need to inspect the entrypoint before answering.',
      );
    } finally {
      logSpy.mockRestore();
    }
  });

  it('does not interpolate model thought text into Ink status updates', () => {
    const source = readFileSync('src/core/agent/ReactLoopRunner.ts', 'utf-8');

    expect(source).not.toContain('Thinking: ${thoughtPreview}');
    expect(source).not.toContain('Calling: ${toolNames}');
  });

  it('does not replace Ink activity verbs with tool lifecycle text', () => {
    const source = readFileSync('src/core/agent/ReactLoopRunner.ts', 'utf-8');

    expect(source).not.toContain('host.inkRenderer.setStatus(formatComposerToolCallStatus');
    expect(source).not.toContain("host.inkRenderer.setStatus('Running tool...')");
    expect(source).not.toContain("host.inkRenderer.setStatus('Responding...')");
    expect(source).not.toContain("host.inkRenderer.setStatus('Thinking...')");
  });

  it('detects meta final responses that promise an answer instead of answering', () => {
    expect(
      isDeferredFinalResponse(
        'I now have a comprehensive understanding of the repository. Let me provide a clear, informative summary about this repo to the user.',
      ),
    ).toBe(true);
    expect(
      isDeferredFinalResponse(
        "I'll perform a comprehensive code review of the workspace. Let me start by gathering context about the project structure and recent changes.",
      ),
    ).toBe(true);
    expect(
      isDeferredFinalResponse(
        'First, let me check the git status and recent changes more thoroughly.',
      ),
    ).toBe(true);
    expect(
      isDeferredFinalResponse(
        'I need to continue gathering information for the comprehensive code review. The glob for test files returned nothing, so let me search differently.',
      ),
    ).toBe(true);
    expect(
      isDeferredFinalResponse(
        [
          'Got it — that sounds like the autocomplete layer is now swallowing editor-editing keys.',
          '',
          'I’ll need to inspect the actual current implementation before changing anything, especially:',
          '- src/ui/inputPrompt.ts',
          '- src/ui/ink/AgentUI.tsx',
          '- related Composer/input tests',
          '',
          'SITREP:',
          '- Done: Confirmed this is a regression in key handling.',
          '- Status: blocked by this turn’s no-tool constraint.',
          '- Next: I should inspect the relevant input/autocomplete code.',
        ].join('\n'),
      ),
    ).toBe(true);
  });

  it('allows real concise answers and summaries', () => {
    expect(isDeferredFinalResponse('This repo is a TypeScript CLI built with React and Ink.')).toBe(false);
    expect(
      isDeferredFinalResponse(
        'Let me explain why this repo exits early: the model returned a planning sentence instead of an answer.',
      ),
    ).toBe(false);
    expect(
      isDeferredFinalResponse(
        'Let me summarize: the CLI is TypeScript, Ink, Bun, and Vitest.',
      ),
    ).toBe(false);
    expect(
      isDeferredFinalResponse(
        'I can now answer: the branch is read from .git/HEAD first.',
      ),
    ).toBe(false);
    expect(
      isDeferredFinalResponse(
        'Here is the summary:\n- TypeScript CLI\n- Ink UI\n- Vitest tests',
      ),
    ).toBe(false);
  });

  it('renders deferred-sounding text by default instead of spending a repair turn', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const parser = new ReactionParser();
    const addSystemNote = vi.fn();
    const emitOutput = vi.fn();
    const deferredText =
      'I need to continue gathering information for the comprehensive code review. The glob for test files returned nothing, so let me search differently.';
    const llmComplete = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'deferred',
        created: 1,
        content: deferredText,
        raw: {},
      });

    const host = {
      activeProvider: undefined,
      autoReportManager: {
        reportError: vi.fn(async () => {}),
      },
      consecutiveCancellations: 0,
      contextPercentLeft: 100,
      contextOrchestrator: {
        checkMidTurnCompaction: vi.fn(async () => false),
        handleOverflow: vi.fn(async () => ({ croppedCount: 0 })),
        setModel: vi.fn(),
        prepareRequest: vi.fn(async () => ({
          messages: [],
          tools: [],
          usage: {
            totalTokens: 0,
            usagePercent: 0,
            isWarning: false,
            isCritical: false,
            isExceeded: false,
          },
          wasCropped: false,
          croppedCount: 0,
        })),
      },
      conversation: {
        addMessage: vi.fn(),
        addSystemNote,
        history: vi.fn(() => []),
      },
      cleanupModelResponse: (content: string) => content.trim(),
      emitOutput,
      ensureSpinnerRunning: vi.fn(),
      forceRenderSpinner: vi.fn(),
      getMessagesWithImages: vi.fn(async () => []),
      getReactionParser: () => parser,
      handleSmartContextCrop: vi.fn(async () => ''),
      inkRenderer: null,
      isContextOverflowError: vi.fn(() => false),
      llm: { complete: llmComplete },
      memoryManager: undefined,
      projectManager: {
        recordFailure: vi.fn(async () => {}),
        recordSuccess: vi.fn(async () => {}),
      },
      runtime: {
        config: {
          agent: { maxIterations: 5, debug: false },
          ui: { showThinking: false },
        },
        options: { model: 'test-model' },
        spinner: { stop: vi.fn() },
      },
      saveAssistantMessage: vi.fn(async () => {}),
      saveToolMessage: vi.fn(async () => {}),
      searchQueries: [],
      sessionManager: {
        getCurrentSession: vi.fn(() => null),
      },
      sessionStartedAt: Date.now(),
      sessionTokensUsed: 0,
      taskStartedAt: Date.now(),
      startStatusUpdates: vi.fn(),
      stopStatusUpdates: vi.fn(),
      setComposerFinalResponse: vi.fn(),
      setComposerIdle: vi.fn(),
      setSpinnerStatus: vi.fn(),
      toolManager: {
        listToolNames: vi.fn(() => []),
        toFunctionDefinitions: vi.fn(() => []),
        execute: vi.fn(async () => []),
        register: vi.fn(),
        registerMetaTools: vi.fn(),
        unregister: vi.fn(() => true),
      },
      toolsRegistry: undefined,
      contextWindow: 128000,
      lastAssistantResponseForNotification: '',
      totalTokensUsed: 0,
      currentTurnActualUsage: { kind: 'unavailable', reason: 'not_reported' },
      currentTurnHadUnavailableUsage: false,
      sessionActualTokensUsed: 0,
      sessionTokenUsageUnavailable: false,
      updateContextUsage: vi.fn(),
      writeDebugLine: vi.fn(),
    } satisfies AgentReactLoopHost;

    try {
      await runAgentReactLoop(host, new AbortController());

      expect(llmComplete).toHaveBeenCalledTimes(1);
      expect(addSystemNote).not.toHaveBeenCalled();
      expect(emitOutput).toHaveBeenCalledWith({
        type: 'message',
        content: deferredText,
      });
    } finally {
      logSpy.mockRestore();
    }
  });

  it('repairs empty no-tool responses without saving them or forbidding tools', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const parser = new ReactionParser();
    const addMessage = vi.fn();
    const addSystemNote = vi.fn();
    const emitOutput = vi.fn();
    const saveAssistantMessage = vi.fn(async () => {});
    const llmComplete = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'empty',
        created: 1,
        content: '',
        raw: {},
      })
      .mockResolvedValueOnce({
        id: 'answer',
        created: 2,
        content: 'The codebase has src, tests, docs, and configuration files.',
        raw: {},
      });

    const host = {
      activeProvider: undefined,
      autoReportManager: {
        reportError: vi.fn(async () => {}),
      },
      contextPercentLeft: 100,
      contextOrchestrator: {
        checkMidTurnCompaction: vi.fn(async () => false),
        handleOverflow: vi.fn(async () => ({ croppedCount: 0 })),
        setModel: vi.fn(),
        prepareRequest: vi.fn(async () => ({
          messages: [],
          tools: [],
          usage: {
            totalTokens: 0,
            usagePercent: 0,
            isWarning: false,
            isCritical: false,
            isExceeded: false,
          },
          wasCropped: false,
          croppedCount: 0,
        })),
      },
      conversation: {
        addMessage,
        addSystemNote,
        history: vi.fn(() => []),
      },
      cleanupModelResponse: (content: string) => content.trim(),
      emitOutput,
      ensureSpinnerRunning: vi.fn(),
      forceRenderSpinner: vi.fn(),
      getMessagesWithImages: vi.fn(async () => []),
      getReactionParser: () => parser,
      handleSmartContextCrop: vi.fn(async () => ''),
      inkRenderer: null,
      isContextOverflowError: vi.fn(() => false),
      llm: { complete: llmComplete },
      memoryManager: undefined,
      projectManager: {
        recordFailure: vi.fn(async () => {}),
        recordSuccess: vi.fn(async () => {}),
      },
      runtime: {
        config: {
          agent: { maxIterations: 5, debug: false },
          ui: { showThinking: false },
        },
        options: { model: 'test-model' },
        spinner: { stop: vi.fn() },
      },
      saveAssistantMessage,
      saveToolMessage: vi.fn(async () => {}),
      searchQueries: [],
      sessionManager: {
        getCurrentSession: vi.fn(() => null),
      },
      sessionStartedAt: Date.now(),
      sessionTokensUsed: 0,
      startStatusUpdates: vi.fn(),
      stopStatusUpdates: vi.fn(),
      setComposerFinalResponse: vi.fn(),
      setComposerIdle: vi.fn(),
      setSpinnerStatus: vi.fn(),
      toolManager: {
        listToolNames: vi.fn(() => []),
        toFunctionDefinitions: vi.fn(() => []),
        execute: vi.fn(async () => []),
        register: vi.fn(),
        unregister: vi.fn(() => true),
      },
      totalTokensUsed: 0,
      updateContextUsage: vi.fn(),
      writeDebugLine: vi.fn(),
    } satisfies AgentReactLoopHost;

    try {
      await runAgentReactLoop(host, new AbortController());

      expect(llmComplete).toHaveBeenCalledTimes(2);
      expect(addMessage).toHaveBeenCalledTimes(1);
      expect(addMessage).toHaveBeenCalledWith({
        role: 'assistant',
        content: 'The codebase has src, tests, docs, and configuration files.',
      });
      expect(saveAssistantMessage).toHaveBeenCalledTimes(1);
      expect(addSystemNote).toHaveBeenCalledWith(expect.stringContaining('emitted no usable finalResponse and no tool calls'));
      expect(addSystemNote).toHaveBeenCalledWith(expect.stringContaining('emit the required tool call'));
      expect(addSystemNote).not.toHaveBeenCalledWith(expect.stringContaining('Do not call any more tools'));
      expect(emitOutput).toHaveBeenCalledWith({
        type: 'message',
        content: 'The codebase has src, tests, docs, and configuration files.',
      });
    } finally {
      logSpy.mockRestore();
    }
  });

  it('does not save JSON-only no-tool responses that clean to empty', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const parser = new ReactionParser({
      cleanupModelResponse: (content) => content.replace(/^\{\s*"toolCalls"\s*:\s*\[\s*\]\s*\}$/u, '').trim(),
    });
    const addMessage = vi.fn();
    const addSystemNote = vi.fn();
    const emitOutput = vi.fn();
    const saveAssistantMessage = vi.fn(async () => {});
    const llmComplete = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'json-only',
        created: 1,
        content: '{"toolCalls":[]}',
        raw: {},
      })
      .mockResolvedValueOnce({
        id: 'answer',
        created: 2,
        content: 'The codebase structure lives under src and tests.',
        raw: {},
      });

    const host = {
      activeProvider: undefined,
      autoReportManager: {
        reportError: vi.fn(async () => {}),
      },
      contextPercentLeft: 100,
      contextOrchestrator: {
        checkMidTurnCompaction: vi.fn(async () => false),
        handleOverflow: vi.fn(async () => ({ croppedCount: 0 })),
        setModel: vi.fn(),
        prepareRequest: vi.fn(async () => ({
          messages: [],
          tools: [],
          usage: {
            totalTokens: 0,
            usagePercent: 0,
            isWarning: false,
            isCritical: false,
            isExceeded: false,
          },
          wasCropped: false,
          croppedCount: 0,
        })),
      },
      conversation: {
        addMessage,
        addSystemNote,
        history: vi.fn(() => []),
      },
      cleanupModelResponse: (content: string) => content.replace(/^\{\s*"toolCalls"\s*:\s*\[\s*\]\s*\}$/u, '').trim(),
      emitOutput,
      ensureSpinnerRunning: vi.fn(),
      forceRenderSpinner: vi.fn(),
      getMessagesWithImages: vi.fn(async () => []),
      getReactionParser: () => parser,
      handleSmartContextCrop: vi.fn(async () => ''),
      inkRenderer: null,
      isContextOverflowError: vi.fn(() => false),
      llm: { complete: llmComplete },
      memoryManager: undefined,
      projectManager: {
        recordFailure: vi.fn(async () => {}),
        recordSuccess: vi.fn(async () => {}),
      },
      runtime: {
        config: {
          agent: { maxIterations: 5, debug: false },
          ui: { showThinking: false },
        },
        options: { model: 'test-model' },
        spinner: { stop: vi.fn() },
      },
      saveAssistantMessage,
      saveToolMessage: vi.fn(async () => {}),
      searchQueries: [],
      sessionManager: {
        getCurrentSession: vi.fn(() => null),
      },
      sessionStartedAt: Date.now(),
      sessionTokensUsed: 0,
      startStatusUpdates: vi.fn(),
      stopStatusUpdates: vi.fn(),
      setComposerFinalResponse: vi.fn(),
      setComposerIdle: vi.fn(),
      setSpinnerStatus: vi.fn(),
      toolManager: {
        listToolNames: vi.fn(() => []),
        toFunctionDefinitions: vi.fn(() => []),
        execute: vi.fn(async () => []),
        register: vi.fn(),
        unregister: vi.fn(() => true),
      },
      totalTokensUsed: 0,
      updateContextUsage: vi.fn(),
      writeDebugLine: vi.fn(),
    } satisfies AgentReactLoopHost;

    try {
      await runAgentReactLoop(host, new AbortController());

      expect(llmComplete).toHaveBeenCalledTimes(2);
      expect(addMessage).toHaveBeenCalledTimes(1);
      expect(saveAssistantMessage).toHaveBeenCalledTimes(1);
      expect(addSystemNote).toHaveBeenCalledWith(expect.stringContaining('no usable finalResponse and no tool calls'));
      expect(addSystemNote).not.toHaveBeenCalledWith(expect.stringContaining('Do not call any more tools'));
      expect(emitOutput).toHaveBeenCalledWith({
        type: 'message',
        content: 'The codebase structure lives under src and tests.',
      });
    } finally {
      logSpy.mockRestore();
    }
  });

  it('bounds repeated invalid deferred responses and reports telemetry', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const parser = new ReactionParser();
    const addSystemNote = vi.fn();
    const emitOutput = vi.fn();
    const reportError = vi.fn(async () => {});
    const setComposerFinalResponse = vi.fn();
    const llmComplete = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'deferred-1',
        created: 1,
        content: 'Let me run the focused regression test before changing anything.',
        raw: {},
      })
      .mockResolvedValueOnce({
        id: 'deferred-2',
        created: 2,
        content: 'SITREP:\n- Status: blocked by no-tool constraint.\n- Next: inspect the React loop.',
        raw: {},
      });

    const host = createReactLoopTestHost(llmComplete, parser);
    host.activeProvider = 'openai';
    host.autoReportManager.reportError = reportError;
    host.conversation.addSystemNote = addSystemNote;
    host.emitOutput = emitOutput;
    host.setComposerFinalResponse = setComposerFinalResponse;
    host.responseCompletionHooks = [
      ({ response }) => response.includes('focused regression test') ||
        response.includes('blocked by no-tool constraint')
          ? {
              kind: 'invalid_deferred_action',
              reason: response.includes('blocked by no-tool constraint')
                ? 'blocked_without_tools'
                : 'announced_action_without_tool',
              excerpt: response,
            }
          : undefined,
    ];

    try {
      await runAgentReactLoop(host, new AbortController());

      expect(llmComplete).toHaveBeenCalledTimes(2);
      expect(addSystemNote).toHaveBeenCalledTimes(1);
      expect(reportError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          errorType: 'invalid_deferred_action',
          model: 'test-model',
          provider: 'openai',
          context: expect.objectContaining({
            excerpt: expect.stringContaining('blocked by no-tool constraint'),
            reason: 'blocked_without_tools',
            responseCompletionKind: 'invalid_deferred_action',
          }),
        }),
      );
      expect(emitOutput).toHaveBeenCalledWith({
        type: 'message',
        content: 'SITREP:\n- Status: blocked by no-tool constraint.\n- Next: inspect the React loop.',
      });
      expect(emitOutput).not.toHaveBeenCalledWith({
        type: 'message',
        content: 'The model stopped before providing a usable answer. Please retry the request.',
      });
    } finally {
      logSpy.mockRestore();
    }
  });

  it('shows tool-list answers instead of the premature-stop fallback', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const parser = new ReactionParser();
    const emitOutput = vi.fn();
    const toolListAnswer = [
      "I'll provide the tools I have for you:",
      '- read_file and fff_grep for source inspection',
      '- apply_patch for focused edits',
      '- shell for validation commands',
    ].join('\n');
    const llmComplete = vi.fn().mockResolvedValueOnce({
      id: 'tool-list-answer',
      created: 1,
      content: toolListAnswer,
      raw: {},
    });

    const host = createReactLoopTestHost(llmComplete, parser);
    host.emitOutput = emitOutput;

    try {
      await runAgentReactLoop(host, new AbortController());

      expect(llmComplete).toHaveBeenCalledTimes(1);
      expect(emitOutput).toHaveBeenCalledWith({
        type: 'message',
        content: toolListAnswer,
      });
      expect(emitOutput).not.toHaveBeenCalledWith({
        type: 'message',
        content: 'The model stopped before providing a usable answer. Please retry the request.',
      });
    } finally {
      logSpy.mockRestore();
    }
  });

  it('uses host completion hooks before ending a no-tool turn', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const parser = new ReactionParser();
    const addSystemNote = vi.fn();
    const emitOutput = vi.fn();
    const llmComplete = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'custom-invalid',
        created: 1,
        content: 'CUSTOM_DEFERRED_MARKER',
        raw: {},
      })
      .mockResolvedValueOnce({
        id: 'answer',
        created: 2,
        content: 'Finished with a real answer.',
        raw: {},
      });

    const host = createReactLoopTestHost(llmComplete, parser);
    host.conversation.addSystemNote = addSystemNote;
    host.emitOutput = emitOutput;
    host.responseCompletionHooks = [
      ({ response }) => response === 'CUSTOM_DEFERRED_MARKER'
        ? {
            kind: 'invalid_deferred_action',
            reason: 'announced_action_without_tool',
            excerpt: response,
          }
        : undefined,
    ];

    try {
      await runAgentReactLoop(host, new AbortController());

      expect(llmComplete).toHaveBeenCalledTimes(2);
      expect(addSystemNote).toHaveBeenCalledWith(expect.stringContaining('CUSTOM_DEFERRED_MARKER'));
      expect(emitOutput).toHaveBeenCalledWith({
        type: 'message',
        content: 'Finished with a real answer.',
      });
    } finally {
      logSpy.mockRestore();
    }
  });

  it('accumulates actual provider usage for a turn', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const parser = new ReactionParser();
    const llmComplete = vi.fn().mockResolvedValueOnce({
      id: 'answer',
      created: 1,
      content: 'Done.',
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      },
      raw: {},
    });

    const host = createReactLoopTestHost(llmComplete, parser);
    const setContextTokens = vi.fn();
    host.inkRenderer = {
      setStatus: vi.fn(),
      addToolCall: vi.fn(),
      addToolOutputBatch: vi.fn(),
      addToolOutput: vi.fn(),
      setThinking: vi.fn(),
      setElapsed: vi.fn(),
      setTokens: vi.fn(),
      setContextTokens,
      setWorking: vi.fn(),
      setFinalResponse: vi.fn(),
    };

    try {
      await runAgentReactLoop(host, new AbortController());

      expect(host.currentTurnActualUsage).toEqual({
        kind: 'actual',
        provider: undefined,
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      });
      expect(host.currentTurnHadUnavailableUsage).toBe(false);
      expect(host.totalTokensUsed).toBe(15);
      expect(setContextTokens).toHaveBeenCalledWith({ used: 10, total: 128000 });
    } finally {
      logSpy.mockRestore();
    }
  });

  it('marks missing provider usage as unavailable instead of zero', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const parser = new ReactionParser();
    const llmComplete = vi.fn().mockResolvedValueOnce({
      id: 'answer',
      created: 1,
      content: 'Done.',
      raw: {},
    });

    const host = createReactLoopTestHost(llmComplete, parser);

    try {
      await runAgentReactLoop(host, new AbortController());

      expect(host.currentTurnActualUsage).toEqual({
        kind: 'unavailable',
        provider: undefined,
        reason: 'not_reported',
      });
      expect(host.currentTurnHadUnavailableUsage).toBe(true);
      expect(host.totalTokensUsed).toBe(0);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('does not send native tool schemas to providers without native tool-call capability', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const parser = new ReactionParser();
    const llmComplete = vi.fn().mockResolvedValueOnce({
      id: 'answer',
      created: 1,
      content: '{"finalResponse":"Done.","toolCalls":[]}',
      raw: {},
    });

    const host = createReactLoopTestHost(llmComplete, parser);
    host.activeProvider = 'openrouter';
    host.toolManager.toFunctionDefinitions = vi.fn(() => [
      {
        name: 'read_file',
        description: 'Read a file',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
    ]);

    try {
      await runAgentReactLoop(host, new AbortController());

      expect(llmComplete).toHaveBeenCalledWith(expect.not.objectContaining({
        tools: expect.any(Array),
        toolChoice: expect.anything(),
      }));
      expect(host.emitOutput).toHaveBeenCalledWith({
        type: 'message',
        content: 'Done.',
      });
    } finally {
      logSpy.mockRestore();
    }
  });

  it('continues sending native tool schemas to providers with native tool-call capability', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const parser = new ReactionParser();
    const llmComplete = vi.fn().mockResolvedValueOnce({
      id: 'answer',
      created: 1,
      content: 'Done.',
      raw: {},
    });

    const host = createReactLoopTestHost(llmComplete, parser);
    host.activeProvider = 'openai';
    host.llm = {
      complete: llmComplete,
      getName: () => 'openai',
      getCapabilities: () => ({ nativeToolCalling: true }),
      isAvailable: vi.fn(async () => true),
      listModels: vi.fn(async () => []),
      setModel: vi.fn(),
    };
    host.toolManager.toFunctionDefinitions = vi.fn(() => [
      {
        name: 'read_file',
        description: 'Read a file',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
    ]);

    try {
      await runAgentReactLoop(host, new AbortController());

      expect(llmComplete).toHaveBeenCalledWith(expect.objectContaining({
        tools: [
          expect.objectContaining({
            name: 'read_file',
          }),
        ],
        toolChoice: 'auto',
      }));
    } finally {
      logSpy.mockRestore();
    }
  });
});

function createReactLoopTestHost(
  llmComplete: ReturnType<typeof vi.fn>,
  parser: ReactionParser,
): AgentReactLoopHost {
  return {
    activeProvider: undefined,
    autoReportManager: {
      reportError: vi.fn(async () => {}),
    },
    consecutiveCancellations: 0,
    contextPercentLeft: 100,
    contextOrchestrator: {
      checkMidTurnCompaction: vi.fn(async () => false),
      handleOverflow: vi.fn(async () => ({ croppedCount: 0 })),
      setModel: vi.fn(),
      prepareRequest: vi.fn(async () => ({
        messages: [],
        tools: [],
        usage: {
          totalTokens: 0,
          usagePercent: 0,
          isWarning: false,
          isCritical: false,
          isExceeded: false,
        },
        wasCropped: false,
        croppedCount: 0,
      })),
    },
    conversation: {
      addMessage: vi.fn(),
      addSystemNote: vi.fn(),
      history: vi.fn(() => []),
    },
    cleanupModelResponse: (content: string) => content.trim(),
    emitOutput: vi.fn(),
    ensureSpinnerRunning: vi.fn(),
    forceRenderSpinner: vi.fn(),
    getMessagesWithImages: vi.fn(async () => []),
    getReactionParser: () => parser,
    handleSmartContextCrop: vi.fn(async () => ''),
    inkRenderer: null,
    isContextOverflowError: vi.fn(() => false),
    llm: { complete: llmComplete },
    memoryManager: undefined,
    projectManager: {
      recordFailure: vi.fn(async () => {}),
      recordSuccess: vi.fn(async () => {}),
    },
    runtime: {
      config: {
        agent: { maxIterations: 5, debug: false },
        ui: { showThinking: false },
      },
      options: { model: 'test-model' },
      spinner: { stop: vi.fn() },
    },
    saveAssistantMessage: vi.fn(async () => {}),
    saveToolMessage: vi.fn(async () => {}),
    searchQueries: [],
    sessionManager: {
      getCurrentSession: vi.fn(() => null),
    },
    sessionStartedAt: Date.now(),
    sessionTokensUsed: 0,
    taskStartedAt: Date.now(),
    startStatusUpdates: vi.fn(),
    stopStatusUpdates: vi.fn(),
    setComposerFinalResponse: vi.fn(),
    setComposerIdle: vi.fn(),
    setSpinnerStatus: vi.fn(),
    toolManager: {
      listToolNames: vi.fn(() => []),
      toFunctionDefinitions: vi.fn(() => []),
      execute: vi.fn(async () => []),
      register: vi.fn(),
      registerMetaTools: vi.fn(),
      unregister: vi.fn(() => true),
    },
    toolsRegistry: undefined,
    contextWindow: 128000,
    lastAssistantResponseForNotification: '',
    totalTokensUsed: 0,
    currentTurnActualUsage: { kind: 'unavailable', reason: 'not_reported' },
    currentTurnHadUnavailableUsage: false,
    sessionActualTokensUsed: 0,
    sessionTokenUsageUnavailable: false,
    updateContextUsage: vi.fn(),
    writeDebugLine: vi.fn(),
  } satisfies AgentReactLoopHost;
}
