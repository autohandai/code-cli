/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pipe Mode — output handler and prompt builder for non-interactive,
 * composable Unix workflows.
 *
 * Usage: `git diff | autohand 'explain'`
 *
 * stdout carries the final result only; stderr carries errors and
 * optional progress messages. In JSON mode, structured NDJSON lines
 * are emitted to stdout instead.
 */

// ============================================================================
// Types
// ============================================================================

export interface PipeOutputOptions {
  /** When true, progress messages are written to stderr. */
  verbose: boolean;
  /** When true, errors are emitted as JSON lines on stdout instead of stderr. */
  jsonOutput: boolean;
}

// ============================================================================
// PipeOutputHandler
// ============================================================================

/**
 * Manages output routing for pipe mode.
 *
 * - `writeFinalResult` always writes to stdout (the composable output).
 * - `writeError` goes to stderr in text mode or stdout as JSON in json mode.
 * - `writeProgress` goes to stderr only when verbose is enabled.
 * - `writeJsonLine` writes an arbitrary value as a single NDJSON line to stdout.
 */
export class PipeOutputHandler {
  private readonly verbose: boolean;
  private readonly jsonOutput: boolean;

  constructor(options: PipeOutputOptions) {
    this.verbose = options.verbose;
    this.jsonOutput = options.jsonOutput;
  }

  /**
   * Write the final result text to stdout.
   * This is the only output consumed by downstream pipes.
   */
  writeFinalResult(text: string): void {
    process.stdout.write(text + '\n');
  }

  /**
   * Write an error message.
   *
   * - Text mode: `Error: <message>\n` to **stderr**.
   * - JSON mode: `{ "type": "error", "message": "<message>" }\n` to **stdout**.
   */
  writeError(message: string): void {
    if (this.jsonOutput) {
      process.stdout.write(JSON.stringify({ type: 'error', message }) + '\n');
    } else {
      process.stderr.write('Error: ' + message + '\n');
    }
  }

  /**
   * Write a progress/status message to stderr.
   * Only emitted when `verbose` is enabled; suppressed otherwise so that
   * downstream consumers see a clean stdout.
   */
  writeProgress(message: string): void {
    if (this.verbose) {
      process.stderr.write(message + '\n');
    }
  }

  /**
   * Write an arbitrary value as a single NDJSON line to stdout.
   * Useful for structured/streaming output in `--json` mode.
   */
  writeJsonLine(data: unknown): void {
    process.stdout.write(JSON.stringify(data) + '\n');
  }
}

// ============================================================================
// buildPipePrompt
// ============================================================================

/**
 * Build the prompt that will be sent to the LLM when running in pipe mode.
 *
 * When `pipedInput` is present, it is prepended inside a fenced code block
 * so the model can see what was piped in.
 *
 * @param userPrompt  - The user-supplied instruction (CLI arg).
 * @param pipedInput  - Content read from stdin, or `null` when nothing was piped.
 * @returns The assembled prompt string.
 */
export function buildPipePrompt(userPrompt: string, pipedInput: string | null): string {
  if (!pipedInput) {
    return userPrompt;
  }

  return `Here is the input from stdin:\n\n\`\`\`\n${pipedInput}\n\`\`\`\n\n${userPrompt}`;
}
