/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Code Formatters
 * Supports prettier, black, rustfmt, gofmt, and more
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'fs-extra';
import os from 'node:os';

export type Formatter = (contents: string, file: string, workspaceRoot?: string) => Promise<string>;

export interface FormatterResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface FormatterInfo {
  name: string;
  command: string;
  extensions: string[];
  description: string;
  checkCmd: string[];
  installed?: boolean;
}

/**
 * Available external formatters with their configurations
 */
export const EXTERNAL_FORMATTERS: Record<string, FormatterInfo> = {
  prettier: {
    name: 'prettier',
    command: 'prettier',
    extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json', '.css', '.scss', '.less', '.html', '.md', '.yaml', '.yml', '.graphql'],
    description: 'Opinionated code formatter for JavaScript, TypeScript, CSS, and more',
    checkCmd: ['prettier', '--version'],
  },
  black: {
    name: 'black',
    command: 'black',
    extensions: ['.py', '.pyi'],
    description: 'The uncompromising Python code formatter',
    checkCmd: ['black', '--version'],
  },
  rustfmt: {
    name: 'rustfmt',
    command: 'rustfmt',
    extensions: ['.rs'],
    description: 'Format Rust code according to style guidelines',
    checkCmd: ['rustfmt', '--version'],
  },
  gofmt: {
    name: 'gofmt',
    command: 'gofmt',
    extensions: ['.go'],
    description: 'Format Go source code',
    checkCmd: ['gofmt', '-h'],
  },
  clangformat: {
    name: 'clang-format',
    command: 'clang-format',
    extensions: ['.c', '.cpp', '.h', '.hpp', '.cc', '.cxx'],
    description: 'Format C/C++ code',
    checkCmd: ['clang-format', '--version'],
  },
  shfmt: {
    name: 'shfmt',
    command: 'shfmt',
    extensions: ['.sh', '.bash'],
    description: 'Format shell scripts',
    checkCmd: ['shfmt', '--version'],
  },
  sqlformat: {
    name: 'sqlformat',
    command: 'sqlformat',
    extensions: ['.sql'],
    description: 'Format SQL files',
    checkCmd: ['sqlformat', '--version'],
  },
  xmllint: {
    name: 'xmllint',
    command: 'xmllint',
    extensions: ['.xml', '.xsl', '.xslt'],
    description: 'Format XML files',
    checkCmd: ['xmllint', '--version'],
  },
};

/**
 * Check if a command is available in PATH
 */
async function isCommandAvailable(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(command, ['--version'], {
      stdio: 'ignore',
      shell: process.platform === 'win32',
    });

    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0));

    // Timeout after 2 seconds
    setTimeout(() => {
      proc.kill();
      resolve(false);
    }, 2000);
  });
}

/**
 * Run an external formatter command
 */
async function runExternalFormatter(
  command: string,
  args: string[],
  input: string,
  cwd?: string
): Promise<FormatterResult> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd,
      shell: process.platform === 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
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
      resolve({
        success: false,
        output: input,
        error: `Failed to run ${command}: ${err.message}`,
      });
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, output: stdout || input });
      } else {
        resolve({
          success: false,
          output: input,
          error: stderr || `${command} exited with code ${code}`,
        });
      }
    });

    // Write input to stdin
    proc.stdin.write(input);
    proc.stdin.end();

    // Timeout after 30 seconds
    setTimeout(() => {
      proc.kill();
      resolve({
        success: false,
        output: input,
        error: `${command} timed out after 30 seconds`,
      });
    }, 30000);
  });
}

/**
 * Format with Prettier
 */
async function formatWithPrettier(contents: string, file: string, workspaceRoot?: string): Promise<string> {
  const ext = path.extname(file);
  const parser = getPrettierParser(ext);

  // Try to use local prettier first, then global
  const result = await runExternalFormatter(
    'prettier',
    ['--stdin-filepath', file, ...(parser ? ['--parser', parser] : [])],
    contents,
    workspaceRoot
  );

  if (!result.success) {
    throw new Error(result.error || 'Prettier formatting failed');
  }

  return result.output;
}

function getPrettierParser(ext: string): string | null {
  const parserMap: Record<string, string> = {
    '.js': 'babel',
    '.jsx': 'babel',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.mjs': 'babel',
    '.cjs': 'babel',
    '.json': 'json',
    '.css': 'css',
    '.scss': 'scss',
    '.less': 'less',
    '.html': 'html',
    '.md': 'markdown',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.graphql': 'graphql',
  };
  return parserMap[ext] || null;
}

/**
 * Format with Black (Python)
 */
async function formatWithBlack(contents: string, file: string, workspaceRoot?: string): Promise<string> {
  const result = await runExternalFormatter(
    'black',
    ['-', '--quiet'],
    contents,
    workspaceRoot
  );

  if (!result.success) {
    throw new Error(result.error || 'Black formatting failed');
  }

  return result.output;
}

/**
 * Format with rustfmt
 */
async function formatWithRustfmt(contents: string, file: string, workspaceRoot?: string): Promise<string> {
  const result = await runExternalFormatter(
    'rustfmt',
    ['--emit', 'stdout'],
    contents,
    workspaceRoot
  );

  if (!result.success) {
    throw new Error(result.error || 'rustfmt formatting failed');
  }

  return result.output;
}

/**
 * Format with gofmt
 */
async function formatWithGofmt(contents: string, file: string, workspaceRoot?: string): Promise<string> {
  const result = await runExternalFormatter(
    'gofmt',
    [],
    contents,
    workspaceRoot
  );

  if (!result.success) {
    throw new Error(result.error || 'gofmt formatting failed');
  }

  return result.output;
}

/**
 * Format with clang-format
 */
async function formatWithClangFormat(contents: string, file: string, workspaceRoot?: string): Promise<string> {
  const result = await runExternalFormatter(
    'clang-format',
    [`--assume-filename=${file}`],
    contents,
    workspaceRoot
  );

  if (!result.success) {
    throw new Error(result.error || 'clang-format formatting failed');
  }

  return result.output;
}

/**
 * Format with shfmt
 */
async function formatWithShfmt(contents: string, file: string, workspaceRoot?: string): Promise<string> {
  const result = await runExternalFormatter(
    'shfmt',
    ['-i', '2'], // 2-space indent
    contents,
    workspaceRoot
  );

  if (!result.success) {
    throw new Error(result.error || 'shfmt formatting failed');
  }

  return result.output;
}

/**
 * Built-in formatters (no external dependencies)
 */
const builtinFormatters: Record<string, Formatter> = {
  json: async (contents) => {
    const parsed = JSON.parse(contents);
    return JSON.stringify(parsed, null, 2) + '\n';
  },
  trim: async (contents) => contents.trim() + '\n',
  'normalize-newlines': async (contents) => {
    return contents.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  },
  'trailing-newline': async (contents) => {
    return contents.endsWith('\n') ? contents : contents + '\n';
  },
  'remove-trailing-whitespace': async (contents) => {
    return contents.split('\n').map(line => line.trimEnd()).join('\n');
  },
};

/**
 * External formatters that require installed tools
 */
const externalFormatters: Record<string, Formatter> = {
  prettier: formatWithPrettier,
  black: formatWithBlack,
  rustfmt: formatWithRustfmt,
  gofmt: formatWithGofmt,
  'clang-format': formatWithClangFormat,
  clangformat: formatWithClangFormat,
  shfmt: formatWithShfmt,
};

/**
 * Get the best formatter for a file based on extension
 */
export function getFormatterForFile(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();

  for (const [name, info] of Object.entries(EXTERNAL_FORMATTERS)) {
    if (info.extensions.includes(ext)) {
      return name;
    }
  }

  return null;
}

/**
 * Check which formatters are available
 */
export async function checkAvailableFormatters(): Promise<Record<string, boolean>> {
  const results: Record<string, boolean> = {};

  // Built-in formatters are always available
  for (const name of Object.keys(builtinFormatters)) {
    results[name] = true;
  }

  // Check external formatters
  const checks = Object.entries(EXTERNAL_FORMATTERS).map(async ([name, info]) => {
    const available = await isCommandAvailable(info.command);
    results[name] = available;
  });

  await Promise.all(checks);
  return results;
}

/**
 * List all formatters with their availability status
 */
export async function listFormatters(): Promise<FormatterInfo[]> {
  const available = await checkAvailableFormatters();

  const formatters: FormatterInfo[] = [
    // Built-in formatters
    { name: 'json', command: 'built-in', extensions: ['.json'], description: 'Format JSON with 2-space indent', checkCmd: [], installed: true },
    { name: 'trim', command: 'built-in', extensions: ['*'], description: 'Trim whitespace and ensure trailing newline', checkCmd: [], installed: true },
    { name: 'normalize-newlines', command: 'built-in', extensions: ['*'], description: 'Convert all line endings to LF', checkCmd: [], installed: true },
    { name: 'trailing-newline', command: 'built-in', extensions: ['*'], description: 'Ensure file ends with newline', checkCmd: [], installed: true },
    { name: 'remove-trailing-whitespace', command: 'built-in', extensions: ['*'], description: 'Remove trailing whitespace from lines', checkCmd: [], installed: true },
    // External formatters
    ...Object.entries(EXTERNAL_FORMATTERS).map(([name, info]) => ({
      ...info,
      installed: available[name] ?? false,
    })),
  ];

  return formatters;
}

/**
 * Apply a formatter to file contents
 */
export async function applyFormatter(
  name: string,
  contents: string,
  file: string,
  workspaceRoot?: string
): Promise<string> {
  // Check built-in formatters first
  const builtin = builtinFormatters[name];
  if (builtin) {
    return builtin(contents, file, workspaceRoot);
  }

  // Check external formatters
  const external = externalFormatters[name];
  if (external) {
    return external(contents, file, workspaceRoot);
  }

  throw new Error(`Formatter "${name}" is not available. Run /formatters to see available formatters.`);
}

/**
 * Auto-format a file using the best available formatter
 */
export async function autoFormat(
  contents: string,
  filePath: string,
  workspaceRoot?: string
): Promise<{ formatted: string; formatter: string | null }> {
  const formatterName = getFormatterForFile(filePath);

  if (!formatterName) {
    // No specific formatter, just normalize
    return {
      formatted: await applyFormatter('trailing-newline', contents, filePath),
      formatter: 'trailing-newline',
    };
  }

  // Check if the formatter is available
  const available = await isCommandAvailable(EXTERNAL_FORMATTERS[formatterName]?.command || formatterName);

  if (!available) {
    // Fall back to basic formatting
    return {
      formatted: await applyFormatter('trailing-newline', contents, filePath),
      formatter: null,
    };
  }

  try {
    const formatted = await applyFormatter(formatterName, contents, filePath, workspaceRoot);
    return { formatted, formatter: formatterName };
  } catch {
    // Formatting failed, return original with trailing newline
    return {
      formatted: await applyFormatter('trailing-newline', contents, filePath),
      formatter: null,
    };
  }
}
