/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { exec } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import type { DetectedIDE, SupportedPlatform } from './ideTypes.js';
import type { IDERegistryEntry } from './ideTypes.js';
import { IDE_REGISTRY } from './ideTypes.js';

/**
 * Detect running IDEs on the system and check if any match the given cwd.
 *
 * Uses platform-specific process listing to find running processes, then
 * resolves workspace paths from process arguments or the IDE's state
 * storage on disk.
 *
 * Storage lookups only check whether cwd appears in the IDE's recent
 * workspaces — they never dump all historical entries.
 */
export async function detectRunningIDEs(cwd: string): Promise<DetectedIDE[]> {
  const platform = getCurrentPlatform();
  const normalizedCwd = path.resolve(cwd);
  const processLines = await getProcessList(platform);
  const detected: DetectedIDE[] = [];

  for (const entry of IDE_REGISTRY) {
    const patterns = entry.processPatterns[platform] ?? [];
    if (patterns.length === 0) continue;

    const matchingLines = findProcessLines(processLines, patterns);
    if (matchingLines.length === 0) continue;

    // Try extracting workspace paths from process arguments first
    const argPaths = extractWorkspacePaths(matchingLines, entry.kind, platform);

    if (argPaths.length > 0) {
      const seen = new Set<string>();
      for (const wsPath of argPaths) {
        const resolvedWs = path.resolve(wsPath);
        if (seen.has(resolvedWs)) continue;
        seen.add(resolvedWs);

        detected.push({
          kind: entry.kind,
          displayName: entry.displayName,
          workspacePath: resolvedWs,
          matchesCwd: pathMatchesCwd(normalizedCwd, resolvedWs, platform),
          extensionUrl: entry.extensionUrl,
        });
      }
    } else {
      // No paths from args — check storage to see if cwd is a known workspace
      const cwdFoundInStorage = await checkCwdInStorage(entry, normalizedCwd, platform);

      detected.push({
        kind: entry.kind,
        displayName: entry.displayName,
        workspacePath: cwdFoundInStorage ? normalizedCwd : null,
        matchesCwd: cwdFoundInStorage,
        extensionUrl: entry.extensionUrl,
      });
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

// ────────────────────────────────────────────────────────
//  Platform helpers
// ────────────────────────────────────────────────────────

/** @internal Exported for testing */
export function getCurrentPlatform(): SupportedPlatform {
  return process.platform as SupportedPlatform;
}

/**
 * Compare a cwd path against a workspace path.
 * Case-insensitive on darwin and win32 (case-insensitive filesystems).
 * @internal Exported for testing
 */
export function pathMatchesCwd(
  normalizedCwd: string,
  workspacePath: string,
  platform: SupportedPlatform,
): boolean {
  if (platform === 'linux') {
    return normalizedCwd === workspacePath;
  }
  return normalizedCwd.toLowerCase() === workspacePath.toLowerCase();
}

// ────────────────────────────────────────────────────────
//  Process listing
// ────────────────────────────────────────────────────────

/**
 * Get the list of running processes via platform-specific commands.
 * Returns an empty array on failure (unsupported platform, permission issues, etc.)
 */
async function getProcessList(platform: SupportedPlatform): Promise<string[]> {
  if (platform === 'win32') {
    return getWindowsProcessList();
  }
  return getUnixProcessList();
}

async function getUnixProcessList(): Promise<string[]> {
  return new Promise((resolve) => {
    exec('ps aux', { encoding: 'utf-8', timeout: 5000 }, (error, stdout) => {
      if (error) {
        resolve([]);
        return;
      }
      resolve(stdout.split('\n'));
    });
  });
}

async function getWindowsProcessList(): Promise<string[]> {
  return new Promise((resolve) => {
    const cmd = 'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Select-Object Name,CommandLine | ConvertTo-Json"';
    exec(cmd, { encoding: 'utf-8', timeout: 8000 }, (error, stdout) => {
      if (error) {
        resolve([]);
        return;
      }
      try {
        const processes = JSON.parse(stdout) as Array<{ Name?: string; CommandLine?: string }>;
        const lines = (Array.isArray(processes) ? processes : [processes]).map(
          (p) => `${p.Name ?? ''} ${p.CommandLine ?? ''}`,
        );
        resolve(lines);
      } catch {
        resolve([]);
      }
    });
  });
}

/**
 * Find process lines that match any of the given patterns.
 * @internal Exported for testing
 */
export function findProcessLines(lines: string[], patterns: string[]): string[] {
  return lines.filter((line) =>
    patterns.some((pattern) => line.includes(pattern)),
  );
}

// ────────────────────────────────────────────────────────
//  Workspace path extraction from process args
// ────────────────────────────────────────────────────────

/**
 * Extract workspace paths from process command-line arguments.
 *
 * VS Code family: looks for `--folder-uri file:///path` or bare directory paths
 * Zed: looks for directory paths passed as arguments
 */
function extractWorkspacePaths(
  lines: string[],
  kind: string,
  platform: SupportedPlatform,
): string[] {
  const paths = new Set<string>();

  for (const line of lines) {
    // Try --folder-uri extraction (VS Code family)
    const folderUriMatch = line.match(/--folder-uri\s+file:\/\/([^\s]+)/);
    if (folderUriMatch?.[1]) {
      try {
        const decoded = decodeURIComponent(folderUriMatch[1]);
        if (!isRuntimePath(decoded, platform)) {
          paths.add(decoded);
        }
        continue;
      } catch {
        // skip malformed URIs
      }
    }

    // Try extracting paths from process arguments
    const extractedPaths = extractPathsFromArgs(line, kind, platform);
    for (const p of extractedPaths) {
      paths.add(p);
    }
  }

  return [...paths];
}

/**
 * Extract directory paths from a process command line.
 * Uses platform-specific regexes to find absolute paths.
 * @internal Exported for testing
 */
export function extractPathsFromArgs(
  line: string,
  _kind: string,
  platform: SupportedPlatform,
): string[] {
  const results: string[] = [];

  let pathMatches: RegExpMatchArray | null;

  if (platform === 'win32') {
    // Windows: match drive-letter paths like C:\Users\foo\project
    pathMatches = line.match(/\s([A-Za-z]:\\[^\s"]+)/g);
  } else {
    // Unix: match absolute paths under home directories
    pathMatches = line.match(/\s(\/(?:Users|home|root)[^\s]+)/g);
  }

  if (!pathMatches) return results;

  for (const match of pathMatches) {
    const candidate = match.trim();

    if (isRuntimePath(candidate, platform)) continue;

    if (looksLikeWorkspace(candidate, platform)) {
      results.push(candidate);
    }
  }

  return results;
}

/**
 * Check if a path looks like a runtime/framework path rather than a user workspace.
 * @internal Exported for testing
 */
export function isRuntimePath(p: string, platform?: SupportedPlatform): boolean {
  const plat = platform ?? getCurrentPlatform();

  const commonPatterns = [
    'node_modules',
    '.vscode',
    '.cursor',
    'Frameworks/',
    'Helper',
    'Crashpad',
    'chrome-sandbox',
    '.log',
    '.sock',
    '.pid',
  ];

  const unixPatterns = [
    '/Applications/',
    '/Library/',
    '/System/',
    '/usr/',
    '/opt/',
    '/tmp/',
    '/var/',
    '/private/',
    '/.local/share/',
    '/.config/',
    '/.cache/',
    '.app/',
    'MacOS/',
    'Resources/',
  ];

  const windowsPatterns = [
    'Program Files',
    'Program Files (x86)',
    '\\Windows\\',
    '\\AppData\\',
    '\\ProgramData\\',
  ];

  const patterns = [
    ...commonPatterns,
    ...(plat === 'win32' ? windowsPatterns : unixPatterns),
  ];

  return patterns.some((pattern) => p.includes(pattern));
}

/**
 * Check if a path looks like a user workspace/project directory.
 * @internal Exported for testing
 */
export function looksLikeWorkspace(p: string, platform?: SupportedPlatform): boolean {
  const plat = platform ?? getCurrentPlatform();

  if (plat === 'win32') {
    return /^[A-Za-z]:\\Users\\[^\\]+\\.+/.test(p);
  }
  // /root is itself the home dir, so /root/<anything> is a workspace.
  // /Users/<user>/<path> and /home/<user>/<path> need two segments after the prefix.
  return /^\/(Users|home)\/[^/]+\/.+/.test(p) || /^\/root\/.+/.test(p);
}

// ────────────────────────────────────────────────────────
//  Storage-based workspace resolution (cross-platform)
// ────────────────────────────────────────────────────────

/**
 * Resolve the base path for an IDE's storage directory on the current platform.
 * @internal Exported for testing
 */
export function getStorageBasePath(
  type: 'vscode-family' | 'zed',
  platform: SupportedPlatform,
): string {
  const home = os.homedir();

  switch (platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support');

    case 'linux':
      if (type === 'zed') {
        return process.env['XDG_DATA_HOME'] ?? path.join(home, '.local', 'share');
      }
      return process.env['XDG_CONFIG_HOME'] ?? path.join(home, '.config');

    case 'win32':
      if (type === 'zed') {
        return process.env['LOCALAPPDATA'] ?? path.join(home, 'AppData', 'Local');
      }
      return process.env['APPDATA'] ?? path.join(home, 'AppData', 'Roaming');

    default:
      return path.join(home, '.config');
  }
}

/**
 * Check whether the given cwd appears in the IDE's on-disk state storage.
 */
async function checkCwdInStorage(
  entry: IDERegistryEntry,
  normalizedCwd: string,
  platform: SupportedPlatform,
): Promise<boolean> {
  const storageName = entry.storage?.[platform];
  if (!storageName || !entry.storage) return false;

  try {
    if (entry.storage.type === 'zed') {
      return await checkZedStorage(storageName, normalizedCwd, platform);
    }
    return await checkVSCodeFamilyStorage(storageName, normalizedCwd, platform);
  } catch {
    return false;
  }
}

/**
 * Check if cwd exists in a VS Code-family IDE's recently opened paths.
 */
async function checkVSCodeFamilyStorage(
  storageName: string,
  normalizedCwd: string,
  platform: SupportedPlatform,
): Promise<boolean> {
  const basePath = getStorageBasePath('vscode-family', platform);
  const dbPath = path.join(basePath, storageName, 'User', 'globalStorage', 'state.vscdb');

  const raw = await querySqlite(
    dbPath,
    "SELECT value FROM ItemTable WHERE key = 'history.recentlyOpenedPathsList'",
  );
  if (!raw) return false;

  try {
    const data = JSON.parse(raw) as { entries?: Array<{ folderUri?: string }> };

    for (const entry of data.entries ?? []) {
      if (!entry.folderUri) continue;
      try {
        const url = new URL(entry.folderUri);
        if (url.protocol === 'file:') {
          const folder = path.resolve(decodeURIComponent(url.pathname));
          if (pathMatchesCwd(normalizedCwd, folder, platform)) return true;
        }
      } catch {
        // skip malformed URIs
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Check if cwd exists in Zed's workspace history.
 */
async function checkZedStorage(
  storageName: string,
  normalizedCwd: string,
  platform: SupportedPlatform,
): Promise<boolean> {
  const basePath = getStorageBasePath('zed', platform);
  const dbPath = path.join(basePath, storageName, 'db', '0-stable', 'db.sqlite');

  // Escape single quotes in the path for the SQL query
  const escaped = normalizedCwd.replace(/'/g, "''");
  const raw = await querySqlite(
    dbPath,
    `SELECT COUNT(*) FROM workspaces WHERE paths IS NOT NULL AND paths = '${escaped}'`,
  );

  return raw !== null && raw.trim() !== '0';
}

/**
 * Run a SQLite query using the `sqlite3` CLI and return the first column's value.
 * Returns null if the query fails or produces no results.
 */
async function querySqlite(dbPath: string, query: string): Promise<string | null> {
  return new Promise((resolve) => {
    exec(
      `sqlite3 -readonly "${dbPath}" "${query}"`,
      { encoding: 'utf-8', timeout: 3000 },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        const trimmed = stdout.trim();
        resolve(trimmed.length > 0 ? trimmed : null);
      },
    );
  });
}

/**
 * Get extension URLs for the set of detected IDE kinds.
 * Only suggests extensions for IDEs that were actually detected running.
 */
export function getExtensionSuggestions(detected: DetectedIDE[]): Array<{ displayName: string; url: string }> {
  const detectedKinds = new Set(detected.map((d) => d.kind));
  const seen = new Set<string>();
  const suggestions: Array<{ displayName: string; url: string }> = [];

  for (const entry of IDE_REGISTRY) {
    if (!entry.extensionUrl) continue;
    if (!detectedKinds.has(entry.kind)) continue;
    if (seen.has(entry.extensionUrl)) continue;

    seen.add(entry.extensionUrl);
    suggestions.push({
      displayName: entry.displayName,
      url: entry.extensionUrl,
    });
  }

  return suggestions;
}
