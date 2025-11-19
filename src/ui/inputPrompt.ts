/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import readline from 'node:readline';
import { TerminalResizeWatcher } from './terminalResize.js';
import { showCommandPalette } from './commandPalette.js';
import type { SlashCommand } from '../core/slashCommands.js';

export type SlashCommandHint = SlashCommand;

export interface PromptIO {
  input?: NodeJS.ReadStream;
  output?: NodeJS.WriteStream;
}

export async function readInstruction(
  files: string[],
  slashCommands: SlashCommandHint[],
  statusLine?: string,
  io: PromptIO = {}
): Promise<string | null> {
  const stdInput = (io.input ?? process.stdin) as NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void };
  const stdOutput = (io.output ?? process.stdout) as NodeJS.WriteStream;

  while (true) {
    try {
      // Ensure stdin is resumed before creating readline interface
      // (it might have been paused by command palette or other UI)
      if (stdInput.isPaused && stdInput.isPaused()) {
        stdInput.resume();
      }

      const rl = readline.createInterface({
        input: stdInput,
        output: stdOutput,
        prompt: `${chalk.gray('›')} `,
        terminal: true,
        crlfDelay: Infinity,
        historySize: 100,
        tabSize: 2
      });
      const input = (rl as readline.Interface & { input: NodeJS.ReadStream }).input;
      const supportsRawMode = typeof input.setRawMode === 'function';

      if (supportsRawMode && input.isTTY) {
        input.setRawMode(true);
      }

      input.resume();
      input.setEncoding('utf8');

      let ctrlCCount = 0;
      let aborted = false;
      let settled = false;
      let paletteOpen = false;
      let keypressHandler: ((str: string, key: readline.Key) => void) | null = null;
      let mentionPreview: MentionPreview | null = null;
      let resizeWatcher: TerminalResizeWatcher | null = null;

      const attachInteractiveUi = () => {
        mentionPreview = new MentionPreview(rl, files, slashCommands, stdOutput, statusLine);
        resizeWatcher = new TerminalResizeWatcher(stdOutput, () => {
          mentionPreview?.handleResize();
          renderPromptLine(rl, statusLine, stdOutput);
        });
      };

      const detachInteractiveUi = () => {
        mentionPreview?.dispose();
        mentionPreview = null;
        resizeWatcher?.dispose();
        resizeWatcher = null;
      };

      const detachKeypressHandler = () => {
        if (keypressHandler) {
          input.off('keypress', keypressHandler);
          keypressHandler = null;
        }
      };

      attachInteractiveUi();

      const result = await new Promise<string | null>((resolve) => {
        const finish = (value: string | null) => {
          if (settled) {
            return;
          }
          settled = true;
          detachInteractiveUi();
          detachKeypressHandler();
          stdOutput.write(RESET_BG);
          if (supportsRawMode && input.isTTY) {
            input.setRawMode(false);
          }
          input.pause();
          rl.close();
          resolve(value);
        };

        const handleKeypress = (_str: string, key: readline.Key) => {
          if (key?.name === 'c' && key.ctrl) {
            if (ctrlCCount === 0) {
              ctrlCCount = 1;
              mentionPreview?.reset();
              stdOutput.write(`\n${chalk.gray('Press Ctrl+C again to exit.')}\n`);
              renderPromptLine(rl, statusLine, stdOutput);
              return;
            }
            aborted = true;
            finish(null);
            return;
          }
          if (!paletteOpen && rl.cursor === 1 && rl.line === '/') {
            void openPalette();
          }
        };

        function attachKeypressHandler(): void {
          detachKeypressHandler();
          keypressHandler = handleKeypress;
          input.on('keypress', keypressHandler);
        }

        function restorePrompt(): void {
          if (supportsRawMode && input.isTTY) {
            input.setRawMode(true);
          }
          input.resume();
          attachInteractiveUi();
          attachKeypressHandler();
          renderPromptLine(rl, statusLine, stdOutput);
        }

        const openPalette = async () => {
          if (paletteOpen) {
            return;
          }
          paletteOpen = true;
          detachInteractiveUi();
          detachKeypressHandler();
          if (supportsRawMode && input.isTTY) {
            input.setRawMode(false);
          }
          input.pause();

          let selection: string | null | undefined;
          try {
            selection = await showCommandPalette(slashCommands, statusLine);
          } catch (error) {
            console.error(chalk.red(`Command palette failed: ${(error as Error).message}`));
          } finally {
            paletteOpen = false;
          }

          if (typeof selection !== 'string') {
            restorePrompt();
            return;
          }

          finish(selection);
        };

        rl.setPrompt(`${chalk.gray('›')} `);
        rl.prompt(true);
        rl.on('line', (value) => {
          stdOutput.write('\n');
          finish(value.trim());
        });
        rl.on('SIGINT', () => {
          if (ctrlCCount === 0) {
            ctrlCCount = 1;
            mentionPreview?.reset();
            stdOutput.write(`\n${chalk.gray('Press Ctrl+C again to exit.')}\n`);
            renderPromptLine(rl, statusLine, stdOutput);
            return;
          }
          aborted = true;
          finish(null);
        });

        attachKeypressHandler();
      });

      if (aborted) {
        return null;
      }
      return result;

    } catch (error) {
      console.error(chalk.red(`\nInput error: ${(error as Error).message}`));
      // Wait a bit before retrying to avoid tight loops if something is permanently broken
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
  }
}

class MentionPreview {
  private mentionLines = 0;
  private keypressHandler: ((str: string, key: readline.Key) => void) | null = null;
  private readonly statusLine?: string;
  private slashMatches: SlashCommandHint[] = [];
  private fileSuggestions: string[] = [];
  private mode: 'file' | 'slash' | null = null;
  private activeIndex = 0;
  private disposed = false;
  private lastSuggestions: string[] = [];

  constructor(
    private readonly rl: readline.Interface,
    private readonly files: string[],
    private readonly slashCommands: SlashCommandHint[],
    private readonly output: NodeJS.WriteStream,
    statusLine?: string
  ) {
    const input = (rl as readline.Interface & { input: NodeJS.ReadStream }).input;
    readline.emitKeypressEvents(input, rl);
    this.statusLine = statusLine ? chalk.gray(statusLine) : undefined;
    this.keypressHandler = this.handleKeypress.bind(this);
    input.on('keypress', this.keypressHandler);
    this.render([]);
  }

  dispose(): void {
    const input = (this.rl as readline.Interface & { input: NodeJS.ReadStream }).input;
    if (this.keypressHandler) {
      input.off('keypress', this.keypressHandler);
    }
    this.disposed = true;
    this.clear();
  }

  reset(): void {
    this.clear();
    if (this.statusLine) {
      this.render([]);
    }
  }

  private handleKeypress(_str: string, key: readline.Key): void {
    if (this.disposed) {
      return;
    }
    const beforeCursor = this.rl.line.slice(0, this.rl.cursor);

    if (key?.name === 'tab') {
      if (this.mode === 'file' && this.fileSuggestions.length) {
        this.insertFileSuggestion(beforeCursor, this.fileSuggestions[this.activeIndex]);
        return;
      }
      if (this.mode === 'slash' && this.slashMatches.length) {
        this.insertSlashSuggestion(beforeCursor, this.slashMatches[this.activeIndex]);
        return;
      }
      // Prevent default tab behavior when in autocomplete mode
      if (this.mode) {
        return;
      }
    }

    if ((key?.name === 'down' || key?.name === 'up') && this.mode && this.lastSuggestions.length) {
      const delta = key.name === 'down' ? 1 : -1;
      const length = this.lastSuggestions.length;
      this.activeIndex = (this.activeIndex + delta + length) % length;
      this.render(this.lastSuggestions);
      return;
    }

    if (beforeCursor.startsWith('/')) {
      const seed = beforeCursor.slice(1);
      const slashSuggestions = this.filterSlash(seed);
      if (slashSuggestions.length) {
        this.mode = 'slash';
        this.activeIndex = Math.min(this.activeIndex, slashSuggestions.length - 1);
      } else {
        this.mode = null;
      }
      this.render(slashSuggestions);
      return;
    }
    this.slashMatches = [];

    const match = /@([A-Za-z0-9_./\-]*)$/.exec(beforeCursor);
    if (!match) {
      this.mode = null;
      this.fileSuggestions = [];
      this.render([]);
      return;
    }

    const seed = match[1];
    const suggestions = this.filter(seed ?? '');
    if (suggestions.length) {
      this.mode = 'file';
      this.fileSuggestions = suggestions;
      this.activeIndex = Math.min(this.activeIndex, suggestions.length - 1);
    } else {
      this.mode = null;
      this.fileSuggestions = [];
    }
    this.render(suggestions);
  }

  private filter(seed: string): string[] {
    if (!seed) {
      // If no seed, show recent/common files
      return this.files.slice(0, 8);
    }

    const normalized = seed.toLowerCase();

    // Separate files into categories
    const startsWithMatches: string[] = [];
    const containsMatches: string[] = [];
    const pathMatches: string[] = [];

    for (const file of this.files) {
      const fileLower = file.toLowerCase();
      const filename = file.split('/').pop() || '';
      const filenameLower = filename.toLowerCase();

      if (filenameLower.startsWith(normalized)) {
        startsWithMatches.push(file);
      } else if (filenameLower.includes(normalized)) {
        containsMatches.push(file);
      } else if (fileLower.includes(normalized)) {
        pathMatches.push(file);
      }
    }

    // Combine results with priority: starts with > contains in filename > path contains
    return [
      ...startsWithMatches,
      ...containsMatches,
      ...pathMatches
    ].slice(0, 8);
  }

  private filterSlash(seed: string): string[] {
    const normalized = seed.toLowerCase();
    this.slashMatches = this.slashCommands
      .filter((cmd) => cmd.command.replace('/', '').toLowerCase().includes(normalized))
      .slice(0, 5);

    return this.slashMatches.map((cmd) => {
      const detail = cmd.description ? chalk.gray(` — ${cmd.description}`) : '';
      return `${cmd.command}${detail}`;
    });
  }

  handleResize(): void {
    if (this.disposed || !this.mentionLines) {
      return;
    }
    this.clear(false);
    this.render(this.lastSuggestions);
  }

  private render(suggestions: string[]): void {
    if (this.disposed) {
      return;
    }
    const suggestionLines = suggestions.map((entry, idx) => {
      const isSelected = this.mode && idx === this.activeIndex;
      const pointer = isSelected ? chalk.cyan('▸') : ' ';

      // For file mode, highlight filename separately from path
      if (this.mode === 'file') {
        const parts = entry.split('/');
        const filename = parts.pop() || entry;
        const dir = parts.length ? parts.join('/') + '/' : '';

        if (isSelected) {
          const highlighted = chalk.cyan(filename);
          const path = dir ? chalk.gray(dir) : '';
          return `${pointer} ${path}${highlighted}`;
        } else {
          const dimmedFilename = chalk.white(filename);
          const path = dir ? chalk.gray(dir) : '';
          return `${pointer} ${path}${dimmedFilename}`;
        }
      }

      // For slash commands, keep existing behavior
      const text = isSelected ? chalk.cyan(entry) : entry;
      return `${pointer} ${text}`;
    });
    const lines = [
      ...suggestionLines,
      ...(this.statusLine ? [this.statusLine] : [])
    ];
    this.lastSuggestions = [...suggestions];
    this.clear();
    if (!lines.length) {
      return;
    }

    this.output.write('\n');
    for (const line of lines) {
      this.output.write(`${line}\n`);
    }
    this.mentionLines = lines.length + 1;

    // Move cursor back up to input line
    readline.moveCursor(this.output, 0, -this.mentionLines);

    // Rewrite the input line
    readline.cursorTo(this.output, 0);
    this.output.write(`${chalk.gray('›')} ${this.rl.line}`);
    readline.cursorTo(this.output, this.rl.cursor + 2); // +2 for '› ' prompt
  }

  private clear(reprompt = true): void {
    if (!this.mentionLines) {
      return;
    }
    readline.moveCursor(this.output, 0, 1);
    for (let i = 0; i < this.mentionLines; i++) {
      readline.clearLine(this.output, 0);
      if (i < this.mentionLines - 1) {
        readline.moveCursor(this.output, 0, 1);
      }
    }
    readline.moveCursor(this.output, 0, -this.mentionLines);
    this.mentionLines = 0;
    if (reprompt) {
      if (!this.disposed) {
        this.rl.prompt(true);
      }
    }
  }

  private insertFileSuggestion(beforeCursor: string, file: string): void {
    const match = /@([A-Za-z0-9_./\\-]*)$/.exec(beforeCursor);
    if (!match) {
      return;
    }
    const seed = match[1] ?? '';
    const start = match.index;
    const end = start + match[0].length;

    // Construct the new line content
    const afterCursor = this.rl.line.slice(this.rl.cursor);
    const prefix = this.rl.line.slice(0, start);
    const replacement = `@${file} `;

    const newLine = prefix + replacement + afterCursor;
    const newCursorPos = prefix.length + replacement.length;

    // Update readline state directly
    (this.rl as any).line = newLine;
    (this.rl as any).cursor = newCursorPos;

    // Reset mode and clear suggestions
    this.mode = null;
    this.fileSuggestions = [];
    this.lastSuggestions = [];

    // Clear the suggestion list from the screen
    this.clear();

    // Force readline to redraw the line
    // @ts-ignore - _refreshLine is internal but necessary here for immediate update
    if (typeof this.rl._refreshLine === 'function') {
      // @ts-ignore
      this.rl._refreshLine();
    } else {
      // Fallback if internal API is missing (unlikely in node)
      readline.cursorTo(this.output, 0);
      this.output.write(`${chalk.gray('›')} ${newLine}`);
      readline.cursorTo(this.output, newCursorPos + 2);
    }
  }

  private insertSlashSuggestion(beforeCursor: string, command: SlashCommandHint): void {
    const seed = beforeCursor.slice(1);
    const completion = command.command.replace('/', '');
    const remainder = completion.slice(seed.length);
    this.rl.write(remainder);
    this.mode = null;
    this.render([]);
  }
}

const INPUT_BG = '\u001b[48;2;47;47;47m';
const RESET_BG = '\u001b[0m';
const STATUS_COLOR = '#6f6f6f';

/**
 * Wrap text to fit within terminal width
 */
function wrapText(text: string, width: number, indent: number = 0): string[] {
  const lines: string[] = [];
  const indentStr = ' '.repeat(indent);
  let currentLine = '';

  // Split by actual newlines first
  const paragraphs = text.split('\n');

  for (const paragraph of paragraphs) {
    const words = paragraph.split(' ');

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const displayWidth = testLine.length + (lines.length === 0 ? 0 : indent);

      if (displayWidth > width && currentLine) {
        lines.push(lines.length === 0 ? currentLine : indentStr + currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }

    if (currentLine) {
      lines.push(lines.length === 0 ? currentLine : indentStr + currentLine);
      currentLine = '';
    }
  }

  return lines.length ? lines : [''];
}

import { drawInputBox } from './box.js';

function renderPromptLine(rl: readline.Interface, statusLine: string | undefined, output: NodeJS.WriteStream): void {
  const width = Math.max(20, output.columns || 80);
  // Subtract 2 for borders
  const contentWidth = width - 2;
  const status = (statusLine ?? ' ').padEnd(contentWidth).slice(0, contentWidth);

  const box = drawInputBox(status, contentWidth);

  readline.cursorTo(output, 0);
  output.write(`${box}\n`);

  // Move cursor to inside the box for input
  // The box has 3 lines: top, middle (status), bottom.
  // We want input to be below the box? Or inside?
  // The original code had input below status.

  // Let's stick to the original layout but use the box for the status line.
  // Actually, drawInputBox draws a box around the "prompt" string.
  // If we want the input to be inside a box, we need a different design.
  // But let's just use it for the status line for now as a "header".

  readline.moveCursor(output, 0, -2); // Move up to the middle line of the box?
  // No, the previous code cleared lines and wrote status.

  // Let's look at drawInputBox again.
  // top, middle (prompt), bottom.

  // If we use it for status:
  // ┌──────────────┐
  // │ status text  │
  // └──────────────┘
  // › input

  // This seems reasonable.

  rl.setPrompt(`${chalk.gray('›')} `);
  rl.prompt(true);
}
