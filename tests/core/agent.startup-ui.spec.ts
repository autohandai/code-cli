/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import readline from 'node:readline';
import { AutohandAgent } from '../../src/core/agent.js';
import { getPlanModeManager } from '../../src/commands/plan.js';

describe('agent startup and active input UI', () => {
  it('ensureInitComplete does not block on unresolved mcpReady', async () => {
    const agent = Object.create(AutohandAgent.prototype) as any;

    agent.initReady = Promise.resolve();
    agent.mcpReady = new Promise<void>(() => {});
    agent.flushMcpStartupSummaryIfPending = vi.fn();
    agent.sessionManager = {
      getCurrentSession: () => ({ metadata: { sessionId: 'session-1' } }),
    };
    agent.hookManager = {
      executeHooks: vi.fn().mockResolvedValue(undefined),
    };

    await Promise.race([
      (agent as any).ensureInitComplete(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('ensureInitComplete timed out')), 150)),
    ]);

    expect(agent.initReady).toBeNull();
    expect(agent.flushMcpStartupSummaryIfPending).toHaveBeenCalledTimes(1);
    expect(agent.hookManager.executeHooks).toHaveBeenCalledWith('session-start', {
      sessionId: 'session-1',
      sessionType: 'startup',
    });
  });

  it('forceRenderSpinner renders a single-line status to avoid log box artifacts', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const spinner = { text: '' };

    agent.taskStartedAt = Date.now() - 1000;
    agent.sessionTokensUsed = 0;
    agent.totalTokensUsed = 12345;
    agent.inkRenderer = null;
    agent.persistentInput = {
      getQueueLength: () => 0,
      setStatusLine: vi.fn(),
    };
    agent.queueInput = 'queued prompt text';
    agent.lastRenderedStatus = '';
    agent.runtime = {
      spinner,
    };

    (agent as any).forceRenderSpinner();

    expect(spinner.text).toContain('Working...');
    expect(spinner.text).toContain('tokens');
    expect(spinner.text).toContain('plan:off');
    expect(spinner.text).not.toContain('typing:');
    expect(spinner.text).not.toContain('┌');
    expect(spinner.text).not.toContain('\n');
  });

  it('flushMcpStartupSummaryIfPending prints once and clears pending flag', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    agent.mcpStartupSummaryPending = true;
    agent.printMcpStartupSummaryIfNeeded = vi.fn();

    (agent as any).flushMcpStartupSummaryIfPending();
    (agent as any).flushMcpStartupSummaryIfPending();

    expect(agent.mcpStartupSummaryPending).toBe(false);
    expect(agent.printMcpStartupSummaryIfNeeded).toHaveBeenCalledTimes(1);
  });

  it('setUIStatus keeps spinner output on one line', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const spinner = { text: '' };

    agent.runtime = { spinner };
    agent.inkRenderer = null;
    agent.queueInput = '';
    agent.persistentInput = {
      getQueueLength: () => 0,
      setStatusLine: vi.fn(),
    };
    agent.contextPercentLeft = 74;

    (agent as any).setUIStatus('Reasoning with the AI (ReAct loop)...');

    expect(spinner.text).toContain('Reasoning with the AI');
    expect(spinner.text).toContain('context left');
    expect(spinner.text).not.toContain('\n');
  });

  it('setUIStatus routes active-turn status to activity row when terminal regions are enabled', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const spinner = {
      text: 'initial',
      isSpinning: true,
      stop: vi.fn(),
      start: vi.fn(),
    };
    const setStatusLine = vi.fn();
    const setActivityLine = vi.fn();
    const originalTerminalRegions = process.env.AUTOHAND_TERMINAL_REGIONS;
    process.env.AUTOHAND_TERMINAL_REGIONS = '1';

    agent.runtime = { spinner };
    agent.inkRenderer = null;
    agent.queueInput = '';
    agent.useInkRenderer = false;
    agent.persistentInputActiveTurn = true;
    agent.persistentInput = {
      getQueueLength: () => 0,
      setStatusLine,
      setActivityLine,
    };
    agent.contextPercentLeft = 74;

    try {
      (agent as any).setUIStatus('Composing... (esc to interrupt · 0m 02s · 28.7k tokens)');

      expect(setStatusLine).toHaveBeenCalled();
      expect(setActivityLine).toHaveBeenCalledTimes(1);
      expect(String(setActivityLine.mock.calls[0]?.[0] ?? '')).toContain('Composing...');
      expect(spinner.stop).toHaveBeenCalledTimes(1);
      expect(spinner.text).toBe('initial');
    } finally {
      if (originalTerminalRegions === undefined) {
        delete process.env.AUTOHAND_TERMINAL_REGIONS;
      } else {
        process.env.AUTOHAND_TERMINAL_REGIONS = originalTerminalRegions;
      }
    }
  });

  it('ensureSpinnerRunning does not restart ora while terminal regions are active', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const spinner = {
      isSpinning: false,
      start: vi.fn(),
      stop: vi.fn(),
    };
    const originalTerminalRegions = process.env.AUTOHAND_TERMINAL_REGIONS;
    process.env.AUTOHAND_TERMINAL_REGIONS = '1';

    agent.runtime = { spinner };
    agent.useInkRenderer = false;
    agent.persistentInputActiveTurn = true;

    try {
      (agent as any).ensureSpinnerRunning();
      expect(spinner.start).not.toHaveBeenCalled();
      expect(spinner.stop).not.toHaveBeenCalled();
    } finally {
      if (originalTerminalRegions === undefined) {
        delete process.env.AUTOHAND_TERMINAL_REGIONS;
      } else {
        process.env.AUTOHAND_TERMINAL_REGIONS = originalTerminalRegions;
      }
    }
  });

  it('startPreparationStatus renders single-line status during preparation', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const spinner = { text: '' };

    agent.runtime = { spinner };
    agent.inkRenderer = null;
    agent.queueInput = '';
    agent.persistentInput = {
      getQueueLength: () => 0,
      setStatusLine: vi.fn(),
    };
    agent.contextPercentLeft = 74;

    const stop = (agent as any).startPreparationStatus('build tests');

    expect(spinner.text).toContain('Preparing to');
    expect(spinner.text).toContain('plan:off');
    expect(spinner.text).not.toContain('\n');

    stop();
  });

  it('buildSpinnerStatusText clamps to one line to avoid terminal wraps', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const out = process.stdout as NodeJS.WriteStream & { columns?: number };
    const originalColumns = out.columns;
    out.columns = 44;

    try {
      agent.queueInput = 'queued prompt text that is intentionally long';
      const text = (agent as any).buildSpinnerStatusText(
        'Working... (esc to interrupt · 00m 02s · 999999 tokens [12 queued]) and this keeps going',
        '\u001b[46mPLAN\u001b[49m 100% context left · / for commands · @ to mention files · ! for terminal'
      );

      const plain = text.replace(/\u001b\[[0-9;]*m/g, '');
      // Reserves 2 columns for ora spinner prefix.
      expect(plain.length).toBeLessThanOrEqual(41);
      expect(plain).not.toContain('\n');
    } finally {
      out.columns = originalColumns;
    }
  });

  it('registers and removes resize handler around status updates', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const spinner = {
      isSpinning: true,
      stop: vi.fn(),
      start: vi.fn(),
    };
    const stdoutDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    const onSpy = vi.spyOn(process.stdout, 'on');
    const offSpy = vi.spyOn(process.stdout, 'off');
    const forceRender = vi.fn();

    agent.runtime = { spinner };
    agent.activityIndicator = { next: vi.fn() };
    agent.lastRenderedStatus = 'cached';
    agent.statusInterval = null;
    agent.forceRenderSpinner = forceRender;
    agent.persistentInputActiveTurn = false;
    agent.resizeHandler = null;

    try {
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      (agent as any).startStatusUpdates();
      expect(onSpy).toHaveBeenCalled();
      const resizeCall = onSpy.mock.calls.find((call) => call[0] === 'resize');
      expect(resizeCall).toBeDefined();
      const handler = resizeCall?.[1] as (() => void);
      expect(typeof handler).toBe('function');

      handler();
      expect(spinner.stop).toHaveBeenCalled();
      expect(spinner.start).toHaveBeenCalled();
      expect(forceRender).toHaveBeenCalled();

      (agent as any).stopStatusUpdates();
      expect(offSpy).toHaveBeenCalledWith('resize', handler);
      expect(agent.resizeHandler).toBeNull();
    } finally {
      if (stdoutDescriptor) {
        Object.defineProperty(process.stdout, 'isTTY', stdoutDescriptor);
      }
      onSpy.mockRestore();
      offSpy.mockRestore();
      (agent as any).stopStatusUpdates();
    }
  });

  it('formatStatusLine includes command hints and context value', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const planModeManager = getPlanModeManager();
    planModeManager.disable();
    agent.contextPercentLeft = 53;
    agent.sessionTokensUsed = 21000;
    agent.totalTokensUsed = 900;
    agent.inkRenderer = null;
    agent.persistentInput = {
      getQueueLength: () => 0,
      setStatusLine: vi.fn(),
    };

    const line = (agent as any).formatStatusLine();

    expect(line.left).toContain('53% context left');
    expect(line.left).toContain('plan:off');
    expect(line.left).toContain('tokens used');
    expect(line.left).toContain('? shortcuts');
  });

  it('formatStatusLine shows plan:on when plan mode is enabled', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const planModeManager = getPlanModeManager();
    planModeManager.enable();
    agent.contextPercentLeft = 99;
    agent.sessionTokensUsed = 0;
    agent.totalTokensUsed = 0;
    agent.inkRenderer = null;
    agent.persistentInput = {
      getQueueLength: () => 0,
      setStatusLine: vi.fn(),
    };

    try {
      const line = (agent as any).formatStatusLine();
      expect(line.left).toContain('plan:on');
      expect(line.left).toContain('99% context left');
    } finally {
      planModeManager.disable();
    }
  });

  it('completion notification body uses latest assistant response preview', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    agent.lastAssistantResponseForNotification = '  Added worktree support and fixed composer rendering.  ';

    const body = (agent as any).getCompletionNotificationBody();

    expect(body).toBe('Added worktree support and fixed composer rendering.');
  });

  it('completion notification body falls back when response is empty', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    agent.lastAssistantResponseForNotification = '   ';
    agent.conversation = {
      history: vi.fn(() => []),
    };

    const body = (agent as any).getCompletionNotificationBody();

    expect(body).toBe('Task completed');
  });

  it('completion notification body falls back to latest assistant message when cached preview is empty', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    agent.lastAssistantResponseForNotification = '   ';
    agent.conversation = {
      history: vi.fn(() => [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: '{"finalResponse":"Great progress on the UI composer."}' },
      ]),
    };

    const body = (agent as any).getCompletionNotificationBody();

    expect(body).toBe('Great progress on the UI composer.');
  });

  it('forceRenderSpinner does not show live typing preview while working', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const spinner = { text: '' };
    const originalTerminalRegions = process.env.AUTOHAND_TERMINAL_REGIONS;
    process.env.AUTOHAND_TERMINAL_REGIONS = '0';
    try {
      agent.taskStartedAt = Date.now() - 1000;
      agent.sessionTokensUsed = 0;
      agent.totalTokensUsed = 0;
      agent.inkRenderer = null;
      agent.persistentInputActiveTurn = true;
      agent.persistentInput = {
        getQueueLength: () => 0,
        getCurrentInput: () => 'next message while working',
        setStatusLine: vi.fn(),
        setActivityLine: vi.fn(),
      };
      agent.queueInput = '';
      agent.lastRenderedStatus = '';
      agent.runtime = { spinner };
      agent.activityIndicator = {
        getVerb: () => 'Working',
        getTip: () => 'Tip',
        next: vi.fn(),
      };

      (agent as any).forceRenderSpinner();

      expect(spinner.text).toContain('Working...');
      expect(spinner.text).not.toContain('typing:');
      expect(spinner.text).not.toContain('next message');
    } finally {
      if (originalTerminalRegions === undefined) {
        delete process.env.AUTOHAND_TERMINAL_REGIONS;
      } else {
        process.env.AUTOHAND_TERMINAL_REGIONS = originalTerminalRegions;
      }
    }
  });

  it('setupEscListener resumes stdin so queue input can be captured while working', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const originalStdin = process.stdin;
    const mockInput = new EventEmitter() as NodeJS.ReadStream;
    (mockInput as any).isTTY = true;
    (mockInput as any).isRaw = false;
    (mockInput as any).setRawMode = vi.fn((mode: boolean) => {
      (mockInput as any).isRaw = mode;
      return mockInput;
    });
    (mockInput as any).resume = vi.fn(() => mockInput);

    agent.runtime = {
      config: {
        agent: {
          enableRequestQueue: true,
        },
      },
    };
    agent.updateInputLine = vi.fn();
    agent.persistentInput = {
      queue: [],
      getQueueLength: () => 0,
      setStatusLine: vi.fn(),
    };
    agent.queueInput = '';

    Object.defineProperty(process, 'stdin', {
      configurable: true,
      value: mockInput,
    });

    try {
      const cleanup = (agent as any).setupEscListener(new AbortController(), vi.fn());
      expect((mockInput as any).resume).toHaveBeenCalled();
      cleanup();
    } finally {
      Object.defineProperty(process, 'stdin', {
        configurable: true,
        value: originalStdin,
      });
    }
  });

  it('setupEscListener queues cooked input chunks that include newline submit', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const originalStdin = process.stdin;
    const mockInput = new EventEmitter() as NodeJS.ReadStream;
    const queue: Array<{ text: string; timestamp: number }> = [];
    (mockInput as any).isTTY = true;
    (mockInput as any).isRaw = false;
    (mockInput as any).setRawMode = vi.fn((mode: boolean) => {
      (mockInput as any).isRaw = mode;
      return mockInput;
    });
    (mockInput as any).resume = vi.fn(() => mockInput);
    (mockInput as any).setEncoding = vi.fn();

    agent.runtime = {
      config: {
        agent: {
          enableRequestQueue: true,
        },
      },
    };
    agent.updateInputLine = vi.fn();
    agent.persistentInput = {
      queue,
      getQueueLength: () => queue.length,
      setStatusLine: vi.fn(),
    };
    agent.queueInput = '';

    Object.defineProperty(process, 'stdin', {
      configurable: true,
      value: mockInput,
    });

    try {
      const cleanup = (agent as any).setupEscListener(new AbortController(), vi.fn());
      mockInput.emit('keypress', 'queued while working\n');
      expect(queue).toHaveLength(1);
      expect(queue[0]?.text).toBe('queued while working');
      cleanup();
    } finally {
      Object.defineProperty(process, 'stdin', {
        configurable: true,
        value: originalStdin,
      });
    }
  });

  it('setupEscListener queues line submissions from stdin data fallback', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const originalStdin = process.stdin;
    const mockInput = new EventEmitter() as NodeJS.ReadStream;
    const queue: Array<{ text: string; timestamp: number }> = [];
    (mockInput as any).isTTY = true;
    (mockInput as any).isRaw = false;
    (mockInput as any).setRawMode = vi.fn((mode: boolean) => {
      (mockInput as any).isRaw = mode;
      return mockInput;
    });
    (mockInput as any).resume = vi.fn(() => mockInput);
    (mockInput as any).setEncoding = vi.fn();

    agent.runtime = {
      config: {
        agent: {
          enableRequestQueue: true,
        },
      },
    };
    agent.updateInputLine = vi.fn();
    agent.persistentInput = {
      queue,
      getQueueLength: () => queue.length,
      setStatusLine: vi.fn(),
    };
    agent.queueInput = '';

    Object.defineProperty(process, 'stdin', {
      configurable: true,
      value: mockInput,
    });

    try {
      const cleanup = (agent as any).setupEscListener(new AbortController(), vi.fn());
      mockInput.emit('data', 'queued from cooked data mode\n');
      expect(queue).toHaveLength(1);
      expect(queue[0]?.text).toBe('queued from cooked data mode');
      cleanup();
    } finally {
      Object.defineProperty(process, 'stdin', {
        configurable: true,
        value: originalStdin,
      });
    }
  });

  it('setupEscListener uses line-based queue fallback when raw mode is unavailable', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const originalStdin = process.stdin;
    const mockInput = new EventEmitter() as NodeJS.ReadStream;
    const queue: Array<{ text: string; timestamp: number }> = [];
    (mockInput as any).isTTY = true;
    (mockInput as any).isRaw = false;
    // Simulate runtimes where setRawMode exists but does not transition into raw mode.
    (mockInput as any).setRawMode = vi.fn(() => mockInput);
    (mockInput as any).resume = vi.fn(() => mockInput);
    (mockInput as any).pause = vi.fn(() => mockInput);
    (mockInput as any).setEncoding = vi.fn();

    agent.runtime = {
      config: {
        agent: {
          enableRequestQueue: true,
        },
      },
    };
    agent.updateInputLine = vi.fn();
    agent.persistentInput = {
      queue,
      getQueueLength: () => queue.length,
      setStatusLine: vi.fn(),
    };
    agent.queueInput = '';

    Object.defineProperty(process, 'stdin', {
      configurable: true,
      value: mockInput,
    });

    try {
      const cleanup = (agent as any).setupEscListener(new AbortController(), vi.fn());
      mockInput.emit('data', 'queued from line fallback\n');
      expect(queue).toHaveLength(1);
      expect(queue[0]?.text).toBe('queued from line fallback');
      cleanup();
    } finally {
      Object.defineProperty(process, 'stdin', {
        configurable: true,
        value: originalStdin,
      });
    }
  });

  it('persistent input interrupt handlers cancel on escape', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const input = new EventEmitter();
    const controller = new AbortController();
    const onCancel = vi.fn();

    agent.persistentInput = input;

    const cleanup = (agent as any).setupPersistentInputInterruptHandlers(controller, onCancel);
    input.emit('escape');

    expect(controller.signal.aborted).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('persistent input interrupt handlers require double ctrl+c to cancel', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const input = new EventEmitter();
    const controller = new AbortController();
    const onCancel = vi.fn();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    agent.persistentInput = input;

    try {
      const cleanup = (agent as any).setupPersistentInputInterruptHandlers(controller, onCancel);
      input.emit('ctrl-c');
      expect(controller.signal.aborted).toBe(false);
      expect(onCancel).not.toHaveBeenCalled();

      input.emit('ctrl-c');
      expect(controller.signal.aborted).toBe(true);
      expect(onCancel).toHaveBeenCalledTimes(1);
      cleanup();
    } finally {
      logSpy.mockRestore();
    }
  });

  it('console bridge routes logs above composer while persistent input is active', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const originalTerminalRegions = process.env.AUTOHAND_TERMINAL_REGIONS;
    const originalLog = console.log;
    const originalInfo = console.info;
    const originalWarn = console.warn;
    const originalError = console.error;
    const writeAbove = vi.fn();

    process.env.AUTOHAND_TERMINAL_REGIONS = '1';
    agent.persistentInputActiveTurn = true;
    agent.persistentInput = { writeAbove };
    agent.persistentConsoleBridgeCleanup = null;

    try {
      const cleanup = (agent as any).installPersistentConsoleBridge();
      console.log('queued', 'line');
      console.info('info line');
      console.warn('warn line');
      console.error('error line');

      expect(writeAbove).toHaveBeenCalledWith('queued line\n');
      expect(writeAbove).toHaveBeenCalledWith('info line\n');
      expect(writeAbove).toHaveBeenCalledWith('warn line\n');
      expect(writeAbove).toHaveBeenCalledWith('error line\n');

      cleanup();
      expect(console.log).toBe(originalLog);
      expect(console.info).toBe(originalInfo);
      expect(console.warn).toBe(originalWarn);
      expect(console.error).toBe(originalError);
    } finally {
      console.log = originalLog;
      console.info = originalInfo;
      console.warn = originalWarn;
      console.error = originalError;
      if (originalTerminalRegions === undefined) {
        delete process.env.AUTOHAND_TERMINAL_REGIONS;
      } else {
        process.env.AUTOHAND_TERMINAL_REGIONS = originalTerminalRegions;
      }
    }
  });
  it('installs console bridge after persistent input activation in runInstruction', async () => {
    const agent = Object.create(AutohandAgent.prototype) as any;

    const stdoutDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');

    const stateAtBridgeInstall: boolean[] = [];
    const cleanupBridge = vi.fn();
    const cleanupEsc = vi.fn();
    const stopPreparation = vi.fn();

    agent.runtime = {
      config: { agent: { enableRequestQueue: true } },
      workspaceRoot: process.cwd(),
    };
    agent.intentDetector = {
      detect: vi.fn(() => ({ intent: 'diagnostic' })),
    };
    agent.displayIntentMode = vi.fn();
    agent.initializeUI = vi.fn(async () => {});
    agent.inkRenderer = null;
    agent.persistentInput = {
      start: vi.fn(),
      stop: vi.fn(),
      hasQueued: vi.fn(() => false),
      getQueueLength: vi.fn(() => 0),
      getCurrentInput: vi.fn(() => ''),
      setCurrentInput: vi.fn(),
      setStatusLine: vi.fn(),
    };
    agent.formatStatusLine = vi.fn(() => ({ left: '100% context left', right: '' }));
    agent.installPersistentConsoleBridge = vi.fn(() => {
      stateAtBridgeInstall.push(agent.persistentInputActiveTurn);
      return cleanupBridge;
    });
    agent.setupPersistentInputInterruptHandlers = vi.fn(() => cleanupEsc);
    agent.startPreparationStatus = vi.fn(() => stopPreparation);
    agent.buildUserMessage = vi.fn(async (instruction: string) => instruction);
    agent.setUIStatus = vi.fn();
    agent.conversation = {
      addMessage: vi.fn(),
      history: vi.fn(() => []),
    };
    agent.saveUserMessage = vi.fn(async () => {});
    agent.updateContextUsage = vi.fn();
    agent.runReactLoop = vi.fn(async () => {});
    agent.stopStatusUpdates = vi.fn();
    agent.cleanupUI = vi.fn();
    agent.clearExplorationLog = vi.fn();
    agent.pendingInkInstructions = [];
    agent.taskStartedAt = null;
    agent.totalTokensUsed = 0;
    agent.sessionTokensUsed = 0;
    agent.filesModifiedThisSession = false;
    agent.useInkRenderer = false;
    agent.persistentInputActiveTurn = false;
    agent.promptSeedInput = '';

    try {
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

      await (agent as any).runInstruction('hello');

      expect(agent.persistentInput.start).toHaveBeenCalledTimes(1);
      expect(agent.installPersistentConsoleBridge).toHaveBeenCalledTimes(1);
      expect(stateAtBridgeInstall).toEqual([true]);
      expect(cleanupBridge).toHaveBeenCalledTimes(1);
      expect(cleanupEsc).toHaveBeenCalledTimes(1);
      expect(stopPreparation).toHaveBeenCalled();
    } finally {
      if (stdoutDescriptor) {
        Object.defineProperty(process.stdout, 'isTTY', stdoutDescriptor);
      }
      if (stdinDescriptor) {
        Object.defineProperty(process.stdin, 'isTTY', stdinDescriptor);
      }
    }
  });

  it('routes queued-processing message above composer when terminal regions are active', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const writeAbove = vi.fn();
    const originalEnv = process.env.AUTOHAND_TERMINAL_REGIONS;
    const originalLog = console.log;
    const logSpy = vi.fn();

    agent.persistentInputActiveTurn = true;
    agent.useInkRenderer = false;
    agent.persistentInput = { writeAbove };

    try {
      process.env.AUTOHAND_TERMINAL_REGIONS = '1';
      console.log = logSpy as unknown as typeof console.log;

      (agent as any).logQueuedProcessingMessage('tell me if I have future', 1);

      expect(writeAbove).toHaveBeenCalledTimes(2);
      expect(writeAbove.mock.calls[0]?.[0]).toContain('Processing queued request');
      expect(writeAbove.mock.calls[1]?.[0]).toContain('1 more request(s) queued');
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      if (originalEnv === undefined) {
        delete process.env.AUTOHAND_TERMINAL_REGIONS;
      } else {
        process.env.AUTOHAND_TERMINAL_REGIONS = originalEnv;
      }
      console.log = originalLog;
    }
  });
  it('ensureStdinReady does not reset raw mode while persistent input owns stdin', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const originalStdin = process.stdin;
    const mockInput = new EventEmitter() as NodeJS.ReadStream;
    const setRawMode = vi.fn();
    const resume = vi.fn();
    const emitSpy = vi.spyOn(readline, 'emitKeypressEvents').mockImplementation(() => {});

    (mockInput as any).isTTY = true;
    (mockInput as any).isRaw = true;
    (mockInput as any).setRawMode = setRawMode;
    (mockInput as any).isPaused = () => true;
    (mockInput as any).resume = resume;

    agent.persistentInputActiveTurn = true;

    Object.defineProperty(process, 'stdin', {
      configurable: true,
      value: mockInput,
    });

    try {
      (agent as any).ensureStdinReady();
      expect(setRawMode).not.toHaveBeenCalled();
      expect(resume).not.toHaveBeenCalled();
      expect(emitSpy).not.toHaveBeenCalled();
    } finally {
      emitSpy.mockRestore();
      Object.defineProperty(process, 'stdin', {
        configurable: true,
        value: originalStdin,
      });
    }
  });

  it('ensureStdinReady restores cooked mode when persistent input is inactive', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const originalStdin = process.stdin;
    const mockInput = new EventEmitter() as NodeJS.ReadStream;
    const setRawMode = vi.fn((mode: boolean) => {
      (mockInput as any).isRaw = mode;
      return mockInput;
    });
    const resume = vi.fn();
    const emitSpy = vi.spyOn(readline, 'emitKeypressEvents').mockImplementation(() => {});

    (mockInput as any).isTTY = true;
    (mockInput as any).isRaw = true;
    (mockInput as any).setRawMode = setRawMode;
    (mockInput as any).isPaused = () => true;
    (mockInput as any).resume = resume;

    agent.persistentInputActiveTurn = false;

    Object.defineProperty(process, 'stdin', {
      configurable: true,
      value: mockInput,
    });

    try {
      (agent as any).ensureStdinReady();
      expect(setRawMode).toHaveBeenCalledWith(false);
      expect(resume).toHaveBeenCalled();
      expect(emitSpy).toHaveBeenCalledWith(mockInput);
    } finally {
      emitSpy.mockRestore();
      Object.defineProperty(process, 'stdin', {
        configurable: true,
        value: originalStdin,
      });
    }
  });
  it('prints submitted user instruction into chat log for non-ink mode', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    agent.useInkRenderer = false;
    agent.persistentInputActiveTurn = false;

    try {
      (agent as any).printUserInstructionToChatLog('build the feature');

      expect(logSpy).toHaveBeenCalledTimes(1);
      const firstArg = String(logSpy.mock.calls[0]?.[0] ?? '');
      expect(firstArg).toContain('› build the feature');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('routes submitted user instruction above composer when terminal regions are active', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const writeAbove = vi.fn();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const originalEnv = process.env.AUTOHAND_TERMINAL_REGIONS;

    agent.useInkRenderer = false;
    agent.persistentInputActiveTurn = true;
    agent.persistentInput = { writeAbove };

    try {
      process.env.AUTOHAND_TERMINAL_REGIONS = '1';
      (agent as any).printUserInstructionToChatLog('queued message');
      expect(writeAbove).toHaveBeenCalledTimes(1);
      expect(String(writeAbove.mock.calls[0]?.[0] ?? '')).toContain('› queued message');
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      if (originalEnv === undefined) {
        delete process.env.AUTOHAND_TERMINAL_REGIONS;
      } else {
        process.env.AUTOHAND_TERMINAL_REGIONS = originalEnv;
      }
      logSpy.mockRestore();
    }
  });

  it('classifies joke prompts as simple chat', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    expect((agent as any).isSimpleChat('tell me a joke')).toBe(true);
    expect((agent as any).isSimpleChat('say something funny')).toBe(true);
    expect((agent as any).isSimpleChat('hello there')).toBe(true);
  });

  it('does not classify time-sensitive requests as simple chat', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    expect((agent as any).isSimpleChat("what's the weather today in lisbon")).toBe(false);
    expect((agent as any).isSimpleChat('latest ai news')).toBe(false);
  });

  it('does not classify coding requests as simple chat', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    expect((agent as any).isSimpleChat('fix the failing test in parser.ts')).toBe(false);
    expect((agent as any).isSimpleChat('search for TODO comments')).toBe(false);
  });

  it('routes casual prompts through runInstruction in interactive loop', async () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    agent.pendingInkInstructions = [];
    agent.inkRenderer = null;
    agent.useInkRenderer = false;
    agent.persistentInputActiveTurn = false;
    agent.promptSeedInput = '';
    agent.persistentInput = {
      hasQueued: vi.fn(() => false),
      dequeue: vi.fn(),
      getQueueLength: vi.fn(() => 0),
      getCurrentInput: vi.fn(() => ''),
      stop: vi.fn(),
    };
    agent.promptForInstruction = vi
      .fn()
      .mockResolvedValueOnce('cool work on the ui')
      .mockResolvedValueOnce('/exit');
    agent.ensureInitComplete = vi.fn(async () => {});
    agent.flushMcpStartupSummaryIfPending = vi.fn();
    agent.printUserInstructionToChatLog = vi.fn();
    agent.runInstruction = vi.fn(async () => true);
    agent.handleSimpleChat = vi.fn(async () => true);
    agent.ensureStdinReady = vi.fn();
    agent.runtime = {
      config: {
        ui: {
          terminalBell: false,
          showCompletionNotification: false,
        },
        agent: {},
      },
      options: {},
      workspaceRoot: process.cwd(),
    };
    agent.telemetryManager = {
      trackCommand: vi.fn(async () => {}),
      recordInteraction: vi.fn(),
    };
    agent.feedbackManager = {
      shouldPrompt: vi.fn(() => null),
      recordInteraction: vi.fn(),
    };
    agent.hookManager = {
      executeHooks: vi.fn(async () => {}),
    };
    agent.sessionManager = {
      getCurrentSession: vi.fn(() => ({ metadata: { sessionId: 'session-1' } })),
    };
    agent.closeSession = vi.fn(async () => {});
    agent.notificationService = {
      notify: vi.fn(async () => {}),
    };

    try {
      await (agent as any).runInteractiveLoop();
      expect(agent.runInstruction).toHaveBeenCalledWith('cool work on the ui');
      expect(agent.handleSimpleChat).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it('does not print user instruction log in ink renderer mode', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    agent.useInkRenderer = true;

    try {
      (agent as any).printUserInstructionToChatLog('do not echo');
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it('buildToolLoopCallSignature is stable for key and call ordering', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const first = (agent as any).buildToolLoopCallSignature([
      { id: '1', tool: 'git_log', args: { max_count: 1, oneline: true } },
      { id: '2', tool: 'search', args: { query: 'TODO', path: 'src' } },
    ]);
    const second = (agent as any).buildToolLoopCallSignature([
      { id: '2', tool: 'search', args: { path: 'src', query: 'TODO' } },
      { id: '1', tool: 'git_log', args: { oneline: true, max_count: 1 } },
    ]);
    expect(first).toBe(second);
  });

  it('runReactLoop breaks repeated identical tool loops and emits fallback response', async () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const spinner = {
      isSpinning: true,
      text: '',
      start: vi.fn(function (this: any) {
        this.isSpinning = true;
        return this;
      }),
      stop: vi.fn(function (this: any) {
        this.isSpinning = false;
        return this;
      }),
    };
    const addSystemNote = vi.fn();
    const emitSpy = vi.fn();
    const executeTools = vi.fn(async () => [{
      tool: 'git_log',
      success: false,
      error: 'Tool failed: blocked',
    }]);
    const llmComplete = vi.fn(async () => ({
      id: 'id-1',
      created: Date.now(),
      content: '',
      raw: {},
    }));

    agent.runtime = {
      spinner,
      config: {
        agent: { maxIterations: 20, debug: false },
        ui: { showThinking: false },
      },
      options: { model: 'test-model' },
      workspaceRoot: process.cwd(),
    };
    agent.conversation = {
      history: vi.fn(() => []),
      addMessage: vi.fn(),
      addSystemNote,
    };
    agent.llm = { complete: llmComplete };
    agent.toolManager = {
      toFunctionDefinitions: vi.fn(() => []),
      execute: executeTools,
    };
    agent.contextCompactionEnabled = false;
    agent.updateContextUsage = vi.fn();
    agent.getMessagesWithImages = vi.fn(() => []);
    agent.parseAssistantResponse = vi.fn(() => ({
      thought: 'Retrying',
      toolCalls: [{ id: 'call-1', tool: 'git_log', args: { max_count: 1, oneline: true } }],
    }));
    agent.saveAssistantMessage = vi.fn(async () => {});
    agent.saveToolMessage = vi.fn(async () => {});
    agent.startStatusUpdates = vi.fn();
    agent.stopStatusUpdates = vi.fn();
    agent.forceRenderSpinner = vi.fn();
    agent.sessionManager = {
      getCurrentSession: vi.fn(() => ({ metadata: { sessionId: 'session-1' } })),
    };
    agent.projectManager = {
      recordSuccess: vi.fn(async () => {}),
      recordFailure: vi.fn(async () => {}),
    };
    agent.activityIndicator = { getVerb: vi.fn(() => 'Working'), getTip: vi.fn(() => 'Tip'), next: vi.fn() };
    agent.contextPercentLeft = 100;
    agent.queueInput = '';
    agent.totalTokensUsed = 0;
    agent.sessionTokensUsed = 0;
    agent.searchQueries = [];
    agent.executedActionNames = [];
    agent.persistentInputActiveTurn = false;
    agent.inkRenderer = null;
    agent.outputListener = emitSpy;

    try {
      await (agent as any).runReactLoop(new AbortController());
      expect(executeTools).toHaveBeenCalledTimes(3);
      expect(llmComplete).toHaveBeenCalledTimes(5);
      expect(addSystemNote).toHaveBeenCalledWith(expect.stringContaining('Critical Loop Guard'));
      expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({
        type: 'message',
        content: expect.stringContaining('repeated tool calls'),
      }));
    } finally {
      logSpy.mockRestore();
    }
  });
});
