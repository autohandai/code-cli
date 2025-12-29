/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Interactive Diff Viewer
 * Allows users to accept, reject, or edit changes
 */
import chalk from 'chalk';
import { diffLines } from 'diff';
import enquirer from 'enquirer';
import { highlight, detectLanguage } from './syntaxHighlight.js';
import { confirm as unifiedConfirm, select as unifiedSelect, isExternalCallbackEnabled } from './promptCallback.js';
import { getTheme, isThemeInitialized } from './theme/index.js';

export interface DiffViewerOptions {
  filePath?: string;
  language?: string;
  showLineNumbers?: boolean;
  contextLines?: number;
}

export interface DiffResult {
  accepted: boolean;
  content: string;
  editedByUser: boolean;
}

interface SimplifiedChange {
  value: string;
  added?: boolean;
  removed?: boolean;
  count?: number;
}

interface DiffHunk {
  oldStart: number;
  oldLines: string[];
  newStart: number;
  newLines: string[];
  changes: SimplifiedChange[];
}

/**
 * Parse diff into hunks for easier display
 */
function parseIntoHunks(changes: SimplifiedChange[], contextLines = 3): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let oldLine = 1;
  let newLine = 1;
  let unchangedBuffer: string[] = [];

  for (const change of changes) {
    const lines = change.value.split('\n').filter((l, i, arr) => i < arr.length - 1 || l !== '');

    if (!change.added && !change.removed) {
      // Unchanged lines
      if (currentHunk) {
        // Add trailing context
        const trailing = lines.slice(0, contextLines);
        for (const line of trailing) {
          currentHunk.oldLines.push(line);
          currentHunk.newLines.push(line);
          currentHunk.changes.push({ value: line + '\n', count: 1 });
        }

        if (lines.length > contextLines * 2) {
          // Close current hunk and save leading context for next
          hunks.push(currentHunk);
          currentHunk = null;
          unchangedBuffer = lines.slice(-contextLines);
        }
      } else {
        // Save for leading context
        unchangedBuffer = lines.slice(-contextLines);
      }

      oldLine += lines.length;
      newLine += lines.length;
    } else {
      // Changed lines - start new hunk if needed
      if (!currentHunk) {
        currentHunk = {
          oldStart: oldLine - unchangedBuffer.length,
          oldLines: [...unchangedBuffer],
          newStart: newLine - unchangedBuffer.length,
          newLines: [...unchangedBuffer],
          changes: unchangedBuffer.map(l => ({ value: l + '\n', count: 1 })),
        };
      }

      if (change.added) {
        for (const line of lines) {
          currentHunk!.newLines.push(line);
          currentHunk!.changes.push({ value: line + '\n', added: true, count: 1 });
        }
        newLine += lines.length;
      } else {
        for (const line of lines) {
          currentHunk!.oldLines.push(line);
          currentHunk!.changes.push({ value: line + '\n', removed: true, count: 1 });
        }
        oldLine += lines.length;
      }

      unchangedBuffer = [];
    }
  }

  if (currentHunk) {
    hunks.push(currentHunk);
  }

  return hunks;
}

/**
 * Format a diff for terminal display with background highlighting
 * Style: green background for additions, red background for deletions
 * Preserves syntax highlighting within the diff
 */
export function formatDiff(
  oldContent: string,
  newContent: string,
  options: DiffViewerOptions = {}
): string {
  const { filePath, language, showLineNumbers = true, contextLines = 3 } = options;
  const lang = language || detectLanguage(filePath);
  const changes = diffLines(oldContent, newContent);

  if (changes.length === 1 && !changes[0].added && !changes[0].removed) {
    if (isThemeInitialized()) {
      return getTheme().fg('muted', 'No changes');
    }
    return chalk.gray('No changes');
  }

  const hunks = parseIntoHunks(changes, contextLines);
  const output: string[] = [];
  const stats = getDiffStats(oldContent, newContent);
  const termWidth = process.stdout.columns || 100;

  // Header with stats - "Added X lines, removed Y line"
  const addText = stats.additions === 1 ? '1 line' : `${stats.additions} lines`;
  const delText = stats.deletions === 1 ? '1 line' : `${stats.deletions} lines`;
  if (isThemeInitialized()) {
    const theme = getTheme();
    output.push(theme.fg('muted', `  Added ${theme.fg('diffAdded', addText)}, removed ${theme.fg('diffRemoved', delText)}`));
  } else {
    output.push(chalk.gray(`  Added ${chalk.green(addText)}, removed ${chalk.red(delText)}`));
  }

  for (const hunk of hunks) {
    let oldLineNum = hunk.oldStart;
    let newLineNum = hunk.newStart;

    for (const change of hunk.changes) {
      const line = change.value.replace(/\n$/, '');
      // Apply syntax highlighting first
      const highlighted = lang !== 'text' ? highlight(line, lang) : line;

      if (change.added) {
        // Green background for additions with + indicator
        const lineNum = String(newLineNum).padStart(3);
        if (isThemeInitialized()) {
          const theme = getTheme();
          const prefix = theme.bg('diffAdded', theme.fg('text', ` ${lineNum} + `));
          // Use dim green background for the content area
          const content = chalk.bgRgb(30, 50, 30)(` ${highlighted} `.padEnd(termWidth - 10));
          output.push(prefix + content);
        } else {
          const prefix = chalk.bgGreen.black(` ${lineNum} + `);
          const content = chalk.bgRgb(30, 50, 30)(` ${highlighted} `.padEnd(termWidth - 10));
          output.push(prefix + content);
        }
        newLineNum++;
      } else if (change.removed) {
        // Red background for deletions with - indicator
        const lineNum = String(oldLineNum).padStart(3);
        if (isThemeInitialized()) {
          const theme = getTheme();
          const prefix = theme.bg('diffRemoved', theme.fg('text', ` ${lineNum} - `));
          // Use dim red background for the content area
          const content = chalk.bgRgb(60, 30, 30)(` ${highlighted} `.padEnd(termWidth - 10));
          output.push(prefix + content);
        } else {
          const prefix = chalk.bgRed.white(` ${lineNum} - `);
          const content = chalk.bgRgb(60, 30, 30)(` ${highlighted} `.padEnd(termWidth - 10));
          output.push(prefix + content);
        }
        oldLineNum++;
      } else {
        // Context lines - no background
        const lineNum = String(oldLineNum).padStart(3);
        if (showLineNumbers) {
          if (isThemeInitialized()) {
            output.push(getTheme().fg('diffContext', ` ${lineNum}   `) + ` ${highlighted}`);
          } else {
            output.push(chalk.gray(` ${lineNum}   `) + ` ${highlighted}`);
          }
        } else {
          output.push(`  ${highlighted}`);
        }
        oldLineNum++;
        newLineNum++;
      }
    }
  }

  return output.join('\n');
}

/**
 * Calculate diff statistics
 */
export function getDiffStats(oldContent: string, newContent: string): { additions: number; deletions: number; changes: number } {
  const changes = diffLines(oldContent, newContent);
  let additions = 0;
  let deletions = 0;

  for (const change of changes) {
    const lineCount = change.value.split('\n').filter((l, i, arr) => i < arr.length - 1 || l !== '').length;
    if (change.added) {
      additions += lineCount;
    } else if (change.removed) {
      deletions += lineCount;
    }
  }

  return { additions, deletions, changes: additions + deletions };
}

/**
 * Interactive diff viewer - allows accept/reject/edit
 */
export async function showInteractiveDiff(
  oldContent: string,
  newContent: string,
  options: DiffViewerOptions = {}
): Promise<DiffResult> {
  const { filePath } = options;
  const stats = getDiffStats(oldContent, newContent);

  // Show the diff
  console.log();
  console.log(formatDiff(oldContent, newContent, options));
  console.log();

  // Show stats
  if (isThemeInitialized()) {
    const theme = getTheme();
    console.log(
      theme.fg('muted', 'Changes: ') +
      theme.fg('diffAdded', `+${stats.additions}`) +
      theme.fg('muted', ' / ') +
      theme.fg('diffRemoved', `-${stats.deletions}`)
    );
  } else {
    console.log(
      chalk.gray('Changes: ') +
      chalk.green(`+${stats.additions}`) +
      chalk.gray(' / ') +
      chalk.red(`-${stats.deletions}`)
    );
  }
  console.log();

  // Use unified prompt for external callback mode
  if (isExternalCallbackEnabled()) {
    const action = await unifiedSelect<'accept' | 'reject'>(
      `Apply changes${filePath ? ` to ${filePath}` : ''}?`,
      [
        { name: 'accept', message: 'Accept - Apply all changes' },
        { name: 'reject', message: 'Reject - Keep original' },
      ]
    );

    if (action === 'accept') {
      return { accepted: true, content: newContent, editedByUser: false };
    }
    return { accepted: false, content: oldContent, editedByUser: false };
  }

  // Interactive prompt (local mode with edit support)
  const { Select, Editor } = enquirer as any;

  let acceptLabel = chalk.green('Accept');
  let rejectLabel = chalk.red('Reject');
  let editLabel = chalk.yellow('Edit');
  if (isThemeInitialized()) {
    const theme = getTheme();
    acceptLabel = theme.fg('success', 'Accept');
    rejectLabel = theme.fg('error', 'Reject');
    editLabel = theme.fg('warning', 'Edit');
  }

  const actionPrompt = new Select({
    name: 'action',
    message: `Apply changes${filePath ? ` to ${filePath}` : ''}?`,
    choices: [
      { name: 'accept', message: acceptLabel + ' - Apply all changes' },
      { name: 'reject', message: rejectLabel + ' - Keep original' },
      { name: 'edit', message: editLabel + ' - Modify the new content' },
    ],
  });

  try {
    const action = await actionPrompt.run();

    switch (action) {
      case 'accept':
        return { accepted: true, content: newContent, editedByUser: false };

      case 'reject':
        return { accepted: false, content: oldContent, editedByUser: false };

      case 'edit': {
        const editorPrompt = new Editor({
          name: 'content',
          message: 'Edit the content:',
          initial: newContent,
        });

        try {
          const editedContent = await editorPrompt.run();
          return { accepted: true, content: editedContent, editedByUser: true };
        } catch {
          // Editor cancelled
          return { accepted: false, content: oldContent, editedByUser: false };
        }
      }

      default:
        return { accepted: false, content: oldContent, editedByUser: false };
    }
  } catch {
    // Prompt cancelled (Ctrl+C)
    return { accepted: false, content: oldContent, editedByUser: false };
  }
}

/**
 * Show diff with simple accept/reject (no edit option)
 */
export async function confirmDiff(
  oldContent: string,
  newContent: string,
  options: DiffViewerOptions = {}
): Promise<boolean> {
  const { filePath } = options;
  const stats = getDiffStats(oldContent, newContent);

  // Show the diff
  console.log();
  console.log(formatDiff(oldContent, newContent, options));
  console.log();

  // Show stats
  if (isThemeInitialized()) {
    const theme = getTheme();
    console.log(
      theme.fg('muted', 'Changes: ') +
      theme.fg('diffAdded', `+${stats.additions}`) +
      theme.fg('muted', ' / ') +
      theme.fg('diffRemoved', `-${stats.deletions}`)
    );
  } else {
    console.log(
      chalk.gray('Changes: ') +
      chalk.green(`+${stats.additions}`) +
      chalk.gray(' / ') +
      chalk.red(`-${stats.deletions}`)
    );
  }

  // Use unified prompt (works for both local and external callback modes)
  return unifiedConfirm(`Apply changes${filePath ? ` to ${filePath}` : ''}?`);
}

/**
 * Display diff without interaction (for preview)
 */
export function displayDiff(
  oldContent: string,
  newContent: string,
  options: DiffViewerOptions = {}
): void {
  const stats = getDiffStats(oldContent, newContent);

  console.log();
  console.log(formatDiff(oldContent, newContent, options));
  console.log();
  if (isThemeInitialized()) {
    const theme = getTheme();
    console.log(
      theme.fg('muted', 'Changes: ') +
      theme.fg('diffAdded', `+${stats.additions}`) +
      theme.fg('muted', ' / ') +
      theme.fg('diffRemoved', `-${stats.deletions}`)
    );
  } else {
    console.log(
      chalk.gray('Changes: ') +
      chalk.green(`+${stats.additions}`) +
      chalk.gray(' / ') +
      chalk.red(`-${stats.deletions}`)
    );
  }
}
