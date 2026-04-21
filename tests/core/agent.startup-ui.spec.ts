/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import readline from 'node:readline';
import { AutohandAgent } from '../../src/core/agent.js';
import { getPlanModeManager } from '../../src/commands/plan.js';
import { ApiError } from '../../src/providers/errors.js';

async function waitForAssertion(assertion: () => void, attempts = 20): Promise<void> {
  let lastError: unknown;

  for (let index = 0; index < attempts; index++) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

describe('agent startup and active input UI', () => {
  it('syncInteractiveAutomodePermissions enables unrestricted approvals when interactive auto-mode is on', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;

    agent.runtime = {
      options: {
        yes: false,
        unrestricted: false,
        restricted: false,
      },
    };
    agent.permissionManager = {
      setMode: vi.fn(),
    };
    agent.basePermissionMode = 'interactive';
    agent.interactiveAutomodeEnabled = true;

    (agent as any).syncInteractiveAutomodePermissions();

    expect(agent.runtime.options.yes).toBe(true);
    expect(agent.runtime.options.unrestricted).toBe(true);
    expect(agent.runtime.options.restricted).toBe(false);
    expect(agent.permissionManager.setMode).toHaveBeenCalledWith('unrestricted');
  });

  it('syncInteractiveAutomodePermissions restores the baseline mode when interactive auto-mode is turned off', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;

    agent.runtime = {
      options: {
        yes: true,
        unrestricted: false,
        restricted: false,
      },
    };
    agent.permissionManager = {
      setMode: vi.fn(),
    };
    agent.basePermissionMode = 'interactive';
    agent.interactiveAutomodeEnabled = false;

    (agent as any).syncInteractiveAutomodePermissions();

    expect(agent.runtime.options.yes).toBe(false);
    expect(agent.runtime.options.unrestricted).toBe(false);
    expect(agent.runtime.options.restricted).toBe(false);
    expect(agent.permissionManager.setMode).toHaveBeenCalledWith('interactive');
  });

  it('syncInteractiveAutomodePermissions respects --unrestricted CLI flag', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;

    agent.runtime = {
      options: {
        yes: false,
        unrestricted: true,
        restricted: false,
      },
    };
    agent.permissionManager = {
      setMode: vi.fn(),
    };
    agent.basePermissionMode = 'interactive';
    agent.interactiveAutomodeEnabled = false;

    (agent as any).syncInteractiveAutomodePermissions();

    expect(agent.runtime.options.yes).toBe(true);
    expect(agent.runtime.options.unrestricted).toBe(true);
    expect(agent.runtime.options.restricted).toBe(false);
    expect(agent.permissionManager.setMode).toHaveBeenCalledWith('unrestricted');
  });

  it('syncInteractiveAutomodePermissions respects --restricted CLI flag', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;

    agent.runtime = {
      options: {
        yes: true,
        unrestricted: true,
        restricted: true,
      },
    };
    agent.permissionManager = {
      setMode: vi.fn(),
    };
    agent.basePermissionMode = 'unrestricted';
    agent.interactiveAutomodeEnabled = false;

    (agent as any).syncInteractiveAutomodePermissions();

    expect(agent.runtime.options.yes).toBe(false);
    expect(agent.runtime.options.unrestricted).toBe(false);
    expect(agent.runtime.options.restricted).toBe(true);
    expect(agent.permissionManager.setMode).toHaveBeenCalledWith('restricted');
  });

  it('resolveWorkspacePath allows absolute paths inside additional directories', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'autohand-agent-workspace-'));
    const additionalDir = mkdtempSync(join(tmpdir(), 'autohand-agent-extra-'));
    const targetPath = join(additionalDir, 'src', 'feature.ts');

    try {
      agent.runtime = {
        workspaceRoot,
        additionalDirs: [additionalDir],
      };
      agent.files = {
        getAllowedDirectories: () => [workspaceRoot, additionalDir],
      };

      expect((agent as any).resolveWorkspacePath(targetPath)).toBe(targetPath);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
      rmSync(additionalDir, { recursive: true, force: true });
    }
  });

  it('resolveWorkspacePath explains how to grant access when a directory is out of scope', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'autohand-agent-workspace-'));
    const outsideDir = mkdtempSync(join(tmpdir(), 'autohand-agent-outside-'));
    const targetPath = join(outsideDir, 'secret.txt');

    try {
      agent.runtime = {
        workspaceRoot,
        additionalDirs: [],
      };
      agent.files = {
        getAllowedDirectories: () => [workspaceRoot],
      };

      expect(() => (agent as any).resolveWorkspacePath(targetPath)).toThrow(
        /\/add-dir <path>|--add-dir <path>/
      );
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('confirmDangerousAction auto-approves run_command when yes mode is enabled', async () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const confirmationCallback = vi.fn().mockResolvedValue(false);

    agent.runtime = {
      options: {
        yes: true,
      },
      config: {},
    };
    agent.confirmationCallback = confirmationCallback;

    const approved = await (agent as any).confirmDangerousAction('Run command?', {
      tool: 'run_command',
      command: 'bun test'
    });

    expect(approved).toEqual({ decision: 'allow_once' });
    expect(confirmationCallback).not.toHaveBeenCalled();
  });

  it('confirmDangerousAction auto-approves run_command when yolo allows it', async () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const confirmationCallback = vi.fn().mockResolvedValue(false);

    agent.runtime = {
      options: {
        yes: false,
        yolo: 'allow:run_command',
      },
      config: {},
    };
    agent.confirmationCallback = confirmationCallback;

    const approved = await (agent as any).confirmDangerousAction('Run command?', {
      tool: 'run_command',
      command: 'bun test'
    });

    expect(approved).toEqual({ decision: 'allow_once' });
    expect(confirmationCallback).not.toHaveBeenCalled();
  });

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

  it('reportInteractiveLoopError emits the error and exits the active menu surface', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const stop = vi.fn();
    const getCurrentInput = vi.fn(() => '/model');
    const outputListener = vi.fn();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    agent.outputListener = outputListener;
    agent.persistentInputActiveTurn = true;
    agent.promptSeedInput = '';
    agent.persistentInput = {
      getCurrentInput,
      stop,
    };

    try {
      (agent as any).reportInteractiveLoopError('Device authorization is unknown. Please try again.');

      expect(outputListener).toHaveBeenCalledWith({
        type: 'error',
        content: 'Device authorization is unknown. Please try again.',
      });
      expect(stop).toHaveBeenCalledTimes(1);
      expect(agent.persistentInputActiveTurn).toBe(false);
      expect(agent.promptSeedInput).toBe('/model');
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
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
      setActivityLine: vi.fn(),
    };
    agent.contextPercentLeft = 74;

    const stop = (agent as any).startPreparationStatus('build tests');

    expect(spinner.text).toContain('Preparing to');
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
        '\u001b[46mPLAN\u001b[49m 100% context left · ? shortcuts · / commands · @ mention files · ! terminal'
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
      setActivityLine: vi.fn(),
    };

    const line = (agent as any).formatStatusLine();

    expect(line.left).toContain('53% context left');
    expect(line.left).not.toContain('plan:off');
    expect(line.left).toContain('? shortcuts');
    expect(line.left).toContain('/ commands');
    expect(line.left).toContain('@ mention files');
    expect(line.left).toContain('! terminal');
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

  it('writeDebugLine pauses the composer and writes debug output to stderr scrollback while active', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const originalTerminalRegions = process.env.AUTOHAND_TERMINAL_REGIONS;
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const pause = vi.fn();
    const resume = vi.fn();

    process.env.AUTOHAND_TERMINAL_REGIONS = '1';
    agent.persistentInputActiveTurn = true;
    agent.persistentInput = { pause, resume };

    try {
      (agent as any).writeDebugLine('[SUGGESTION] debug line');
      expect(pause).toHaveBeenCalledTimes(1);
      expect(stderrSpy).toHaveBeenCalledWith('[SUGGESTION] debug line\n');
      expect(resume).toHaveBeenCalledTimes(1);
    } finally {
      stderrSpy.mockRestore();
      if (originalTerminalRegions === undefined) {
        delete process.env.AUTOHAND_TERMINAL_REGIONS;
      } else {
        process.env.AUTOHAND_TERMINAL_REGIONS = originalTerminalRegions;
      }
    }
  });

  it('writeDebugLine falls back to stderr when composer is inactive', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    agent.persistentInputActiveTurn = false;
    agent.readlinePromptActive = false;
    agent.deferredDebugLines = [];
    agent.persistentInput = { writeAbove: vi.fn() };

    try {
      (agent as any).writeDebugLine('[AGENT DEBUG] line');
      expect(stderrSpy).toHaveBeenCalledWith('[AGENT DEBUG] line\n');
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('writeDebugLine defers output while readline prompt is active', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    agent.persistentInputActiveTurn = false;
    agent.readlinePromptActive = true;
    agent.deferredDebugLines = [];
    agent.persistentInput = { pause: vi.fn(), resume: vi.fn() };

    try {
      (agent as any).writeDebugLine('[SUGGESTION] Generated "test" in 500ms');
      // Should NOT write to stderr immediately
      expect(stderrSpy).not.toHaveBeenCalled();
      // Should buffer the line instead
      expect(agent.deferredDebugLines).toEqual(['[SUGGESTION] Generated "test" in 500ms\n']);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('flushDeferredDebugLines writes buffered debug lines to stderr', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    agent.deferredDebugLines = [
      '[SUGGESTION] line one\n',
      '[SUGGESTION] line two\n',
    ];

    try {
      (agent as any).flushDeferredDebugLines();
      expect(stderrSpy).toHaveBeenCalledTimes(2);
      expect(stderrSpy).toHaveBeenNthCalledWith(1, '[SUGGESTION] line one\n');
      expect(stderrSpy).toHaveBeenNthCalledWith(2, '[SUGGESTION] line two\n');
      expect(agent.deferredDebugLines).toEqual([]);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('writeDebugLine writes immediately when readline prompt is not active and composer is off', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    agent.persistentInputActiveTurn = false;
    agent.readlinePromptActive = false;
    agent.deferredDebugLines = [];
    agent.persistentInput = { pause: vi.fn(), resume: vi.fn() };

    try {
      (agent as any).writeDebugLine('[AGENT DEBUG] immediate');
      expect(stderrSpy).toHaveBeenCalledWith('[AGENT DEBUG] immediate\n');
      expect(agent.deferredDebugLines).toEqual([]);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('does not start persistent input for interactive slash commands', () => {
    // Regression: interactive commands like /permissions, /hooks, /chrome
    // must NOT activate the persistent input because it renders a status line
    // that conflicts with the command's own interactive UI.
    const interactiveCommands = (AutohandAgent as any).INTERACTIVE_SLASH_COMMANDS as Set<string>;

    expect(interactiveCommands).toBeInstanceOf(Set);
    expect(interactiveCommands.has('/permissions')).toBe(true);
    expect(interactiveCommands.has('/hooks')).toBe(true);
    expect(interactiveCommands.has('/chrome')).toBe(true);
    expect(interactiveCommands.has('/theme')).toBe(true);
    expect(interactiveCommands.has('/model')).toBe(true);
    expect(interactiveCommands.has('/resume')).toBe(true);
    expect(interactiveCommands.has('/feedback')).toBe(true);

    // Non-interactive commands should NOT be in the set
    expect(interactiveCommands.has('/diff')).toBe(false);
    expect(interactiveCommands.has('/status')).toBe(false);
    expect(interactiveCommands.has('/help')).toBe(false);
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
    agent.printUserInstructionToChatLog = vi.fn();

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
      // User instruction must be printed AFTER persistent input starts
      // so it renders inside the scroll region (not overwritten by fixed region)
      expect(agent.printUserInstructionToChatLog).toHaveBeenCalledWith('hello');
      const startOrder = agent.persistentInput.start.mock.invocationCallOrder[0];
      const printOrder = agent.printUserInstructionToChatLog.mock.invocationCallOrder[0];
      expect(printOrder).toBeGreaterThan(startOrder);
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

  it('retries transport outages without injecting continuation prompts back into the model', async () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const stdoutDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    const cleanupBridge = vi.fn();
    const cleanupEsc = vi.fn();
    const stopPreparation = vi.fn();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    agent.runtime = {
      config: {
        agent: {
          enableRequestQueue: true,
          sessionRetryLimit: 3,
          sessionRetryDelay: 0,
        },
      },
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
    agent.installPersistentConsoleBridge = vi.fn(() => cleanupBridge);
    agent.setupPersistentInputInterruptHandlers = vi.fn(() => cleanupEsc);
    agent.startPreparationStatus = vi.fn(() => stopPreparation);
    agent.buildUserMessage = vi.fn(async (instruction: string) => instruction);
    agent.setUIStatus = vi.fn();
    agent.conversation = {
      addMessage: vi.fn(),
      history: vi.fn(() => []),
      addSystemNote: vi.fn(),
    };
    agent.saveUserMessage = vi.fn(async () => {});
    agent.updateContextUsage = vi.fn();
    agent.runReactLoop = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError(
          'Unable to connect to the AI service. Please check your internet connection.',
          'network_error',
          0,
          true,
        ),
      )
      .mockResolvedValueOnce(undefined);
    agent.submitSessionFailureBugReport = vi.fn(async () => {});
    agent.sleep = vi.fn(async () => {});
    agent.injectContinuationMessage = vi.fn();
    agent.stopStatusUpdates = vi.fn();
    agent.cleanupUI = vi.fn();
    agent.clearExplorationLog = vi.fn();
    agent.printCompletionSummary = vi.fn();
    agent.pendingInkInstructions = [];
    agent.taskStartedAt = null;
    agent.totalTokensUsed = 0;
    agent.sessionTokensUsed = 0;
    agent.filesModifiedThisSession = false;
    agent.useInkRenderer = false;
    agent.persistentInputActiveTurn = false;
    agent.promptSeedInput = '';
    agent.printUserInstructionToChatLog = vi.fn();
    agent.sessionRetryCount = 0;

    try {
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

      const result = await (agent as any).runInstruction('hello');

      expect(result).toBe(true);
      expect(agent.runReactLoop).toHaveBeenCalledTimes(2);
      expect(agent.submitSessionFailureBugReport).toHaveBeenCalledTimes(1);
      expect(agent.sleep).toHaveBeenCalledWith(0);
      expect(agent.injectContinuationMessage).not.toHaveBeenCalled();
      expect(agent.setUIStatus).toHaveBeenCalledWith('Recovering session...');
      expect(agent.sessionRetryCount).toBe(0);
    } finally {
      logSpy.mockRestore();
      if (stdoutDescriptor) {
        Object.defineProperty(process.stdout, 'isTTY', stdoutDescriptor);
      }
      if (stdinDescriptor) {
        Object.defineProperty(process.stdin, 'isTTY', stdinDescriptor);
      }
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

  it('handleInkSubmittedInstruction executes shell commands immediately instead of queueing them', async () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    agent.inkRenderer = {
      addQueuedInstruction: vi.fn(),
    };
    agent.executeImmediateShellCommandForInk = vi.fn(async () => {});

    await (agent as any).handleInkSubmittedInstruction('!bun run proof');

    expect(agent.executeImmediateShellCommandForInk).toHaveBeenCalledWith('bun run proof');
    expect(agent.inkRenderer.addQueuedInstruction).not.toHaveBeenCalled();
  });

  it('handleInkSubmittedInstruction still queues normal text', async () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    agent.inkRenderer = {
      addQueuedInstruction: vi.fn(),
    };
    agent.executeImmediateShellCommandForInk = vi.fn(async () => {});

    await (agent as any).handleInkSubmittedInstruction('regular task');

    expect(agent.inkRenderer.addQueuedInstruction).toHaveBeenCalledWith('regular task');
    expect(agent.executeImmediateShellCommandForInk).not.toHaveBeenCalled();
  });

  it('prefers PTY only when rendering shell output through the Ink live command block', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;

    agent.inkRenderer = null;
    expect((agent as any).shouldPreferPtyForImmediateShellCommands()).toBe(false);

    agent.inkRenderer = {
      startLiveCommand: vi.fn(),
      appendLiveCommandOutput: vi.fn(),
      finishLiveCommand: vi.fn(),
    };
    expect((agent as any).shouldPreferPtyForImmediateShellCommands()).toBe(true);
  });

  it('routes immediate shell commands to the composer executor when Ink is disabled', async () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    agent.inkRenderer = null;
    agent.executeImmediateShellCommandForComposer = vi.fn(async () => {});
    agent.executeImmediateShellCommandForInk = vi.fn(async () => {});

    await (agent as any).executeImmediateShellCommand('git status', {
      persistentInputActiveTurn: true,
      terminalRegionsDisabled: false,
      writeAbove: vi.fn(),
    });

    expect(agent.executeImmediateShellCommandForComposer).toHaveBeenCalledWith('git status', expect.any(Object));
    expect(agent.executeImmediateShellCommandForInk).not.toHaveBeenCalled();
  });

  it('routes immediate shell commands to the Ink live block when Ink is enabled', async () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    agent.inkRenderer = {
      startLiveCommand: vi.fn(),
      appendLiveCommandOutput: vi.fn(),
      finishLiveCommand: vi.fn(),
    };
    agent.executeImmediateShellCommandForComposer = vi.fn(async () => {});
    agent.executeImmediateShellCommandForInk = vi.fn(async () => {});

    await (agent as any).executeImmediateShellCommand('git status');

    expect(agent.executeImmediateShellCommandForInk).toHaveBeenCalledWith('git status');
    expect(agent.executeImmediateShellCommandForComposer).not.toHaveBeenCalled();
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

  it('buildSystemPrompt teaches the right tool-choice rubric for discovery and shell usage', async () => {
    const agent = Object.create(AutohandAgent.prototype) as any;

    agent.runtime = {
      options: {},
      workspaceRoot: process.cwd(),
      config: {},
    };
    agent.toolManager = {
      listDefinitions: vi.fn(() => [{
        name: 'find',
        description: 'Find code, symbols, and matching context in the workspace',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Text or pattern to find' },
          },
          required: ['query']
        }
      }]),
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

    const prompt = await (agent as any).buildSystemPrompt();

    expect(prompt).toContain('Use `glob` first when you need file path discovery by filename, extension, or directory pattern.');
    expect(prompt).toContain('Use `find` as the default code discovery tool.');
    expect(prompt).toContain('Use `find` for content, symbol, import, regex, and semantic lookup inside files.');
    expect(prompt).toContain('Use `read_file` after `find` identifies the exact file or region you need.');
    expect(prompt).toContain('Prefer `glob`, `find`, `read_file`, `git_status`, and `git_diff` over `run_command` whenever they can accomplish the task.');
    expect(prompt).toContain('The legacy tools `search`, `search_with_context`, and `semantic_search` are compatibility aliases');
    expect(prompt).toContain('Glob: `glob(pattern="**/*.test.ts")`');
    expect(prompt).toContain('Exact: `find(query="parallelToolConcurrency|maxConcurrency", mode="exact")`');
    expect(prompt).toContain('Context: `find(query="buildSystemPrompt", context=8, mode="context")`');
    expect(prompt).toContain('Semantic: `find(query="code discovery and tool selection", mode="semantic")`');
    expect(prompt).toContain('Prefer dedicated tools over `run_command` whenever a dedicated tool exists.');
    expect(prompt).toContain('If the user mentions a directory or path outside the current workspace scope, proactively call `request_directory_access` to request access');
    expect(prompt).toContain('Do not use `run_command` as a workaround for directory access');
    expect(prompt).toContain('{"tool": "run_command", "args": {"command": "npm test"}}');
    expect(prompt).toContain('{"tool": "run_command", "args": {"command": "bun run build"}}');
    expect(prompt).toContain('{"tool": "run_command", "args": {"command": "git status"}}');
    expect(prompt).toContain('If independent tool calls do not depend on each other, batch them in the same response.');
    expect(prompt).toContain('If the user needs to run an interactive shell command themselves, tell them to use `! <command>`');
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

  it('promptForInstruction does not block on startup suggestion', async () => {
    const agent = Object.create(AutohandAgent.prototype) as any;

    // Simulate a slow startup suggestion that takes 10 seconds
    agent.pendingSuggestion = new Promise<void>((resolve) => {
      setTimeout(resolve, 10_000);
    });
    agent.isStartupSuggestion = true;
    agent.suggestionEngine = {
      getSuggestion: () => null,
      clear: vi.fn(),
    };
    agent.formatStatusLine = vi.fn(() => ({ left: '', right: '' }));
    agent.promptSeedInput = '';
    agent.workspaceFileCollector = {
      getCachedFiles: () => [],
      collectWorkspaceFiles: vi.fn(async () => {}),
    };

    // Startup suggestion should NOT block the prompt at all.
    // The prompt must appear instantly (within one tick).
    void (agent as any).promptForInstruction([], []).catch(() => {});

    // After a single tick, pendingSuggestion should already be cleared
    // because startup skips the await entirely.
    await new Promise((r) => setTimeout(r, 50));
    expect(agent.pendingSuggestion).toBeNull();
    expect(agent.isStartupSuggestion).toBe(false);
  });

  it('promptForInstruction clears pendingSuggestion immediately (lazy provider pattern)', async () => {
    const agent = Object.create(AutohandAgent.prototype) as any;

    // Simulate a slow turn suggestion (10s) — with lazy provider,
    // the prompt doesn't block waiting for it.
    agent.pendingSuggestion = new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 10_000);
    });
    agent.isStartupSuggestion = false; // turn, not startup
    agent.suggestionEngine = {
      getSuggestion: () => null,
      clear: vi.fn(),
    };
    agent.formatStatusLine = vi.fn(() => ({ left: '', right: '' }));
    agent.promptSeedInput = '';
    agent.workspaceFileCollector = {
      getCachedFiles: () => [],
      collectWorkspaceFiles: vi.fn(async () => {}),
    };

    // Start promptForInstruction — it captures pendingSuggestion and clears it immediately
    void (agent as any).promptForInstruction([], []).catch(() => {});

    // pendingSuggestion should be nulled right away (no 3s wait)
    await new Promise((r) => setImmediate(r));
    expect(agent.pendingSuggestion).toBeNull();

    // The suggestion engine should NOT be eagerly cleared — the lazy provider
    // reads getSuggestion() on each render cycle, so clear() is not called here.
    expect(agent.suggestionEngine.clear).not.toHaveBeenCalled();
  });

  it('routes completion summary through writeAbove when persistent input is kept for next turn', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const writeAboveCalls: string[] = [];

    agent.taskStartedAt = Date.now() - 2000;
    agent.sessionTokensUsed = 0;
    agent.totalTokensUsed = 5000;
    agent.useInkRenderer = false;
    agent.inkRenderer = null;
    agent.pendingInkInstructions = [];
    agent.persistentInputActiveTurn = true;
    agent.persistentInput = {
      hasQueued: () => true,
      getCurrentInput: () => '',
      getQueueLength: () => 1,
      writeAbove: (text: string) => writeAboveCalls.push(text),
      stop: vi.fn(),
    };

    // Spy on console.log to verify it is NOT used
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Call the completion summary logic directly:
    // When persistentInputActiveTurn is true and hasQueued() returns true,
    // keepPersistentInputForNextTurn is true, so regions stay active.
    // The completion message must go through writeAbove, not console.log.
    const keepPersistentInputForNextTurn =
      agent.persistentInputActiveTurn &&
      (agent.persistentInput.hasQueued() || agent.persistentInput.getCurrentInput().trim().length > 0);

    expect(keepPersistentInputForNextTurn).toBe(true);

    // Simulate the completion summary output path
    (agent as any).printCompletionSummary(keepPersistentInputForNextTurn);

    // Should have used writeAbove, not console.log
    expect(writeAboveCalls.length).toBe(1);
    expect(writeAboveCalls[0]).toContain('Completed in');
    expect(writeAboveCalls[0]).toContain('used');

    // console.log should NOT have been called with the completion message
    const completionCalls = consoleLogSpy.mock.calls.filter(
      (args) => typeof args[0] === 'string' && args[0].includes('Completed in')
    );
    expect(completionCalls).toHaveLength(0);

    consoleLogSpy.mockRestore();
  });

  it('uses console.log for completion summary when persistent input is stopped', () => {
    const agent = Object.create(AutohandAgent.prototype) as any;

    agent.taskStartedAt = Date.now() - 2000;
    agent.sessionTokensUsed = 0;
    agent.totalTokensUsed = 5000;
    agent.useInkRenderer = false;
    agent.inkRenderer = null;
    agent.pendingInkInstructions = [];
    agent.persistentInput = {
      getQueueLength: () => 0,
      writeAbove: vi.fn(),
    };

    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // keepPersistentInputForNextTurn is false — regions are torn down
    (agent as any).printCompletionSummary(false);

    // Should have used console.log
    const completionCalls = consoleLogSpy.mock.calls.filter(
      (args) => typeof args[0] === 'string' && args[0].includes('Completed in')
    );
    expect(completionCalls).toHaveLength(1);

    // writeAbove should NOT have been called
    expect(agent.persistentInput.writeAbove).not.toHaveBeenCalled();

    consoleLogSpy.mockRestore();
  });

  it('pauses persistent input before showing feedback modal and resumes after', async () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const callOrder: string[] = [];

    agent.persistentInputActiveTurn = true;
    agent.persistentInput = {
      pause: () => callOrder.push('pause'),
      resume: () => callOrder.push('resume'),
      hasQueued: () => true,
      getCurrentInput: () => '',
      getQueueLength: () => 1,
    };
    agent.runtime = { spinner: undefined };
    agent.inkRenderer = null;

    // Mock feedbackManager that tracks call order
    agent.feedbackManager = {
      shouldPrompt: () => 'periodic',
      promptForFeedback: async () => {
        callOrder.push('promptForFeedback');
        return true;
      },
      recordInteraction: vi.fn(),
    };

    // Call the method that wraps feedback with pause/resume
    await (agent as any).showFeedbackWithPause(
      'periodic',
      'session-1'
    );

    // Verify: pause → feedback → resume
    expect(callOrder).toEqual(['pause', 'promptForFeedback', 'resume']);
  });

  it('resumes persistent input even if feedback modal throws', async () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const callOrder: string[] = [];

    agent.persistentInputActiveTurn = true;
    agent.persistentInput = {
      pause: () => callOrder.push('pause'),
      resume: () => callOrder.push('resume'),
      hasQueued: () => true,
      getCurrentInput: () => '',
    };
    agent.runtime = { spinner: undefined };
    agent.inkRenderer = null;

    agent.feedbackManager = {
      promptForFeedback: async () => {
        callOrder.push('promptForFeedback');
        throw new Error('Modal crashed');
      },
    };

    // Should not throw — error is swallowed
    await (agent as any).showFeedbackWithPause('periodic', 'session-1');

    // Resume must still happen
    expect(callOrder).toEqual(['pause', 'promptForFeedback', 'resume']);
  });

  it('skips pause/resume when persistent input is not active', async () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const callOrder: string[] = [];

    agent.persistentInputActiveTurn = false;
    agent.persistentInput = {
      pause: () => callOrder.push('pause'),
      resume: () => callOrder.push('resume'),
    };
    agent.runtime = { spinner: undefined };
    agent.inkRenderer = null;

    agent.feedbackManager = {
      promptForFeedback: async () => {
        callOrder.push('promptForFeedback');
        return true;
      },
    };

    await (agent as any).showFeedbackWithPause('periodic', 'session-1');

    // No pause/resume — persistent input wasn't active
    expect(callOrder).toEqual(['promptForFeedback']);
  });

  it('closeSession awaits async cleanup before telemetry shutdown', async () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    let resolveDisconnect!: () => void;
    let resolveHooks!: () => void;
    let resolveSync!: () => void;
    let resolveEnd!: () => void;

    const disconnectAll = vi.fn(
      () => new Promise<void>((resolve) => { resolveDisconnect = resolve; })
    );
    const executeHooks = vi.fn(
      () => new Promise<void>((resolve) => { resolveHooks = resolve; })
    );
    const syncSession = vi.fn(
      () => new Promise<void>((resolve) => { resolveSync = resolve; })
    );
    const endSession = vi.fn(
      () => new Promise<void>((resolve) => { resolveEnd = resolve; })
    );
    const shutdown = vi.fn(async () => {});

    agent.sessionStartedAt = Date.now() - 1000;
    agent.runtime = { workspaceRoot: process.cwd() };
    agent.persistentInput = { dispose: vi.fn() };
    agent.mcpManager = { disconnectAll };
    agent.hookManager = { executeHooks };
    agent.telemetryManager = { syncSession, endSession, shutdown };
    agent.sessionManager = {
      getCurrentSession: vi.fn(() => ({
        metadata: { sessionId: 'session-123' },
        getMessages: () => [
          { role: 'user', content: 'hello', timestamp: new Date().toISOString() },
        ],
      })),
      closeSession: vi.fn(async () => {}),
    };

    const closePromise = (agent as any).closeSession();
    await waitForAssertion(() => {
      expect(disconnectAll).toHaveBeenCalledTimes(1);
      expect(executeHooks).toHaveBeenCalledTimes(1);
      expect(syncSession).toHaveBeenCalledTimes(1);
      expect(endSession).toHaveBeenCalledTimes(1);
    });
    expect(shutdown).not.toHaveBeenCalled();

    resolveDisconnect();
    resolveHooks();
    resolveSync();
    resolveEnd();
    await closePromise;

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(syncSession.mock.invocationCallOrder[0]).toBeLessThan(shutdown.mock.invocationCallOrder[0]);
    expect(endSession.mock.invocationCallOrder[0]).toBeLessThan(shutdown.mock.invocationCallOrder[0]);
    logSpy.mockRestore();
  });
});
