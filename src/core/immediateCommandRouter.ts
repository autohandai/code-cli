/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';

export interface RouteOutputOptions {
  persistentInputActiveTurn: boolean;
  terminalRegionsDisabled: boolean;
  writeAbove: (text: string) => void;
}

/**
 * Convert lightweight markdown formatting to terminal ANSI codes.
 *
 * Handles:
 * - `**text**` → chalk.bold(text)
 * - `_text_`   → chalk.italic(text)  (only when delimiters touch word chars,
 *    avoiding false positives on file paths like `my_skill`)
 */
export function renderTerminalMarkdown(text: string): string {
  if (!text) return text;

  // Bold: **text**
  let result = text.replace(/\*\*([^*]+)\*\*/g, (_match, content: string) =>
    chalk.bold(content)
  );

  // Italic: _text_ — require the opening `_` to be preceded by whitespace or
  // start-of-string and the closing `_` to be followed by whitespace, punctuation,
  // or end-of-string. This avoids converting underscores inside identifiers/paths.
  result = result.replace(/(^|[\s(])_([^_]+)_(?=[\s),.:;!?]|$)/gm, (_match, before: string, content: string) =>
    `${before}${chalk.italic(content)}`
  );

  return result;
}

/**
 * Route immediate-command output to the correct destination.
 *
 * When terminal regions are active (PersistentInput owns the bottom of the
 * screen), output must go through writeAbove() so it appears in the scroll
 * region above the input box. Otherwise, plain console.log() is fine.
 *
 * Markdown-style formatting (**bold**, _italic_) is rendered to ANSI before output.
 */
export function routeOutput(text: string, opts: RouteOutputOptions): void {
  const rendered = renderTerminalMarkdown(text);
  if (opts.persistentInputActiveTurn && !opts.terminalRegionsDisabled) {
    opts.writeAbove(`${rendered}\n`);
  } else {
    console.log(rendered);
  }
}

export function createBufferedRouteOutput(
  opts: RouteOutputOptions,
  transform: (text: string) => string = (text) => text
): { push: (chunk: string) => void; flush: () => void } {
  let pending = '';

  const flushLine = (line: string): void => {
    routeOutput(transform(line), opts);
  };

  return {
    push(chunk: string): void {
      pending += chunk;

      while (true) {
        const newlineIndex = pending.indexOf('\n');
        const carriageIndex = pending.indexOf('\r');
        const boundaryCandidates = [newlineIndex, carriageIndex].filter((value) => value >= 0);
        if (boundaryCandidates.length === 0) {
          break;
        }

        const boundaryIndex = Math.min(...boundaryCandidates);
        const boundaryWidth = pending[boundaryIndex] === '\r' && pending[boundaryIndex + 1] === '\n' ? 2 : 1;
        const line = pending.slice(0, boundaryIndex);
        pending = pending.slice(boundaryIndex + boundaryWidth);
        flushLine(line);
      }
    },
    flush(): void {
      if (!pending) {
        return;
      }
      flushLine(pending);
      pending = '';
    }
  };
}

export function formatImmediateShellCommandHeader(command: string): string {
  return `You ran ${command}`;
}

export function createImmediateShellCommandBlockWriter(
  command: string,
  opts: RouteOutputOptions
): {
  pushStdout: (chunk: string) => void;
  pushStderr: (chunk: string) => void;
  flush: () => void;
} {
  let pending = '';
  let pendingStream: 'stdout' | 'stderr' = 'stdout';
  let lineIndex = 0;

  routeOutput(chalk.cyan(formatImmediateShellCommandHeader(command)), opts);

  const flushLine = (line: string, stream: 'stdout' | 'stderr'): void => {
    const prefix = lineIndex === 0 ? '  └ ' : '    ';
    const renderedLine = `${prefix}${line}`;
    routeOutput(stream === 'stderr' ? chalk.red(renderedLine) : renderedLine, opts);
    lineIndex += 1;
  };

  const push = (chunk: string, stream: 'stdout' | 'stderr'): void => {
    pendingStream = stream;
    pending += chunk;

    while (true) {
      const newlineIndex = pending.indexOf('\n');
      const carriageIndex = pending.indexOf('\r');
      const boundaryCandidates = [newlineIndex, carriageIndex].filter((value) => value >= 0);
      if (boundaryCandidates.length === 0) {
        break;
      }

      const boundaryIndex = Math.min(...boundaryCandidates);
      const boundaryWidth = pending[boundaryIndex] === '\r' && pending[boundaryIndex + 1] === '\n' ? 2 : 1;
      const line = pending.slice(0, boundaryIndex);
      pending = pending.slice(boundaryIndex + boundaryWidth);
      flushLine(line, stream);
    }
  };

  return {
    pushStdout(chunk: string): void {
      push(chunk, 'stdout');
    },
    pushStderr(chunk: string): void {
      push(chunk, 'stderr');
    },
    flush(): void {
      if (!pending) {
        return;
      }
      flushLine(pending, pendingStream);
      pending = '';
    },
  };
}
