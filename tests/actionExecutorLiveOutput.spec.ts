/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileActionManager } from '../src/actions/filesystem.js';
import * as commandActions from '../src/actions/command.js';
import { ActionExecutor } from '../src/core/actionExecutor.js';
import * as shellActions from '../src/ui/shellCommand.js';
import { BackgroundProcessRegistry } from '../src/core/agent/BackgroundProcessRegistry.js';
import type { AgentAction, AgentRuntime } from '../src/types.js';

interface BackgroundExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
}

interface BackgroundLifecycleCallbacks {
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  onBackgroundExit?: (result: BackgroundExit) => void;
}

function createRuntime(ui: AgentRuntime['config']['ui'] = {}): AgentRuntime {
  return {
    config: {
      configPath: '',
      openrouter: { apiKey: 'test', model: 'model' },
      ui,
    },
    workspaceRoot: process.cwd(),
    options: {},
  } as AgentRuntime;
}

function createFiles(): FileActionManager {
  return {
    root: process.cwd(),
  } as FileActionManager;
}

function createExecutor(options: {
  ui?: AgentRuntime['config']['ui'];
  onLiveCommandStart?: (command: string) => string;
  onLiveCommandOutput?: (id: string, stream: 'stdout' | 'stderr', chunk: string) => void;
  onLiveCommandFinish?: (id: string, success: boolean, error?: string) => void;
  onLiveCommandRemove?: (id: string) => void;
  backgroundProcessRegistry?: BackgroundProcessRegistry;
}): ActionExecutor {
  return new ActionExecutor({
    runtime: createRuntime(options.ui),
    files: createFiles(),
    resolveWorkspacePath: (relativePath) => `${process.cwd()}/${relativePath}`,
    confirmDangerousAction: vi.fn(async () => true),
    onLiveCommandStart: options.onLiveCommandStart,
    onLiveCommandOutput: options.onLiveCommandOutput,
    onLiveCommandFinish: options.onLiveCommandFinish,
    onLiveCommandRemove: options.onLiveCommandRemove,
    backgroundProcessRegistry: options.backgroundProcessRegistry,
  });
}

describe('ActionExecutor live tool output display', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('streams run_command output through the live command display by default', async () => {
    const onLiveCommandStart = vi.fn(() => 'live-1');
    const onLiveCommandOutput = vi.fn();
    const onLiveCommandRemove = vi.fn();
    const executor = createExecutor({
      onLiveCommandStart,
      onLiveCommandOutput,
      onLiveCommandRemove,
    });

    const action = {
      type: 'run_command',
      command: 'printf',
      args: ['live-output'],
    } satisfies AgentAction;
    const result = await executor.execute(action);

    expect(result).toContain('live-output');
    expect(onLiveCommandStart).toHaveBeenCalledWith('printf live-output');
    expect(onLiveCommandOutput).toHaveBeenCalledWith('live-1', 'stdout', 'live-output');
    expect(onLiveCommandRemove).toHaveBeenCalledWith('live-1');
  });

  it('does not stream run_command output when silent tool output is enabled', async () => {
    const onLiveCommandStart = vi.fn(() => 'live-1');
    const onLiveCommandOutput = vi.fn();
    const executor = createExecutor({
      ui: { silentToolOutput: true },
      onLiveCommandStart,
      onLiveCommandOutput,
    });

    const action = {
      type: 'run_command',
      command: 'printf',
      args: ['hidden-output'],
    } satisfies AgentAction;
    const result = await executor.execute(action);

    expect(result).toContain('hidden-output');
    expect(onLiveCommandStart).not.toHaveBeenCalled();
    expect(onLiveCommandOutput).not.toHaveBeenCalled();
  });

  it('keeps a background run_command live after returning its PID and finishes it on exit', async () => {
    let callbacks: BackgroundLifecycleCallbacks | undefined;
    vi.spyOn(commandActions, 'runCommand').mockImplementation(
      async (_command, _args, _cwd, options = {}) => {
        callbacks = options as BackgroundLifecycleCallbacks;
        return {
          stdout: '',
          stderr: '',
          code: null,
          signal: null,
          backgroundPid: 4101,
        };
      },
    );
    const onLiveCommandStart = vi.fn(() => 'live-background-run');
    const onLiveCommandOutput = vi.fn();
    const onLiveCommandFinish = vi.fn();
    const onLiveCommandRemove = vi.fn();
    const executor = createExecutor({
      onLiveCommandStart,
      onLiveCommandOutput,
      onLiveCommandFinish,
      onLiveCommandRemove,
    });

    const result = await executor.executeForTool(
      {
        type: 'run_command',
        command: 'node server.js',
        background: true,
      },
      { approvalHandled: true },
    );

    expect(result).toMatchObject({
      success: true,
      output: expect.stringContaining('Background PID: 4101'),
    });
    expect(onLiveCommandStart).toHaveBeenCalledWith('node server.js');
    expect(onLiveCommandRemove).not.toHaveBeenCalled();
    expect(onLiveCommandFinish).not.toHaveBeenCalled();

    callbacks?.onStdout?.('server ready\n');
    callbacks?.onStderr?.('server warning\n');
    expect(onLiveCommandOutput).toHaveBeenNthCalledWith(
      1,
      'live-background-run',
      'stdout',
      'server ready\n',
    );
    expect(onLiveCommandOutput).toHaveBeenNthCalledWith(
      2,
      'live-background-run',
      'stderr',
      'server warning\n',
    );

    callbacks?.onBackgroundExit?.({ code: 0, signal: null });
    callbacks?.onBackgroundExit?.({ code: 0, signal: null });
    expect(onLiveCommandFinish).toHaveBeenCalledOnce();
    expect(onLiveCommandFinish).toHaveBeenCalledWith('live-background-run', true, undefined);
  });

  it('continues to classify a foreground null exit code as a command failure', async () => {
    vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
      stdout: '',
      stderr: '',
      code: null,
      signal: null,
    });
    const executor = createExecutor({
      onLiveCommandStart: vi.fn(() => 'live-foreground-null'),
      onLiveCommandOutput: vi.fn(),
      onLiveCommandFinish: vi.fn(),
      onLiveCommandRemove: vi.fn(),
    });

    const result = await executor.executeForTool(
      { type: 'run_command', command: 'foreground-without-exit-code' },
      { approvalHandled: true },
    );

    expect(result).toMatchObject({
      success: false,
      kind: 'command',
      error: 'Command exited with code unknown.',
    });
  });

  it('keeps a background shell live after returning its PID and finishes it on exit', async () => {
    let callbacks: BackgroundLifecycleCallbacks | undefined;
    vi.spyOn(shellActions, 'executeStreamingShellCommand').mockImplementation(
      async (_command, _cwd, options = {}) => {
        callbacks = options as BackgroundLifecycleCallbacks;
        return {
          success: true,
          output: '',
          backgroundPid: 4102,
        };
      },
    );
    const onLiveCommandStart = vi.fn(() => 'live-background-shell');
    const onLiveCommandOutput = vi.fn();
    const onLiveCommandFinish = vi.fn();
    const onLiveCommandRemove = vi.fn();
    const executor = createExecutor({
      onLiveCommandStart,
      onLiveCommandOutput,
      onLiveCommandFinish,
      onLiveCommandRemove,
    });

    const result = await executor.execute({
      type: 'shell',
      command: 'bun dev',
      background: true,
    });

    expect(result).toContain('Background PID: 4102');
    expect(onLiveCommandStart).toHaveBeenCalledWith('bun dev');
    expect(onLiveCommandRemove).not.toHaveBeenCalled();
    expect(onLiveCommandFinish).not.toHaveBeenCalled();

    callbacks?.onStdout?.('listening on 3000\n');
    expect(onLiveCommandOutput).toHaveBeenCalledWith(
      'live-background-shell',
      'stdout',
      'listening on 3000\n',
    );

    callbacks?.onBackgroundExit?.({ code: 0, signal: null });
    callbacks?.onBackgroundExit?.({ code: 0, signal: null });
    expect(onLiveCommandFinish).toHaveBeenCalledOnce();
    expect(onLiveCommandFinish).toHaveBeenCalledWith('live-background-shell', true, undefined);
  });

  it('removes a background shell row when launch fails before a PID handoff', async () => {
    vi.spyOn(shellActions, 'executeStreamingShellCommand').mockImplementation(
      async (_command, _cwd, options = {}) => {
        (options as BackgroundLifecycleCallbacks).onBackgroundExit?.({
          code: null,
          signal: null,
          error: new Error('spawn EACCES'),
        });
        return { success: false, error: 'spawn EACCES' };
      },
    );
    const onLiveCommandFinish = vi.fn();
    const onLiveCommandRemove = vi.fn();
    const executor = createExecutor({
      onLiveCommandStart: vi.fn(() => 'failed-background-shell'),
      onLiveCommandOutput: vi.fn(),
      onLiveCommandFinish,
      onLiveCommandRemove,
    });

    const result = await executor.executeForTool(
      { type: 'shell', command: 'unlaunchable', background: true },
      { approvalHandled: true },
    );

    expect(result).toMatchObject({ success: false, error: 'spawn EACCES' });
    expect(onLiveCommandRemove).toHaveBeenCalledWith('failed-background-shell');
    expect(onLiveCommandFinish).not.toHaveBeenCalled();
  });

  it('defers a fast background completion until the PID handoff succeeds', async () => {
    const events: string[] = [];
    vi.spyOn(shellActions, 'executeStreamingShellCommand').mockImplementation(
      async (_command, _cwd, options = {}) => {
        (options as BackgroundLifecycleCallbacks).onBackgroundExit?.({ code: 0, signal: null });
        events.push('pid-handoff');
        return { success: true, output: '', backgroundPid: 4106 };
      },
    );
    const executor = createExecutor({
      onLiveCommandStart: vi.fn(() => 'fast-background-shell'),
      onLiveCommandOutput: vi.fn(),
      onLiveCommandFinish: vi.fn(() => events.push('finish')),
      onLiveCommandRemove: vi.fn(),
    });

    await executor.execute({ type: 'shell', command: 'fast-command', background: true });

    expect(events).toEqual(['pid-handoff', 'finish']);
  });

  it.each([
    [{ code: 7, signal: null }, 'Background command exited with code 7.'],
    [{ code: null, signal: 'SIGTERM' as NodeJS.Signals }, 'Background command terminated by SIGTERM.'],
    [
      { code: null, signal: null, error: new Error('spawn EACCES') },
      'Background command failed: spawn EACCES',
    ],
  ] satisfies Array<[BackgroundExit, string]>)(
    'reports a concise background run_command failure for %j',
    async (backgroundExit, expectedError) => {
      let callbacks: BackgroundLifecycleCallbacks | undefined;
      vi.spyOn(commandActions, 'runCommand').mockImplementation(
        async (_command, _args, _cwd, options = {}) => {
          callbacks = options as BackgroundLifecycleCallbacks;
          return {
            stdout: '',
            stderr: '',
            code: null,
            signal: null,
            backgroundPid: 4103,
          };
        },
      );
      const onLiveCommandFinish = vi.fn();
      const executor = createExecutor({
        onLiveCommandStart: vi.fn(() => 'live-background-failure'),
        onLiveCommandOutput: vi.fn(),
        onLiveCommandFinish,
        onLiveCommandRemove: vi.fn(),
      });

      await executor.execute({
        type: 'run_command',
        command: 'failing-background-command',
        background: true,
      });
      callbacks?.onBackgroundExit?.(backgroundExit);

      expect(onLiveCommandFinish).toHaveBeenCalledWith(
        'live-background-failure',
        false,
        expectedError,
      );
    },
  );

  it.each(['run_command', 'shell'] as const)(
    'does not create a live row for a silent background %s action',
    async (type) => {
      const onLiveCommandStart = vi.fn(() => 'hidden-background');
      const onLiveCommandFinish = vi.fn();
      vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: '',
        stderr: '',
        code: null,
        signal: null,
        backgroundPid: 4104,
      });
      vi.spyOn(shellActions, 'executeStreamingShellCommand').mockResolvedValue({
        success: true,
        output: '',
        backgroundPid: 4105,
      });
      const executor = createExecutor({
        ui: { silentToolOutput: true },
        onLiveCommandStart,
        onLiveCommandOutput: vi.fn(),
        onLiveCommandFinish,
        onLiveCommandRemove: vi.fn(),
      });

      const result = await executor.execute({
        type,
        command: 'silent-background-command',
        background: true,
      });

      expect(result).toContain('Background PID: 4104');
      expect(onLiveCommandStart).not.toHaveBeenCalled();
      expect(onLiveCommandFinish).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['run_command', 'finish'],
    ['run_command', 'remove'],
    ['shell', 'finish'],
    ['shell', 'remove'],
  ] as const)(
    'does not create an unfinishable background row for a partial %s integration missing %s',
    async (type, missingCallback) => {
      const onLiveCommandStart = vi.fn(() => 'unfinishable-background');
      vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: '',
        stderr: '',
        code: null,
        signal: null,
        backgroundPid: 4107,
      });
      vi.spyOn(shellActions, 'executeStreamingShellCommand').mockResolvedValue({
        success: true,
        output: '',
        backgroundPid: 4108,
      });
      const executor = createExecutor({
        onLiveCommandStart,
        onLiveCommandOutput: vi.fn(),
        ...(missingCallback === 'finish' ? {} : { onLiveCommandFinish: vi.fn() }),
        ...(missingCallback === 'remove' ? {} : { onLiveCommandRemove: vi.fn() }),
      });

      const result = await executor.execute({
        type,
        command: 'partial-background-integration',
        background: true,
      });

      expect(result).toContain('Background PID: 4107');
      expect(onLiveCommandStart).not.toHaveBeenCalled();
    },
  );

  it('registers a background run_command in the registry and removes it on exit', async () => {
    let callbacks: BackgroundLifecycleCallbacks | undefined;
    vi.spyOn(commandActions, 'runCommand').mockImplementation(
      async (_command, _args, _cwd, options = {}) => {
        callbacks = options as BackgroundLifecycleCallbacks;
        return {
          stdout: '',
          stderr: '',
          code: null,
          signal: null,
          backgroundPid: 4242,
        };
      },
    );
    const registry = new BackgroundProcessRegistry();
    const executor = createExecutor({
      onLiveCommandStart: vi.fn(() => 'live-1'),
      onLiveCommandOutput: vi.fn(),
      onLiveCommandFinish: vi.fn(),
      onLiveCommandRemove: vi.fn(),
      backgroundProcessRegistry: registry,
    });

    await executor.executeForTool(
      { type: 'run_command', command: 'node server.js', background: true },
      { approvalHandled: true },
    );

    expect(registry.list()).toEqual([
      expect.objectContaining({ pid: 4242, command: 'node server.js' }),
    ]);

    callbacks?.onBackgroundExit?.({ code: 0, signal: null });
    expect(registry.list()).toEqual([]);
  });

  it('registers a background shell command (live display) in the registry and removes it on exit', async () => {
    let callbacks: BackgroundLifecycleCallbacks | undefined;
    vi.spyOn(shellActions, 'executeStreamingShellCommand').mockImplementation(
      async (_command, _cwd, options = {}) => {
        callbacks = options as BackgroundLifecycleCallbacks;
        return {
          success: true,
          output: '',
          error: undefined,
          backgroundPid: 4343,
        } as never;
      },
    );
    const registry = new BackgroundProcessRegistry();
    const executor = createExecutor({
      onLiveCommandStart: vi.fn(() => 'live-shell-1'),
      onLiveCommandOutput: vi.fn(),
      onLiveCommandFinish: vi.fn(),
      onLiveCommandRemove: vi.fn(),
      backgroundProcessRegistry: registry,
    });

    await executor.executeForTool(
      { type: 'shell', command: 'bun', args: ['dev'], background: true },
      { approvalHandled: true },
    );

    expect(registry.list()).toEqual([
      expect.objectContaining({ pid: 4343, command: 'bun dev' }),
    ]);

    callbacks?.onBackgroundExit?.({ code: 0, signal: null });
    expect(registry.list()).toEqual([]);
  });

  it('registers a background shell command even when silent tool output hides the live panel', async () => {
    let callbacks: BackgroundLifecycleCallbacks | undefined;
    vi.spyOn(commandActions, 'runCommand').mockImplementation(
      async (_command, _args, _cwd, options = {}) => {
        callbacks = options as BackgroundLifecycleCallbacks;
        return {
          stdout: '',
          stderr: '',
          code: null,
          signal: null,
          backgroundPid: 4444,
        };
      },
    );
    const registry = new BackgroundProcessRegistry();
    const executor = createExecutor({
      ui: { silentToolOutput: true },
      backgroundProcessRegistry: registry,
    });

    await executor.executeForTool(
      { type: 'shell', command: 'bun', args: ['dev'], background: true },
      { approvalHandled: true },
    );

    expect(registry.list()).toEqual([
      expect.objectContaining({ pid: 4444, command: 'bun dev' }),
    ]);

    callbacks?.onBackgroundExit?.({ code: 0, signal: null });
    expect(registry.list()).toEqual([]);
  });
});
