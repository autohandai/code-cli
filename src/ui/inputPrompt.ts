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
import {
  type ImageMimeType,
  parseBase64DataUrl,
  getMimeTypeFromExtension,
} from '../core/ImageManager.js';
import { getContentDisplay } from './displayUtils.js';

// Shared prompt prefix for the main instruction input
export const PROMPT_PREFIX = `${chalk.gray('›')} `;
// Visible length of the prompt prefix (ANSI codes not counted)
export const PROMPT_VISIBLE_LENGTH = 2;
// Number of fixed status lines we render beneath the prompt
export const STATUS_LINE_COUNT = 1;

export type SlashCommandHint = SlashCommand;

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
    buffer: ''
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
  statusLine?: string,
  io: PromptIO = {},
  onImageDetected?: ImageDetectedCallback,
  workspaceRoot?: string
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
        stdInput,
        stdOutput,
        onImageDetected,
        workspaceRoot
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
  statusLine?: string;
  stdInput: NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void };
  stdOutput: NodeJS.WriteStream;
  onImageDetected?: ImageDetectedCallback;
  workspaceRoot?: string;
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
  // Reset terminal state before creating new readline
  // This ensures cursor position and output buffer are clean
  stdOutput.write('\r'); // Move cursor to column 0

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
    input.setRawMode(true);
  }
  input.resume();
  input.setEncoding('utf8');

  return { rl, input, supportsRawMode };
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

  // Clear all the extra lines that readline printed during paste
  // Move cursor up for each newline, clearing as we go
  for (let i = 0; i < newlineCount; i++) {
    readline.moveCursor(output, 0, -1); // Move up one line
    readline.clearLine(output, 0); // Clear that line
  }

  // Now we're back at the original prompt line - clear it too
  readline.cursorTo(output, 0);
  readline.clearLine(output, 0);

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
  pasteState.prefixContent = undefined;
}

async function promptOnce(options: PromptOnceOptions): Promise<PromptResult> {
  const { files, slashCommands, statusLine, stdInput, stdOutput, onImageDetected, workspaceRoot } = options;
  const { rl, input, supportsRawMode } = createReadline(stdInput, stdOutput);

  // Don't pass statusLine to MentionPreview - renderPromptLine handles the status display
  // MentionPreview only shows suggestions (@ mentions, / commands)
  const mentionPreview = new MentionPreview(rl, files, slashCommands, stdOutput);

  // Initialize paste state for bracketed paste detection
  const pasteState = createPasteState();

  const resizeWatcher = new TerminalResizeWatcher(stdOutput, () => {
    renderPromptLine(rl, statusLine, stdOutput, true);
    mentionPreview.handleResize();
  });

  // Render initial prompt with status line (was missing - caused status to only show on typing)
  renderPromptLine(rl, statusLine, stdOutput);

  return new Promise<PromptResult>((resolve) => {
    let ctrlCCount = 0;
    let closed = false;
    let inlineImageScanTimeout: NodeJS.Timeout | undefined;
    let inlineImageRetryCount = 0;
    const MAX_INLINE_IMAGE_RETRIES = 12;

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
      // Disable bracketed paste mode
      disableBracketedPaste(stdOutput);
      mentionPreview.dispose();
      resizeWatcher.dispose();
      input.off('keypress', handleKeypress);
      input.off('data', handleInputData);
      if (supportsRawMode && input.isTTY) {
        input.setRawMode(false);
      }
      input.pause();
      rl.close();
    };

    const insertAtCursor = (text: string) => {
      const rlAny = rl as readline.Interface & { line: string; cursor: number; _refreshLine?: () => void };
      const before = rlAny.line.slice(0, rlAny.cursor);
      const after = rlAny.line.slice(rlAny.cursor);
      rlAny.line = before + text + after;
      rlAny.cursor = before.length + text.length;

      // Use atomic refresh to avoid triple rendering
      // _refreshLine is a stable internal method that handles cursor positioning
      if (typeof rlAny._refreshLine === 'function') {
        rlAny._refreshLine();
      } else {
        // Fallback for environments where _refreshLine is not available
        readline.cursorTo(stdOutput, 0);
        readline.clearLine(stdOutput, 0);
        rl.prompt(true);
      }
    };

    const refreshLine = () => {
      const rlAny = rl as readline.Interface & { _refreshLine?: () => void };
      if (typeof rlAny._refreshLine === 'function') {
        rlAny._refreshLine();
      } else {
        readline.cursorTo(stdOutput, 0);
        readline.clearLine(stdOutput, 0);
        rl.prompt(true);
      }
    };

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
          // Process images in the paste buffer BEFORE handlePasteComplete
          // sets rl.line — this is the earliest moment where the temp file
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

      // Backspace on indicator: expand to full content
      if (key?.name === 'backspace' && pasteState.hiddenContent) {
        const rlAny = rl as readline.Interface & { line: string; cursor: number; _refreshLine?: () => void };

        // Replace indicator with actual content (convert newlines to markers for display)
        const displayContent = pasteState.hiddenContent.split('\n').join(NEWLINE_MARKER);
        rlAny.line = displayContent;
        rlAny.cursor = displayContent.length;
        pasteState.hiddenContent = undefined;

        // Refresh display
        if (typeof rlAny._refreshLine === 'function') {
          rlAny._refreshLine();
        } else {
          readline.cursorTo(stdOutput, 0);
          readline.clearLine(stdOutput, 0);
          rl.prompt(true);
        }
        return;
      }

      // Shift+Tab: toggle plan mode on/off
      if (key?.name === 'tab' && key.shift) {
        const planModeManager = getPlanModeManager();
        const wasEnabled = planModeManager.isEnabled();
        planModeManager.handleShiftTab();

        // Show immediate feedback
        if (wasEnabled) {
          stdOutput.write(`\n${chalk.gray('Plan mode')} ${chalk.red('OFF')}\n`);
        } else {
          stdOutput.write(`\n${chalk.bgCyan.black.bold(' PLAN ')} ${chalk.cyan('Plan mode ON - read-only tools')}\n`);
        }
        renderPromptLine(rl, statusLine, stdOutput);
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
          stdOutput.write(`\n${chalk.gray('Press Ctrl+C again to exit.')}\n`);
          renderPromptLine(rl, statusLine, stdOutput);
          return;
        }
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
    };

    input.on('keypress', handleKeypress);
    input.on('data', handleInputData);

    // Note: renderPromptLine already called rl.setPrompt() and rl.prompt()
    // No need to call them again here

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

      // Handle shell commands (prefix with !)
      if (isShellCommand(finalValue)) {
        const shellCmd = parseShellCommand(finalValue);
        stdOutput.write('\n');
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
        renderPromptLine(rl, statusLine, stdOutput);
        return;
      }

      stdOutput.write('\n');
      // Show interrupt hint when user submits a non-empty, non-command instruction
      if (finalValue && !finalValue.startsWith('/')) {
        stdOutput.write(`${chalk.gray('press ESC to interrupt')}\n\n`);
      }
      cleanup();
      resolve({ kind: 'submit', value: finalValue });
    });

    rl.on('SIGINT', () => {
      const currentInput = rl.line || '';
      
      if (currentInput.length > 0) {
        mentionPreview.reset();
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
        stdOutput.write(`\n${chalk.gray('Press Ctrl+C again to exit.')}\n`);
        renderPromptLine(rl, statusLine, stdOutput);
        return;
      }
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

import { drawInputBox } from './box.js';

function renderPromptLine(rl: readline.Interface, statusLine: string | undefined, output: NodeJS.WriteStream, isResize = false): void {
  const width = Math.max(20, output.columns || 80);
  const status = (statusLine ?? ' ').padEnd(width).slice(0, width);
  const rlAny = rl as readline.Interface & { cursor?: number; line?: string };
  const box = drawInputBox(status, width);
  const currentLine = rlAny.line ?? '';
  const cursorPos = rlAny.cursor ?? currentLine.length;

  // Keep readline's prompt in sync with the prefix we render
  rl.setPrompt(PROMPT_PREFIX);

  // Clear prompt + status line region
  readline.cursorTo(output, 0);
  if (isResize) {
    readline.clearScreenDown(output);
  } else {
    readline.clearLine(output, 0);
    readline.moveCursor(output, 0, 1);
    readline.clearLine(output, 0);
    readline.moveCursor(output, 0, -1);
  }

  // Render prompt/input then status directly below
  output.write(`${PROMPT_PREFIX}${currentLine}\n`);
  output.write(box);

  // Move cursor back to prompt line at correct column
  readline.moveCursor(output, 0, -1);
  readline.cursorTo(output, PROMPT_VISIBLE_LENGTH + cursorPos);
}
