/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import readline from 'node:readline';
import { existsSync, readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import os from 'node:os';
import { TerminalResizeWatcher } from './terminalResize.js';
import { isShellCommand, parseShellCommand, executeShellCommand } from './shellCommand.js';
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
  type InputBorderStyle
} from './box.js';
import { buildFileMentionSuggestions } from './mentionFilter.js';
import { getTheme, isThemeInitialized } from './theme/index.js';
import type { ColorToken } from './theme/types.js';

export const PROMPT_PREFIX = `${chalk.gray('›')} `;
// Visible length of the prompt prefix (ANSI codes not counted)
export const PROMPT_VISIBLE_LENGTH = 2;
// Number of fixed status lines we render beneath the prompt
export const STATUS_LINE_COUNT = 1;
// Composer block structure relative to input line.
export const PROMPT_LINES_ABOVE_INPUT = 1;
export const PROMPT_LINES_BELOW_INPUT = 1;
export const PROMPT_BLOCK_LINE_COUNT = PROMPT_LINES_ABOVE_INPUT + 1 + PROMPT_LINES_BELOW_INPUT;
export const PROMPT_PLACEHOLDER = 'Plan, search, build anything';
export const PROMPT_INPUT_PREFIX = '❯ ';

export type SlashCommandHint = SlashCommand;

export interface PromptRenderState {
  lineText: string;
  cursorColumn: number;
}

export interface PromptHotTip {
  label: string;
}

interface PromptSuggestion {
  line: string;
  cursor: number;
}

const HOT_TIP_LIMIT = 5;
const HOT_TIP_SHELL_SUGGESTIONS = [
  '! git status',
  '! bun test',
  '! bun run lint'
];

const CONTEXTUAL_HELP_ROWS: Array<{ left: string; right: string }> = [
  { left: '/ for commands', right: '! for shell commands' },
  { left: '@ for file paths', right: 'tab accepts suggestion' },
  { left: '? toggles this shortcuts panel', right: 'shift + tab toggles plan mode' },
  { left: 'shift + enter inserts newline', right: 'alt + enter inserts newline' },
  { left: 'enter submits prompt', right: 'ctrl + c clears input / exits' },
  { left: 'esc interrupts active turn', right: 'type /, @, or ! to switch mode' },
];

function themedFg(token: ColorToken, text: string, fallback: (value: string) => string): string {
  if (!isThemeInitialized()) {
    return fallback(text);
  }

  try {
    return getTheme().fg(token, text);
  } catch {
    return fallback(text);
  }
}

function stripAnsiCodes(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

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
  slashCommands: SlashCommandHint[]
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
    return HOT_TIP_SHELL_SUGGESTIONS.map((value) => ({
      label: `Tab -> ${value}`
    }));
  }

  const defaultFileTip = files.length > 0
    ? { label: `Tab -> @${files[0]}` }
    : { label: 'Type @ to mention files' };

  return [
    { label: 'Tab -> /help' },
    { label: `Tab -> ${HOT_TIP_SHELL_SUGGESTIONS[0]}` },
    defaultFileTip,
    { label: 'Type /, @, or ! to switch suggestion mode' },
    { label: 'Shift+Tab toggles plan mode' },
  ];
}

export function getPrimaryHotTipSuggestion(
  currentLine: string,
  files: string[],
  slashCommands: SlashCommandHint[],
  suggestionText?: string
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
    const suggestion = HOT_TIP_SHELL_SUGGESTIONS.find((value) => value.startsWith(trimmed))
      ?? HOT_TIP_SHELL_SUGGESTIONS[0];
    return { line: suggestion, cursor: suggestion.length };
  }

  return null;
}

export function buildContextualHelpPanelLines(
  currentLine: string,
  width: number,
  files: string[],
  slashCommands: SlashCommandHint[]
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
  slashCommands: SlashCommandHint[]
): string {
  const tips = buildPromptHotTips(currentLine, files, slashCommands);
  const primaryTip = tips[0]?.label ?? 'Tab -> /help';
  return `hot tip: ${primaryTip}`;
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
  suggestionText?: string
): PromptRenderState {
  const sanitizedLine = sanitizeRenderLine(currentLine);
  // Whitespace-only drift can happen after terminal redraws; treat it as empty.
  const normalizedLine = sanitizedLine.trim().length === 0 ? '' : sanitizedLine;
  const innerWidth = Math.max(1, width - 2);
  const prefix = PROMPT_INPUT_PREFIX;
  const effectiveCursor = Math.max(0, Math.min(normalizedLine.length, cursorPos));
  const fullInput = `${prefix}${normalizedLine}`;
  const placeholder = `${prefix}${PROMPT_PLACEHOLDER}`;

  let visibleText = fullInput;
  let cursorColumn = prefix.length + effectiveCursor;
  const fullCursor = prefix.length + effectiveCursor;

  if (!normalizedLine) {
    const displayPlaceholder = suggestionText
      ? `${prefix}${suggestionText}`
      : placeholder;
    visibleText = chalk.gray(displayPlaceholder);
    cursorColumn = prefix.length;
  } else if (fullInput.length > innerWidth) {
    const ellipsis = '…';
    const nearStartThreshold = innerWidth - 1;
    const nearEndThreshold = innerWidth - 1;

    // Near start: keep left side stable and show a right ellipsis.
    if (fullCursor <= nearStartThreshold) {
      const body = fullInput.slice(0, Math.max(1, innerWidth - 1));
      visibleText = `${body}${ellipsis}`;
      cursorColumn = fullCursor;
    // Near end: keep right side stable and show a left ellipsis.
    } else if ((fullInput.length - fullCursor) <= nearEndThreshold) {
      const start = Math.max(0, fullInput.length - Math.max(1, innerWidth - 1));
      const body = fullInput.slice(start);
      visibleText = `${ellipsis}${body}`;
      cursorColumn = 1 + (fullCursor - start);
    // Middle: keep cursor in a moving window with ellipses on both sides.
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

  let styledVisibleText = visibleText;
  if (!normalizedLine) {
    styledVisibleText = themedFg('muted', visibleText, (value) => chalk.gray(value));
  } else if (visibleText.startsWith(prefix)) {
    const prefixStyled = themedFg('accent', prefix, (value) => chalk.gray(value));
    styledVisibleText = `${prefixStyled}${visibleText.slice(prefix.length)}`;
  } else if (visibleText.startsWith(`…${prefix}`)) {
    const prefixStyled = themedFg('accent', prefix, (value) => chalk.gray(value));
    styledVisibleText = `…${prefixStyled}${visibleText.slice((`…${prefix}`).length)}`;
  }

  const lineText = drawInputBox(styledVisibleText, width);
  const clampedCursor = Math.max(0, Math.min(width - 1, cursorColumn));

  return { lineText, cursorColumn: clampedCursor };
}

function formatPromptStatusRow(
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
  const plainRight = right ? stripAnsiCodes(right) : '';
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
export type ImageDetectedCallback = (
  data: Buffer,
  mimeType: ImageMimeType,
  filename?: string
) => number;

export interface PromptIO {
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
const MAX_NEWLINES = 2; // Max 3 lines = 2 newline markers

// Maximum lines to display visually (input can contain more)
export const MAX_DISPLAY_LINES = 5;

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
 * Result from getDisplayContent
 */
export interface DisplayResult {
  /** Content to show in terminal */
  display: string;
  /** Total lines if shown untruncated */
  totalLines: number;
  /** Whether content was truncated for display */
  isTruncated: boolean;
}

/**
 * Calculate display content with truncation if needed.
 * When content exceeds MAX_DISPLAY_LINES, shows the END (most recent typing)
 * with an indicator showing total line count.
 *
 * @param fullContent - The complete input content
 * @param terminalWidth - Current terminal width in columns
 * @returns Display result with truncated content and metadata
 */
export function getDisplayContent(fullContent: string, terminalWidth: number): DisplayResult {
  if (!fullContent) {
    return { display: '', totalLines: 0, isTruncated: false };
  }

  const promptWidth = 2; // "› " prefix
  const availableWidth = Math.max(1, terminalWidth - promptWidth);

  // Calculate how many lines the content would take
  const totalLines = Math.ceil(fullContent.length / availableWidth);

  if (totalLines <= MAX_DISPLAY_LINES) {
    return { display: fullContent, totalLines, isTruncated: false };
  }

  // Reserve space for indicator like "... (8 lines) "
  const indicator = `... (${totalLines} lines) `;
  const indicatorWidth = indicator.length;

  // Calculate max chars for display (MAX_DISPLAY_LINES lines minus indicator)
  const maxChars = (availableWidth * MAX_DISPLAY_LINES) - indicatorWidth;

  // Show the END of the content (most recent typing)
  const truncated = fullContent.slice(-Math.max(0, maxChars));

  return {
    display: indicator + truncated,
    totalLines,
    isTruncated: true
  };
}

/**
 * Count the number of newline markers in text
 */
export function countNewlineMarkers(text: string): number {
  return (text.match(new RegExp(NEWLINE_MARKER, 'g')) || []).length;
}

/**
 * Convert newline markers back to actual newlines
 */
export function convertNewlineMarkersToNewlines(text: string): string {
  return text.replace(new RegExp(NEWLINE_MARKER, 'g'), '\n');
}

export async function readInstruction(
  files: string[],
  slashCommands: SlashCommandHint[],
  statusLine?: string | { left: string; right: string },
  io: PromptIO = {},
  onImageDetected?: ImageDetectedCallback,
  workspaceRoot?: string,
  initialValue = '',
  suggestionText?: string
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
        files,
        slashCommands,
        statusLine,
        initialValue,
        stdInput,
        stdOutput,
        onImageDetected,
        workspaceRoot,
        suggestionText
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
  files: string[];
  slashCommands: SlashCommandHint[];
  statusLine?: string | { left: string; right: string };
  initialValue?: string;
  stdInput: NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void };
  stdOutput: NodeJS.WriteStream;
  onImageDetected?: ImageDetectedCallback;
  workspaceRoot?: string;
  suggestionText?: string;
}

/**
 * Enable bracketed paste mode in terminal.
 * Terminal will send escape sequences around pasted content.
 */
function enableBracketedPaste(output: NodeJS.WriteStream): void {
  try {
    output.write('\x1b[?2004h');
  } catch (error) {
    // Terminal doesn't support bracketed paste, continue without it
    if (process.env.DEBUG_PASTE) {
      output.write(`[DEBUG] Failed to enable bracketed paste: ${error}\n`);
    }
  }
}

/**
 * Disable bracketed paste mode in terminal.
 */
function disableBracketedPaste(output: NodeJS.WriteStream): void {
  try {
    output.write('\x1b[?2004l');
  } catch {
    // Ignore errors during cleanup
  }
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

  // Enable bracketed paste mode for paste detection
  enableBracketedPaste(stdOutput);

  // Always ensure stdin is in a known state before creating readline
  // This fixes issues with Bun where isPaused() may not return correct state
  try {
    stdInput.resume();
  } catch {
    // Ignore if already resumed
  }

  const rl = readline.createInterface({
    input: stdInput,
    output: stdOutput,
    prompt: PROMPT_PREFIX,
    terminal: true,
    crlfDelay: Infinity,
    historySize: 100,
    tabSize: 2
  });

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
  // Enter submissions can leave the cursor one line below the input row.
  // With a boxed prompt, readline can advance into the rows below input.
  // Normalize back to the input line before clearing the full prompt block.
  if (fromLineEvent) {
    const normalizationRows = PROMPT_LINES_BELOW_INPUT;
    for (let i = 0; i < normalizationRows; i++) {
      readline.moveCursor(output, 0, -1);
    }
  }

  // Clear current input line
  readline.cursorTo(output, 0);
  readline.clearLine(output, 0);

  // Clear prompt lines above the input
  for (let i = 0; i < PROMPT_LINES_ABOVE_INPUT; i++) {
    readline.moveCursor(output, 0, -1);
    readline.clearLine(output, 0);
  }

  // Return to input line
  for (let i = 0; i < PROMPT_LINES_ABOVE_INPUT; i++) {
    readline.moveCursor(output, 0, 1);
  }

  // Clear prompt lines below the input
  for (let i = 0; i < PROMPT_LINES_BELOW_INPUT; i++) {
    readline.moveCursor(output, 0, 1);
    readline.clearLine(output, 0);
  }

  for (let i = 0; i < statusLineCount; i++) {
    readline.moveCursor(output, 0, 1);
    readline.clearLine(output, 0);
  }

  // Move to the first free line below the prompt surface.
  readline.moveCursor(output, 0, 1);
  readline.cursorTo(output, 0);
}

/**
 * Handle paste completion - apply display logic based on line count
 */
function handlePasteComplete(
  pasteState: PasteState,
  rl: readline.Interface,
  output: NodeJS.WriteStream
): void {
  const display = getContentDisplay(pasteState.buffer);
  const rlAny = rl as readline.Interface & { line: string; cursor: number; _refreshLine?: () => void };

  // Get any prefix content that was typed before the paste
  const prefix = pasteState.prefixContent || '';

  // Count newlines to know how many extra prompt lines were printed
  const newlineCount = (pasteState.buffer.match(/\n/g) || []).length;

  // If readline echoed pasted rows, clear that transient output.
  // When output is suppressed, skip this so we don't move into chat logs.
  if (!pasteState.outputSuppressed) {
    // Clear all the extra lines that readline printed during paste
    // Move cursor up for each newline, clearing as we go
    for (let i = 0; i < newlineCount; i++) {
      readline.moveCursor(output, 0, -1); // Move up one line
      readline.clearLine(output, 0); // Clear that line
    }

    // Now we're back at the original prompt line - clear it too
    readline.cursorTo(output, 0);
    readline.clearLine(output, 0);
  }

  if (display.isPasted) {
    // Large paste: show indicator, store actual content
    // Prepend prefix to hidden content so it's included in submission
    pasteState.hiddenContent = prefix + display.actual;
    rlAny.line = prefix + display.visual;
    rlAny.cursor = rlAny.line.length;
  } else {
    // Small paste: insert normally with prefix
    rlAny.line = prefix + display.actual;
    rlAny.cursor = rlAny.line.length;
  }

  // Refresh the display with clean prompt
  rl.prompt(true);

  // Clear the buffer and prefix
  pasteState.buffer = '';
  pasteState.outputSuppressed = false;
  pasteState.prefixContent = undefined;
}

async function promptOnce(options: PromptOnceOptions): Promise<PromptResult> {
  const { files, slashCommands, statusLine, initialValue, stdInput, stdOutput, onImageDetected, workspaceRoot, suggestionText } = options;
  const { rl, input, supportsRawMode } = createReadline(stdInput, stdOutput);

  const mentionPreview = new MentionPreview(rl, files, slashCommands, stdOutput);

  // Initialize paste state for bracketed paste detection
  const pasteState = createPasteState();
  let contextualHelpVisible = false;
  let renderedContextualHelpLines = 0;

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

  const getActiveContextualHelpLines = (): string[] => {
    if (!contextualHelpVisible) {
      return [];
    }
    const rlAny = rl as readline.Interface & { line?: string };
    const currentLine = rlAny.line ?? '';
    const width = getPromptBlockWidth(stdOutput.columns);
    return buildContextualHelpPanelLines(currentLine, width, files, slashCommands);
  };

  const renderPromptSurface = (isResize = false, hasExistingPromptBlock = true): void => {
    const helpLines = getActiveContextualHelpLines();
    renderPromptLine(
      rl,
      getActiveStatusLine(),
      stdOutput,
      isResize,
      hasExistingPromptBlock,
      suggestionText
    );
  };

  const resizeWatcher = new TerminalResizeWatcher(stdOutput, () => {
    renderPromptSurface(true, true);
    mentionPreview.handleResize();
  });

  // Render initial prompt with status line (was missing - caused status to only show on typing)
  renderPromptSurface(false, false);

  const initialLine = sanitizeRenderLine(initialValue ?? '');
  if (initialLine.length > 0) {
    const rlAny = rl as readline.Interface & { line: string; cursor: number };
    rlAny.line = initialLine;
    rlAny.cursor = initialLine.length;
    renderPromptSurface(false, true);
  }

  // Override readline's _refreshLine to use our renderPromptLine instead.
  // readline's default _refreshLine miscalculates cursor position when the
  // prompt contains ANSI escape codes (chalk styling), causing the cursor
  // to appear on top of typed text rather than after it.
  const rlInternal = rl as readline.Interface & { _refreshLine?: () => void };
  const originalRefreshLine = typeof rlInternal._refreshLine === 'function'
    ? rlInternal._refreshLine.bind(rlInternal)
    : undefined;

  if (typeof rlInternal._refreshLine === 'function') {
    rlInternal._refreshLine = () => {
      if (!pasteState.isInPaste) {
        renderPromptLine(rl, statusLine, stdOutput);
      }
    };
  }

  return new Promise<PromptResult>((resolve) => {
    let ctrlCCount = 0;
    let closed = false;
    let inlineImageScanTimeout: NodeJS.Timeout | undefined;
    let inlineImageRetryCount = 0;
    const MAX_INLINE_IMAGE_RETRIES = 12;
    const rlInternal = rl as readline.Interface & { _refreshLine?: () => void };
    const originalRefreshLine = typeof rlInternal._refreshLine === 'function'
      ? rlInternal._refreshLine.bind(rlInternal)
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

    const cleanup = () => {
      if (closed) return;
      closed = true;
      // Clear paste timeout if any
      if (pasteState.timeout) {
        clearTimeout(pasteState.timeout);
        pasteState.timeout = undefined;
      }
      if (inlineImageScanTimeout) {
        clearTimeout(inlineImageScanTimeout);
        inlineImageScanTimeout = undefined;
      }
      // Disable bracketed paste mode and ensure cursor is visible
      disableBracketedPaste(stdOutput);
      stdOutput.write('\x1b[?25h');
      if (contextualHelpVisible) {
        contextualHelpVisible = false;
      }
      mentionPreview.dispose();
      resizeWatcher.dispose();
      input.off('keypress', handleKeypress);
      input.off('data', handleInputData);
      if (originalRefreshLine) {
        rlInternal._refreshLine = originalRefreshLine;
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

    const insertAtCursor = (text: string) => {
      const rlAny = rl as readline.Interface & { line: string; cursor: number; _refreshLine?: () => void };
      const before = rlAny.line.slice(0, rlAny.cursor);
      const after = rlAny.line.slice(rlAny.cursor);
      rlAny.line = before + text + after;
      rlAny.cursor = before.length + text.length;

      renderActivePrompt();
    };

    const refreshLine = () => {
      renderActivePrompt();
    };

    if (typeof rlInternal._refreshLine === 'function') {
      rlInternal._refreshLine = () => {
        if (!closed && !pasteState.isInPaste) {
          renderActivePrompt();
        }
      };
    }

    const applyDetectedImagesToLine = (processedText: string) => {
      const rlAny = rl as readline.Interface & { line: string; cursor: number };
      const display = getContentDisplay(processedText);

      if (display.isPasted) {
        pasteState.hiddenContent = display.actual;
        rlAny.line = display.visual;
      } else {
        pasteState.hiddenContent = undefined;
        rlAny.line = display.actual;
      }

      rlAny.cursor = rlAny.line.length;
      refreshLine();
    };

    const replaceDroppedImagesInline = (): boolean => {
      if (!onImageDetected) {
        return false;
      }

      const rlAny = rl as readline.Interface & { line: string };
      const sourceText = pasteState.hiddenContent ?? rlAny.line ?? '';
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

    const handleInputData = () => {
      // Catch drag/drop payloads even when terminal does not emit keypress
      // events for each pasted character.
      scheduleInlineImageScan();
    };

    const handleKeypress = (_str: string, key: readline.Key) => {
      // Detect bracketed paste start: ESC[200~ (Node names this 'paste-start')
      if (key?.name === 'paste-start') {
        pasteState.isInPaste = true;
        pasteState.buffer = '';
        pasteState.outputSuppressed = true;
        outputGuard.setSuppressed(true);

        if (pasteState.timeout) {
          clearTimeout(pasteState.timeout);
        }

        // Save any existing line content (what user typed before pasting)
        const rlAny = rl as readline.Interface & { line: string; cursor: number };
        pasteState.prefixContent = rlAny.line || '';

        return;
      }

      // Detect bracketed paste end: ESC[201~ (Node names this 'paste-end')
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
          handlePasteComplete(pasteState, rl, stdOutput);
          // Schedule a deferred fallback scan in case the synchronous
          // replacement missed (e.g. file not yet materialized).
          scheduleInlineImageScan(10);
        }
        return;
      }

      // During paste, accumulate ALL input to buffer (including newlines)
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
            handlePasteComplete(pasteState, rl, stdOutput);
            scheduleInlineImageScan(10);
          }
        }, 50);

        return; // Don't process normally during paste
      }

      // Backspace/delete on paste indicator: drop reference token from the line.
      // Users should be able to remove the compact pasted marker without restoring
      // the full pasted content into the composer.
      if ((key?.name === 'backspace' || key?.name === 'delete') && pasteState.hiddenContent) {
        const rlAny = rl as readline.Interface & { line: string; cursor: number; _refreshLine?: () => void };
        const stripped = removePastedReferenceFromLine(rlAny.line ?? '');
        if (stripped) {
          rlAny.line = stripped.line;
          rlAny.cursor = stripped.cursor;
        } else {
          rlAny.line = '';
          rlAny.cursor = 0;
        }
        pasteState.hiddenContent = undefined;

        // Refresh display with boxed renderer.
        renderActivePrompt();
        return;
      }

      // '?' on empty input toggles contextual shortcut help.
      if (_str === '?' && !key?.ctrl && !key?.meta) {
        const rlAny = rl as readline.Interface & { line: string; cursor: number };
        const typedLine = rlAny.line ?? '';
        if (typedLine.trim() === '?') {
          const markerIndex = Math.max(0, (rlAny.cursor ?? typedLine.length) - 1);
          if (typedLine[markerIndex] === '?') {
            rlAny.line = `${typedLine.slice(0, markerIndex)}${typedLine.slice(markerIndex + 1)}`;
            rlAny.cursor = markerIndex;
          } else {
            rlAny.line = typedLine.replace(/\?/g, '');
            rlAny.cursor = rlAny.line.length;
          }
          setContextualHelpVisible(!contextualHelpVisible);
          return;
        }
      }

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

      if (isPlainTabShortcut(_str, key)) {
        const rlAny = rl as readline.Interface & { line: string; cursor: number };
        const currentInput = rlAny.line ?? '';
        const suggestion = getPrimaryHotTipSuggestion(currentInput, files, slashCommands, suggestionText);
        if (suggestion) {
          rlAny.line = suggestion.line;
          rlAny.cursor = suggestion.cursor;
          renderActivePrompt();
        }
        return;
      }

      // Shift+Enter or Alt+Enter: insert newline marker (max 3 lines)
      if (key?.name === 'return' && (key.shift || key.meta)) {
        const currentMarkers = countNewlineMarkers(rl.line || '');
        if (currentMarkers < MAX_NEWLINES) {
          insertAtCursor(NEWLINE_MARKER);
        }
        return;
      }

      // Ctrl+C: clear input or exit
      if (key?.name === 'c' && key.ctrl) {
        const currentInput = rl.line || '';
        
        if (currentInput.length > 0) {
          // Clear the input
          mentionPreview.reset();
          if (contextualHelpVisible) {
            setContextualHelpVisible(false);
          }
          const rlAny = rl as readline.Interface & { line: string; cursor: number };
          rlAny.line = '';
          rlAny.cursor = 0;
          readline.cursorTo(stdOutput, 0);
          readline.clearLine(stdOutput, 0);
          rl.prompt(true);
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

      // Reset Ctrl+C counter on any other key
      ctrlCCount = 0;

      // Some terminals send drag/drop as rapid keypresses without bracketed-paste
      // delimiters. Scan the current line after keypress idle to replace image paths
      // with [Image #N] placeholders inline.
      scheduleInlineImageScan();

      if (contextualHelpVisible && shouldAutoHideShortcutHelp(_str, key)) {
        setContextualHelpVisible(false);
      }

      // Force a post-keypress repaint so border/mode styling follows the
      // latest readline buffer even on terminals where _refreshLine timing
      // can run one keystroke behind.
      setImmediate(() => {
        if (!closed && !pasteState.isInPaste) {
          renderActivePrompt();
        }
      });
    };

    input.on('keypress', handleKeypress);
    input.on('data', handleInputData);

    rl.on('line', (value) => {
      // Ignore line events during paste mode - we're buffering
      if (pasteState.isInPaste) {
        return;
      }

      // If we have hidden content from a large paste, use that instead of visual
      let finalValue = pasteState.hiddenContent || value;

      // Clear hidden content after use
      pasteState.hiddenContent = undefined;

      // Convert newline markers back to actual newlines
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
        // Re-prompt without sending to LLM
        stdOutput.write('\n');
        renderPromptLine(rl, getActiveStatusLine(), stdOutput, false, false, suggestionText);
        return;
      }

      mentionPreview.reset();
      leavePromptSurface(stdOutput, STATUS_LINE_COUNT, true);
      // Show interrupt hint when user submits a non-empty, non-command instruction
      if (finalValue && !finalValue.startsWith('/')) {
        stdOutput.write(`${chalk.gray('press ESC to interrupt')}\n`);
        stdOutput.write('\n');
      }
      cleanup();
      resolve({ kind: 'submit', value: finalValue });
    });

    rl.on('SIGINT', () => {
      const currentInput = rl.line || '';
      
      if (currentInput.length > 0) {
        mentionPreview.reset();
        if (contextualHelpVisible) {
          setContextualHelpVisible(false);
        }
        const rlAny = rl as readline.Interface & { line: string; cursor: number };
        rlAny.line = '';
        rlAny.cursor = 0;
        readline.cursorTo(stdOutput, 0);
        readline.clearLine(stdOutput, 0);
        rl.prompt(true);
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

function renderPromptLine(
  rl: readline.Interface,
  statusLine: string | { left: string; right: string } | undefined,
  output: NodeJS.WriteStream,
  isResize = false,
  hasExistingPromptBlock = true,
  suggestionText?: string
): void {
  const width = getPromptBlockWidth(output.columns);
  const rlAny = rl as readline.Interface & { cursor?: number; line?: string };
  const currentLine = rlAny.line ?? '';
  const cursorPos = rlAny.cursor ?? currentLine.length;
  const prompt = buildPromptRenderState(currentLine, cursorPos, width, suggestionText);
  const borderStyle = getComposerBorderStyle(currentLine);
  const topBorder = drawInputTopBorder(width, borderStyle);
  const bottomBorder = drawInputBottomBorder(width, borderStyle);
  const statusRow = formatPromptStatusRow(statusLine, width);

  // Keep readline's prompt in sync for line editing internals.
  rl.setPrompt(PROMPT_PREFIX);

  // Hide cursor during rendering to prevent flicker/slow blinking.
  // The cursor visibly jumps as lines are cleared and rewritten;
  // hiding it produces a clean, natural blink at the final position.
  output.write('\x1b[?25l');

  if (isResize) {
    readline.cursorTo(output, 0);
    readline.clearScreenDown(output);
  } else if (hasExistingPromptBlock) {
    // Cursor normally sits on the input row.
    // Clear the full prompt block in place before re-drawing.
    readline.cursorTo(output, 0);
    for (let i = 0; i < PROMPT_LINES_ABOVE_INPUT; i++) {
      readline.moveCursor(output, 0, -1);
      readline.clearLine(output, 0);
    }
    readline.cursorTo(output, 0);
    readline.clearLine(output, 0);
    for (let i = 0; i < PROMPT_LINES_BELOW_INPUT + STATUS_LINE_COUNT; i++) {
      readline.moveCursor(output, 0, 1);
      readline.clearLine(output, 0);
    }
    for (let i = 0; i < PROMPT_LINES_BELOW_INPUT + STATUS_LINE_COUNT; i++) {
      readline.moveCursor(output, 0, -1);
    }
    readline.cursorTo(output, 0);
  } else {
    // Initial render: the cursor has been placed on a fresh row by createReadline,
    // but defensively clear the current line before drawing the top border to
    // eliminate any residual characters that could cause a one-frame flash.
    readline.cursorTo(output, 0);
    readline.clearLine(output, 0);
  }

  // Render top border, input row, bottom border, and status row.
  output.write(`${topBorder}\n`);
  output.write(`${prompt.lineText}\n`);
  output.write(`${bottomBorder}\n`);
  output.write(statusRow);

  // Move cursor back to input row, inside the box.
  // +1 accounts for the left | border character added by drawInputBox.
  readline.moveCursor(output, 0, -(PROMPT_LINES_BELOW_INPUT + STATUS_LINE_COUNT));
  readline.cursorTo(output, prompt.cursorColumn + 1);

  // Show cursor at its final, correct position.
  output.write('\x1b[?25h');
}
