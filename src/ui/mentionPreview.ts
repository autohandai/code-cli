/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import readline from 'node:readline';
import type { SlashCommand } from '../core/slashCommands.js';
import { buildFileMentionSuggestions, MENTION_SUGGESTION_LIMIT } from './mentionFilter.js';

type Mode = 'file' | 'slash' | null;

export class MentionPreview {
  private mentionLines = 0;
  private keypressHandler: ((str: string, key: readline.Key) => void) | null = null;
  private readonly statusLine?: string;
  private slashMatches: SlashCommand[] = [];
  private fileSuggestions: string[] = [];
  private mode: Mode = null;
  private activeIndex = 0;
  private disposed = false;
  private lastSuggestions: string[] = [];

  constructor(
    private readonly rl: readline.Interface,
    private readonly files: string[],
    private readonly slashCommands: SlashCommand[],
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

  handleResize(): void {
    if (this.disposed || !this.mentionLines) {
      return;
    }
    this.clear(false);
    this.render(this.lastSuggestions);
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

  private render(suggestions: string[]): void {
    if (this.disposed) {
      return;
    }
    const suggestionLines = suggestions.map((entry, idx) => {
      const isSelected = this.mode && idx === this.activeIndex;
      const pointer = isSelected ? chalk.cyan('▸') : ' ';

      if (this.mode === 'file') {
        const parts = entry.split('/');
        const filename = parts.pop() || entry;
        const dir = parts.length ? parts.join('/') + '/' : '';

        if (isSelected) {
          const highlighted = chalk.cyan(filename);
          const path = dir ? chalk.gray(dir) : '';
          return `${pointer} ${path}${highlighted}`;
        }
        const dimmedFilename = chalk.white(filename);
        const path = dir ? chalk.gray(dir) : '';
        return `${pointer} ${path}${dimmedFilename}`;
      }

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

    readline.moveCursor(this.output, 0, -this.mentionLines);
    readline.cursorTo(this.output, 0);
    this.output.write(`${chalk.gray('›')} ${this.rl.line}`);
    readline.cursorTo(this.output, this.rl.cursor + 2);
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
    if (reprompt && !this.disposed) {
      this.rl.prompt(true);
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
    const afterCursor = this.rl.line.slice(this.rl.cursor);
    const prefix = this.rl.line.slice(0, start);
    const replacement = `@${file} `;

    const newLine = prefix + replacement + afterCursor;
    const newCursorPos = prefix.length + replacement.length;

    (this.rl as any).line = newLine;
    (this.rl as any).cursor = newCursorPos;

    this.mode = null;
    this.fileSuggestions = [];
    this.lastSuggestions = [];
    this.clear();

    // @ts-ignore - _refreshLine is internal but necessary for immediate update
    if (typeof this.rl._refreshLine === 'function') {
      // @ts-ignore
      this.rl._refreshLine();
    } else {
      readline.cursorTo(this.output, 0);
      this.output.write(`${chalk.gray('›')} ${newLine}`);
      readline.cursorTo(this.output, newCursorPos + 2);
    }
  }

  private insertSlashSuggestion(beforeCursor: string, command: SlashCommand): void {
    const seed = beforeCursor.slice(1);
    const completion = command.command.replace('/', '');
    const remainder = completion.slice(seed.length);
    this.rl.write(remainder);
    this.mode = null;
    this.render([]);
  }
}
