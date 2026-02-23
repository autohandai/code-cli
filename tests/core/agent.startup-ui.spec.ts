/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
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
      setActivityLine: vi.fn(),
    };
    agent.queueInput = 'queued prompt text';
    agent.lastRenderedStatus = '';
    agent.runtime = {
      spinner,
    };
    agent.activityIndicator = {
      getVerb: () => 'Working',
      getTip: () => 'Tip',
      next: vi.fn(),
    };

    (agent as any).forceRenderSpinner();

    expect(spinner.text).toContain('Working...');
    expect(spinner.text).toContain('tokens');
    expect(spinner.text).not.toContain('typing:');
    expect(spinner.text).not.toContain('┌');
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
      setActivityLine: vi.fn(),
    };
    agent.contextPercentLeft = 74;

    (agent as any).setUIStatus('Reasoning with the AI (ReAct loop)...');

    expect(spinner.text).toContain('Reasoning with the AI');
    expect(spinner.text).toContain('context left');
    expect(spinner.text).not.toContain('\n');
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
      setActivityLine: vi.fn(),
    };
    agent.contextPercentLeft = 74;

    const stop = (agent as any).startPreparationStatus('build tests');

    expect(spinner.text).toContain('Preparing to');
    expect(spinner.text).toContain('context left');
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
      setActivityLine: vi.fn(),
    };

    const line = (agent as any).formatStatusLine();

    expect(line.left).toContain('53% context left');
    expect(line.left).not.toContain('plan:off');
    expect(line.left).toContain('/ for commands');
    expect(line.left).toContain('@ to mention files');
    expect(line.left).toContain('! for terminal');
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
      setActivityLine: vi.fn(),
    };

    try {
      const line = (agent as any).formatStatusLine();
      expect(line.left).toContain('PLAN');
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

    const body = (agent as any).getCompletionNotificationBody();

    expect(body).toBe('Task completed');
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
      setActivityLine: vi.fn(),
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
      setActivityLine: vi.fn(),
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
      setActivityLine: vi.fn(),
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
      setActivityLine: vi.fn(),
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

  it('prints submitted user instruction into chat log for non-ink mode', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    agent.useInkRenderer = false;

    try {
      (agent as any).printUserInstructionToChatLog('build the feature');

      expect(logSpy).toHaveBeenCalledTimes(1);
      const firstArg = String(logSpy.mock.calls[0]?.[0] ?? '');
      expect(firstArg).toContain('› build the feature');
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
});
