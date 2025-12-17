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
 * Format a diff for terminal display
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
    return chalk.gray('No changes');
  }

  const hunks = parseIntoHunks(changes, contextLines);
  const output: string[] = [];

  // Header
  if (filePath) {
    output.push(chalk.cyan('─'.repeat(60)));
    output.push(chalk.cyan.bold(`  ${filePath}`));
    output.push(chalk.cyan('─'.repeat(60)));
  }

  for (const hunk of hunks) {
    // Hunk header
    output.push(chalk.cyan(`@@ -${hunk.oldStart},${hunk.oldLines.length} +${hunk.newStart},${hunk.newLines.length} @@`));

    let oldLineNum = hunk.oldStart;
    let newLineNum = hunk.newStart;

    for (const change of hunk.changes) {
      const line = change.value.replace(/\n$/, '');

      if (change.added) {
        const highlighted = lang !== 'text' ? highlight(line, lang) : line;
        if (showLineNumbers) {
          output.push(chalk.green(`+${String(newLineNum).padStart(4)} │ `) + chalk.green(highlighted));
        } else {
          output.push(chalk.green(`+ ${highlighted}`));
        }
        newLineNum++;
      } else if (change.removed) {
        const highlighted = lang !== 'text' ? highlight(line, lang) : line;
        if (showLineNumbers) {
          output.push(chalk.red(`-${String(oldLineNum).padStart(4)} │ `) + chalk.red(highlighted));
        } else {
          output.push(chalk.red(`- ${highlighted}`));
        }
        oldLineNum++;
      } else {
        const highlighted = lang !== 'text' ? highlight(line, lang) : line;
        if (showLineNumbers) {
          output.push(chalk.gray(` ${String(oldLineNum).padStart(4)} │ `) + chalk.gray(highlighted));
        } else {
          output.push(chalk.gray(`  ${highlighted}`));
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
  console.log(
    chalk.gray('Changes: ') +
    chalk.green(`+${stats.additions}`) +
    chalk.gray(' / ') +
    chalk.red(`-${stats.deletions}`)
  );
  console.log();

  // Interactive prompt
  const { Select, Editor } = enquirer as any;

  const actionPrompt = new Select({
    name: 'action',
    message: `Apply changes${filePath ? ` to ${filePath}` : ''}?`,
    choices: [
      { name: 'accept', message: chalk.green('Accept') + ' - Apply all changes' },
      { name: 'reject', message: chalk.red('Reject') + ' - Keep original' },
      { name: 'edit', message: chalk.yellow('Edit') + ' - Modify the new content' },
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
  console.log(
    chalk.gray('Changes: ') +
    chalk.green(`+${stats.additions}`) +
    chalk.gray(' / ') +
    chalk.red(`-${stats.deletions}`)
  );

  const { Confirm } = enquirer as any;
  const prompt = new Confirm({
    name: 'confirm',
    message: `Apply changes${filePath ? ` to ${filePath}` : ''}?`,
  });

  try {
    return await prompt.run();
  } catch {
    return false;
  }
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
  console.log(
    chalk.gray('Changes: ') +
    chalk.green(`+${stats.additions}`) +
    chalk.gray(' / ') +
    chalk.red(`-${stats.deletions}`)
  );
}
