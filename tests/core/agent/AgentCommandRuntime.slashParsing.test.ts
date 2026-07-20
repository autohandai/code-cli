/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import {
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

describe('runAgentSlashCommandWithInput', () => {
  it('keeps the persistent composer paused for /browser', async () => {
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
      await runAgentSlashCommandWithInput(host, '/browser', []);

      expect(start).not.toHaveBeenCalled();
      expect(stop).not.toHaveBeenCalled();
      expect(handleSlashCommand).toHaveBeenCalledWith('/browser', []);
    } finally {
      restoreStdoutTTY();
      restoreStdinTTY();
    }
  });
});
