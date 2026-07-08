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
    scheduleTurnMemoryReflection: vi.fn(),
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
    expect(host.scheduleTurnMemoryReflection).not.toHaveBeenCalled();
  });

  it('schedules automatic memory reflection after a successful interactive turn', async () => {
    const host = createHost();
    host.runtime = {
      ...host.runtime,
      options: {},
      isCommandMode: false,
    };

    await new InstructionRunner(host).run('remember what changed');

    expect(host.scheduleTurnMemoryReflection).toHaveBeenCalledWith(true);
  });

  it('keeps the Ink renderer mounted while running quality checks after an implementation turn', async () => {
    const host = createHost();
    const inkRenderer = {
      pause: vi.fn(),
      resume: vi.fn(),
    };
    host.runtime = {
      ...host.runtime,
      options: {},
      isCommandMode: false,
    };
    host.useInkRenderer = true;
    host.inkRenderer = inkRenderer;
    host.lastIntent = 'implementation';
    host.intentDetector.detect = vi.fn(() => ({ intent: 'implementation', confidence: 1, reasons: [] }));
    host.runReactLoop = vi.fn(async () => {
      host.filesModifiedThisSession = true;
    });

    await new InstructionRunner(host).run('change the code');

    expect(host.runQualityPipeline).toHaveBeenCalledTimes(1);
    expect(inkRenderer.pause).not.toHaveBeenCalled();
    expect(inkRenderer.resume).not.toHaveBeenCalled();
    expect(host.cleanupUI).toHaveBeenCalledWith(true);
  });

  it('marks the turn summary as failed when the provider run errors after retries', async () => {
    const host = createHost();
    host.runReactLoop = vi.fn(async () => {
      throw new Error('Request timed out. The NVIDIA service may be experiencing high load.');
    });
    host.getDisplayErrorMessage = vi.fn(() => 'Request timed out. The NVIDIA service may be experiencing high load.');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const result = await new InstructionRunner(host).run('run a deep research job');

      expect(result).toBe(false);
      expect(host.stopUI).toHaveBeenCalledWith(true, 'Session failed');
      expect(host.printCompletionSummary).toHaveBeenCalledWith(false, false);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('continues retrying provider outages until a later retry succeeds', async () => {
    const host = createHost();
    host.runtime = {
      ...host.runtime,
      config: {
        ...host.runtime.config,
        agent: {
          enableRequestQueue: true,
          sessionRetryLimit: 3,
          sessionRetryDelay: 0,
        },
      },
    };
    host.isRetryableSessionError = vi.fn(() => true);
    host.shouldUsePassiveSessionRetry = vi.fn(() => true);
    host.runReactLoop = vi
      .fn()
      .mockRejectedValueOnce(new Error('provider timeout'))
      .mockRejectedValueOnce(new Error('provider timeout'))
      .mockResolvedValueOnce(undefined);
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      const result = await new InstructionRunner(host).run('continue the research job');

      expect(result).toBe(true);
      expect(host.runReactLoop).toHaveBeenCalledTimes(3);
      expect(host.submitSessionFailureBugReport).toHaveBeenCalledTimes(2);
      expect(host.submitSessionFailureBugReport).toHaveBeenNthCalledWith(
        1,
        expect.any(Error),
        1,
        3,
        { autoReport: false },
      );
      expect(host.submitSessionFailureBugReport).toHaveBeenNthCalledWith(
        2,
        expect.any(Error),
        2,
        3,
        { autoReport: false },
      );
      expect(host.sleep).toHaveBeenCalledTimes(2);
      expect(host.injectContinuationMessage).not.toHaveBeenCalled();
      expect(host.sessionRetryCount).toBe(0);
      expect(host.stopUI).not.toHaveBeenCalledWith(true, 'Session failed');
      expect(host.printCompletionSummary).toHaveBeenCalledWith(false, true);
    } finally {
      consoleLogSpy.mockRestore();
    }
  });

  it('submits final unrecovered provider failures only after retries are exhausted', async () => {
    const host = createHost();
    host.runtime = {
      ...host.runtime,
      config: {
        ...host.runtime.config,
        agent: {
          enableRequestQueue: true,
          sessionRetryLimit: 1,
          sessionRetryDelay: 0,
        },
      },
    };
    host.isRetryableSessionError = vi.fn(() => true);
    host.shouldUsePassiveSessionRetry = vi.fn(() => true);
    host.runReactLoop = vi
      .fn()
      .mockRejectedValueOnce(new Error('Request timed out. The NVIDIA service may be experiencing high load.'))
      .mockRejectedValueOnce(new Error('Request timed out. The NVIDIA service may be experiencing high load.'));
    host.getDisplayErrorMessage = vi.fn(() => 'Request timed out. The NVIDIA service may be experiencing high load.');
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const result = await new InstructionRunner(host).run('continue the research job');

      expect(result).toBe(false);
      expect(host.runReactLoop).toHaveBeenCalledTimes(2);
      expect(host.submitSessionFailureBugReport).toHaveBeenCalledTimes(2);
      expect(host.submitSessionFailureBugReport).toHaveBeenNthCalledWith(
        1,
        expect.any(Error),
        1,
        1,
        { autoReport: false },
      );
      expect(host.submitSessionFailureBugReport).toHaveBeenNthCalledWith(
        2,
        expect.any(Error),
        1,
        1,
        { autoReport: true },
      );
    } finally {
      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });

  it('submits final unrecovered product errors for auto-reporting', async () => {
    const host = createHost();
    const error = new TypeError('Cannot read properties of undefined');
    host.runReactLoop = vi.fn(async () => {
      throw error;
    });
    host.getDisplayErrorMessage = vi.fn(() => error.message);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const result = await new InstructionRunner(host).run('run a command');

      expect(result).toBe(false);
      expect(host.submitSessionFailureBugReport).toHaveBeenCalledTimes(1);
      expect(host.submitSessionFailureBugReport).toHaveBeenCalledWith(
        error,
        0,
        3,
        { autoReport: true },
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
