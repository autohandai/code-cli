/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Heuristic to distinguish slash commands from file paths that begin with "/".
 * Only inspects the first token so slash-command arguments (e.g. npm package
 * specs like "@playwright/mcp@latest") do not accidentally trigger path mode.
 */
export function isLikelyFilePathSlashInput(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) {
    return false;
  }

  const firstToken = trimmed.split(/\s+/, 1)[0] ?? '';

  // Has nested path separators (e.g. /Users/foo/bar, /tmp/x)
  if ((firstToken.match(/\//g) || []).length > 1) {
    return true;
  }

  // Starts with common absolute path prefixes
  if (/^\/(?:Users|home|tmp|var|opt|etc|usr)\//i.test(firstToken)) {
    return true;
  }

  // Looks like a file with extension
  if (/\.[a-z0-9]{1,5}$/i.test(firstToken)) {
    return true;
  }

  return false;
}

