/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import readline from 'node:readline';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import os from 'node:os';
import { TerminalResizeWatcher } from './terminalResize.js';
import {
  isShellCommand,
  parseShellCommand,
  executeShellCommand,
  getPrimaryShellCommandSuggestion,
  getShellCommandSuggestions
} from './shellCommand.js';
import type { SlashCommand } from '../core/slashCommands.js';
import { MentionPreview } from './mentionPreview.js';
import { getPlanModeManager } from '../commands/plan.js';
import { safeSetRawMode } from './rawMode.js';
import {
  type ImageMimeType,
  parseBase64DataUrl,
  getMimeTypeFromExtension,
} from '../core/ImageManager.js';
import { getContentDisplay } from './displayUtils.js';
import {
  drawInputBottomBorder,
  drawInputBox,
  drawInputTopBorder,
  invalidateBoxColorCache,
  type InputBorderStyle
} from './box.js';
import { buildFileMentionSuggestions } from './mentionFilter.js';
import { themedFg } from './theme/index.js';
import { stripAnsiCodes, enableBracketedPaste, disableBracketedPaste } from './displayUtils.js';
import { TextBuffer } from './textBuffer.js';
import { handleTextBufferKey } from './textBufferKeyHandler.js';
import { calculateLayout, logicalToVisual } from './textBufferLayout.js';

/**
 * Module-level event emitter for delivering messages above the active prompt.
 * Use `promptNotify(message)` from anywhere to display a message cleanly
 * above the composer without interleaving with readline output.
 */
const promptEvents = new EventEmitter();

export function promptNotify(message: string): void {
  promptEvents.emit('notify', message);
}

/**
 * Interrupt the active prompt, causing readInstruction to resolve with the given value.
 * Used by repeat jobs to inject instructions while the prompt is blocking the loop.
 */
export function promptInterrupt(value: string): void {
  promptEvents.emit('interrupt', value);
}

const PROMPT_PREFIX = `${chalk.gray('›')} `;
// Number of fixed status lines we render beneath the prompt
export const STATUS_LINE_COUNT = 1;
// Composer block structure relative to input line.
export const PROMPT_LINES_ABOVE_INPUT = 1;
export const PROMPT_LINES_BELOW_INPUT = 1;
export const PROMPT_PLACEHOLDER = 'Plan, search, build anything';
export const PROMPT_INPUT_PREFIX = '❯ ';
const SHIFT_ENTER_RESIDUAL_PATTERN = /^(?:13;?[234]?\d*[u~]|27;[234];13~)$/;

export interface PromptRenderState {
  lineText: string;
  cursorColumn: number;
}

export interface MultiLineRenderState {
  lines: string[];        // drawInputBox() output per content row
  cursorRow: number;      // which content line has cursor (0-based)
  cursorColumn: number;   // screen column on that row (includes border offset)
  lineCount: number;      // total content lines
}

interface PromptHotTip {
  label: string;
}

interface PromptSuggestion {
  line: string;
  cursor: number;
}

const HOT_TIP_LIMIT = 5;

const CONTEXTUAL_HELP_ROWS: Array<{ left: string; right: string }> = [
  { left: '/ for commands', right: '! for shell commands' },
  { left: '@ for file paths', right: 'tab accepts suggestion' },
  { left: '? toggles this shortcuts panel', right: 'shift + tab toggles plan mode' },
  { left: 'shift + enter inserts newline', right: 'alt + enter inserts newline' },
  { left: 'enter submits prompt', right: 'ctrl + c clears input / exits' },
  { left: 'esc interrupts active turn', right: 'type /, @, or ! to switch mode' },
];

function truncatePlainText(value: string, width: number): string {
  if (width <= 0) {
    return '';
  }
  if (value.length <= width) {
    return value;
  }
  if (width === 1) {
    return '…';
  }
  return `${value.slice(0, width - 1)}…`;
}

export function buildPromptHotTips(
  currentLine: string,
  files: string[],
  slashCommands: SlashCommand[],
  workspaceRoot?: string
): PromptHotTip[] {
  const trimmed = currentLine.trim();
  const mentionMatch = /@([A-Za-z0-9_./\\-]*)$/.exec(currentLine);

  if (mentionMatch) {
    const seed = mentionMatch[1] ?? '';
    const suggestions = buildFileMentionSuggestions(files, seed, HOT_TIP_LIMIT);
    const mentionTips = suggestions.map((file) => ({
      label: `Tab -> @${file}`
    }));
    return mentionTips.length > 0
      ? mentionTips
      : [{ label: 'Type more after @ to filter file paths' }];
  }

  if (trimmed.startsWith('/')) {
    // Use left-trimmed input to preserve trailing space for subcommand detection
    const slashInput = currentLine.replace(/^\s+/, '');
    const spaceIdx = slashInput.indexOf(' ');
    if (spaceIdx !== -1) {
      const cmdPart = slashInput.slice(0, spaceIdx).toLowerCase();
      const subSeed = slashInput.slice(spaceIdx + 1).toLowerCase().trim();
      const parent = slashCommands.find((cmd) => cmd.command.toLowerCase() === cmdPart);

      if (parent?.subcommands && parent.subcommands.length > 0) {
        const subMatches = parent.subcommands
          .filter((sub) =>
            subSeed === '' ? true : sub.name.toLowerCase().startsWith(subSeed)
          )
          .slice(0, HOT_TIP_LIMIT)
          .map((sub) => ({
            label: `Tab -> ${parent.command} ${sub.name} (${sub.description})`
          }));
        if (subMatches.length > 0) {
          return subMatches;
        }
      }
    }

    const seed = trimmed.slice(1).toLowerCase();
    const matches = slashCommands
      .filter((cmd) => cmd.command.slice(1).toLowerCase().includes(seed))
      .slice(0, HOT_TIP_LIMIT)
      .map((cmd) => ({
        label: `Tab -> ${cmd.command}${cmd.description ? ` (${cmd.description})` : ''}`
      }));
    return matches.length > 0
      ? matches
      : [{ label: 'No slash command match. Try /help' }];
  }

  if (trimmed.startsWith('!')) {
    const shellSuggestions = getShellCommandSuggestions(trimmed, {
      cwd: workspaceRoot,
      limit: HOT_TIP_LIMIT
    });
    return shellSuggestions.length > 0
      ? shellSuggestions.map((value) => ({ label: `Tab -> ${value}` }))
      : [{ label: 'Type a shell command after ! (e.g. ! git status)' }];
  }

  const defaultFileTip = files.length > 0
    ? { label: `Tab -> @${files[0]}` }
    : { label: 'Type @ to mention files' };

  return [
    { label: 'Tab -> /help' },
    { label: 'Tab -> ! git status' },
    defaultFileTip,
    { label: 'Type /, @, or ! to switch suggestion mode' },
    { label: 'Shift+Tab toggles plan mode' },
  ];
}

export function getPrimaryHotTipSuggestion(
  currentLine: string,
  files: string[],
  slashCommands: SlashCommand[],
  suggestionText?: string,
  workspaceRoot?: string
): PromptSuggestion | null {
  const mentionMatch = /@([A-Za-z0-9_./\\-]*)$/.exec(currentLine);
  if (mentionMatch) {
    const seed = mentionMatch[1] ?? '';
    const suggestions = buildFileMentionSuggestions(files, seed, 1);
    if (suggestions.length === 0) {
      return null;
    }
    const prefix = currentLine.slice(0, mentionMatch.index);
    const line = `${prefix}@${suggestions[0]} `;
    return { line, cursor: line.length };
  }

  const trimmed = currentLine.trim();
  if (!trimmed) {
    if (suggestionText) {
      return { line: suggestionText, cursor: suggestionText.length };
    }
    return { line: '/help ', cursor: 6 };
  }

  if (trimmed.startsWith('/')) {
    // Use left-trimmed input to preserve trailing space for subcommand detection
    const slashInput = currentLine.replace(/^\s+/, '');
    const spaceIdx = slashInput.indexOf(' ');
    if (spaceIdx !== -1) {
      const cmdPart = slashInput.slice(0, spaceIdx).toLowerCase();
      const subSeed = slashInput.slice(spaceIdx + 1).toLowerCase().trim();
      const parent = slashCommands.find((cmd) => cmd.command.toLowerCase() === cmdPart);

      if (parent?.subcommands && parent.subcommands.length > 0) {
        const subMatch = parent.subcommands.find(
          (sub) => subSeed === '' ? true : sub.name.toLowerCase().startsWith(subSeed)
        );
        if (subMatch) {
          const line = `${parent.command} ${subMatch.name} `;
          return { line, cursor: line.length };
        }
      }
      return null;
    }

    const seed = trimmed.slice(1).toLowerCase();
    const match = slashCommands.find((cmd) =>
      cmd.command.slice(1).toLowerCase().includes(seed)
    );
    if (!match) {
      return null;
    }
    const line = `${match.command} `;
    return { line, cursor: line.length };
  }

  if (trimmed.startsWith('!')) {
    const suggestion = getPrimaryShellCommandSuggestion(trimmed, { cwd: workspaceRoot });
    if (!suggestion) {
      return null;
    }
    return { line: suggestion, cursor: suggestion.length };
  }

  return null;
}

export function getInlineGhostCompletionSuffix(
  currentLine: string,
  files: string[],
  slashCommands: SlashCommand[],
  workspaceRoot?: string,
  llmSuggestion?: string | null
): string | null {
  const trimmed = currentLine.trim();
  // Only show ghost completions for actionable prefixes: / (commands), @ (mentions), ! (shell)
  if (!trimmed.startsWith('/') && !trimmed.startsWith('@') && !trimmed.startsWith('!')) {
    return null;
  }

  const cleanLlmSuggestion = sanitizeRenderLine(llmSuggestion ?? '');
  if (
    cleanLlmSuggestion &&
    cleanLlmSuggestion.startsWith(currentLine) &&
    cleanLlmSuggestion !== currentLine
  ) {
    return cleanLlmSuggestion.slice(currentLine.length);
  }

  const suggestion = getPrimaryHotTipSuggestion(
    currentLine,
    files,
    slashCommands,
    undefined,
    workspaceRoot
  );
  if (!suggestion) {
    return null;
  }
  if (!suggestion.line.startsWith(currentLine)) {
    return null;
  }

  const suffix = suggestion.line.slice(currentLine.length);
  return suffix.length > 0 ? suffix : null;
}

export function buildContextualHelpPanelLines(
  currentLine: string,
  width: number,
  files: string[],
  slashCommands: SlashCommand[]
): string[] {
  const panelWidth = Math.max(20, width);
  const gap = 3;
  const leftWidth = Math.max(12, Math.floor((panelWidth - gap) / 2));
  const rightWidth = Math.max(12, panelWidth - leftWidth - gap);
  const tips = buildPromptHotTips(currentLine, files, slashCommands);
  const primaryTip = tips[0]?.label ?? 'Tab -> /help';
  const secondaryTip = tips[1]?.label ?? 'Type /, @, or ! to switch suggestion mode';

  const formatCell = (value: string, cellWidth: number): string => {
    const plain = sanitizeRenderLine(value);
    return truncatePlainText(plain, cellWidth).padEnd(cellWidth, ' ');
  };

  const rowLines = CONTEXTUAL_HELP_ROWS.map((row) => {
    const left = formatCell(row.left, leftWidth);
    const right = formatCell(row.right, rightWidth);
    return `${left}${' '.repeat(gap)}${right}`;
  });

  const lines = [
    ' ? shortcuts',
    ...rowLines,
    '',
    ` hot tip: ${primaryTip}`,
    ` tab applies suggestion: ${secondaryTip}`,
  ];

  return lines.map((line) =>
    chalk.bgHex('#2b2b2b').hex('#a8a8a8')(truncatePlainText(line, panelWidth).padEnd(panelWidth, ' '))
  );
}

export function buildContextualPromptStatusLine(
  currentLine: string,
  files: string[],
  slashCommands: SlashCommand[]
): string {
  const tips = buildPromptHotTips(currentLine, files, slashCommands);
  const primaryTip = tips[0]?.label ?? 'Tab -> /help';
  return `hot tip: ${primaryTip}`;
}

/**
 * Build styled lines for the slash command suggestion dropdown.
 *
 * When the user types `/` followed by optional characters, this returns a
 * compact list of matching commands with their descriptions — rendered
 * below the status line with a dark background, similar to IDE autocomplete.
 *
 * When a full command is matched and the user types a space (e.g. `/learn `),
 * the dropdown switches to showing that command's subcommands.
 *
 * Returns empty array when the input does not start with `/`.
 */
export function buildSlashSuggestionLines(
  currentLine: string,
  width: number,
  slashCommands: SlashCommand[]
): string[] {
  // Only trim leading whitespace — trailing space signals subcommand mode
  const input = currentLine.replace(/^\s+/, '');
  if (!input.startsWith('/')) {
    return [];
  }

  const panelWidth = Math.max(20, width);

  // Check if the user has typed a full command + space (subcommand mode)
  const subcommandResult = buildSubcommandSuggestions(input, panelWidth, slashCommands);
  if (subcommandResult !== null) {
    return subcommandResult;
  }

  // Top-level command matching
  const seed = input.slice(1).toLowerCase();
  const matches = slashCommands
    .filter((cmd) => cmd.command.slice(1).toLowerCase().includes(seed))
    .slice(0, HOT_TIP_LIMIT);

  if (matches.length === 0) {
    return [];
  }

  return formatSuggestionLines(
    matches.map((m) => ({ name: m.command, description: m.description ?? '' })),
    panelWidth
  );
}

/**
 * Check if input matches a known command + space, then show its subcommands.
 * Returns null if not in subcommand mode, empty array if in subcommand mode
 * but no matches.
 */
function buildSubcommandSuggestions(
  input: string,
  panelWidth: number,
  slashCommands: SlashCommand[]
): string[] | null {
  // Match pattern: /command <optional-subcommand-seed>
  const spaceIdx = input.indexOf(' ');
  if (spaceIdx === -1) {
    return null;
  }

  const cmdPart = input.slice(0, spaceIdx).toLowerCase();
  const subSeed = input.slice(spaceIdx + 1).toLowerCase().trim();

  // Find the parent command
  const parent = slashCommands.find(
    (cmd) => cmd.command.toLowerCase() === cmdPart
  );

  if (!parent) {
    return null;
  }

  // Command found but has no subcommands — signal "handled" with empty result
  if (!parent.subcommands || parent.subcommands.length === 0) {
    return [];
  }

  const matches = parent.subcommands
    .filter((sub) =>
      subSeed === '' ? true : sub.name.toLowerCase().startsWith(subSeed)
    )
    .slice(0, HOT_TIP_LIMIT);

  if (matches.length === 0) {
    return [];
  }

  return formatSuggestionLines(
    matches.map((m) => ({ name: `${parent.command} ${m.name}`, description: m.description })),
    panelWidth
  );
}

/**
 * Format suggestion entries into styled terminal lines.
 */
function formatSuggestionLines(
  entries: Array<{ name: string; description: string }>,
  panelWidth: number
): string[] {
  const maxNameLen = Math.min(
    24,
    Math.max(...entries.map((e) => e.name.length))
  );

  return entries.map((entry, i) => {
    const prefix = i === 0 ? ' ▸ ' : '   ';
    const namePadded = entry.name.padEnd(maxNameLen + 1);
    const content = `${prefix}${namePadded}${entry.description}`;
    return chalk.bgHex('#1e1e2e').hex('#cdd6f4')(
      truncatePlainText(content, panelWidth).padEnd(panelWidth, ' ')
    );
  });
}

const PASTED_REFERENCE_PATTERN = /\[Text pasted:\s*\d+\s+lines\]/;

export function removePastedReferenceFromLine(line: string): { line: string; cursor: number } | null {
  const match = PASTED_REFERENCE_PATTERN.exec(line);
  if (!match) {
    return null;
  }

  const start = match.index;
  const end = start + match[0].length;
  return {
    line: `${line.slice(0, start)}${line.slice(end)}`,
    cursor: start,
  };
}

export function isShiftTabShortcut(str: string, key: readline.Key | undefined): boolean {
  const sequence = key?.sequence ?? str;
  return (
    key?.name === 'backtab' ||
    (key?.name === 'tab' && key.shift === true) ||
    sequence === '\x1b[Z'
  );
}

export function isPlainTabShortcut(str: string, key: readline.Key | undefined): boolean {
  if (isShiftTabShortcut(str, key)) {
    return false;
  }
  return key?.name === 'tab' || key?.sequence === '\t' || str === '\t';
}

/**
 * Detect Shift+Enter or Alt+Enter across different terminal protocols.
 *
 * Standard terminals rely on Node's readline parser to set key.name='return'
 * with key.shift/key.meta.  Modern terminals using the kitty keyboard protocol
 * (CSI u) send ESC[13;Xu where X encodes modifiers – Node's readline does NOT
 * understand this format and would insert the raw bytes as garbage text.
 *
 * Modifier bits (CSI u): 2=Shift, 3=Alt, 4=Shift+Alt, 10=Shift+Alt+Ctrl
 */
export function isShiftEnterSequence(str: string, key: readline.Key | undefined): boolean {
  // Standard readline detection
  if (key?.name === 'return' && (key.shift || key.meta)) {
    return true;
  }
  const seq = key?.sequence ?? str ?? '';
  // CSI u protocol (kitty keyboard): ESC[13;Xu  (u terminator)
  // xterm modified key format:       ESC[13;X~  (~ terminator)
  // Modifier X: 2=Shift, 3=Alt, 4=Shift+Alt
  // Some terminals send bare ESC[13~ (no modifier) for Shift+Enter.
  if (/^\x1b\[13;?[234]?\d*[u~]$/.test(seq)) {
    return true;
  }
  // xterm modifyOtherKeys level 2: ESC[27;modifier;13~
  if (/^\x1b\[27;[234];13~$/.test(seq)) {
    return true;
  }
  // Alt+Enter: ESC followed by carriage return
  if (seq === '\x1b\r' || seq === '\x1b\n') {
    return true;
  }
  return false;
}

export function isShiftEnterResidualSequence(sequence: string | undefined): boolean {
  return SHIFT_ENTER_RESIDUAL_PATTERN.test(sequence ?? '');
}

export function countResidualModifiedEnterSequences(chunk: string): number {
  if (!chunk) {
    return 0;
  }

  const matches = chunk.match(/(?:13;?[234]?\d*[u~]|27;[234];13~)/g);
  if (!matches || matches.length === 0) {
    return 0;
  }

  return matches.join('') === chunk ? matches.length : 0;
}

export function countRawModifiedEnterSequences(chunk: string): number {
  if (!chunk) {
    return 0;
  }

  const matches = chunk.match(/\x1b(?:\[13;?[234]?\d*[u~]|\[27;[234];13~|\r|\n)/g);
  return matches?.length ?? 0;
}

export function shouldAutoHideShortcutHelp(str: string, key: readline.Key | undefined): boolean {
  if (isPlainTabShortcut(str, key) || isShiftTabShortcut(str, key)) {
    return false;
  }
  if (key?.ctrl || key?.meta) {
    return false;
  }
  if (key?.name === 'escape') {
    return false;
  }
  if (key?.name === 'up' || key?.name === 'down' || key?.name === 'left' || key?.name === 'right') {
    return false;
  }
  if (key?.name === 'backspace' || key?.name === 'delete') {
    return true;
  }
  if (!str) {
    return false;
  }
  return str !== '\r' && str !== '\n';
}

function sanitizeRenderLine(line: string): string {
  if (!line) return '';
  // Drop ANSI escape sequences and control bytes that can leak into rl.line.
  const withoutAnsi = line.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
  return withoutAnsi.replace(/[\x00-\x1F\x7F]/g, '');
}

/**
 * Calculate a safe prompt width that avoids terminal auto-wrap on full-width lines.
 */
export function getPromptBlockWidth(columns: number | undefined): number {
  const terminalWidth = Math.max(10, columns ?? 80);
  return Math.max(10, terminalWidth - 1);
}

/**
 * Render a single segment of input text with truncation/scrolling and styling.
 * Returns styled text ready for drawInputBox and a cursor column (without border offset).
 */
interface SegmentRender {
  styledText: string;
  cursorColumn: number;
}

function renderSegment(
  rawSegment: string,
  cursorPos: number,
  width: number,
  prefix: string,
  showPlaceholder: boolean,
  suggestionText?: string,
  inlineGhostSuffix?: string
): SegmentRender {
  const sanitizedLine = sanitizeRenderLine(rawSegment);
  const normalizedLine = sanitizedLine.trim().length === 0 ? '' : sanitizedLine;
  const innerWidth = Math.max(1, width - 2);
  const effectiveCursor = Math.max(0, Math.min(normalizedLine.length, cursorPos));
  const fullInput = `${prefix}${normalizedLine}`;
  const safeGhostSuffix = sanitizeRenderLine(inlineGhostSuffix ?? '');

  let visibleText = fullInput;
  let cursorColumn = prefix.length + effectiveCursor;
  const fullCursor = prefix.length + effectiveCursor;
  let ghostFragment = '';

  if (showPlaceholder && !normalizedLine) {
    const placeholder = `${prefix}${PROMPT_PLACEHOLDER}`;
    const displayPlaceholder = suggestionText
      ? `${prefix}${suggestionText}`
      : placeholder;
    visibleText = chalk.gray(displayPlaceholder);
    cursorColumn = prefix.length;
  } else if (!normalizedLine) {
    // Empty segment (continuation line or first line in multi-line)
    visibleText = prefix;
    cursorColumn = prefix.length;
  } else if (fullInput.length > innerWidth) {
    const ellipsis = '…';
    const nearStartThreshold = innerWidth - 1;
    const nearEndThreshold = innerWidth - 1;

    if (fullCursor <= nearStartThreshold) {
      const body = fullInput.slice(0, Math.max(1, innerWidth - 1));
      visibleText = `${body}${ellipsis}`;
      cursorColumn = fullCursor;
    } else if ((fullInput.length - fullCursor) <= nearEndThreshold) {
      const start = Math.max(0, fullInput.length - Math.max(1, innerWidth - 1));
      const body = fullInput.slice(start);
      visibleText = `${ellipsis}${body}`;
      cursorColumn = 1 + (fullCursor - start);
    } else {
      const windowSize = Math.max(1, innerWidth - 2);
      const half = Math.floor(windowSize / 2);
      const minStart = 1;
      const maxStart = Math.max(minStart, fullInput.length - windowSize - 1);
      const start = Math.max(minStart, Math.min(maxStart, fullCursor - half));
      const body = fullInput.slice(start, start + windowSize);
      visibleText = `${ellipsis}${body}${ellipsis}`;
      cursorColumn = 1 + (fullCursor - start);
    }
  }

  let styledText = visibleText;
  if (showPlaceholder && !normalizedLine) {
    styledText = themedFg('muted', visibleText, (value) => chalk.gray(value));
  } else if (visibleText.startsWith(prefix)) {
    const prefixStyled = themedFg('accent', prefix, (value) => chalk.gray(value));
    styledText = `${prefixStyled}${visibleText.slice(prefix.length)}`;
  } else if (visibleText.startsWith(`…${prefix}`)) {
    const prefixStyled = themedFg('accent', prefix, (value) => chalk.gray(value));
    styledText = `…${prefixStyled}${visibleText.slice((`…${prefix}`).length)}`;
  }

  if (
    normalizedLine &&
    safeGhostSuffix &&
    fullInput.length <= innerWidth &&
    effectiveCursor === normalizedLine.length
  ) {
    const availableGhostWidth = Math.max(0, innerWidth - fullInput.length);
    if (availableGhostWidth > 0) {
      ghostFragment = safeGhostSuffix.slice(0, availableGhostWidth);
    }
  }

  if (ghostFragment) {
    styledText += themedFg('muted', ghostFragment, (value) => chalk.gray(value));
  }

  return { styledText, cursorColumn };
}

/**
 * Build the visible prompt row and the corresponding cursor column.
 * Returns a boxed line (full terminal width) and a zero-based cursor column.
 *
 * @param currentLine - Raw readline buffer content.
 * @param cursorPos - Current readline cursor offset within the line.
 * @param width - Terminal column width for the prompt block.
 * @param suggestionText - Ghost text shown as placeholder when input is empty.
 */
export function buildPromptRenderState(
  currentLine: string,
  cursorPos: number,
  width: number,
  suggestionText?: string,
  inlineGhostSuffix?: string
): PromptRenderState {
  const segment = renderSegment(
    currentLine,
    cursorPos,
    width,
    PROMPT_INPUT_PREFIX,
    true,
    suggestionText,
    inlineGhostSuffix
  );
  const lineText = drawInputBox(segment.styledText, width);
  // +1 accounts for the left │ border character in drawInputBox
  const clampedCursor = Math.max(0, Math.min(width - 1, segment.cursorColumn + 1));
  return { lineText, cursorColumn: clampedCursor };
}

/**
 * Build multi-line render state for the composer.
 * Splits input by newlines (literal and legacy NEWLINE_MARKER), then builds boxed rows.
 */
export function buildMultiLineRenderState(
  currentLine: string,
  cursorPos: number,
  width: number,
  borderStyle: InputBorderStyle = 'default',
  suggestionText?: string,
  inlineGhostSuffix?: string
): MultiLineRenderState {
  const { segments, separatorLengths } = splitMultilineSegments(currentLine);
  const innerWidth = Math.max(1, width - 2);
  const continuationPrefix = '  ';
  const contentWidth = Math.max(1, innerWidth - continuationPrefix.length);

  if (segments.length <= 1) {
    const singleSegment = sanitizeRenderLine(segments[0] ?? '');
    const singleLayout = calculateLayout([singleSegment], contentWidth);
    if (singleLayout.visualLines.length <= 1) {
      const seg = renderSegment(
        currentLine,
        cursorPos,
        width,
        PROMPT_INPUT_PREFIX,
        true,
        suggestionText,
        inlineGhostSuffix
      );
      const lineText = drawInputBox(seg.styledText, width, undefined, borderStyle);
      const clampedCursor = Math.max(0, Math.min(width - 1, seg.cursorColumn + 1));
      return { lines: [lineText], cursorRow: 0, cursorColumn: clampedCursor, lineCount: 1 };
    }
  }

  if (currentLine.length === 0) {
    const seg = renderSegment(
      currentLine,
      cursorPos,
      width,
      PROMPT_INPUT_PREFIX,
      true,
      suggestionText,
      inlineGhostSuffix
    );
    const lineText = drawInputBox(seg.styledText, width, undefined, borderStyle);
    const clampedCursor = Math.max(0, Math.min(width - 1, seg.cursorColumn + 1));
    return { lines: [lineText], cursorRow: 0, cursorColumn: clampedCursor, lineCount: 1 };
  }

  // Find which segment the flat cursor falls in
  let cursorRow = 0;
  let cursorInSegment = 0;
  let pos = 0;
  for (let i = 0; i < segments.length; i++) {
    const segEnd = pos + segments[i].length;
    if (cursorPos <= segEnd || i === segments.length - 1) {
      cursorRow = i;
      cursorInSegment = Math.max(0, cursorPos - pos);
      break;
    }
    pos = segEnd + (separatorLengths[i] ?? 0);
  }

  const lines: string[] = [];
  let visualRowOffset = 0;
  let overallVisualRow = 0;
  let hasPromptPrefix = false;
  let finalCursorColumn = 0;

  for (let i = 0; i < segments.length; i++) {
    const sanitizedSegment = sanitizeRenderLine(segments[i] ?? '');
    const layout = calculateLayout([sanitizedSegment], contentWidth);
    const wrappedLines = layout.visualLines.length > 0 ? layout.visualLines : [''];

    if (i === cursorRow) {
      const [wrappedCursorRow, wrappedCursorCol] = logicalToVisual(
        layout,
        0,
        Math.max(0, Math.min(sanitizedSegment.length, cursorInSegment))
      );
      cursorRow = visualRowOffset + wrappedCursorRow;
      finalCursorColumn = Math.max(
        0,
        Math.min(width - 1, continuationPrefix.length + wrappedCursorCol + 1)
      );
    }

    for (let j = 0; j < wrappedLines.length; j++) {
      const prefix = !hasPromptPrefix ? PROMPT_INPUT_PREFIX : continuationPrefix;
      const prefixStyled = themedFg('accent', prefix, (value) => chalk.gray(value));
      const styledText = `${prefixStyled}${wrappedLines[j] ?? ''}`;
      lines.push(drawInputBox(styledText, width, undefined, borderStyle));
      hasPromptPrefix = true;
      overallVisualRow += 1;
    }

    visualRowOffset += wrappedLines.length;
  }

  return {
    lines,
    cursorRow,
    cursorColumn: finalCursorColumn,
    lineCount: overallVisualRow,
  };
}

interface MultilineSegments {
  segments: string[];
  separatorLengths: number[];
}

function splitMultilineSegments(value: string): MultilineSegments {
  const segments: string[] = [];
  const separatorLengths: number[] = [];

  let segmentStart = 0;
  let i = 0;
  while (i < value.length) {
    if (value.startsWith(NEWLINE_MARKER, i)) {
      segments.push(value.slice(segmentStart, i));
      separatorLengths.push(NEWLINE_MARKER.length);
      i += NEWLINE_MARKER.length;
      segmentStart = i;
      continue;
    }

    const ch = value[i];
    if (ch === '\n') {
      segments.push(value.slice(segmentStart, i));
      separatorLengths.push(1);
      i += 1;
      segmentStart = i;
      continue;
    }
    if (ch === '\r') {
      const separatorLength = value[i + 1] === '\n' ? 2 : 1;
      segments.push(value.slice(segmentStart, i));
      separatorLengths.push(separatorLength);
      i += separatorLength;
      segmentStart = i;
      continue;
    }
    i += 1;
  }

  segments.push(value.slice(segmentStart));
  return { segments, separatorLengths };
}

export function formatPromptStatusRow(
  statusLine: string | { left: string; right: string } | undefined,
  width: number
): string {
  let left: string;
  let right: string | undefined;
  if (typeof statusLine === 'object' && statusLine !== null) {
    left = statusLine.left ?? '';
    right = statusLine.right || undefined;
  } else {
    left = statusLine ?? ' ';
  }

  const plainLeft = stripAnsiCodes(left);
  let plainRight = right ? stripAnsiCodes(right) : '';

  // Truncate right part if it alone exceeds width — prevents terminal wrapping
  // which breaks cursor positioning (moveUp assumes exactly 1 status row).
  if (plainRight.length > width) {
    plainRight = truncatePlainText(plainRight, width);
  }

  const minGap = plainRight ? 2 : 0;
  const availableForLeft = Math.max(0, width - plainRight.length - minGap);
  const clippedLeft = truncatePlainText(plainLeft, availableForLeft);
  const gap = Math.max(0, width - clippedLeft.length - plainRight.length);
  const row = `${clippedLeft}${' '.repeat(gap)}${plainRight}`;
  return themedFg('muted', row.padEnd(width), (value) => chalk.gray(value));
}

/**
 * Callback for when an image is detected in input
 * @param data - Image data as Buffer
 * @param mimeType - Image MIME type
 * @param filename - Optional original filename
 * @returns Image ID from ImageManager
 */
type ImageDetectedCallback = (
  data: Buffer,
  mimeType: ImageMimeType,
  filename?: string
) => number;

interface PromptIO {
  input?: NodeJS.ReadStream;
  output?: NodeJS.WriteStream;
}

type PromptResult =
  | { kind: 'submit'; value: string }
  | { kind: 'abort' };

/**
 * State for tracking bracketed paste operations
 */
interface PasteState {
  /** Currently receiving paste */
  isInPaste: boolean;
  /** Accumulated paste content */
  buffer: string;
  /** Whether readline echo was suppressed for this paste */
  outputSuppressed: boolean;
  /** Hidden actual content when indicator shown */
  hiddenContent?: string;
  /** Content that was in the line before paste started (prefix to preserve) */
  prefixContent?: string;
  /** Timeout handle for incomplete pastes */
  timeout?: NodeJS.Timeout;
}

/**
 * Create initial paste state
 */
function createPasteState(): PasteState {
  return {
    isInPaste: false,
    buffer: '',
    outputSuppressed: false
  };
}

type ReadlineOutputWriter = readline.Interface & { _writeToOutput?: (chunk: string) => void };

export interface ReadlineOutputGuard {
  setSuppressed: (suppressed: boolean) => void;
  restore: () => void;
}

export function installReadlineOutputGuard(rl: readline.Interface): ReadlineOutputGuard {
  const rlWriter = rl as ReadlineOutputWriter;
  const originalWriteToOutput = typeof rlWriter._writeToOutput === 'function'
    ? rlWriter._writeToOutput.bind(rlWriter)
    : undefined;

  if (!originalWriteToOutput) {
    return {
      setSuppressed: () => { },
      restore: () => { },
    };
  }

  let suppressed = false;
  rlWriter._writeToOutput = (chunk: string) => {
    if (!suppressed) {
      originalWriteToOutput(chunk);
    }
  };

  return {
    setSuppressed: (nextSuppressed: boolean) => {
      suppressed = nextSuppressed;
    },
    restore: () => {
      rlWriter._writeToOutput = originalWriteToOutput;
    },
  };
}

interface ProcessImagesOptions {
  /** Whether to print detection notices to terminal output */
  announce?: boolean;
  /** Output stream used for notices when announce=true */
  output?: NodeJS.WriteStream;
}

const IMAGE_FILE_EXTENSIONS = '(?:png|jpg|jpeg|gif|webp)';
const IMAGE_FILE_SUFFIX_REGEX = new RegExp(`\\.${IMAGE_FILE_EXTENSIONS}$`, 'i');
const ASCII_WHITESPACE = '[ \\t\\r\\n]';

function createEscapedImagePathRegex(flags: string): RegExp {
  return new RegExp(
    `(?:^|${ASCII_WHITESPACE})((\\/|~)(?:[^ \\t\\r\\n\\\\]|\\\\.)+\\.${IMAGE_FILE_EXTENSIONS})(?=${ASCII_WHITESPACE}|$)`,
    flags
  );
}

function createSimpleImagePathRegex(flags: string): RegExp {
  return new RegExp(
    `(?:^|${ASCII_WHITESPACE})([^ \\t\\r\\n"']+\\.${IMAGE_FILE_EXTENSIONS})(?=${ASCII_WHITESPACE}|$)`,
    flags
  );
}

function hasPotentialImagePath(text: string): boolean {
  return createEscapedImagePathRegex('i').test(text) || createSimpleImagePathRegex('i').test(text);
}

function writeImageNotice(
  output: NodeJS.WriteStream | undefined,
  message: string,
  announce: boolean
): void {
  if (!announce || !output) {
    return;
  }
  output.write(chalk.cyan(`\n${message}\n`));
}

function normalizeDragPathCandidates(rawPath: string): string[] {
  const trimmed = rawPath.trim();
  if (!trimmed) return [];

  const unquoted = trimmed
    .replace(/^"(.*)"$/s, '$1')
    .replace(/^'(.*)'$/s, '$1');

  const unescaped = unquoted
    // Shell-escaped path fragments from drag-and-drop (e.g. "\ ").
    .replace(/\\([ \t\r\n\u00a0\u202f])/g, '$1')
    // Conservative generic unescape for common escaped path chars.
    .replace(/\\([\\'"()])/g, '$1');
  const broadlyUnescaped = unquoted.replace(/\\(.)/g, '$1');

  const withHomeExpanded = (value: string): string => {
    if (value.startsWith('~/')) {
      return `${os.homedir()}/${value.slice(2)}`;
    }
    return value;
  };

  const candidates = new Set<string>();
  const push = (value: string) => {
    if (!value) return;
    candidates.add(value);
    candidates.add(withHomeExpanded(value));
    // macOS screenshot names can include narrow no-break spaces.
    // Try normalized variants because terminal/client may transform them.
    candidates.add(value.replace(/\u202f/g, ' '));
    candidates.add(withHomeExpanded(value.replace(/\u202f/g, ' ')));
    candidates.add(value.replace(/\u00a0/g, ' '));
    candidates.add(withHomeExpanded(value.replace(/\u00a0/g, ' ')));
    // Reverse: terminal may normalize U+202F to regular space during drag.
    // macOS Sequoia+ uses U+202F before AM/PM in screenshot filenames.
    const withNNBSP = value.replace(/ (?=(?:AM|PM)\.)/gi, '\u202f');
    if (withNNBSP !== value) {
      candidates.add(withNNBSP);
      candidates.add(withHomeExpanded(withNNBSP));
    }
  };

  push(unquoted);
  push(unescaped);
  push(broadlyUnescaped);
  return Array.from(candidates).filter(Boolean);
}

/**
 * Process text and replace embedded image references with [Image #N] placeholders.
 * Supports base64 image data URLs and filesystem image paths (quoted, escaped, or plain).
 */
export function processImagesInText(
  text: string,
  onImageDetected?: ImageDetectedCallback,
  options: ProcessImagesOptions = {}
): string {
  if (!onImageDetected) {
    return text;
  }

  const announce = options.announce ?? true;
  const output = options.output;
  let result = text;

  const replaceImagePath = (rawMatch: string): boolean => {
    const candidates = normalizeDragPathCandidates(rawMatch);
    for (const candidatePath of candidates) {
      if (!existsSync(candidatePath)) continue;

      try {
        const data = readFileSync(candidatePath);
        const ext = extname(candidatePath);
        const mimeType = getMimeTypeFromExtension(ext);
        if (!mimeType) continue;

        const id = onImageDetected(data, mimeType, basename(candidatePath));
        result = result.replace(rawMatch, `[Image #${id}]`);
        writeImageNotice(output, `📷 Loaded image: ${candidatePath} -> [Image #${id}]`, announce);
        return true;
      } catch {
        // Ignore file read errors and try next candidate
      }
    }
    return false;
  };

  // Detect base64 image data URLs: data:image/...;base64,...
  const base64Regex = /data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g;
  const base64Matches = result.match(base64Regex) || [];

  for (const dataUrl of base64Matches) {
    const parsed = parseBase64DataUrl(dataUrl);
    if (!parsed) continue;

    const id = onImageDetected(parsed.data, parsed.mimeType);
    result = result.replace(dataUrl, `[Image #${id}]`);
    writeImageNotice(output, `📷 Detected base64 image -> [Image #${id}]`, announce);
  }

  // Detect image file paths (with supported extensions)
  // Handles:
  // 1. Paths with escaped spaces: /path/to/file\ name.png
  // 2. Quoted paths: "/path/to/file name.png" or '/path/to/file name.png'
  // 3. Simple paths without spaces: /path/to/file.png

  // First, try to find quoted paths
  const quotedPathRegex = new RegExp(`["']([^"']+\\.${IMAGE_FILE_EXTENSIONS})["']`, 'gi');
  let quotedMatch;
  while ((quotedMatch = quotedPathRegex.exec(text)) !== null) {
    const fullMatch = quotedMatch[0];
    if (!result.includes(fullMatch)) continue;
    replaceImagePath(quotedMatch[1]) || replaceImagePath(fullMatch);
  }

  // Then, find paths with escaped spaces or regular paths.
  // On macOS terminal, dragged files have spaces escaped as "\ ".
  const escapedPathRegex = createEscapedImagePathRegex('gi');
  let escapedMatch;

  // Debug: log input for image detection
  if (process.env.DEBUG_IMAGES && output) {
    output.write(chalk.gray(`\n[DEBUG] processImagesInText called\n`));
    output.write(chalk.gray(`[DEBUG] Input text: ${JSON.stringify(text)}\n`));
    output.write(chalk.gray(`[DEBUG] Has backslash: ${text.includes('\\')}\n`));
    output.write(chalk.gray(`[DEBUG] Char codes: ${text.slice(0, 50).split('').map(c => c.charCodeAt(0)).join(',')}\n`));
  }

  while ((escapedMatch = escapedPathRegex.exec(text)) !== null) {
    const rawPath = escapedMatch[1];

    if (process.env.DEBUG_IMAGES && output) {
      output.write(chalk.gray(`[DEBUG] Regex matched: ${JSON.stringify(rawPath)}\n`));
      const candidates = normalizeDragPathCandidates(rawPath);
      output.write(chalk.gray(`[DEBUG] Candidate paths: ${JSON.stringify(candidates)}\n`));
    }

    if (!result.includes(rawPath)) continue;
    replaceImagePath(rawPath);
  }

  // Finally, simple paths without spaces (fallback)
  const simplePathRegex = createSimpleImagePathRegex('gi');
  let simpleMatch;
  while ((simpleMatch = simplePathRegex.exec(text)) !== null) {
    const filePath = simpleMatch[1];
    // Skip if already processed by a previous regex pass
    if (!result.includes(filePath)) {
      continue;
    }
    replaceImagePath(filePath);
  }

  // Final fallback: treat the entire input as a single dragged path token.
  if (!result.includes('[Image #')) {
    const trimmed = result.trim();
    if (IMAGE_FILE_SUFFIX_REGEX.test(trimmed)) {
      replaceImagePath(trimmed);
    }
  }

  return result;
}

// Visual marker for newlines in single-line input (converted to \n on submit)
export const NEWLINE_MARKER = ' ↵ ';
const NEWLINE_MARKER_REGEX = new RegExp(escapeRegex(NEWLINE_MARKER), 'g');

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Track stdin streams that have been instrumented with emitKeypressEvents
// to prevent duplicate listener registration
const instrumentedStreams = new WeakSet<NodeJS.ReadStream>();

/**
 * Safely instrument a stream with readline.emitKeypressEvents
 * Only does so once per stream to prevent duplicate listeners
 */
export function safeEmitKeypressEvents(stream: NodeJS.ReadStream): void {
  if (!instrumentedStreams.has(stream)) {
    readline.emitKeypressEvents(stream);
    instrumentedStreams.add(stream);
  }
}

/**
 * Convert newline markers back to actual newlines
 */
export function convertNewlineMarkersToNewlines(text: string): string {
  return text
    .replace(NEWLINE_MARKER_REGEX, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

export async function readInstruction(
  filesProvider: () => string[],
  slashCommands: SlashCommand[],
  statusLine?: string | { left: string; right: string },
  io: PromptIO = {},
  onImageDetected?: ImageDetectedCallback,
  workspaceRoot?: string,
  initialValue = '',
  suggestionText?: string,
  resolveShellSuggestion?: (input: string) => Promise<string | null>
): Promise<string | null> {
  const stdInput = (io.input ?? process.stdin) as NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void };
  const stdOutput = (io.output ?? process.stdout) as NodeJS.WriteStream;

  // Keep the process alive during UI handoffs (readline <-> Ink)
  const keepAlive = setInterval(() => {}, 10_000);

  try {
    while (true) {
      // Wait for event loop to process any pending cleanup operations
      // This ensures previous readline is fully closed before creating new one
      await new Promise(resolve => process.nextTick(resolve));

      const result = await promptOnce({
        filesProvider,
        slashCommands,
        statusLine,
        initialValue,
        stdInput,
        stdOutput,
        onImageDetected,
        workspaceRoot,
        suggestionText,
        resolveShellSuggestion
      });

      if (result.kind === 'abort') {
        return 'ABORT';
      }

      return result.value;
    }
  } finally {
    clearInterval(keepAlive);
  }
}

interface PromptOnceOptions {
  filesProvider: () => string[];
  slashCommands: SlashCommand[];
  statusLine?: string | { left: string; right: string };
  initialValue?: string;
  stdInput: NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void };
  stdOutput: NodeJS.WriteStream;
  onImageDetected?: ImageDetectedCallback;
  workspaceRoot?: string;
  suggestionText?: string;
  resolveShellSuggestion?: (input: string) => Promise<string | null>;
}

/**
 * Drain any pending data from stdin that accumulated while the prompt was
 * inactive (e.g., user pasted text while the agent was processing).
 * Without this, buffered raw text floods the new readline and each newline
 * triggers a separate submission.
 */
function drainStdin(input: NodeJS.ReadStream): void {
  // Read and discard all available data without blocking.
  // `read()` returns null when no data is available.
  let chunk: Buffer | string | null;
  do {
    chunk = input.read();
  } while (chunk !== null);
}

function createReadline(
  stdInput: NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void },
  stdOutput: NodeJS.WriteStream
): { rl: readline.Interface; input: NodeJS.ReadStream; supportsRawMode: boolean } {
  // Move cursor to column 0 of the current row. The caller is responsible for
  // ensuring the cursor is already on a fresh blank line before calling
  // createReadline (e.g., by writing '\n' after all agent/spinner output).
  // This '\r' is a defensive reset; it does NOT advance to a new row.
  stdOutput.write('\r');

  // Ensure stdin keypress events are set up (only once per stream)
  safeEmitKeypressEvents(stdInput);

  // Drain any data that was buffered while the prompt was inactive.
  // When the user pastes during agent processing, bracketed paste is disabled,
  // so the text arrives as raw lines without paste delimiters. Without draining,
  // each newline would trigger a separate submission.
  try {
    stdInput.resume();
    drainStdin(stdInput);
  } catch {
    // Ignore errors during drain
  }

  // Enable bracketed paste mode for paste detection
  enableBracketedPaste(stdOutput);

  // Always ensure stdin is in a known state before creating readline
  // This fixes issues with Bun where isPaused() may not return correct state
  try {
    stdInput.resume();
  } catch {
    // Ignore if already resumed
  }

  let rl: readline.Interface;
  try {
    rl = readline.createInterface({
      input: stdInput,
      output: stdOutput,
      prompt: PROMPT_PREFIX,
      terminal: true,
      crlfDelay: Infinity,
      historySize: 100,
      tabSize: 2
    });
  } catch {
    // readline.createInterface calls setRawMode internally when terminal: true.
    // If the TTY is dead (errno 5 = EIO), fall back to non-terminal mode.
    rl = readline.createInterface({
      input: stdInput,
      output: stdOutput,
      prompt: PROMPT_PREFIX,
      terminal: false,
      crlfDelay: Infinity,
      historySize: 100,
      tabSize: 2
    });
  }

  disableReadlineTabBehavior(rl);

  const input = (rl as readline.Interface & { input: NodeJS.ReadStream }).input;
  const supportsRawMode = typeof input.setRawMode === 'function';

  if (supportsRawMode && input.isTTY) {
    safeSetRawMode(input, true);
  }
  input.resume();
  input.setEncoding('utf8');

  return { rl, input, supportsRawMode };
}

/**
 * Clear the prompt and status lines, then move the cursor below that region.
 * Assumes the cursor currently sits on the prompt line.
 */
export function leavePromptSurface(
  output: NodeJS.WriteStream,
  statusLineCount = STATUS_LINE_COUNT,
  fromLineEvent = false
): void {
  const numContentLines = lastRenderedContentLines;
  const cursorRow = lastRenderedCursorRow;

  // Enter submissions can leave the cursor one line below the input row.
  // With a boxed prompt, readline can advance into the rows below input.
  // Normalize back to the input line before clearing the full prompt block.
  if (fromLineEvent) {
    const normalizationRows = PROMPT_LINES_BELOW_INPUT;
    for (let i = 0; i < normalizationRows; i++) {
      readline.moveCursor(output, 0, -1);
    }
  }

  // Cursor is on content row `cursorRow`. Clear it.
  readline.cursorTo(output, 0);
  readline.clearLine(output, 0);

  // Clear content lines above cursor and top border
  for (let i = 0; i < cursorRow + PROMPT_LINES_ABOVE_INPUT; i++) {
    readline.moveCursor(output, 0, -1);
    readline.clearLine(output, 0);
  }

  // Return to cursor's content row
  for (let i = 0; i < cursorRow + PROMPT_LINES_ABOVE_INPUT; i++) {
    readline.moveCursor(output, 0, 1);
  }

  // Clear content lines below cursor, bottom border, help panel, and status
  const belowCount = (numContentLines - 1 - cursorRow) + PROMPT_LINES_BELOW_INPUT + lastRenderedHelpLines + statusLineCount;
  for (let i = 0; i < belowCount; i++) {
    readline.moveCursor(output, 0, 1);
    readline.clearLine(output, 0);
  }

  // Move cursor back to the top of the cleared prompt surface so
  // subsequent output fills the area instead of leaving blank lines.
  const upToTop = PROMPT_LINES_ABOVE_INPUT + cursorRow + belowCount;
  readline.moveCursor(output, 0, -upToTop);
  readline.cursorTo(output, 0);
}

/**
 * Handle paste completion - apply display logic based on line count
 */
function handlePasteComplete(
  pasteState: PasteState,
  rl: readline.Interface,
  output: NodeJS.WriteStream,
  renderActivePrompt: () => void
): void {
  const display = getContentDisplay(pasteState.buffer);
  const rlAny = rl as readline.Interface & { line: string; cursor: number };

  // Get any prefix content that was typed before the paste
  const prefix = pasteState.prefixContent || '';

  // If readline echoed pasted rows (timeout fallback path where output was
  // not suppressed), clear those transient lines. On the normal bracketed-
  // paste path outputSuppressed is true so the box was never disturbed.
  if (!pasteState.outputSuppressed) {
    const newlineCount = (pasteState.buffer.match(/\n/g) || []).length;
    for (let i = 0; i < newlineCount; i++) {
      readline.moveCursor(output, 0, -1);
      readline.clearLine(output, 0);
    }
    readline.cursorTo(output, 0);
    readline.clearLine(output, 0);
  }

  if (display.isPasted) {
    // Large paste: show indicator, store actual content
    pasteState.hiddenContent = prefix + display.actual;
    rlAny.line = prefix + display.visual;
    rlAny.cursor = rlAny.line.length;
  } else {
    // Small paste: insert normally with prefix
    rlAny.line = prefix + display.actual;
    rlAny.cursor = rlAny.line.length;
  }

  // Use the boxed renderer — NOT rl.prompt(true) — so the composer stays
  // anchored at the bottom and the 3-row layout is preserved.
  renderActivePrompt();

  // Clear the buffer and prefix
  pasteState.buffer = '';
  pasteState.outputSuppressed = false;
  pasteState.prefixContent = undefined;
}

async function promptOnce(options: PromptOnceOptions): Promise<PromptResult> {
  const {
    filesProvider,
    slashCommands,
    statusLine,
    initialValue,
    stdInput,
    stdOutput,
    onImageDetected,
    workspaceRoot,
    suggestionText,
    resolveShellSuggestion,
  } = options;

  // Reset module-level render state so stale values from the previous
  // promptOnce() invocation don't cause the clearing logic to miscalculate
  // row positions — which manifests as ghost/duplicate prompt boxes.
  resetPromptRenderState();

  const { rl, input, supportsRawMode } = createReadline(stdInput, stdOutput);

  // Create TextBuffer as the source of truth for input content.
  // Width is inner content width: prompt block width minus 2 for │ borders.
  const tbWidth = Math.max(1, getPromptBlockWidth(stdOutput.columns) - 2);
  const tbMaxVisibleLines = 10;
  const initialLine = sanitizeRenderLine(initialValue ?? '');
  const textBuffer = new TextBuffer(tbWidth, tbMaxVisibleLines, initialLine || undefined);
  activeTextBuffer = textBuffer;

  const mentionPreview = new MentionPreview(rl, filesProvider, slashCommands, stdOutput);

  // Initialize paste state for bracketed paste detection
  const pasteState = createPasteState();
  let contextualHelpVisible = false;
  let llmInlineShellSuggestion: string | null = null;

  const applyPlanModePrefix = (line: string): string => {
    const planPrefix = getPlanModeManager().isEnabled() ? 'plan:on' : 'plan:off';
    if (!line) {
      return planPrefix;
    }
    if (line.startsWith('plan:on · ') || line.startsWith('plan:off · ')) {
      const separatorIndex = line.indexOf(' · ');
      return `${planPrefix}${line.slice(separatorIndex)}`;
    }
    return `${planPrefix} · ${line}`;
  };

  const getActiveStatusLine = (): string | { left: string; right: string } | undefined => {
    if (typeof statusLine === 'object' && statusLine !== null) {
      return statusLine;
    }
    return applyPlanModePrefix(statusLine ?? '');
  };

  /** Helper to read current text from TextBuffer (the source of truth). */
  const getCurrentText = (): string => textBuffer.getText();

  /**
   * Sync readline's internal buffer from TextBuffer so that code that reads
   * rl.line (suggestions, ghost text, mention preview, etc.) sees the correct value.
   * We flatten newlines to spaces for readline's single-line model.
   */
  const syncReadlineFromBuffer = (): void => {
    const rlAny = rl as readline.Interface & { line: string; cursor: number };
    const text = textBuffer.getText();
    // Keep NEWLINE_MARKER representation so existing suggestion/ghost logic works
    // (they check for NEWLINE_MARKER to disable ghost text on multi-line)
    const flat = text.replace(/\n/g, NEWLINE_MARKER);
    rlAny.line = flat;
    rlAny.cursor = flat.length;
  };

  const getInlineGhostSuffix = (): string | undefined => {
    if (contextualHelpVisible) {
      return undefined;
    }
    const currentText = getCurrentText();
    if (!currentText || currentText.includes('\n') || currentText.includes(NEWLINE_MARKER)) {
      return undefined;
    }
    return getInlineGhostCompletionSuffix(
      currentText,
      filesProvider(),
      slashCommands,
      workspaceRoot,
      llmInlineShellSuggestion
    ) ?? undefined;
  };

  const getHelpPanelLines = (): string[] | undefined => {
    if (!contextualHelpVisible) {
      return undefined;
    }
    const width = getPromptBlockWidth(stdOutput.columns);
    return buildContextualHelpPanelLines(getCurrentText(), width, filesProvider(), slashCommands);
  };

  const getSlashSuggestionLines = (): string[] | undefined => {
    // Don't show slash suggestions when contextual help panel is visible
    if (contextualHelpVisible) {
      return undefined;
    }
    const width = getPromptBlockWidth(stdOutput.columns);
    const lines = buildSlashSuggestionLines(getCurrentText(), width, slashCommands);
    return lines.length > 0 ? lines : undefined;
  };

  const renderPromptSurface = (isResize = false, hasExistingPromptBlock = true): void => {
    renderPromptLine(
      rl,
      getActiveStatusLine(),
      stdOutput,
      isResize,
      hasExistingPromptBlock,
      suggestionText,
      getInlineGhostSuffix(),
      getHelpPanelLines(),
      getSlashSuggestionLines()
    );
  };

  const resizeWatcher = new TerminalResizeWatcher(stdOutput, () => {
    const newWidth = Math.max(1, getPromptBlockWidth(stdOutput.columns) - 2);
    textBuffer.setViewport(newWidth, tbMaxVisibleLines);
    renderPromptSurface(true, true);
    mentionPreview.handleResize();
  });

  // Render initial prompt with status line (was missing - caused status to only show on typing)
  // Sync readline from buffer before initial render so rl.line reflects initial value.
  syncReadlineFromBuffer();
  renderPromptSurface(false, false);

  if (initialLine.length > 0) {
    renderPromptSurface(false, true);
  }

  return new Promise<PromptResult>((resolve) => {
    let ctrlCCount = 0;
    let closed = false;
    let suppressResidualShiftEnterCharsUntil = 0;
    let inlineImageScanTimeout: NodeJS.Timeout | undefined;
    let inlineImageRetryCount = 0;
    const MAX_INLINE_IMAGE_RETRIES = 12;
    let shellSuggestionRequestId = 0;
    let inlineShellSuggestionTimeout: NodeJS.Timeout | undefined;
    let inlineShellSuggestionRequestId = 0;
    const rlInternal = rl as readline.Interface & { _refreshLine?: () => void; _moveCursor?: () => void };
    const originalRefreshLine = typeof rlInternal._refreshLine === 'function'
      ? rlInternal._refreshLine.bind(rlInternal)
      : undefined;
    const originalMoveCursor = typeof rlInternal._moveCursor === 'function'
      ? rlInternal._moveCursor.bind(rlInternal)
      : undefined;
    const outputGuard = installReadlineOutputGuard(rl);

    const setContextualHelpVisible = (visible: boolean) => {
      if (contextualHelpVisible === visible) {
        return;
      }
      contextualHelpVisible = visible;
      mentionPreview.setSuspended(visible);
      if (visible) {
        mentionPreview.reset();
      }
      if (!closed) {
        renderPromptSurface(false, true);
      }
    };

    function renderActivePrompt(): void {
      renderPromptSurface(false, true);
    }

    // Coalesce renders: both _refreshLine and keypress handlers trigger renders,
    // but we only need one per event-loop tick.
    let renderScheduled = false;
    function scheduleRender(): void {
      if (renderScheduled) return;
      renderScheduled = true;
      setImmediate(() => {
        renderScheduled = false;
        if (!closed && !pasteState.isInPaste) {
          renderActivePrompt();
        }
      });
    }

    const cleanup = () => {
      if (closed) return;
      closed = true;
      // Release module-level TextBuffer reference
      activeTextBuffer = null;
      // Clear paste timeout if any
      if (pasteState.timeout) {
        clearTimeout(pasteState.timeout);
        pasteState.timeout = undefined;
      }
      if (inlineImageScanTimeout) {
        clearTimeout(inlineImageScanTimeout);
        inlineImageScanTimeout = undefined;
      }
      if (inlineShellSuggestionTimeout) {
        clearTimeout(inlineShellSuggestionTimeout);
        inlineShellSuggestionTimeout = undefined;
      }
      // Disable bracketed paste mode and ensure cursor is visible
      disableBracketedPaste(stdOutput);
      stdOutput.write('\x1b[?25h');
      if (contextualHelpVisible) {
        contextualHelpVisible = false;
      }
      mentionPreview.dispose();
      resizeWatcher.dispose();
      promptEvents.off('notify', onPromptNotify);
      promptEvents.off('interrupt', onPromptInterrupt);
      input.off('keypress', handleKeypress);
      input.off('data', handleInputData);
      if (originalRefreshLine) {
        rlInternal._refreshLine = originalRefreshLine;
      }
      if (originalMoveCursor) {
        rlInternal._moveCursor = originalMoveCursor;
      }
      outputGuard.restore();
      if (supportsRawMode && input.isTTY) {
        safeSetRawMode(input, false);
      }
      input.pause();
      rl.close();
    };

    const showPromptMessage = (message: string) => {
      mentionPreview.reset();
      if (contextualHelpVisible) {
        setContextualHelpVisible(false);
      }
      leavePromptSurface(stdOutput);
      stdOutput.write(`${message.replace(/\n+$/g, '')}\n`);
      renderPromptSurface(false, false);
    };

    // Subscribe to external notifications so they render above the composer
    const onPromptNotify = (msg: string) => showPromptMessage(msg);
    promptEvents.on('notify', onPromptNotify);

    // Subscribe to external interrupts (e.g. repeat job triggers).
    // Mirrors the normal rl 'line' submit path so terminal state is clean.
    const onPromptInterrupt = (value: string) => {
      if (closed) return;
      mentionPreview.reset();
      if (contextualHelpVisible) {
        setContextualHelpVisible(false);
      }
      leavePromptSurface(stdOutput, STATUS_LINE_COUNT);
      cleanup();
      resolve({ kind: 'submit', value });
    };
    promptEvents.on('interrupt', onPromptInterrupt);

    const refreshLine = () => {
      renderActivePrompt();
    };

    if (typeof rlInternal._refreshLine === 'function') {
      rlInternal._refreshLine = () => {
        if (!closed && !pasteState.isInPaste) {
          scheduleRender();
        }
      };
    }

    // Override _moveCursor while preserving readline's internal cursor updates.
    // Readline uses this path for left/right/home/end edits; skipping the
    // original call leaves rl.cursor stale and breaks mid-line editing.
    if (typeof rlInternal._moveCursor === 'function') {
      rlInternal._moveCursor = (...args: unknown[]) => {
        originalMoveCursor?.(...(args as []));
        if (!closed && !pasteState.isInPaste) {
          scheduleRender();
        }
      };
    }

    // Intercept _ttyWrite to suppress ALL readline text processing.
    // TextBuffer is the source of truth for input content. Readline is kept
    // only for the 'line' event emission and internal machinery.
    // Without this, readline would duplicate character insertions and
    // mishandle multi-line content.
    const rlTtyWrite = rl as readline.Interface & { _ttyWrite?: (s: string, key: readline.Key) => void };
    const originalTtyWrite = rlTtyWrite._ttyWrite?.bind(rl);
    if (originalTtyWrite) {
      rlTtyWrite._ttyWrite = (s: string, _key: readline.Key) => {
        // During paste, suppress ALL readline processing. Without this,
        // readline processes each pasted character including newlines that
        // fire 'line' events and trigger individual submissions.
        // The handleKeypress handler buffers paste content separately.
        if (pasteState.isInPaste) {
          return;
        }
        // Catch residual CSI u / modifyOtherKeys fragments that readline
        // passes as literal text. Insert a real newline into the TextBuffer.
        if (/^(?:13;?[234]?\d*[u~]|27;[234];13~)$/.test(s)) {
          textBuffer.insert('\n');
          syncReadlineFromBuffer();
          renderActivePrompt();
          return;
        }
        // Suppress all other readline processing — TextBuffer handles input
        // via the keypress handler below.
        return;
      };
    }

    const applyDetectedImagesToLine = (processedText: string) => {
      const display = getContentDisplay(processedText);

      if (display.isPasted) {
        pasteState.hiddenContent = display.actual;
        textBuffer.setText(display.visual);
      } else {
        pasteState.hiddenContent = undefined;
        textBuffer.setText(display.actual);
      }

      syncReadlineFromBuffer();
      refreshLine();
    };

    const replaceDroppedImagesInline = (): boolean => {
      if (!onImageDetected) {
        return false;
      }

      const sourceText = pasteState.hiddenContent ?? getCurrentText();
      if (!sourceText) {
        inlineImageRetryCount = 0;
        return false;
      }

      const processed = processImagesInText(sourceText, onImageDetected, {
        announce: false,
        output: stdOutput,
      });

      if (processed !== sourceText) {
        inlineImageRetryCount = 0;
        applyDetectedImagesToLine(processed);
        return true;
      }

      // Some macOS drag sources emit a path before the screenshot file
      // is fully materialized in TemporaryItems. Retry briefly.
      if (hasPotentialImagePath(sourceText) && inlineImageRetryCount < MAX_INLINE_IMAGE_RETRIES) {
        inlineImageRetryCount += 1;
        scheduleInlineImageScan(180);
      } else if (!hasPotentialImagePath(sourceText)) {
        inlineImageRetryCount = 0;
      }
      return false;
    };

    const scheduleInlineImageScan = (delayMs = 75) => {
      if (!onImageDetected || pasteState.isInPaste) {
        return;
      }

      if (inlineImageScanTimeout) {
        clearTimeout(inlineImageScanTimeout);
      }

      // Defer scan until typing settles so readline has updated rl.line.
      inlineImageScanTimeout = setTimeout(() => {
        inlineImageScanTimeout = undefined;
        if (!closed && !pasteState.isInPaste) {
          replaceDroppedImagesInline();
        }
      }, delayMs);
    };

    const scheduleInlineShellSuggestion = (delayMs = 120) => {
      if (!resolveShellSuggestion || pasteState.isInPaste || contextualHelpVisible) {
        return;
      }

      const sourceLine = getCurrentText();
      const trimmedSource = sourceLine.trim();

      if (!trimmedSource.startsWith('!') || !trimmedSource.slice(1).trim()) {
        if (llmInlineShellSuggestion !== null) {
          llmInlineShellSuggestion = null;
          renderActivePrompt();
        }
        return;
      }

      if (inlineShellSuggestionTimeout) {
        clearTimeout(inlineShellSuggestionTimeout);
      }

      inlineShellSuggestionTimeout = setTimeout(() => {
        inlineShellSuggestionTimeout = undefined;
        const requestId = ++inlineShellSuggestionRequestId;
        const lineAtRequest = getCurrentText();

        resolveShellSuggestion(lineAtRequest)
          .then((suggestion) => {
            if (closed || requestId !== inlineShellSuggestionRequestId) {
              return;
            }
            const latest = getCurrentText();
            if (latest !== lineAtRequest) {
              return;
            }
            llmInlineShellSuggestion = suggestion ?? null;
            renderActivePrompt();
          })
          .catch(() => {
            // Best effort only; local deterministic ghost suggestion remains available.
          });
      }, delayMs);
    };

    const handleInputData = (chunk: Buffer | string) => {
      if (closed || pasteState.isInPaste) {
        return;
      }

      const rawText = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk ?? '');
      const modifiedEnterCount = countRawModifiedEnterSequences(rawText);
      const residualModifiedEnterCount = countResidualModifiedEnterSequences(rawText);

      if (modifiedEnterCount > 0) {
        for (let i = 0; i < modifiedEnterCount; i++) {
          textBuffer.insert('\n');
        }
        suppressResidualShiftEnterCharsUntil = Date.now() + 200;
        syncReadlineFromBuffer();
        renderActivePrompt();
        return;
      }

      if (residualModifiedEnterCount > 0) {
        for (let i = 0; i < residualModifiedEnterCount; i++) {
          textBuffer.insert('\n');
        }
        suppressResidualShiftEnterCharsUntil = Date.now() + 200;
        syncReadlineFromBuffer();
        renderActivePrompt();
        return;
      }

      // Catch drag/drop payloads even when terminal does not emit keypress
      // events for each pasted character.
      scheduleInlineImageScan();
    };

    const handleKeypress = (_str: string, key: readline.Key) => {
      if (closed) return;
      const rawSeq = key?.sequence ?? _str ?? '';

      // Suppress residual chars from modified-Enter CSI sequences.
      // The timer is set by handleInputData (which runs as a prepended
      // data listener, before readline emits keypresses).
      if (Date.now() < suppressResidualShiftEnterCharsUntil) {
        if (
          isShiftEnterSequence(_str, key) ||
          isShiftEnterResidualSequence(rawSeq) ||
          (_str && _str.length > 0 && /^[\d;~u]+$/.test(_str))
        ) {
          return;
        }
      }

      // Fallback: if the key originated from a CSI 13~ sequence (bare Enter
      // keycode) but the timer wasn't set (e.g., emitKeypressEvents ran before
      // our data handler), catch it by checking key.sequence directly.
      if (key?.sequence === '\x1b[13~') {
        textBuffer.insert('\n');
        suppressResidualShiftEnterCharsUntil = Date.now() + 200;
        syncReadlineFromBuffer();
        renderActivePrompt();
        return;
      }

      // ── Bracketed paste start ─────────────────────────────────────────
      if (key?.name === 'paste-start') {
        pasteState.isInPaste = true;
        pasteState.buffer = '';
        pasteState.outputSuppressed = true;
        outputGuard.setSuppressed(true);

        if (pasteState.timeout) {
          clearTimeout(pasteState.timeout);
        }

        // Save any existing content typed before the paste
        pasteState.prefixContent = getCurrentText();

        return;
      }

      // ── Bracketed paste end ───────────────────────────────────────────
      if (key?.name === 'paste-end') {
        if (pasteState.timeout) {
          clearTimeout(pasteState.timeout);
          pasteState.timeout = undefined;
        }

        if (pasteState.isInPaste) {
          pasteState.isInPaste = false;
          outputGuard.setSuppressed(false);
          // Process images in the paste buffer BEFORE handlePasteComplete
          // sets rl.line - this is the earliest moment where the temp file
          // is most likely to still exist on disk.
          if (onImageDetected && pasteState.buffer) {
            pasteState.buffer = processImagesInText(
              pasteState.buffer, onImageDetected, { announce: false, output: stdOutput }
            );
          }
          handlePasteComplete(pasteState, rl, stdOutput, () => {
            // After paste completes, sync TextBuffer from rl.line (paste handler sets rl.line)
            const rlAny = rl as readline.Interface & { line: string };
            textBuffer.setText(rlAny.line ?? '');
            syncReadlineFromBuffer();
            renderActivePrompt();
          });
          // Schedule a deferred fallback scan in case the synchronous
          // replacement missed (e.g. file not yet materialized).
          scheduleInlineImageScan(10);
        }
        return;
      }

      // ── During paste: accumulate to buffer ────────────────────────────
      if (pasteState.isInPaste) {
        if (_str) {
          pasteState.buffer += _str;
        }
        // Also buffer newlines from Enter key during paste
        if (key?.name === 'return' || key?.name === 'enter') {
          pasteState.buffer += '\n';
        }

        // Reset idle timeout on each character - complete paste after 50ms of no input
        if (pasteState.timeout) {
          clearTimeout(pasteState.timeout);
        }
        pasteState.timeout = setTimeout(() => {
          if (pasteState.isInPaste && pasteState.buffer) {
            pasteState.isInPaste = false;
            outputGuard.setSuppressed(false);
            if (onImageDetected) {
              pasteState.buffer = processImagesInText(
                pasteState.buffer, onImageDetected, { announce: false, output: stdOutput }
              );
            }
            handlePasteComplete(pasteState, rl, stdOutput, () => {
              const rlAny = rl as readline.Interface & { line: string };
              textBuffer.setText(rlAny.line ?? '');
              syncReadlineFromBuffer();
              renderActivePrompt();
            });
            scheduleInlineImageScan(10);
          }
        }, 50);

        return; // Don't process normally during paste
      }

      // ── Backspace/delete on paste indicator ───────────────────────────
      if ((key?.name === 'backspace' || key?.name === 'delete') && pasteState.hiddenContent) {
        const currentText = getCurrentText();
        const stripped = removePastedReferenceFromLine(currentText);
        if (stripped) {
          textBuffer.setText(stripped.line);
        } else {
          textBuffer.setText('');
        }
        pasteState.hiddenContent = undefined;
        syncReadlineFromBuffer();
        renderActivePrompt();
        return;
      }

      // ── Reset Ctrl+C counter on non-Ctrl+C keys ──────────────────────
      if (!(key?.name === 'c' && key.ctrl)) {
        ctrlCCount = 0;
      }

      // ── Ctrl+C: clear input or exit ───────────────────────────────────
      if (key?.name === 'c' && key.ctrl) {
        const currentInput = getCurrentText();

        if (currentInput.length > 0) {
          // Clear the input
          mentionPreview.reset();
          if (contextualHelpVisible) {
            setContextualHelpVisible(false);
          }
          textBuffer.setText('');
          syncReadlineFromBuffer();
          renderActivePrompt();
          ctrlCCount = 0;
          return;
        }

        // Input is empty - handle exit flow
        if (ctrlCCount === 0) {
          ctrlCCount = 1;
          mentionPreview.reset();
          if (contextualHelpVisible) {
            setContextualHelpVisible(false);
          }
          showPromptMessage(chalk.gray('Press Ctrl+C again to exit.'));
          return;
        }
        mentionPreview.reset();
        if (contextualHelpVisible) {
          setContextualHelpVisible(false);
        }
        leavePromptSurface(stdOutput);
        cleanup();
        resolve({ kind: 'abort' });
        return;
      }

      // ── Shift+Tab: plan mode toggle ───────────────────────────────────
      if (isShiftTabShortcut(_str, key)) {
        const planModeManager = getPlanModeManager();
        const wasEnabled = planModeManager.isEnabled();
        planModeManager.handleShiftTab();

        // Show immediate feedback
        if (wasEnabled) {
          showPromptMessage(`${chalk.gray('Plan mode')} ${chalk.red('OFF')}`);
        } else {
          showPromptMessage(`${chalk.bgCyan.black.bold(' PLAN ')} ${chalk.cyan('Plan mode ON - read-only tools')}`);
        }
        return;
      }

      // ── Tab: accept suggestion ────────────────────────────────────────
      if (isPlainTabShortcut(_str, key)) {
        const currentInput = getCurrentText();
        const trimmedInput = currentInput.trim();

        if (trimmedInput.startsWith('!') && resolveShellSuggestion) {
          if (
            llmInlineShellSuggestion &&
            llmInlineShellSuggestion.startsWith(currentInput) &&
            llmInlineShellSuggestion !== currentInput
          ) {
            textBuffer.setText(llmInlineShellSuggestion);
            syncReadlineFromBuffer();
            renderActivePrompt();
            return;
          }

          const requestId = ++shellSuggestionRequestId;
          const immediateFallback = getPrimaryHotTipSuggestion(
            currentInput,
            filesProvider(),
            slashCommands,
            suggestionText,
            workspaceRoot
          );
          let expectedInputAtResponse = currentInput;

          if (immediateFallback) {
            textBuffer.setText(immediateFallback.line);
            syncReadlineFromBuffer();
            expectedInputAtResponse = immediateFallback.line;
            renderActivePrompt();
          }

          resolveShellSuggestion(currentInput)
            .then((llmSuggestion) => {
              if (closed || requestId !== shellSuggestionRequestId) {
                return;
              }

              const latest = getCurrentText();
              if (latest !== expectedInputAtResponse) {
                return;
              }

              if (llmSuggestion) {
                textBuffer.setText(llmSuggestion);
                syncReadlineFromBuffer();
                renderActivePrompt();
              }
            })
            .catch(() => {
              if (closed || requestId !== shellSuggestionRequestId) {
                return;
              }
              // Ignore LLM errors: immediate local fallback already applied above.
            });
          return;
        }

        const suggestion = getPrimaryHotTipSuggestion(
          currentInput,
          filesProvider(),
          slashCommands,
          suggestionText,
          workspaceRoot
        );
        if (suggestion) {
          textBuffer.setText(suggestion.line);
          syncReadlineFromBuffer();
          renderActivePrompt();
        }
        return;
      }

      // ── '?' on empty/single-? input: toggle contextual shortcut help ─
      if (_str === '?' && !key?.ctrl && !key?.meta) {
        // TextBuffer may have already inserted the '?' (if handleTextBufferKey
        // runs first). We need to check BEFORE TextBuffer sees it.
        // Since we handle '?' here before routing to TextBuffer, we check the
        // current buffer state:
        const currentText = getCurrentText();
        if (currentText.trim() === '' || currentText.trim() === '?') {
          // If buffer is empty, the '?' hasn't been inserted yet.
          // If buffer is '?', it was just inserted by a prior key event.
          // Either way, we toggle help and suppress the character.
          // Don't insert the '?' — just toggle help panel.
          setContextualHelpVisible(!contextualHelpVisible);
          return;
        }
      }

      // ── Route through TextBuffer key handler ──────────────────────────
      const residualModifiedEnterCount = countResidualModifiedEnterSequences(rawSeq);
      if (isShiftEnterSequence(_str, key) || isShiftEnterResidualSequence(rawSeq)) {
        textBuffer.insert('\n');
        syncReadlineFromBuffer();
        renderActivePrompt();
        scheduleInlineImageScan();
        scheduleInlineShellSuggestion();
        return;
      }
      if (residualModifiedEnterCount > 0) {
        for (let i = 0; i < residualModifiedEnterCount; i++) {
          textBuffer.insert('\n');
        }
        syncReadlineFromBuffer();
        renderActivePrompt();
        scheduleInlineImageScan();
        scheduleInlineShellSuggestion();
        return;
      }

      const tbResult = handleTextBufferKey(textBuffer, _str, key);

      if (tbResult === 'submit') {
        const text = textBuffer.getText().trim();
        if (!text) return; // Don't submit empty
        // Sync readline then emit 'line' event which drives the submission handler
        syncReadlineFromBuffer();
        rl.emit('line', text);
        return;
      }

      if (tbResult === 'handled') {
        syncReadlineFromBuffer();
        renderActivePrompt();
        scheduleInlineImageScan();
        scheduleInlineShellSuggestion();
        if (contextualHelpVisible && shouldAutoHideShortcutHelp(_str, key)) {
          setContextualHelpVisible(false);
        }
        return;
      }

      // 'unhandled' — Escape and other control keys fall through here.
      // Schedule scans and renders for any unhandled key.
      scheduleInlineImageScan();
      scheduleInlineShellSuggestion();

      if (contextualHelpVisible && shouldAutoHideShortcutHelp(_str, key)) {
        setContextualHelpVisible(false);
      }

      // Force a post-keypress repaint so border/mode styling follows the
      // latest buffer even on terminals where timing can lag one keystroke.
      scheduleRender();
    };

    // IMPORTANT: handleInputData MUST run before readline's emitKeypressEvents
    // handler. When a bare ESC[13~ arrives, handleInputData detects it and sets
    // suppressResidualShiftEnterCharsUntil. If this runs AFTER readline parses
    // the data into individual keypress events, those events would reach
    // handleTextBufferKey and insert "13~" as literal text before the timer
    // is set. prependListener ensures our handler fires first.
    input.prependListener('data', handleInputData);
    input.on('keypress', handleKeypress);

    rl.on('line', (value) => {
      // Ignore line events during paste mode - we're buffering
      if (pasteState.isInPaste) {
        return;
      }

      // If we have hidden content from a large paste, use that instead of visual
      let finalValue = pasteState.hiddenContent || value;

      // Clear hidden content after use
      pasteState.hiddenContent = undefined;

      // Convert any remaining newline markers back to actual newlines.
      // TextBuffer uses real \n, but legacy code paths may still produce markers.
      finalValue = convertNewlineMarkersToNewlines(finalValue).trim();

      // Process any embedded images (base64 data URLs or file paths)
      finalValue = processImagesInText(finalValue, onImageDetected, {
        announce: true,
        output: stdOutput,
      });

      if (contextualHelpVisible) {
        setContextualHelpVisible(false);
      }

      // Handle shell commands (prefix with !)
      if (isShellCommand(finalValue)) {
        const shellCmd = parseShellCommand(finalValue);
        mentionPreview.reset();
        leavePromptSurface(stdOutput, STATUS_LINE_COUNT, true);
        const result = executeShellCommand(shellCmd, workspaceRoot);
        if (result.success && result.output) {
          stdOutput.write(result.output);
          if (!result.output.endsWith('\n')) {
            stdOutput.write('\n');
          }
        } else if (!result.success && result.error) {
          stdOutput.write(chalk.red(`Error: ${result.error}\n`));
        }
        // Re-prompt without sending to LLM — reset TextBuffer for fresh input
        textBuffer.setText('');
        syncReadlineFromBuffer();
        stdOutput.write('\n');
        renderPromptLine(rl, getActiveStatusLine(), stdOutput, false, false, suggestionText);
        return;
      }

      mentionPreview.reset();
      leavePromptSurface(stdOutput, STATUS_LINE_COUNT, true);
      // Show interrupt hint when user submits a non-empty, non-command instruction
      if (finalValue && !finalValue.startsWith('/')) {
        stdOutput.write(`${chalk.gray('press ESC to interrupt')}\n`);
      }
      cleanup();
      resolve({ kind: 'submit', value: finalValue });
    });

    rl.on('SIGINT', () => {
      const currentInput = getCurrentText();

      if (currentInput.length > 0) {
        mentionPreview.reset();
        if (contextualHelpVisible) {
          setContextualHelpVisible(false);
        }
        textBuffer.setText('');
        syncReadlineFromBuffer();
        renderActivePrompt();
        ctrlCCount = 0;
        return;
      }

      if (ctrlCCount === 0) {
        ctrlCCount = 1;
        mentionPreview.reset();
        if (contextualHelpVisible) {
          setContextualHelpVisible(false);
        }
        showPromptMessage(chalk.gray('Press Ctrl+C again to exit.'));
        return;
      }
      mentionPreview.reset();
      if (contextualHelpVisible) {
        setContextualHelpVisible(false);
      }
      leavePromptSurface(stdOutput);
      cleanup();
      resolve({ kind: 'abort' });
    });
  });
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

function getComposerBorderStyle(line: string): InputBorderStyle {
  if (/^[\s\u200B-\u200D\uFEFF]*!/u.test(line)) {
    return 'shell';
  }
  if (getPlanModeManager().isEnabled()) {
    return 'plan';
  }
  return 'default';
}

// Track multi-line state for leavePromptSurface and MentionPreview offset.
let lastRenderedContentLines = 1;
let lastRenderedCursorRow = 0;

// Module-level reference to the active TextBuffer for rendering.
// Set when entering promptOnce, cleared on cleanup.
let activeTextBuffer: TextBuffer | null = null;

/** Expose the active TextBuffer for external consumers (e.g. persistentInput). */
export function getActiveTextBuffer(): TextBuffer | null {
  return activeTextBuffer;
}

export function getLastRenderedContentLines(): number {
  return lastRenderedContentLines;
}

export function getLastRenderedCursorRow(): number {
  return lastRenderedCursorRow;
}

// Track the width used by the last renderPromptLine call so we can detect
// width changes (resize) and compute reflow line counts for clearing.
let lastRenderedPromptWidth = 0;
let lastRenderedHelpLines = 0;
let lastRenderedSlashLines = 0;

/**
 * Reset module-level render state between promptOnce() invocations.
 * Prevents stale values from the previous prompt affecting the clearing
 * logic of the new prompt's initial render.
 */
export function resetPromptRenderState(): void {
  lastRenderedContentLines = 1;
  lastRenderedCursorRow = 0;
  lastRenderedPromptWidth = 0;
  lastRenderedHelpLines = 0;
  lastRenderedSlashLines = 0;
}

function renderPromptLine(
  rl: readline.Interface,
  statusLine: string | { left: string; right: string } | undefined,
  output: NodeJS.WriteStream,
  isResize = false,
  hasExistingPromptBlock = true,
  suggestionText?: string,
  inlineGhostSuffix?: string,
  helpPanelLines?: string[],
  slashSuggestionLines?: string[]
): void {
  // Invalidate color cache once per render frame
  invalidateBoxColorCache();

  const width = getPromptBlockWidth(output.columns);

  // Read input state from TextBuffer (source of truth) when available,
  // otherwise fall back to readline for compatibility.
  let currentLine: string;
  let cursorPos: number;
  if (activeTextBuffer) {
    currentLine = activeTextBuffer.getText();
    // Compute flat cursor position: sum of chars + newlines before the cursor
    const lines = activeTextBuffer.getLines();
    const row = activeTextBuffer.getCursorRow();
    const col = activeTextBuffer.getCursorCol();
    let flat = 0;
    for (let i = 0; i < row; i++) {
      flat += lines[i].length + 1; // +1 for the newline separator
    }
    flat += col;
    cursorPos = flat;
  } else {
    const rlAny = rl as readline.Interface & { cursor?: number; line?: string };
    currentLine = rlAny.line ?? '';
    cursorPos = rlAny.cursor ?? currentLine.length;
  }

  const borderStyle = getComposerBorderStyle(currentLine);
  const state = buildMultiLineRenderState(
    currentLine,
    cursorPos,
    width,
    borderStyle,
    suggestionText,
    inlineGhostSuffix
  );
  const topBorder = drawInputTopBorder(width, borderStyle);
  const bottomBorder = drawInputBottomBorder(width, borderStyle);
  const statusRow = formatPromptStatusRow(statusLine, width);

  // Detect width change even when called from _refreshLine (which passes
  // isResize=false). Readline triggers _refreshLine on resize before our
  // debounced handler fires, so we must use the reflow-aware clearing path
  // whenever the width has actually changed.
  const widthChanged = lastRenderedPromptWidth > 0 && width !== lastRenderedPromptWidth;
  const effectiveResize = isResize || widthChanged;

  // Keep readline's prompt in sync for line editing internals.
  rl.setPrompt(PROMPT_PREFIX);

  // Hide cursor during rendering to prevent flicker/slow blinking.
  output.write('\x1b[?25l');

  if (effectiveResize && hasExistingPromptBlock) {
    // When the terminal resizes, it reflows all previously written content.
    // A line of N chars wraps to ceil(N / newCols) physical rows at the new
    // terminal width. We must move up enough to reach above ALL reflowed
    // remnants of the old prompt block before clearing.
    const termCols = output.columns ?? 80;
    const oldWidth = lastRenderedPromptWidth || width;
    const prevContentLines = lastRenderedContentLines;
    const prevCursorRow = lastRenderedCursorRow;
    const logicalLines = PROMPT_LINES_ABOVE_INPUT + prevContentLines + PROMPT_LINES_BELOW_INPUT + lastRenderedHelpLines + STATUS_LINE_COUNT + lastRenderedSlashLines;
    // Use actual terminal columns (not prompt width) since that's what
    // the terminal uses for reflow calculations.
    const rowsPerOldLine = Math.max(1, Math.ceil(oldWidth / Math.max(1, termCols)));
    const totalReflowedRows = logicalLines * rowsPerOldLine;
    // Move up generously from cursor row. The cursor sits on content row
    // prevCursorRow, which is (prevCursorRow + PROMPT_LINES_ABOVE_INPUT)
    // rows below the top border.
    const cursorOffset = prevCursorRow + PROMPT_LINES_ABOVE_INPUT;
    const moveUp = totalReflowedRows + rowsPerOldLine + cursorOffset;
    readline.moveCursor(output, 0, -moveUp);
    readline.cursorTo(output, 0);
    // Clear only the reflowed prompt block rows, NOT the entire screen below.
    const rowsToClear = moveUp + logicalLines;
    for (let i = 0; i < rowsToClear; i++) {
      readline.clearLine(output, 0);
      readline.moveCursor(output, 0, 1);
    }
    // Return cursor to the starting position for the new prompt block
    readline.moveCursor(output, 0, -rowsToClear);
    readline.cursorTo(output, 0);
  } else if (hasExistingPromptBlock) {
    // Same-width redraw: cursor sits on content row lastRenderedCursorRow.
    const prevContentLines = lastRenderedContentLines;
    const prevCursorRow = lastRenderedCursorRow;

    readline.cursorTo(output, 0);
    readline.clearLine(output, 0);

    // Clear content lines above cursor and top border
    const upCount = prevCursorRow + PROMPT_LINES_ABOVE_INPUT;
    for (let i = 0; i < upCount; i++) {
      readline.moveCursor(output, 0, -1);
      readline.clearLine(output, 0);
    }

    // Move down, clearing remaining content + below + help panel + status + slash suggestions
    const downCount = prevContentLines + PROMPT_LINES_BELOW_INPUT + lastRenderedHelpLines + STATUS_LINE_COUNT + lastRenderedSlashLines;
    for (let i = 0; i < downCount; i++) {
      readline.moveCursor(output, 0, 1);
      readline.clearLine(output, 0);
    }

    // Return to top border position (where we started minus upCount)
    for (let i = 0; i < downCount; i++) {
      readline.moveCursor(output, 0, -1);
    }
    readline.cursorTo(output, 0);
  } else {
    // Initial render: clear current line AND the rows below where the
    // prompt block will be drawn.  PersistentInput's fixed region may
    // have left remnants (❯ prefix, borders) on these rows after
    // regions.disable().  Without this, ghost duplicate prompts appear.
    readline.cursorTo(output, 0);
    const blockSize = PROMPT_LINES_ABOVE_INPUT + state.lineCount + PROMPT_LINES_BELOW_INPUT + (helpPanelLines?.length ?? 0) + STATUS_LINE_COUNT + (slashSuggestionLines?.length ?? 0);
    for (let i = 0; i < blockSize; i++) {
      readline.clearLine(output, 0);
      if (i < blockSize - 1) {
        readline.moveCursor(output, 0, 1);
      }
    }
    // Return to starting row
    readline.moveCursor(output, 0, -(blockSize - 1));
    readline.cursorTo(output, 0);
  }

  // Batch all prompt content into a single write to minimize syscalls.
  const helpLines = helpPanelLines ?? [];
  const slashLines = slashSuggestionLines ?? [];
  let buf = `${topBorder}\n`;
  for (const line of state.lines) {
    buf += `${line}\n`;
  }
  buf += `${bottomBorder}\n`;
  for (const hl of helpLines) {
    buf += `${hl}\n`;
  }
  buf += statusRow;
  // Slash command suggestions appear below the status line
  for (const sl of slashLines) {
    buf += `\n${sl}`;
  }
  output.write(buf);

  // Move cursor from the last rendered row back to the cursor's content row.
  const moveUp = PROMPT_LINES_BELOW_INPUT + helpLines.length + STATUS_LINE_COUNT + slashLines.length + (state.lineCount - 1 - state.cursorRow);
  readline.moveCursor(output, 0, -moveUp);
  readline.cursorTo(output, state.cursorColumn);

  // Show cursor at its final, correct position.
  output.write('\x1b[?25h');

  lastRenderedContentLines = state.lineCount;
  lastRenderedCursorRow = state.cursorRow;
  lastRenderedPromptWidth = width;
  lastRenderedHelpLines = helpLines.length;
  lastRenderedSlashLines = slashLines.length;
}
