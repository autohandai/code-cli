/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Code Linters
 * Supports eslint, pylint, clippy, golangci-lint, and more
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'fs-extra';
import os from 'node:os';
import chalk from 'chalk';

export interface LintIssue {
  file: string;
  line: number;
  column?: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  rule?: string;
  source?: string;
}

export interface LintResult {
  success: boolean;
  issues: LintIssue[];
  summary: {
    errors: number;
    warnings: number;
    infos: number;
  };
  rawOutput?: string;
}

export interface LinterInfo {
  name: string;
  command: string;
  extensions: string[];
  description: string;
  checkCmd: string[];
  installed?: boolean;
}

/**
 * Available linters with their configurations
 */
export const LINTERS: Record<string, LinterInfo> = {
  eslint: {
    name: 'eslint',
    command: 'eslint',
    extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
    description: 'Pluggable JavaScript/TypeScript linter',
    checkCmd: ['eslint', '--version'],
  },
  pylint: {
    name: 'pylint',
    command: 'pylint',
    extensions: ['.py'],
    description: 'Python static code analysis tool',
    checkCmd: ['pylint', '--version'],
  },
  ruff: {
    name: 'ruff',
    command: 'ruff',
    extensions: ['.py'],
    description: 'Extremely fast Python linter (recommended)',
    checkCmd: ['ruff', '--version'],
  },
  clippy: {
    name: 'clippy',
    command: 'cargo',
    extensions: ['.rs'],
    description: 'Rust linter with helpful suggestions',
    checkCmd: ['cargo', 'clippy', '--version'],
  },
  golangci: {
    name: 'golangci-lint',
    command: 'golangci-lint',
    extensions: ['.go'],
    description: 'Fast Go linter aggregator',
    checkCmd: ['golangci-lint', '--version'],
  },
  shellcheck: {
    name: 'shellcheck',
    command: 'shellcheck',
    extensions: ['.sh', '.bash'],
    description: 'Shell script static analysis tool',
    checkCmd: ['shellcheck', '--version'],
  },
  stylelint: {
    name: 'stylelint',
    command: 'stylelint',
    extensions: ['.css', '.scss', '.less'],
    description: 'CSS linter',
    checkCmd: ['stylelint', '--version'],
  },
  htmlhint: {
    name: 'htmlhint',
    command: 'htmlhint',
    extensions: ['.html', '.htm'],
    description: 'HTML linter',
    checkCmd: ['htmlhint', '--version'],
  },
};

/**
 * Check if a command is available in PATH
 */
async function isCommandAvailable(command: string, args: string[] = ['--version']): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      stdio: 'ignore',
      shell: process.platform === 'win32',
    });

    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0));

    setTimeout(() => {
      proc.kill();
      resolve(false);
    }, 3000);
  });
}

/**
 * Run a linter command and capture output
 */
async function runLinter(
  command: string,
  args: string[],
  cwd?: string
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      resolve({ stdout: '', stderr: err.message, code: 1 });
    });

    proc.on('close', (code) => {
      resolve({ stdout, stderr, code: code ?? 1 });
    });

    // Timeout after 60 seconds
    setTimeout(() => {
      proc.kill();
      resolve({ stdout, stderr: 'Linter timed out', code: 1 });
    }, 60000);
  });
}

/**
 * Parse ESLint JSON output
 */
function parseEslintOutput(output: string): LintIssue[] {
  try {
    const results = JSON.parse(output);
    const issues: LintIssue[] = [];

    for (const file of results) {
      for (const msg of file.messages || []) {
        issues.push({
          file: file.filePath,
          line: msg.line || 1,
          column: msg.column,
          severity: msg.severity === 2 ? 'error' : 'warning',
          message: msg.message,
          rule: msg.ruleId,
          source: 'eslint',
        });
      }
    }

    return issues;
  } catch {
    return [];
  }
}

/**
 * Parse Pylint JSON output
 */
function parsePylintOutput(output: string): LintIssue[] {
  try {
    const results = JSON.parse(output);
    return results.map((msg: any) => ({
      file: msg.path,
      line: msg.line || 1,
      column: msg.column,
      severity: msg.type === 'error' || msg.type === 'fatal' ? 'error' : 'warning',
      message: msg.message,
      rule: msg.symbol,
      source: 'pylint',
    }));
  } catch {
    return [];
  }
}

/**
 * Parse Ruff JSON output
 */
function parseRuffOutput(output: string): LintIssue[] {
  try {
    const results = JSON.parse(output);
    return results.map((msg: any) => ({
      file: msg.filename,
      line: msg.location?.row || 1,
      column: msg.location?.column,
      severity: 'warning',
      message: msg.message,
      rule: msg.code,
      source: 'ruff',
    }));
  } catch {
    return [];
  }
}

/**
 * Parse ShellCheck JSON output
 */
function parseShellcheckOutput(output: string): LintIssue[] {
  try {
    const results = JSON.parse(output);
    return results.map((msg: any) => ({
      file: msg.file,
      line: msg.line || 1,
      column: msg.column,
      severity: msg.level === 'error' ? 'error' : msg.level === 'warning' ? 'warning' : 'info',
      message: msg.message,
      rule: `SC${msg.code}`,
      source: 'shellcheck',
    }));
  } catch {
    return [];
  }
}

/**
 * Parse generic linter output (line-based)
 */
function parseGenericOutput(output: string, filePath: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const lines = output.split('\n');

  // Common patterns for linter output
  const patterns = [
    // file:line:column: message
    /^(.+?):(\d+):(\d+):\s*(.+)$/,
    // file:line: message
    /^(.+?):(\d+):\s*(.+)$/,
    // file(line,column): message
    /^(.+?)\((\d+),(\d+)\):\s*(.+)$/,
  ];

  for (const line of lines) {
    if (!line.trim()) continue;

    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        const hasColumn = match.length === 5;
        issues.push({
          file: match[1] || filePath,
          line: parseInt(match[2], 10) || 1,
          column: hasColumn ? parseInt(match[3], 10) : undefined,
          severity: line.toLowerCase().includes('error') ? 'error' : 'warning',
          message: hasColumn ? match[4] : match[3],
          source: 'linter',
        });
        break;
      }
    }
  }

  return issues;
}

/**
 * Lint with ESLint
 */
async function lintWithEslint(filePath: string, workspaceRoot?: string): Promise<LintResult> {
  const result = await runLinter('eslint', ['--format', 'json', filePath], workspaceRoot);
  const issues = parseEslintOutput(result.stdout);

  return {
    success: result.code === 0,
    issues,
    summary: {
      errors: issues.filter((i) => i.severity === 'error').length,
      warnings: issues.filter((i) => i.severity === 'warning').length,
      infos: issues.filter((i) => i.severity === 'info').length,
    },
    rawOutput: result.stdout + result.stderr,
  };
}

/**
 * Lint with Pylint
 */
async function lintWithPylint(filePath: string, workspaceRoot?: string): Promise<LintResult> {
  const result = await runLinter('pylint', ['--output-format=json', filePath], workspaceRoot);
  const issues = parsePylintOutput(result.stdout);

  return {
    success: issues.filter((i) => i.severity === 'error').length === 0,
    issues,
    summary: {
      errors: issues.filter((i) => i.severity === 'error').length,
      warnings: issues.filter((i) => i.severity === 'warning').length,
      infos: issues.filter((i) => i.severity === 'info').length,
    },
    rawOutput: result.stdout + result.stderr,
  };
}

/**
 * Lint with Ruff (faster Python linter)
 */
async function lintWithRuff(filePath: string, workspaceRoot?: string): Promise<LintResult> {
  const result = await runLinter('ruff', ['check', '--output-format=json', filePath], workspaceRoot);
  const issues = parseRuffOutput(result.stdout);

  return {
    success: result.code === 0,
    issues,
    summary: {
      errors: issues.filter((i) => i.severity === 'error').length,
      warnings: issues.filter((i) => i.severity === 'warning').length,
      infos: issues.filter((i) => i.severity === 'info').length,
    },
    rawOutput: result.stdout + result.stderr,
  };
}

/**
 * Lint with Clippy (Rust)
 */
async function lintWithClippy(filePath: string, workspaceRoot?: string): Promise<LintResult> {
  // Clippy works on the whole project, not individual files
  const result = await runLinter('cargo', ['clippy', '--message-format=short'], workspaceRoot);
  const issues = parseGenericOutput(result.stdout + result.stderr, filePath);

  return {
    success: result.code === 0,
    issues,
    summary: {
      errors: issues.filter((i) => i.severity === 'error').length,
      warnings: issues.filter((i) => i.severity === 'warning').length,
      infos: issues.filter((i) => i.severity === 'info').length,
    },
    rawOutput: result.stdout + result.stderr,
  };
}

/**
 * Lint with golangci-lint
 */
async function lintWithGolangci(filePath: string, workspaceRoot?: string): Promise<LintResult> {
  const result = await runLinter('golangci-lint', ['run', '--out-format=line-number', filePath], workspaceRoot);
  const issues = parseGenericOutput(result.stdout + result.stderr, filePath);

  return {
    success: result.code === 0,
    issues,
    summary: {
      errors: issues.filter((i) => i.severity === 'error').length,
      warnings: issues.filter((i) => i.severity === 'warning').length,
      infos: issues.filter((i) => i.severity === 'info').length,
    },
    rawOutput: result.stdout + result.stderr,
  };
}

/**
 * Lint with ShellCheck
 */
async function lintWithShellcheck(filePath: string, workspaceRoot?: string): Promise<LintResult> {
  const result = await runLinter('shellcheck', ['--format=json', filePath], workspaceRoot);
  const issues = parseShellcheckOutput(result.stdout);

  return {
    success: result.code === 0,
    issues,
    summary: {
      errors: issues.filter((i) => i.severity === 'error').length,
      warnings: issues.filter((i) => i.severity === 'warning').length,
      infos: issues.filter((i) => i.severity === 'info').length,
    },
    rawOutput: result.stdout + result.stderr,
  };
}

/**
 * Get the best linter for a file based on extension
 */
export function getLinterForFile(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();

  // Prefer ruff over pylint for Python
  if (ext === '.py') {
    return 'ruff'; // Will fall back to pylint if ruff not available
  }

  for (const [name, info] of Object.entries(LINTERS)) {
    if (info.extensions.includes(ext)) {
      return name;
    }
  }

  return null;
}

/**
 * Check which linters are available
 */
export async function checkAvailableLinters(): Promise<Record<string, boolean>> {
  const results: Record<string, boolean> = {};

  const checks = Object.entries(LINTERS).map(async ([name, info]) => {
    if (name === 'clippy') {
      // Clippy is a cargo subcommand
      results[name] = await isCommandAvailable('cargo', ['clippy', '--version']);
    } else {
      results[name] = await isCommandAvailable(info.command);
    }
  });

  await Promise.all(checks);
  return results;
}

/**
 * List all linters with their availability status
 */
export async function listLinters(): Promise<LinterInfo[]> {
  const available = await checkAvailableLinters();

  return Object.entries(LINTERS).map(([name, info]) => ({
    ...info,
    installed: available[name] ?? false,
  }));
}

/**
 * Lint a file using the appropriate linter
 */
export async function lintFile(
  filePath: string,
  linterName?: string,
  workspaceRoot?: string
): Promise<LintResult> {
  const name = linterName || getLinterForFile(filePath);

  if (!name) {
    return {
      success: true,
      issues: [],
      summary: { errors: 0, warnings: 0, infos: 0 },
    };
  }

  // Check availability and run linter
  const available = await checkAvailableLinters();

  // For Python, try ruff first, fall back to pylint
  if (name === 'ruff' && !available.ruff) {
    if (available.pylint) {
      return lintWithPylint(filePath, workspaceRoot);
    }
    return {
      success: true,
      issues: [],
      summary: { errors: 0, warnings: 0, infos: 0 },
    };
  }

  if (!available[name]) {
    return {
      success: true,
      issues: [],
      summary: { errors: 0, warnings: 0, infos: 0 },
    };
  }

  switch (name) {
    case 'eslint':
      return lintWithEslint(filePath, workspaceRoot);
    case 'pylint':
      return lintWithPylint(filePath, workspaceRoot);
    case 'ruff':
      return lintWithRuff(filePath, workspaceRoot);
    case 'clippy':
      return lintWithClippy(filePath, workspaceRoot);
    case 'golangci':
      return lintWithGolangci(filePath, workspaceRoot);
    case 'shellcheck':
      return lintWithShellcheck(filePath, workspaceRoot);
    default:
      return {
        success: true,
        issues: [],
        summary: { errors: 0, warnings: 0, infos: 0 },
      };
  }
}

/**
 * Format lint results for terminal display
 */
export function formatLintResults(result: LintResult, showAll = false): string {
  if (result.issues.length === 0) {
    return chalk.green('No issues found');
  }

  const output: string[] = [];
  const issuesToShow = showAll ? result.issues : result.issues.slice(0, 20);

  for (const issue of issuesToShow) {
    const location = `${path.basename(issue.file)}:${issue.line}${issue.column ? `:${issue.column}` : ''}`;
    const severity =
      issue.severity === 'error'
        ? chalk.red('error')
        : issue.severity === 'warning'
        ? chalk.yellow('warn')
        : chalk.blue('info');
    const rule = issue.rule ? chalk.gray(` [${issue.rule}]`) : '';

    output.push(`  ${chalk.cyan(location)} ${severity}: ${issue.message}${rule}`);
  }

  if (!showAll && result.issues.length > 20) {
    output.push(chalk.gray(`  ... and ${result.issues.length - 20} more issues`));
  }

  // Summary
  output.push('');
  output.push(
    `${chalk.red(`${result.summary.errors} errors`)}, ` +
    `${chalk.yellow(`${result.summary.warnings} warnings`)}, ` +
    `${chalk.blue(`${result.summary.infos} infos`)}`
  );

  return output.join('\n');
}
