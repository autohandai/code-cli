/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';

/** Maximum file size for system prompt files (1MB) */
const MAX_PROMPT_FILE_SIZE = 1024 * 1024;

/** File extensions that indicate a file path */
const PROMPT_FILE_EXTENSIONS = ['.txt', '.md', '.prompt'];

export interface ResolvePromptOptions {
  /** Working directory for resolving relative paths */
  cwd?: string;
}

export class SysPromptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SysPromptError';
  }
}

/**
 * Determines if a value looks like a file path rather than an inline string.
 *
 * File path heuristics:
 * - Starts with ./ or ../  (relative path)
 * - Starts with /          (absolute Unix path)
 * - Starts with ~/         (home directory)
 * - Starts with C:\ or similar (Windows absolute path)
 * - Ends with .txt, .md, or .prompt
 * - Contains path separator without newlines
 */
export function looksLikeFilePath(value: string): boolean {
  if (!value || typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();

  // Empty strings are not file paths
  if (!trimmed) {
    return false;
  }

  // Multi-line strings are definitely inline content
  if (trimmed.includes('\n')) {
    return false;
  }

  // Check for explicit path prefixes
  if (trimmed.startsWith('./') || trimmed.startsWith('../')) {
    return true;
  }

  // Absolute Unix path
  if (trimmed.startsWith('/')) {
    return true;
  }

  // Home directory expansion
  if (trimmed.startsWith('~/')) {
    return true;
  }

  // Windows absolute path (C:\, D:\, etc.)
  if (/^[A-Za-z]:[/\\]/.test(trimmed)) {
    return true;
  }

  // Check for prompt file extensions
  const lower = trimmed.toLowerCase();
  for (const ext of PROMPT_FILE_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      return true;
    }
  }

  // Path-like patterns without newlines (contains / or \ but no newlines)
  // Only trigger if there's an actual path separator
  if ((trimmed.includes('/') || trimmed.includes('\\')) && !trimmed.includes(' ')) {
    return true;
  }

  return false;
}

/**
 * Resolves a prompt value to its content.
 * If the value looks like a file path, reads and returns the file content.
 * Otherwise, returns the value as-is (inline string).
 */
export async function resolvePromptValue(
  value: string,
  options: ResolvePromptOptions = {}
): Promise<string> {
  if (!value || typeof value !== 'string') {
    throw new SysPromptError('Prompt value cannot be empty');
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new SysPromptError('Prompt value cannot be empty');
  }

  // If it doesn't look like a file path, return as inline string
  if (!looksLikeFilePath(trimmed)) {
    return trimmed;
  }

  // Resolve the file path
  let filePath = trimmed;

  // Expand home directory
  if (filePath.startsWith('~/')) {
    filePath = path.join(os.homedir(), filePath.slice(2));
  }

  // Resolve relative paths
  if (!path.isAbsolute(filePath)) {
    const cwd = options.cwd || process.cwd();
    filePath = path.resolve(cwd, filePath);
  }

  // Check if path exists
  const exists = await fs.pathExists(filePath);
  if (!exists) {
    // File doesn't exist - treat as inline string
    // This allows users to pass strings that happen to look like paths
    return trimmed;
  }

  // Check if it's a file (not a directory)
  const stats = await fs.stat(filePath);
  if (stats.isDirectory()) {
    throw new SysPromptError(`Path is a directory, not a file: ${trimmed}`);
  }

  // Check file size
  if (stats.size > MAX_PROMPT_FILE_SIZE) {
    throw new SysPromptError(
      `Prompt file exceeds maximum size of 1MB: ${trimmed} (${Math.round(stats.size / 1024)}KB)`
    );
  }

  // Read the file
  try {
    const content = await fs.readFile(filePath, 'utf-8');

    // Check for empty file
    if (!content.trim()) {
      throw new SysPromptError(`Prompt file is empty: ${trimmed}`);
    }

    return content;
  } catch (error) {
    if (error instanceof SysPromptError) {
      throw error;
    }

    // Handle permission errors
    if ((error as NodeJS.ErrnoException).code === 'EACCES') {
      throw new SysPromptError(`Permission denied reading prompt file: ${trimmed}`);
    }

    throw new SysPromptError(`Failed to read prompt file: ${trimmed} - ${(error as Error).message}`);
  }
}

/**
 * Validates prompt content for basic sanity checks.
 * Returns true if valid, throws SysPromptError if invalid.
 */
export function validatePromptContent(content: string): boolean {
  if (!content || typeof content !== 'string') {
    throw new SysPromptError('Prompt content cannot be empty');
  }

  const trimmed = content.trim();
  if (!trimmed) {
    throw new SysPromptError('Prompt content cannot be empty');
  }

  // Check for reasonable length (warn but don't fail for very long prompts)
  if (trimmed.length > MAX_PROMPT_FILE_SIZE) {
    throw new SysPromptError(
      `Prompt content exceeds maximum size of 1MB (${Math.round(trimmed.length / 1024)}KB)`
    );
  }

  return true;
}
