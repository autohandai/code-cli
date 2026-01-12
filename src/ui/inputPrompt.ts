/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import readline from 'node:readline';
import { existsSync, readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { TerminalResizeWatcher } from './terminalResize.js';
import type { SlashCommand } from '../core/slashCommands.js';
import { MentionPreview } from './mentionPreview.js';
import {
  type ImageMimeType,
  isImagePath,
  isBase64Image,
  parseBase64DataUrl,
  getMimeTypeFromExtension,
} from '../core/ImageManager.js';

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
  onImageDetected?: ImageDetectedCallback
): Promise<string | null> {
  const stdInput = (io.input ?? process.stdin) as NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void };
  const stdOutput = (io.output ?? process.stdout) as NodeJS.WriteStream;

  // Keep the process alive during UI handoffs (readline <-> Ink)
  const keepAlive = setInterval(() => {}, 10_000);

  try {
    while (true) {
      const result = await promptOnce({
        files,
        slashCommands,
        statusLine,
        stdInput,
        stdOutput,
        onImageDetected
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

  return { rl, input, supportsRawMode };
}

async function promptOnce(options: PromptOnceOptions): Promise<PromptResult> {
  const { files, slashCommands, statusLine, stdInput, stdOutput, onImageDetected } = options;
  const { rl, input, supportsRawMode } = createReadline(stdInput, stdOutput);

  const mentionPreview = new MentionPreview(rl, files, slashCommands, stdOutput, statusLine);

  const resizeWatcher = new TerminalResizeWatcher(stdOutput, () => {
    mentionPreview.handleResize();
    renderPromptLine(rl, statusLine, stdOutput, true);
  });

  /**
   * Process text and detect embedded images (base64 data URLs or file paths)
   * @param text - Input text that may contain image references
   * @returns Text with image references replaced by placeholders
   */
  const processImagesInText = (text: string): string => {
    if (!onImageDetected) {
      return text;
    }

    let result = text;

    // Detect base64 image data URLs: data:image/...;base64,...
    const base64Regex = /data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g;
    const base64Matches = result.match(base64Regex) || [];

    for (const dataUrl of base64Matches) {
      const parsed = parseBase64DataUrl(dataUrl);
      if (parsed) {
        const id = onImageDetected(parsed.data, parsed.mimeType);
        result = result.replace(dataUrl, `[Image #${id}]`);
        stdOutput.write(chalk.cyan(`\n📷 Detected base64 image -> [Image #${id}]\n`));
      }
    }

    // Detect image file paths (with supported extensions)
    // Handles:
    // 1. Paths with escaped spaces: /path/to/file\ name.png
    // 2. Quoted paths: "/path/to/file name.png" or '/path/to/file name.png'
    // 3. Simple paths without spaces: /path/to/file.png

    // First, try to find quoted paths
    const quotedPathRegex = /["']([^"']+\.(?:png|jpg|jpeg|gif|webp))["']/gi;
    let quotedMatch;
    while ((quotedMatch = quotedPathRegex.exec(text)) !== null) {
      const filePath = quotedMatch[1];
      const fullMatch = quotedMatch[0];
      if (result.includes(fullMatch) && existsSync(filePath)) {
        try {
          const data = readFileSync(filePath);
          const ext = extname(filePath);
          const mimeType = getMimeTypeFromExtension(ext);
          if (mimeType) {
            const id = onImageDetected(data, mimeType, basename(filePath));
            result = result.replace(fullMatch, `[Image #${id}] ${basename(filePath)}`);
            stdOutput.write(chalk.cyan(`\n📷 Loaded image: ${filePath} -> [Image #${id}]\n`));
          }
        } catch {
          // Ignore file read errors
        }
      }
    }

    // Then, find paths with escaped spaces or regular paths
    // On macOS terminal, dragged files have spaces escaped as "\ "
    // Pattern matches: (non-space non-backslash) OR (backslash followed by any char)
    // This handles: /path/to/file\ with\ spaces.png
    const escapedPathRegex = /(?:^|[\s])((\/|~)(?:[^\s\\]|\\.)+\.(?:png|jpg|jpeg|gif|webp))(?=[\s]|$)/gi;
    let escapedMatch;

    // Debug: log input for image detection
    if (process.env.DEBUG_IMAGES) {
      stdOutput.write(chalk.gray(`\n[DEBUG] processImagesInText called\n`));
      stdOutput.write(chalk.gray(`[DEBUG] Input text: ${JSON.stringify(text)}\n`));
      stdOutput.write(chalk.gray(`[DEBUG] Has backslash: ${text.includes('\\')}\n`));
      stdOutput.write(chalk.gray(`[DEBUG] Char codes: ${text.slice(0, 50).split('').map(c => c.charCodeAt(0)).join(',')}\n`));
    }

    while ((escapedMatch = escapedPathRegex.exec(text)) !== null) {
      const rawPath = escapedMatch[1];
      // Convert escaped spaces to actual spaces for file system lookup
      const filePath = rawPath.replace(/\\ /g, ' ');

      if (process.env.DEBUG_IMAGES) {
        stdOutput.write(chalk.gray(`[DEBUG] Regex matched: ${JSON.stringify(rawPath)}\n`));
        stdOutput.write(chalk.gray(`[DEBUG] Converted path: ${JSON.stringify(filePath)}\n`));
        stdOutput.write(chalk.gray(`[DEBUG] File exists: ${existsSync(filePath)}\n`));
      }

      if (result.includes(rawPath) && existsSync(filePath)) {
        try {
          const data = readFileSync(filePath);
          const ext = extname(filePath);
          const mimeType = getMimeTypeFromExtension(ext);
          if (mimeType) {
            const id = onImageDetected(data, mimeType, basename(filePath));
            result = result.replace(rawPath, `[Image #${id}] ${basename(filePath)}`);
            stdOutput.write(chalk.cyan(`\n📷 Loaded image: ${filePath} -> [Image #${id}]\n`));
          }
        } catch {
          // Ignore file read errors
        }
      }
    }

    // Finally, simple paths without spaces (fallback)
    const simplePathRegex = /(?:^|[\s])([^\s"']+\.(?:png|jpg|jpeg|gif|webp))(?=[\s]|$)/gi;
    let simpleMatch;
    while ((simpleMatch = simplePathRegex.exec(text)) !== null) {
      const filePath = simpleMatch[1];
      // Skip if already processed (check if placeholder exists)
      if (result.includes(filePath) && !result.includes(`[Image #`) && existsSync(filePath)) {
        try {
          const data = readFileSync(filePath);
          const ext = extname(filePath);
          const mimeType = getMimeTypeFromExtension(ext);
          if (mimeType) {
            const id = onImageDetected(data, mimeType, basename(filePath));
            result = result.replace(filePath, `[Image #${id}] ${basename(filePath)}`);
            stdOutput.write(chalk.cyan(`\n📷 Loaded image: ${filePath} -> [Image #${id}]\n`));
          }
        } catch {
          // Ignore file read errors
        }
      }
    }

    return result;
  };

  return new Promise<PromptResult>((resolve) => {
    let ctrlCCount = 0;
    let closed = false;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      mentionPreview.dispose();
      resizeWatcher.dispose();
      input.off('keypress', handleKeypress);
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

    const handleKeypress = (_str: string, key: readline.Key) => {
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
    };

    input.on('keypress', handleKeypress);

    rl.setPrompt(`${chalk.gray('›')} `);
    rl.prompt(true);

    // Explicit fallback: ensure prompt is visible even if readline buffering fails
    // Use setImmediate to let rl.prompt(true) flush first, then verify prompt is visible
    setImmediate(() => {
      // Force cursor to column 0 and write prompt character explicitly
      // This handles cases where readline's internal buffer didn't render
      const promptStr = `${chalk.gray('›')} `;
      stdOutput.write(`\r${promptStr}`);
    });

    rl.on('line', (value) => {
      // Convert newline markers back to actual newlines
      let finalValue = convertNewlineMarkersToNewlines(value).trim();

      // Process any embedded images (base64 data URLs or file paths)
      finalValue = processImagesInText(finalValue);

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

  const box = drawInputBox(status, width);

  if (isResize) {
    // On resize, clear the previous status line and prompt before redrawing
    readline.moveCursor(output, 0, -2);
    readline.clearScreenDown(output);
  }

  readline.cursorTo(output, 0);
  output.write(`${box}\n`);

  rl.setPrompt(`${chalk.gray('›')} `);
  rl.prompt(true);
}
