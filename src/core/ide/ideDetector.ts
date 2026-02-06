/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import type { DetectedIDE } from './ideTypes.js';
import type { IDERegistryEntry } from './ideTypes.js';
import { IDE_REGISTRY } from './ideTypes.js';

/**
 * Detect running IDEs on the system and check if any match the given cwd.
 *
 * Uses `ps aux` to find running processes, then resolves workspace paths
 * from the IDE's state storage on disk (SQLite databases in Application Support).
 */
export async function detectRunningIDEs(cwd: string): Promise<DetectedIDE[]> {
  const normalizedCwd = path.resolve(cwd);
  const processLines = getProcessList();
  const detected: DetectedIDE[] = [];

  for (const entry of IDE_REGISTRY) {
    const matchingLines = findProcessLines(processLines, entry.processPatterns);

    if (matchingLines.length === 0) continue;

    // Try extracting workspace paths from process arguments first
    let workspacePaths = extractWorkspacePaths(matchingLines, entry.kind);

    // Fall back to reading the IDE's state storage for workspace info
    if (workspacePaths.length === 0) {
      workspacePaths = readWorkspacesFromStorage(entry);
    }

    if (workspacePaths.length === 0) {
      // IDE is running but we couldn't determine its workspace
      detected.push({
        kind: entry.kind,
        displayName: entry.displayName,
        workspacePath: null,
        matchesCwd: false,
        extensionUrl: entry.extensionUrl,
      });
    } else {
      // Create an entry for each unique workspace path
      for (const wsPath of workspacePaths) {
        const resolvedWs = path.resolve(wsPath);
        detected.push({
          kind: entry.kind,
          displayName: entry.displayName,
          workspacePath: resolvedWs,
          matchesCwd: normalizedCwd === resolvedWs,
          extensionUrl: entry.extensionUrl,
        });
      }
    }
  }

  // Sort: matching cwd first, then alphabetically by display name
  detected.sort((a, b) => {
    if (a.matchesCwd && !b.matchesCwd) return -1;
    if (!a.matchesCwd && b.matchesCwd) return 1;
    return a.displayName.localeCompare(b.displayName);
  });

  return detected;
}

/**
 * Get the list of running processes via `ps aux`.
 * Returns an empty array on failure (non-Unix systems, permission issues, etc.)
 */
function getProcessList(): string[] {
  try {
    const output = execSync('ps aux', {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output.split('\n');
  } catch {
    return [];
  }
}

/**
 * Find process lines that match any of the given patterns.
 */
function findProcessLines(lines: string[], patterns: string[]): string[] {
  return lines.filter((line) =>
    patterns.some((pattern) => line.includes(pattern))
  );
}

/**
 * Extract workspace paths from process command-line arguments.
 *
 * VS Code family: looks for `--folder-uri file:///path` or bare directory paths
 * Zed: looks for directory paths passed as arguments
 */
function extractWorkspacePaths(lines: string[], kind: string): string[] {
  const paths = new Set<string>();

  for (const line of lines) {
    // Try --folder-uri extraction (VS Code family)
    const folderUriMatch = line.match(/--folder-uri\s+file:\/\/([^\s]+)/);
    if (folderUriMatch?.[1]) {
      try {
        const decoded = decodeURIComponent(folderUriMatch[1]);
        paths.add(decoded);
        continue;
      } catch {
        // skip malformed URIs
      }
    }

    // Try extracting paths from process arguments
    const extractedPaths = extractPathsFromArgs(line, kind);
    for (const p of extractedPaths) {
      paths.add(p);
    }
  }

  return [...paths];
}

/**
 * Extract directory paths from a process command line.
 *
 * Heuristic: look for absolute paths (starting with /) that are likely
 * workspace directories, filtering out framework/runtime paths.
 */
function extractPathsFromArgs(line: string, _kind: string): string[] {
  const results: string[] = [];

  // Match absolute paths in the command line
  const pathMatches = line.match(/\s(\/(?:Users|home|root)[^\s]+)/g);
  if (!pathMatches) return results;

  for (const match of pathMatches) {
    const candidate = match.trim();

    // Skip paths that are clearly not workspace directories
    if (isRuntimePath(candidate)) continue;

    // Only include paths that look like project directories
    if (looksLikeWorkspace(candidate)) {
      results.push(candidate);
    }
  }

  return results;
}

/**
 * Check if a path looks like a runtime/framework path rather than a user workspace.
 */
function isRuntimePath(p: string): boolean {
  const runtimePatterns = [
    '/Applications/',
    '/Library/',
    '/System/',
    '/usr/',
    '/opt/',
    '/tmp/',
    '/var/',
    '/private/',
    'node_modules',
    '.vscode',
    '.cursor',
    'Frameworks/',
    '.app/',
    'MacOS/',
    'Resources/',
    'Helper',
    'Crashpad',
    'chrome-sandbox',
    '.log',
    '.sock',
    '.pid',
  ];

  return runtimePatterns.some((pattern) => p.includes(pattern));
}

/**
 * Check if a path looks like a user workspace/project directory.
 */
function looksLikeWorkspace(p: string): boolean {
  // Must start with a common home directory prefix
  return /^\/(Users|home|root)\/[^/]+\/.+/.test(p);
}

// ────────────────────────────────────────────────────────
//  Storage-based workspace resolution (macOS)
// ────────────────────────────────────────────────────────

/** Max recently-opened entries to return per IDE */
const MAX_RECENT_WORKSPACES = 10;

/**
 * Read workspace paths from the IDE's on-disk state storage.
 *
 * VS Code family stores recently opened folders in a SQLite database at
 * `~/Library/Application Support/<name>/User/globalStorage/state.vscdb`.
 *
 * Zed stores workspaces in a SQLite database at
 * `~/Library/Application Support/Zed/db/0-stable/db.sqlite`.
 */
function readWorkspacesFromStorage(entry: IDERegistryEntry): string[] {
  if (process.platform !== 'darwin' || !entry.macStorageName) return [];

  try {
    if (entry.kind === 'zed') {
      return readZedWorkspaces(entry.macStorageName);
    }
    return readVSCodeFamilyWorkspaces(entry.macStorageName);
  } catch {
    return [];
  }
}

/**
 * Read recently opened workspaces from a VS Code-family IDE's state database.
 *
 * Queries `history.recentlyOpenedPathsList` from the `ItemTable` in
 * `state.vscdb`, which contains `folderUri` entries like `file:///path/to/project`.
 */
function readVSCodeFamilyWorkspaces(storageName: string): string[] {
  const dbPath = path.join(
    os.homedir(),
    'Library',
    'Application Support',
    storageName,
    'User',
    'globalStorage',
    'state.vscdb',
  );

  const raw = querySqlite(
    dbPath,
    "SELECT value FROM ItemTable WHERE key = 'history.recentlyOpenedPathsList'",
  );
  if (!raw) return [];

  try {
    const data = JSON.parse(raw) as { entries?: Array<{ folderUri?: string }> };
    const folders: string[] = [];

    for (const entry of data.entries ?? []) {
      if (!entry.folderUri) continue;
      try {
        const url = new URL(entry.folderUri);
        if (url.protocol === 'file:') {
          folders.push(decodeURIComponent(url.pathname));
        }
      } catch {
        // skip malformed URIs
      }
      if (folders.length >= MAX_RECENT_WORKSPACES) break;
    }

    return folders;
  } catch {
    return [];
  }
}

/**
 * Read workspaces from Zed's state database.
 *
 * Queries the `workspaces` table for the `paths` column,
 * ordered by most recently used first.
 */
function readZedWorkspaces(storageName: string): string[] {
  const dbPath = path.join(
    os.homedir(),
    'Library',
    'Application Support',
    storageName,
    'db',
    '0-stable',
    'db.sqlite',
  );

  const raw = querySqlite(
    dbPath,
    `SELECT paths FROM workspaces WHERE paths IS NOT NULL ORDER BY timestamp DESC LIMIT ${MAX_RECENT_WORKSPACES}`,
  );
  if (!raw) return [];

  // sqlite3 returns one path per line
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.startsWith('/'));
}

/**
 * Run a SQLite query using the `sqlite3` CLI and return the first column's value.
 * Returns null if the query fails or produces no results.
 */
function querySqlite(dbPath: string, query: string): string | null {
  try {
    const output = execSync(
      `sqlite3 -readonly "${dbPath}" "${query}"`,
      {
        encoding: 'utf-8',
        timeout: 3000,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    const trimmed = output.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * Get unique extension URLs for detected IDEs that have extensions available.
 */
export function getExtensionSuggestions(detected: DetectedIDE[]): Array<{ displayName: string; url: string }> {
  const seen = new Set<string>();
  const suggestions: Array<{ displayName: string; url: string }> = [];

  // Also suggest extensions for IDEs in the registry that aren't running
  for (const entry of IDE_REGISTRY) {
    if (!entry.extensionUrl) continue;
    if (seen.has(entry.extensionUrl)) continue;

    seen.add(entry.extensionUrl);
    suggestions.push({
      displayName: entry.displayName,
      url: entry.extensionUrl,
    });
  }

  return suggestions;
}
