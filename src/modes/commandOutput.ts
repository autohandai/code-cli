/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AgentOutputEvent, CommandOutputFormat } from '../types.js';
import { Console } from 'node:console';

export interface CommandOutputOptions {
  outputFormat?: unknown;
  json?: unknown;
}

export type CommandOutputResolution =
  | { format: CommandOutputFormat }
  | { error: string };

const JSON_OUTPUT_MODES = ['stream', 'local'] as const;
type JsonOutputMode = typeof JSON_OUTPUT_MODES[number];

function normalizeJsonOutputMode(value: unknown): JsonOutputMode | undefined {
  if (value === true) return 'stream';
  if (typeof value !== 'string') return undefined;
  const normalized = value.toLowerCase();
  return JSON_OUTPUT_MODES.find((mode) => mode === normalized);
}

function formatForJsonMode(mode: JsonOutputMode): CommandOutputFormat {
  return mode === 'stream' ? 'stream-json' : 'json';
}

export function resolveCommandOutputFormat(options: CommandOutputOptions): CommandOutputResolution {
  const requestedOutputFormat = options.outputFormat;
  const requestedJsonMode = options.json;

  if (
    requestedOutputFormat !== undefined
    && requestedOutputFormat !== 'stream-json'
  ) {
    return {
      error: `Invalid --output-format value "${String(requestedOutputFormat)}". Expected: stream-json.`,
    };
  }

  if (requestedJsonMode !== undefined) {
    const jsonMode = normalizeJsonOutputMode(requestedJsonMode);
    if (!jsonMode) {
      return {
        error: `Invalid --json value "${String(requestedJsonMode)}". Expected: stream or local.`,
      };
    }

    const jsonFormat = formatForJsonMode(jsonMode);
    if (requestedOutputFormat === 'stream-json' && jsonFormat !== 'stream-json') {
      return {
        error: '--output-format stream-json cannot be combined with --json local.',
      };
    }
    return { format: jsonFormat };
  }

  return { format: requestedOutputFormat === 'stream-json' ? 'stream-json' : 'text' };
}

export function isStructuredCommandOutput(format: CommandOutputFormat | undefined): boolean {
  return format === 'stream-json' || format === 'json';
}

type CommandOutputRecord =
  | AgentOutputEvent
  | { type: 'result'; content: string }
  | { type: 'error'; message: string };

export class CommandOutputWriter {
  private completed = false;
  private finalContent = '';
  private lastError: string | undefined;

  constructor(private readonly format: CommandOutputFormat) {}

  handleEvent(event: AgentOutputEvent): void {
    if (event.type === 'message') {
      this.finalContent = event.content ?? '';
      if (this.format === 'stream-json') {
        this.write({ type: 'result', content: this.finalContent });
      }
      return;
    }

    if (event.type === 'error') {
      this.writeError(event.content ?? 'Unknown error occurred');
      return;
    }

    if (this.format === 'stream-json') {
      this.write(event);
    }
  }

  writeError(message: string): void {
    this.lastError = message;
    if (this.format === 'stream-json') {
      this.write({ type: 'error', message });
    }
  }

  finish(succeeded: boolean): void {
    if (this.completed) return;
    this.completed = true;

    if (this.format === 'stream-json') {
      if (!succeeded && !this.lastError) {
        this.write({ type: 'error', message: 'Command did not complete successfully.' });
      }
      return;
    }
    if (this.format !== 'json') return;
    if (succeeded) {
      this.write({ type: 'result', content: this.finalContent });
      return;
    }
    this.write({
      type: 'error',
      message: this.lastError ?? 'Command did not complete successfully.',
    });
  }

  private write(record: CommandOutputRecord): void {
    process.stdout.write(`${JSON.stringify(record)}\n`);
  }
}

/**
 * Keeps stdout machine-readable while a one-shot command runs. The normal CLI
 * progress UI remains available to people on stderr.
 */
export function redirectConsoleOutputToStderr(): () => void {
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };
  const stderrConsole = new Console({ stdout: process.stderr, stderr: process.stderr });

  console.log = stderrConsole.log.bind(stderrConsole);
  console.info = stderrConsole.info.bind(stderrConsole);
  console.warn = stderrConsole.warn.bind(stderrConsole);
  console.error = stderrConsole.error.bind(stderrConsole);
  console.debug = stderrConsole.debug.bind(stderrConsole);

  return () => {
    console.log = original.log;
    console.info = original.info;
    console.warn = original.warn;
    console.error = original.error;
    console.debug = original.debug;
  };
}
