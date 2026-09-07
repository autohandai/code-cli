/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import {
  handleAgentSlashCommand,
  renderAgentSlashCommandResult,
  parseAgentSlashCommand,
  runAgentSlashCommandWithInput,
} from '../../../src/core/agent/AgentCommandRuntime.js';

function overrideStreamTTY(
  stream: NodeJS.ReadStream | NodeJS.WriteStream,
  value: boolean,
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

describe('parseAgentSlashCommand', () => {
  it('parses /handoff session as a two-word command', () => {
    const parsed = parseAgentSlashCommand({} as never, '/handoff session --queue');

    expect(parsed).toEqual({
      command: '/handoff session',
      args: ['--queue'],
    });
  });
});

describe('handleAgentSlashCommand telemetry', () => {
  it('tracks a known subcommand and surface without free-form arguments', async () => {
    const trackCommand = vi.fn().mockResolvedValue(undefined);
    const handle = vi.fn().mockResolvedValue('report queued');
    const host = {
      runtime: { options: { bare: false } },
      telemetryManager: { trackCommand },
      slashHandler: {
        getKnownSubcommands: vi.fn(() => ['changes', 'security']),
        handle,
      },
    };

    await expect(handleAgentSlashCommand(
      host,
      '/review',
      ['security', 'private/customer-a', '--focus', 'credential leak'],
      'json_rpc',
    )).resolves.toBe('report queued');

    expect(trackCommand).toHaveBeenCalledWith({
      command: '/review',
      subcommand: 'security',
      surface: 'json_rpc',
    });
    expect(handle).toHaveBeenCalledWith('/review', [
      'security',
      'private/customer-a',
      '--focus',
      'credential leak',
    ]);
  });
});

describe('renderAgentSlashCommandResult', () => {
  it.each(['/tasks', '/team', '/squad'])('pins %s below the status line', (command) => {
    const setCommandResult = vi.fn();
    const addAssistantMessage = vi.fn();
    const host = {
      inkRenderer: {
        isRunning: () => true,
        setCommandResult,
        addAssistantMessage,
      },
    };

    expect(renderAgentSlashCommandResult(host, command, `${command} output`)).toBe(true);
    expect(setCommandResult).toHaveBeenCalledWith(command, `${command} output`);
    expect(addAssistantMessage).not.toHaveBeenCalled();
  });

  it('keeps unrelated command results in transcript history', () => {
    const setCommandResult = vi.fn();
    const addAssistantMessage = vi.fn();
    const host = {
      inkRenderer: {
        isRunning: () => true,
        setCommandResult,
        addAssistantMessage,
      },
    };

    renderAgentSlashCommandResult(host, '/help', 'Help output');

    expect(setCommandResult).not.toHaveBeenCalled();
    expect(addAssistantMessage).toHaveBeenCalledWith('Help output');
  });
});

describe('runAgentSlashCommandWithInput', () => {
  it('preserves the prompt loaded by /whatityped', async () => {
    const clearInput = vi.fn();
    const host = {
      runtime: { options: {}, config: {} },
      inkRenderer: { isRunning: () => true, clearInput },
      handleSlashCommand: vi.fn(async () => null),
    };
    await runAgentSlashCommandWithInput(host, '/whatityped', []);
    expect(clearInput).not.toHaveBeenCalled();
  });

  it.each(['/browser', '/chrome', '/whatityped'])('keeps the persistent composer paused for %s', async (command) => {
    const restoreStdoutTTY = overrideStreamTTY(process.stdout, true);
    const restoreStdinTTY = overrideStreamTTY(process.stdin, true);
    const start = vi.fn();
    const handleSlashCommand = vi.fn(async () => null);
    const stop = vi.fn();
    const host = {
      runtime: {
        options: { bare: false },
        config: { agent: { enableRequestQueue: true } },
      },
      inkRenderer: undefined,
      persistentInput: {
        start,
        stop,
        getCurrentInput: vi.fn(() => ''),
        hasQueued: vi.fn(() => false),
        dequeue: vi.fn(),
      },
      persistentInputActiveTurn: false,
      installPersistentConsoleBridge: vi.fn(() => vi.fn()),
      handleSlashCommand,
    };

    try {
      await runAgentSlashCommandWithInput(host, command, []);

      expect(start).not.toHaveBeenCalled();
      expect(stop).not.toHaveBeenCalled();
      expect(handleSlashCommand).toHaveBeenCalledWith(command, []);
    } finally {
      restoreStdoutTTY();
      restoreStdinTTY();
    }
  });
});
