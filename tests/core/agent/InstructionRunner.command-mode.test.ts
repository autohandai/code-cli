/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { InstructionRunner, type AgentInstructionHost } from '../../../src/core/agent/InstructionRunner.js';
import { startDeepResearchRun } from '../../../src/deepResearch/session.js';
import {
  isAgentRetryableSessionError,
  shouldUsePassiveAgentSessionRetry,
} from '../../../src/core/agent/InputTurnCoordinator.js';
import { ApiError, classifyApiError } from '../../../src/providers/errors.js';

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
    runReactLoop: vi.fn(async () => ({ status: 'completed' as const })),
    runQualityPipeline: vi.fn(async () => true),
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

  it('returns before starting work when the external signal is already aborted', async () => {
    const host = createHost();
    const controller = new AbortController();
    controller.abort();

    await expect(new InstructionRunner(host).run('do not start', {
      signal: controller.signal,
    })).resolves.toBe(false);

    expect(host.initializeUI).not.toHaveBeenCalled();
    expect(host.runReactLoop).not.toHaveBeenCalled();
    expect(host.isInstructionActive).toBe(false);
  });

  it('links an in-flight external abort and removes its listener after settlement', async () => {
    const host = createHost();
    const controller = new AbortController();
    const addListener = vi.spyOn(controller.signal, 'addEventListener');
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    let instructionSignal: AbortSignal | undefined;
    host.runReactLoop = vi.fn(async (internalController) => {
      instructionSignal = internalController.signal;
      await new Promise<void>((resolve) => {
        internalController.signal.addEventListener('abort', () => resolve(), { once: true });
      });
      return { status: 'aborted' as const };
    });

    const run = new InstructionRunner(host).run('cancel this turn', {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(host.runReactLoop).toHaveBeenCalledOnce());

    controller.abort();

    await expect(run).resolves.toBe(false);
    expect(instructionSignal?.aborted).toBe(true);
    expect(addListener).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('removes the external abort listener after a normal turn', async () => {
    const host = createHost();
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');

    await expect(new InstructionRunner(host).run('finish normally', {
      signal: controller.signal,
    })).resolves.toBe(true);

    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
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

  it('schedules automatic memory reflection with a successful interactive outcome', async () => {
    const host = createHost();
    host.runtime = {
      ...host.runtime,
      options: {},
      isCommandMode: false,
    };

    await new InstructionRunner(host).run('remember what changed');

    expect(host.scheduleTurnMemoryReflection).toHaveBeenCalledWith({ status: 'succeeded' });
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
      return { status: 'completed' as const };
    });

    await new InstructionRunner(host).run('change the code');

    expect(host.runQualityPipeline).toHaveBeenCalledTimes(1);
    expect(inkRenderer.pause).not.toHaveBeenCalled();
    expect(inkRenderer.resume).not.toHaveBeenCalled();
    expect(host.cleanupUI).toHaveBeenCalledWith(true);
  });

  it('marks the turn failed when project quality checks fail', async () => {
    const host = createHost();
    host.runtime = {
      ...host.runtime,
      options: {},
      isCommandMode: false,
    };
    host.lastIntent = 'implementation';
    host.intentDetector.detect = vi.fn(() => ({ intent: 'implementation', confidence: 1, reasons: [] }));
    host.runReactLoop = vi.fn(async () => {
      host.filesModifiedThisSession = true;
      return { status: 'completed' as const };
    });
    host.runQualityPipeline = vi.fn(async () => false);

    const result = await new InstructionRunner(host).run('change the code');

    expect(result).toBe(false);
    expect(host.stopUI).toHaveBeenCalledWith(true, 'Quality checks failed');
    expect(host.printCompletionSummary).toHaveBeenCalledWith(false, false);
    expect(host.scheduleTurnMemoryReflection).toHaveBeenCalledWith({
      status: 'failed',
      category: 'quality',
      reason: 'Quality checks failed',
    });
  });

  it('schedules canceled turns without treating cancellation as failure', async () => {
    const host = createHost();
    host.runtime = {
      ...host.runtime,
      options: {},
      isCommandMode: false,
    };
    host.initializeUI = vi.fn(async (_controller, onCancel) => {
      onCancel?.();
    });
    host.runReactLoop = vi.fn(async (controller) => {
      controller.abort();
      return { status: 'aborted' as const };
    });

    await expect(new InstructionRunner(host).run('stop this work')).resolves.toBe(false);

    expect(host.scheduleTurnMemoryReflection).toHaveBeenCalledWith({
      status: 'canceled',
      reason: 'user',
    });
  });

  it('schedules loop-guard failures with their durable failure category', async () => {
    const host = createHost();
    host.runtime = {
      ...host.runtime,
      options: {},
      isCommandMode: false,
    };
    const error = new Error('Repeated tool-call limit exceeded');
    error.name = 'LoopAbortedError';
    host.runReactLoop = vi.fn(async () => {
      throw error;
    });

    await expect(new InstructionRunner(host).run('finish the task')).resolves.toBe(false);

    expect(host.scheduleTurnMemoryReflection).toHaveBeenCalledWith({
      status: 'failed',
      category: 'loop-guard',
      reason: 'Repeated tool-call limit exceeded',
    });
  });

  it('marks a deep research turn incomplete when the report contract is unmet', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-instruction-deep-research-'));
    try {
      const run = await startDeepResearchRun({
        workspaceRoot,
        topic: 'Hermes and DSPy',
        reportPath: '.autohand/research/topic-hermes-and-dspy.md',
      });
      const host = createHost();
      host.runtime = {
        ...host.runtime,
        workspaceRoot,
        options: {},
        isCommandMode: false,
      };
      host.sessionManager = {
        getCurrentSession: () => ({
          getMessages: () => [],
        }),
      };

      const result = await new InstructionRunner(host).run(
        `Research deeply.\nAUTOHAND_DEEP_RESEARCH_RUN_ID: ${run.id}`,
      );

      expect(result).toBe(false);
      expect(host.stopUI).toHaveBeenCalledWith(true, 'Deep research incomplete');
      expect(host.printCompletionSummary).toHaveBeenCalledWith(false, false);
      expect(host.scheduleTurnMemoryReflection).toHaveBeenCalledWith({
        status: 'failed',
        category: 'deep-research',
        reason: 'Deep research completion contract was not met',
      });
    } finally {
      await fs.remove(workspaceRoot);
    }
  });

  it('marks the turn summary as failed when the provider run errors after retries', async () => {
    const host = createHost();
    const recordTurnFailure = vi.fn();
    (host as AgentInstructionHost & { recordTurnFailure: (message: string) => void }).recordTurnFailure = recordTurnFailure;
    host.runReactLoop = vi.fn(async () => {
      throw new Error('Request timed out. The NVIDIA service may be experiencing high load.');
    });
    host.getDisplayErrorMessage = vi.fn(() => 'Request timed out. The NVIDIA service may be experiencing high load.');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const result = await new InstructionRunner(host).run('run a deep research job');

      expect(result).toBe(false);
      expect(host.stopUI).toHaveBeenCalledWith(true, 'Session failed');
      expect(recordTurnFailure).toHaveBeenCalledWith(
        'Request timed out. The NVIDIA service may be experiencing high load.'
      );
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
      .mockResolvedValueOnce({ status: 'completed' });
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

  it('bounds the backoff delay when a retryable outage advertises an hours-long Retry-After', async () => {
    const host = createHost();
    host.runtime = {
      ...host.runtime,
      config: {
        ...host.runtime.config,
        agent: {
          enableRequestQueue: true,
          sessionRetryLimit: 3,
          sessionRetryDelay: 1000,
        },
      },
    };
    const fourHoursFromNow = new Date(Date.now() + 4 * 60 * 60 * 1000).toUTCString();
    const headers = new Headers({ 'Retry-After': fourHoursFromNow });
    const outageError = () =>
      classifyApiError(503, 'The upstream service is unavailable', headers);

    host.isRetryableSessionError = (err: Error) => isAgentRetryableSessionError(err);
    host.shouldUsePassiveSessionRetry = (err: Error) => shouldUsePassiveAgentSessionRetry(err);
    host.runReactLoop = vi.fn(async () => {
      throw outageError();
    });
    const sleepDelays: number[] = [];
    host.sleep = vi.fn(async (ms: number) => {
      sleepDelays.push(ms);
    });
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const result = await new InstructionRunner(host).run('call the flaky provider');

      expect(result).toBe(false);
      // Initial attempt + 3 retries, all completing rather than stalling on
      // an hours-long sleep for the first retry.
      expect(host.runReactLoop).toHaveBeenCalledTimes(4);
      expect(sleepDelays).toHaveLength(3);
      for (const delay of sleepDelays) {
        expect(delay).toBeLessThanOrEqual(60_000);
      }
    } finally {
      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });

  // Regression: a daily quota cannot recover inside the turn, so retrying it just
  // printed "Attempting recovery (1/5)..." five times before failing anyway.
  it('fails immediately without session retries when the provider reports a rate limit', async () => {
    const host = createHost();
    host.runtime = {
      ...host.runtime,
      config: {
        ...host.runtime.config,
        agent: {
          enableRequestQueue: true,
          sessionRetryLimit: 5,
          sessionRetryDelay: 1000,
        },
      },
    };
    const rateLimited = () =>
      classifyApiError(
        429,
        'Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day'
      );

    host.isRetryableSessionError = (err: Error) => isAgentRetryableSessionError(err);
    host.shouldUsePassiveSessionRetry = (err: Error) => shouldUsePassiveAgentSessionRetry(err);
    host.runReactLoop = vi.fn(async () => {
      throw rateLimited();
    });

    const logged: string[] = [];
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const result = await new InstructionRunner(host).run('call the rate-limited provider');

      expect(result).toBe(false);
      expect(host.runReactLoop).toHaveBeenCalledTimes(1);
      expect(host.sleep).not.toHaveBeenCalled();
      expect(host.injectContinuationMessage).not.toHaveBeenCalled();
      expect(logged.join('\n')).not.toContain('Attempting recovery');
    } finally {
      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });

  it('notifies the host once so rate-limit and session-error hooks can fire', async () => {
    const host = createHost();
    const notifySessionFailure = vi.fn();
    host.notifySessionFailure = notifySessionFailure;
    host.isRetryableSessionError = (err: Error) => isAgentRetryableSessionError(err);
    host.shouldUsePassiveSessionRetry = (err: Error) => shouldUsePassiveAgentSessionRetry(err);
    host.runReactLoop = vi.fn(async () => {
      throw classifyApiError(429, 'Rate limit exceeded: free-models-per-day.');
    });
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await new InstructionRunner(host).run('call the rate-limited provider');

      expect(notifySessionFailure).toHaveBeenCalledTimes(1);
      const reported = notifySessionFailure.mock.calls[0]?.[0] as ApiError;
      expect(reported).toBeInstanceOf(ApiError);
      expect(reported.code).toBe('rate_limited');
    } finally {
      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });

  it('notifies the host after a retryable outage exhausts its retry budget', async () => {
    const host = createHost();
    host.runtime = {
      ...host.runtime,
      config: {
        ...host.runtime.config,
        agent: { enableRequestQueue: true, sessionRetryLimit: 2, sessionRetryDelay: 1 },
      },
    };
    const notifySessionFailure = vi.fn();
    host.notifySessionFailure = notifySessionFailure;
    host.isRetryableSessionError = (err: Error) => isAgentRetryableSessionError(err);
    host.shouldUsePassiveSessionRetry = (err: Error) => shouldUsePassiveAgentSessionRetry(err);
    host.runReactLoop = vi.fn(async () => {
      throw classifyApiError(503, 'The upstream service is unavailable');
    });
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await new InstructionRunner(host).run('call the flaky provider');

      // Retries still happen for genuine outages; the hook fires once, at the end.
      expect(host.runReactLoop).toHaveBeenCalledTimes(3);
      expect(notifySessionFailure).toHaveBeenCalledTimes(1);
    } finally {
      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });

  it('stops retry recovery when the instruction is aborted during backoff', async () => {
    const host = createHost();
    const controller = new AbortController();
    host.runtime = {
      ...host.runtime,
      config: {
        ...host.runtime.config,
        agent: {
          enableRequestQueue: true,
          sessionRetryLimit: 3,
          sessionRetryDelay: 1,
        },
      },
    };
    host.isRetryableSessionError = vi.fn(() => true);
    host.runReactLoop = vi.fn().mockRejectedValueOnce(new Error('provider timeout'));
    host.sleep = vi.fn(async () => {
      controller.abort();
    });
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      const result = await new InstructionRunner(host).run('cancel recovery', {
        signal: controller.signal,
      });

      expect(result).toBe(false);
      expect(host.runReactLoop).toHaveBeenCalledTimes(1);
      expect(host.injectContinuationMessage).not.toHaveBeenCalled();
      expect(host.stopUI).not.toHaveBeenCalledWith(true, 'Session failed');
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
