/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstructionRunner, type AgentInstructionHost } from '../../../src/core/agent/InstructionRunner.js';

function overrideStreamTTY(
  stream: NodeJS.ReadStream | NodeJS.WriteStream,
  value: boolean
): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(stream, 'isTTY');
  Object.defineProperty(stream, 'isTTY', {
    value,
    configurable: true,
    writable: true,
  });

  return () => {
    if (descriptor) {
      Object.defineProperty(stream, 'isTTY', descriptor);
    } else {
      delete (stream as typeof stream & { isTTY?: boolean }).isTTY;
    }
  };
}

function createHost(): AgentInstructionHost {
  return {
    isInstructionActive: false,
    filesModifiedThisSession: false,
    lastAssistantResponseForNotification: '',
    taskStartedAt: null,
    totalTokensUsed: 0,
    currentTurnActualUsage: { kind: 'unavailable', reason: 'not_reported' },
    currentTurnHadUnavailableUsage: false,
    lastTurnActualUsage: { kind: 'unavailable', reason: 'not_reported' },
    sessionActualTokensUsed: 0,
    sessionTokenUsageUnavailable: false,
    lastIntent: 'diagnostic',
    activeAbortController: null,
    persistentInputActiveTurn: false,
    promptSeedInput: '',
    useInkRenderer: false,
    inkRenderer: null,
    modalActive: false,
    sessionRetryCount: 0,
    sessionTokensUsed: 0,
    runtime: {
      config: { configPath: '/tmp/config.json', agent: { enableRequestQueue: true } },
      workspaceRoot: '/tmp',
      options: { prompt: 'tell me something' },
      isCommandMode: true,
    },
    intentDetector: {
      detect: vi.fn(() => ({ intent: 'diagnostic', confidence: 1, reasons: [] })),
    },
    persistentInput: {
      start: vi.fn(),
      stop: vi.fn(),
      hasQueued: vi.fn(() => false),
      getCurrentInput: vi.fn(() => ''),
      setCurrentInput: vi.fn(),
      setStatusLine: vi.fn(),
    },
    conversation: {
      addMessage: vi.fn(),
      history: vi.fn(() => []),
    },
    providerConfigManager: {
      promptModelSelection: vi.fn(),
    },
    clearExplorationLog: vi.fn(),
    displayIntentMode: vi.fn(),
    runEnvironmentBootstrap: vi.fn(async () => ({ success: true })),
    initializeUI: vi.fn(async () => {}),
    stopStatusUpdates: vi.fn(),
    stopUI: vi.fn(),
    isUsingTerminalRegionsForActiveTurn: vi.fn(() => false),
    installPersistentConsoleBridge: vi.fn(() => vi.fn()),
    formatStatusLine: vi.fn(() => ({ left: 'status' })),
    printUserInstructionToChatLog: vi.fn(),
    setupPersistentInputInterruptHandlers: vi.fn(() => vi.fn()),
    setupEscListener: vi.fn(() => vi.fn()),
    startPreparationStatus: vi.fn(() => vi.fn()),
    buildUserMessage: vi.fn(async instruction => instruction),
    setUIStatus: vi.fn(),
    saveUserMessage: vi.fn(async () => {}),
    updateContextUsage: vi.fn(),
    runReactLoop: vi.fn(async () => {}),
    runQualityPipeline: vi.fn(async () => {}),
    cleanupUI: vi.fn(),
    runInstruction: vi.fn(async () => true),
    isRetryableSessionError: vi.fn(() => false),
    submitSessionFailureBugReport: vi.fn(async () => {}),
    sleep: vi.fn(async () => {}),
    shouldUsePassiveSessionRetry: vi.fn(() => false),
    injectContinuationMessage: vi.fn(),
    getDisplayErrorMessage: vi.fn(error => String(error)),
    emitOutput: vi.fn(),
    printCompletionSummary: vi.fn(),
  };
}

describe('InstructionRunner command mode UI', () => {
  const restoreFns: Array<() => void> = [];

  afterEach(() => {
    while (restoreFns.length > 0) {
      restoreFns.pop()?.();
    }
  });

  it('does not activate the persistent queue composer for --prompt turns', async () => {
    restoreFns.push(overrideStreamTTY(process.stdout, true));
    restoreFns.push(overrideStreamTTY(process.stdin, true));
    const host = createHost();

    await new InstructionRunner(host).run('tell me something');

    expect(host.initializeUI).toHaveBeenCalledWith(expect.any(AbortController), expect.any(Function), false);
    expect(host.persistentInput.start).not.toHaveBeenCalled();
    expect(host.setupEscListener).toHaveBeenCalledWith(expect.any(AbortController), expect.any(Function), true);
  });
});
