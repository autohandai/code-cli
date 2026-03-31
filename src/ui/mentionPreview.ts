/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import readline from 'node:readline';
import type { SlashCommand } from '../core/slashCommands.js';
import { buildFileMentionSuggestions, MENTION_SUGGESTION_LIMIT } from './mentionFilter.js';
import {
  STATUS_LINE_COUNT,
  PROMPT_LINES_BELOW_INPUT,
  safeEmitKeypressEvents,
  buildPromptRenderState,
  getPromptBlockWidth,
  getLastRenderedContentLines,
  getLastRenderedCursorRow
} from './inputPrompt.js';

type Mode = 'file' | 'slash' | null;
type FileSuggestionAcceptHandler = (line: string, cursorPos: number) => void;

function padVisibleRight(text: string, width: number): string {
  if (width <= 0) {
    return '';
  }
  const visibleLength = text.replace(/\u001b\[[0-9;]*m/g, '').length;
  if (visibleLength >= width) {
    return text;
  }
  return `${text}${' '.repeat(width - visibleLength)}`;
}

function truncateVisible(text: string, width: number): string {
  if (width <= 0) {
    return '';
  }
  const plain = text.replace(/\u001b\[[0-9;]*m/g, '');
  if (plain.length <= width) {
    return text;
  }
  if (width === 1) {
    return '…';
  }
  return `${plain.slice(0, width - 1)}…`;
}

function getFilenameColumnWidth(entries: string[], width: number): number {
  const longestFilename = entries.reduce((max, entry) => {
    const normalized = entry.replace(/\\/g, '/');
    const filename = normalized.split('/').pop() || normalized;
    return Math.max(max, filename.length);
  }, 0);

  const availableWidth = Math.max(12, width - 2);
  return Math.max(12, Math.min(longestFilename, Math.floor(availableWidth * 0.32), 24));
}

function formatFileSuggestionLine(entry: string, isSelected: boolean, width: number, filenameColumnWidth: number): string {
  const normalized = entry.replace(/\\/g, '/');
  const parts = normalized.split('/');
  const filename = parts.pop() || normalized;
  const dir = parts.join('/');
  const pointer = isSelected ? chalk.cyan('▸') : ' ';
  const basePrefix = `${pointer} `;
  const gap = '  ';
  const availableWidth = Math.max(12, width - basePrefix.length);
  const filenameWidth = Math.min(filenameColumnWidth, Math.max(1, availableWidth - gap.length));
  const pathWidth = Math.max(0, availableWidth - gap.length - filenameWidth);
  const visibleFilename = truncateVisible(filename, filenameWidth);
  const visiblePath = truncateVisible(dir, pathWidth);
  const styledFilename = isSelected ? chalk.cyan(visibleFilename) : chalk.white(visibleFilename);
  const styledPath = visiblePath ? chalk.gray(visiblePath) : '';
  return `${basePrefix}${padVisibleRight(styledFilename, filenameWidth)}${styledPath ? `${gap}${styledPath}` : ''}`;
}

export class MentionPreview {
  private suggestionLines = 0;
  private keypressHandler: ((str: string, key: readline.Key) => void) | null = null;
  private slashMatches: SlashCommand[] = [];
  private fileSuggestions: string[] = [];
  private mode: Mode = null;
  private activeIndex = 0;
  private disposed = false;
  private suspended = false;
  private lastSuggestions: string[] = [];
  private tabJustHandled = false;

  // Dynamic offset from cursor to suggestion area, accounting for multi-line content
  private get suggestionOffset(): number {
    const contentLines = getLastRenderedContentLines();
    const cursorRow = getLastRenderedCursorRow();
    const contentLinesBelow = contentLines - 1 - cursorRow;
    return contentLinesBelow + PROMPT_LINES_BELOW_INPUT + STATUS_LINE_COUNT + 1;
  }

  constructor(
    private readonly rl: readline.Interface,
    private readonly filesProvider: () => string[],
    private readonly slashCommands: SlashCommand[],
    private readonly output: NodeJS.WriteStream,
    private readonly onFileSuggestionAccepted?: FileSuggestionAcceptHandler,
  ) {
    const input = (rl as readline.Interface & { input: NodeJS.ReadStream }).input;
    // Use safe emit to prevent duplicate listener registration
    safeEmitKeypressEvents(input);
    this.keypressHandler = this.handleKeypress.bind(this);
    input.prependListener('keypress', this.keypressHandler);
    // Don't render initially - renderPromptLine handles the status display
    // MentionPreview only renders when there are suggestions to show
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
    this.tabJustHandled = false;
    // Don't re-render status line here - let renderPromptLine handle it
    // This prevents double-rendering of the status line
  }

  handleResize(): void {
    if (this.disposed || this.suspended || !this.suggestionLines) {
      return;
    }
    this.clear(false);
    this.render(this.lastSuggestions);
  }

  setSuspended(suspended: boolean): void {
    if (this.suspended === suspended) {
      return;
    }
    this.suspended = suspended;
    if (suspended) {
      this.clear();
    }
  }

  private handleKeypress(_str: string, key: readline.Key): void {
    if (this.disposed || this.suspended) {
      return;
    }
    const beforeCursor = this.rl.line.slice(0, this.rl.cursor);

    // Tab and arrow keys must be handled synchronously (before readline processes them)
    if (this.isTabKey(_str, key)) {
      if (this.mode === 'file' && this.fileSuggestions.length) {
        this.tabJustHandled = true;
        this.insertFileSuggestion(beforeCursor, this.fileSuggestions[this.activeIndex]);
        return;
      }
      if (this.mode === 'slash' && this.slashMatches.length) {
        this.tabJustHandled = true;
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
          this.activeIndex = this.getPreservedSelectionIndex(
            this.lastSuggestions,
            suggestions,
            this.activeIndex,
          );
          this.tabJustHandled = true;
          this.insertFileSuggestion(beforeCursor, suggestions[this.activeIndex] ?? suggestions[0]);
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

    // Defer filter updates to next tick — prependListener fires BEFORE readline
    // updates rl.line, so reading it synchronously here would be one char behind.
    setImmediate(() => this.updateSuggestions());
  }

  private updateSuggestions(): void {
    if (this.disposed || this.suspended) {
      return;
    }
    const beforeCursor = this.rl.line.slice(0, this.rl.cursor);

    if (beforeCursor.startsWith('/')) {
      const seed = beforeCursor.slice(1);
      const slashSuggestions = this.filterSlash(seed);
      if (slashSuggestions.length) {
        this.mode = 'slash';
        this.activeIndex = this.getPreservedSelectionIndex(
          this.lastSuggestions,
          slashSuggestions,
          this.activeIndex,
        );
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
      this.activeIndex = this.getPreservedSelectionIndex(
        this.lastSuggestions,
        suggestions,
        this.activeIndex,
      );
    } else {
      this.mode = null;
      this.fileSuggestions = [];
    }
    this.render(suggestions);
  }

  private filter(seed: string): string[] {
    return buildFileMentionSuggestions(this.filesProvider(), seed, MENTION_SUGGESTION_LIMIT);
  }

  consumeHandledTab(): boolean {
    const handled = this.tabJustHandled;
    this.tabJustHandled = false;
    return handled;
  }

  private getPreservedSelectionIndex(
    previousSuggestions: string[],
    nextSuggestions: string[],
    previousIndex: number,
  ): number {
    if (!nextSuggestions.length) {
      return 0;
    }

    const previousSelection = previousSuggestions[previousIndex];
    if (!previousSelection) {
      return 0;
    }

    const nextIndex = nextSuggestions.indexOf(previousSelection);
    if (nextIndex >= 0) {
      return nextIndex;
    }

    return Math.min(previousIndex, nextSuggestions.length - 1);
  }

  private matchMention(beforeCursor: string): RegExpExecArray | null {
    return /@([A-Za-z0-9_./\\-]*)$/.exec(beforeCursor);
  }

  private isTabKey(str: string, key: readline.Key | undefined): boolean {
    if (key?.name === 'backtab' || key?.sequence === '\x1b[Z' || str === '\x1b[Z' || key?.shift) {
      return false;
    }
    return key?.name === 'tab' || key?.sequence === '\t' || str === '\t';
  }

  private filterSlash(seed: string): string[] {
    const normalized = seed.toLowerCase();

    // Prefix match first; fall back to substring if no prefix hits
    let matches = this.slashCommands
      .filter((cmd) => cmd.command.replace('/', '').toLowerCase().startsWith(normalized));
    if (matches.length === 0) {
      matches = this.slashCommands
        .filter((cmd) => cmd.command.replace('/', '').toLowerCase().includes(normalized));
    }

    this.slashMatches = matches.slice(0, 5);

    return this.slashMatches.map((cmd) => {
      const detail = cmd.description ? chalk.gray(` - ${cmd.description}`) : '';
      return `${cmd.command}${detail}`;
    });
  }

  private render(suggestions: string[]): void {
    if (this.disposed || this.suspended) {
      return;
    }

    this.lastSuggestions = [...suggestions];
    this.clear(false);

    // Only render if there are actual suggestions to show
    // Status line is handled by renderPromptLine when no suggestions
    if (!suggestions.length) {
      return;
    }

    const filenameColumnWidth = this.mode === 'file'
      ? getFilenameColumnWidth(suggestions, getPromptBlockWidth(this.output.columns))
      : 0;

    const suggestionLines = suggestions.map((entry, idx) => {
      const isSelected = this.mode && idx === this.activeIndex;

      if (this.mode === 'file') {
        return formatFileSuggestionLine(
          entry,
          Boolean(isSelected),
          getPromptBlockWidth(this.output.columns),
          filenameColumnWidth,
        );
      }

      const pointer = isSelected ? chalk.cyan('▸') : ' ';
      const text = isSelected ? chalk.cyan(entry) : entry;
      return `${pointer} ${text}`;
    });

    const lines = suggestionLines;

    // Move below the status line before writing suggestions
    readline.moveCursor(this.output, 0, this.suggestionOffset);
    readline.cursorTo(this.output, 0);

    for (const line of lines) {
      readline.clearLine(this.output, 0);
      this.output.write(`${line}\n`);
    }

    this.suggestionLines = lines.length;

    // Restore cursor to the prompt line at the correct column
    readline.moveCursor(this.output, 0, -(this.suggestionLines + this.suggestionOffset));
    readline.cursorTo(this.output, 0);
    const rlAny = this.rl as readline.Interface & { line: string; cursor: number };
    const cursorPos = rlAny.cursor ?? rlAny.line.length;
    const width = getPromptBlockWidth(this.output.columns);
    const state = buildPromptRenderState(rlAny.line, cursorPos, width);
    this.output.write(state.lineText);
    readline.cursorTo(this.output, state.cursorColumn);
  }

  private clear(reprompt = true): void {
    if (!this.suggestionLines) {
      return;
    }
    // Move cursor to the first suggestion line (below status)
    readline.moveCursor(this.output, 0, this.suggestionOffset);
    for (let i = 0; i < this.suggestionLines; i++) {
      readline.clearLine(this.output, 0);
      if (i < this.suggestionLines - 1) {
        readline.moveCursor(this.output, 0, 1);
      }
    }
    // Move back to the prompt line (account for not advancing after the last line)
    readline.moveCursor(this.output, 0, -(this.suggestionLines + this.suggestionOffset - 1));
    this.suggestionLines = 0;
    if (reprompt && !this.disposed) {
      const rlAny = this.rl as readline.Interface & { line: string; cursor: number };
      readline.cursorTo(this.output, 0);
      const cursorPos = rlAny.cursor ?? rlAny.line.length;
      const width = getPromptBlockWidth(this.output.columns);
      const state = buildPromptRenderState(rlAny.line, cursorPos, width);
      this.output.write(state.lineText);
      readline.cursorTo(this.output, state.cursorColumn);
    }
  }

  private insertFileSuggestion(beforeCursor: string, file: string): void {
    const match = /@([A-Za-z0-9_./\\-]*)$/.exec(beforeCursor);
    if (!match) {
      return;
    }
    const start = match.index;
    const afterCursor = this.rl.line.slice(this.rl.cursor);
    const prefix = this.rl.line.slice(0, start);
    const replacement = `@${file} `;

    const newLine = prefix + replacement + afterCursor;
    const newCursorPos = prefix.length + replacement.length;

    if (this.onFileSuggestionAccepted) {
      this.onFileSuggestionAccepted(newLine, newCursorPos);
    } else {
      (this.rl as any).line = newLine;
      (this.rl as any).cursor = newCursorPos;
    }

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
      const width = getPromptBlockWidth(this.output.columns);
      const state = buildPromptRenderState(newLine, newCursorPos, width);
      this.output.write(state.lineText);
      readline.cursorTo(this.output, state.cursorColumn);
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
