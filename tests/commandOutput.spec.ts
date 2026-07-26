/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentOutputEvent } from '../src/types.js';
import {
  CommandOutputWriter,
  resolveCommandOutputFormat,
} from '../src/modes/commandOutput.js';

describe('resolveCommandOutputFormat', () => {
  it.each([
    [{ outputFormat: 'stream-json' }, 'stream-json'],
    [{ json: 'stream' }, 'stream-json'],
    [{ json: true }, 'stream-json'],
    [{ json: 'local' }, 'json'],
    [{}, 'text'],
  ] as const)('resolves %o as %s', (options, expected) => {
    expect(resolveCommandOutputFormat(options)).toEqual({ format: expected });
  });

  it('accepts matching stream aliases', () => {
    expect(resolveCommandOutputFormat({
      outputFormat: 'stream-json',
      json: 'stream',
    })).toEqual({ format: 'stream-json' });
  });

  it('rejects unsupported output formats', () => {
    expect(resolveCommandOutputFormat({ outputFormat: 'json' })).toEqual({
      error: 'Invalid --output-format value "json". Expected: stream-json.',
    });
  });

  it('rejects unsupported --json modes', () => {
    expect(resolveCommandOutputFormat({ json: 'remote' })).toEqual({
      error: 'Invalid --json value "remote". Expected: stream or local.',
    });
  });

  it('rejects conflicting aliases', () => {
    expect(resolveCommandOutputFormat({
      outputFormat: 'stream-json',
      json: 'local',
    })).toEqual({
      error: '--output-format stream-json cannot be combined with --json local.',
    });
  });
});

describe('CommandOutputWriter', () => {
  let stdoutWrite: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes each agent event as JSONL in stream-json mode', () => {
    const writer = new CommandOutputWriter('stream-json');
    const events: AgentOutputEvent[] = [
      { type: 'thinking', thought: 'Inspecting the workspace.' },
      { type: 'tool_start', toolId: 'call-1', toolName: 'read_file', toolArgs: { path: 'src/index.ts' } },
      { type: 'tool_end', toolId: 'call-1', toolName: 'read_file', toolSuccess: true, toolOutput: 'contents' },
      { type: 'message', content: 'Implemented the change.' },
    ];

    for (const event of events) {
      writer.handleEvent(event);
    }
    writer.finish(true);

    expect(stdoutWrite).toHaveBeenNthCalledWith(1, `${JSON.stringify(events[0])}\n`);
    expect(stdoutWrite).toHaveBeenNthCalledWith(2, `${JSON.stringify(events[1])}\n`);
    expect(stdoutWrite).toHaveBeenNthCalledWith(3, `${JSON.stringify(events[2])}\n`);
    expect(stdoutWrite).toHaveBeenNthCalledWith(4, `${JSON.stringify({
      type: 'result',
      content: 'Implemented the change.',
    })}\n`);
    expect(stdoutWrite).toHaveBeenCalledTimes(4);
  });

  it('writes exactly one final JSON result in local mode', () => {
    const writer = new CommandOutputWriter('json');

    writer.handleEvent({ type: 'thinking', thought: 'Working.' });
    writer.handleEvent({ type: 'tool_start', toolId: 'call-1', toolName: 'read_file' });
    writer.handleEvent({ type: 'message', content: 'Final response.' });
    writer.finish(true);

    expect(stdoutWrite).toHaveBeenCalledTimes(1);
    expect(stdoutWrite).toHaveBeenCalledWith(`${JSON.stringify({
      type: 'result',
      content: 'Final response.',
    })}\n`);
  });

  it('writes a terminal JSON error when the command fails before a result', () => {
    const writer = new CommandOutputWriter('json');

    writer.writeError('Provider unavailable.');
    writer.finish(false);

    expect(stdoutWrite).toHaveBeenCalledTimes(1);
    expect(stdoutWrite).toHaveBeenCalledWith(`${JSON.stringify({
      type: 'error',
      message: 'Provider unavailable.',
    })}\n`);
  });
});
