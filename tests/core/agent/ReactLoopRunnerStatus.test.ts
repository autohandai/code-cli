/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  formatComposerToolCallStatus,
  isDeferredFinalResponse,
  runAgentReactLoop,
} from '../../../src/core/agent/ReactLoopRunner.js';
import { ReactionParser } from '../../../src/core/agent/ReactionParser.js';

describe('ReactLoopRunner composer status', () => {
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
  });

  it('allows real concise answers and summaries', () => {
    expect(isDeferredFinalResponse('This repo is a TypeScript CLI built with React and Ink.')).toBe(false);
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
          'I now have a comprehensive understanding of the repository. Let me provide a clear, informative summary about this repo to the user.',
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
      contextPercentLeft: 100,
      contextOrchestrator: {
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
      executedActionNames: [],
      expressesIntentToAct: vi.fn(() => false),
      forceRenderSpinner: vi.fn(),
      getMessagesWithImages: vi.fn(async () => []),
      getReactionParser: () => parser,
      inkRenderer: null,
      isContextOverflowError: vi.fn(() => false),
      llm: { complete: llmComplete },
      runtime: {
        config: {
          agent: { maxIterations: 5, debug: false },
          ui: { showThinking: false },
        },
        options: { model: 'test-model' },
        spinner: { stop: vi.fn() },
      },
      saveAssistantMessage: vi.fn(async () => {}),
      searchQueries: [],
      sessionTokensUsed: 0,
      startStatusUpdates: vi.fn(),
      stopStatusUpdates: vi.fn(),
      toolManager: {
        listToolNames: vi.fn(() => []),
        toFunctionDefinitions: vi.fn(() => []),
        unregister: vi.fn(() => true),
      },
      totalTokensUsed: 0,
      updateContextUsage: vi.fn(),
    };

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
