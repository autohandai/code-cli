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

  it('does not interpolate model thought text into Ink status updates', () => {
    const source = readFileSync('src/core/agent/ReactLoopRunner.ts', 'utf-8');

    expect(source).not.toContain('Thinking: ${thoughtPreview}');
    expect(source).not.toContain('Calling: ${toolNames}');
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

  it('retries a deferred final response instead of ending the turn', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const parser = new ReactionParser();
    const addSystemNote = vi.fn();
    const emitOutput = vi.fn();
    const llmComplete = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'deferred',
        created: 1,
        content:
          'I need to continue gathering information for the comprehensive code review. The glob for test files returned nothing, so let me search differently.',
        raw: {},
      })
      .mockResolvedValueOnce({
        id: 'answer',
        created: 2,
        content: 'This repo is a TypeScript CLI built with React, Ink, Bun, and Vitest.',
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
        addMessage: vi.fn(),
        addSystemNote,
        history: vi.fn(() => []),
      },
      cleanupModelResponse: (content: string) => content.trim(),
      emitOutput,
      ensureSpinnerRunning: vi.fn(),
      expressesIntentToAct: vi.fn(() => false),
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
      expect(addSystemNote).toHaveBeenCalledWith(expect.stringContaining('was not an answer'));
      expect(emitOutput).toHaveBeenCalledWith({
        type: 'message',
        content: 'This repo is a TypeScript CLI built with React, Ink, Bun, and Vitest.',
      });
    } finally {
      logSpy.mockRestore();
    }
  });
});
