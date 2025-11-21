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
import { buildFileMentionSuggestions, MENTION_SUGGESTION_LIMIT } from './mentionFilter.js';

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

  // Keep process alive while we are reading instruction to prevent
  // event loop starvation during UI transitions (e.g. Ink -> Readline)
  const keepAlive = setInterval(() => { }, 10000);

  try {
    // State machine loop
    while (true) {
      // 1. Create Readline Interface
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
      disableReadlineTabBehavior(rl);

      const input = (rl as readline.Interface & { input: NodeJS.ReadStream }).input;
      const supportsRawMode = typeof input.setRawMode === 'function';
      if (supportsRawMode && input.isTTY) {
        input.setRawMode(true);
      }
      input.resume();
      input.setEncoding('utf8');

      // 2. Setup Interactive UI (Mentions, Resize)
      let mentionPreview: MentionPreview | null = new MentionPreview(rl, files, slashCommands, stdOutput, statusLine);
      let resizeWatcher: TerminalResizeWatcher | null = new TerminalResizeWatcher(stdOutput, () => {
        mentionPreview?.handleResize();
        renderPromptLine(rl, statusLine, stdOutput);
      });

      // 3. Wait for Input or Palette Trigger
      const result = await new Promise<string | null | 'OPEN_PALETTE'>((resolve) => {
        let ctrlCCount = 0;

        const cleanup = () => {
          mentionPreview?.dispose();
          mentionPreview = null;
          resizeWatcher?.dispose();
          resizeWatcher = null;
          input.off('keypress', handleKeypress);
          rl.close();
          // IMPORTANT: Do NOT pause input here. Leave it flowing for the next step.
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
            cleanup();
            resolve('ABORT');
            return;
          }

          // Trigger Palette
          if (rl.cursor === 1 && rl.line === '/') {
            cleanup();
            resolve('OPEN_PALETTE');
          }
        };

        input.on('keypress', handleKeypress);

        rl.setPrompt(`${chalk.gray('›')} `);
        rl.prompt(true);

        rl.on('line', (value) => {
          stdOutput.write('\n');
          cleanup();
          resolve(value.trim());
        });

        rl.on('SIGINT', () => {
          // duplicate of ctrl+c handler but good for safety
          if (ctrlCCount === 0) {
            ctrlCCount = 1;
            mentionPreview?.reset();
            stdOutput.write(`\n${chalk.gray('Press Ctrl+C again to exit.')}\n`);
            renderPromptLine(rl, statusLine, stdOutput);
            return;
          }
          cleanup();
          resolve('ABORT');
        });
      });

      // 4. Handle Result
      if (result === 'OPEN_PALETTE') {
        // Transition to Ink Palette
        // Ensure raw mode is off for Ink? Ink handles it.
        // Just ensure input is not paused.

        let selection: string | null = null;
        try {
          selection = await showCommandPalette(slashCommands, statusLine);
        } catch (error) {
          console.error(chalk.red(`Command palette failed: ${(error as Error).message}`));
        }

        if (typeof selection === 'string') {
          return selection;
        }

        // If null (cancelled), loop back to recreate readline prompt
        continue;
      }

      if (result === 'ABORT') {
        return 'ABORT';
      }

      return result;
    }
  } finally {
    clearInterval(keepAlive);
  }
}

/**
 * Disable readline's built-in tab completion so our custom @ mention handler
 * can own Tab behavior without the default inserter interfering.
 */
function disableReadlineTabBehavior(rl: readline.Interface): void {
  const anyRl = rl as readline.Interface & { completer?: (line: string) => [string[], string]; _tabComplete?: () => void };
  anyRl.completer = (line: string) => [[], line];
  if (typeof anyRl._tabComplete === 'function') {
    anyRl._tabComplete = () => { };
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
    input.prependListener('keypress', this.keypressHandler);
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

    if (this.isTabKey(key)) {
      if (this.mode === 'file' && this.fileSuggestions.length) {
        this.insertFileSuggestion(beforeCursor, this.fileSuggestions[this.activeIndex]);
        return;
      }
      if (this.mode === 'slash' && this.slashMatches.length) {
        this.insertSlashSuggestion(beforeCursor, this.slashMatches[this.activeIndex]);
        return;
      }

      // If mode was lost, attempt to autocomplete based on current buffer
      const match = this.matchMention(beforeCursor);
      if (match) {
        const seed = match[1] ?? '';
        const suggestions = this.filter(seed);
        if (suggestions.length) {
          this.mode = 'file';
          this.fileSuggestions = suggestions;
          this.activeIndex = 0;
          this.insertFileSuggestion(beforeCursor, suggestions[0]);
        }
      }
      return;
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
        this.activeIndex = 0;
      } else {
        this.mode = null;
      }
      this.render(slashSuggestions);
      return;
    }
    this.slashMatches = [];

    const match = this.matchMention(beforeCursor);
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
      this.activeIndex = 0;
    } else {
      this.mode = null;
      this.fileSuggestions = [];
    }
    this.render(suggestions);
  }

  private filter(seed: string): string[] {
    return buildFileMentionSuggestions(this.files, seed, MENTION_SUGGESTION_LIMIT);
  }

  private matchMention(beforeCursor: string): RegExpExecArray | null {
    return /@([A-Za-z0-9_./\\-]*)$/.exec(beforeCursor);
  }

  private isTabKey(key: readline.Key | undefined): boolean {
    return key?.name === 'tab' || key?.sequence === '\t';
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
  const status = (statusLine ?? ' ').padEnd(width).slice(0, width);

  const box = drawInputBox(status, width);

  readline.cursorTo(output, 0);
  output.write(`${box}\n`);

  rl.setPrompt(`${chalk.gray('›')} `);
  rl.prompt(true);
}
