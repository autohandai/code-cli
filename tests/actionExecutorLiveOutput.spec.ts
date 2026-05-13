/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import type { FileActionManager } from '../src/actions/filesystem.js';
import { ActionExecutor } from '../src/core/actionExecutor.js';
import type { AgentAction, AgentRuntime } from '../src/types.js';

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
  onLiveCommandRemove?: (id: string) => void;
}): ActionExecutor {
  return new ActionExecutor({
    runtime: createRuntime(options.ui),
    files: createFiles(),
    resolveWorkspacePath: (relativePath) => `${process.cwd()}/${relativePath}`,
    confirmDangerousAction: vi.fn(async () => true),
    onLiveCommandStart: options.onLiveCommandStart,
    onLiveCommandOutput: options.onLiveCommandOutput,
    onLiveCommandRemove: options.onLiveCommandRemove,
  });
}

describe('ActionExecutor live tool output display', () => {
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
});
