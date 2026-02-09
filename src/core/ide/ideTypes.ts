/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Known IDE types that Autohand can detect and connect to.
 */
export type IDEKind = 'vscode' | 'vscode-insiders' | 'cursor' | 'zed' | 'antigravity';

/**
 * Supported platform identifiers for IDE detection.
 */
export type SupportedPlatform = 'darwin' | 'linux' | 'win32';

/**
 * Per-platform process name patterns used to find a running IDE.
 */
export interface PlatformProcessPatterns {
  darwin: string[];
  linux: string[];
  win32: string[];
}

/**
 * Configuration for locating an IDE's on-disk state storage.
 */
export interface StorageConfig {
  type: 'vscode-family' | 'zed';
  /** Application Support subdirectory name on macOS */
  darwin?: string;
  /** Config/data directory name on Linux (under XDG paths) */
  linux?: string;
  /** Directory name on Windows (under %APPDATA% or %LOCALAPPDATA%) */
  win32?: string;
}

/**
 * A running IDE instance detected on the system.
 */
export interface DetectedIDE {
  /** Which IDE this is */
  kind: IDEKind;
  /** Human-readable name (e.g. "Visual Studio Code") */
  displayName: string;
  /** The workspace/project directory open in this IDE instance, or null if unknown */
  workspacePath: string | null;
  /** Whether this IDE's workspace matches the current working directory */
  matchesCwd: boolean;
  /** Marketplace/extension URL if an Autohand extension is available */
  extensionUrl?: string;
}

/**
 * Static registry entry for each supported IDE.
 */
export interface IDERegistryEntry {
  kind: IDEKind;
  /** Display name shown to the user */
  displayName: string;
  /** Per-platform process name patterns to search for */
  processPatterns: PlatformProcessPatterns;
  /** Marketplace/extension URL, if available */
  extensionUrl?: string;
  /** Cross-platform storage configuration for workspace resolution */
  storage?: StorageConfig;
}

/**
 * Registry of all supported IDEs with detection metadata.
 */
export const IDE_REGISTRY: IDERegistryEntry[] = [
  {
    kind: 'vscode',
    displayName: 'Visual Studio Code',
    processPatterns: {
      darwin: ['Visual Studio Code', 'code '],
      linux: ['code ', '/code'],
      win32: ['Code.exe'],
    },
    extensionUrl: 'https://marketplace.visualstudio.com/items?itemName=AutohandAI.vscode-autohand',
    storage: {
      type: 'vscode-family',
      darwin: 'Code',
      linux: 'Code',
      win32: 'Code',
    },
  },
  {
    kind: 'vscode-insiders',
    displayName: 'Visual Studio Code Insiders',
    processPatterns: {
      darwin: ['Code - Insiders', 'code-insiders '],
      linux: ['code-insiders ', '/code-insiders'],
      win32: ['Code - Insiders.exe'],
    },
    extensionUrl: 'https://marketplace.visualstudio.com/items?itemName=AutohandAI.vscode-autohand',
    storage: {
      type: 'vscode-family',
      darwin: 'Code - Insiders',
      linux: 'Code - Insiders',
      win32: 'Code - Insiders',
    },
  },
  {
    kind: 'cursor',
    displayName: 'Cursor',
    processPatterns: {
      darwin: ['Cursor.app', 'cursor '],
      linux: ['cursor ', '/cursor'],
      win32: ['Cursor.exe'],
    },
    storage: {
      type: 'vscode-family',
      darwin: 'Cursor',
      linux: 'Cursor',
      win32: 'Cursor',
    },
  },
  {
    kind: 'zed',
    displayName: 'Zed',
    processPatterns: {
      darwin: ['Zed.app', '/zed '],
      linux: ['zed ', '/zed'],
      win32: ['Zed.exe'],
    },
    extensionUrl: 'https://zed.dev/extensions/autohand-acp',
    storage: {
      type: 'zed',
      darwin: 'Zed',
      linux: 'zed',
      win32: 'Zed',
    },
  },
  {
    kind: 'antigravity',
    displayName: 'Antigravity',
    processPatterns: {
      darwin: ['Antigravity.app', 'antigravity '],
      linux: [],
      win32: [],
    },
    storage: {
      type: 'vscode-family',
      darwin: 'Antigravity',
    },
  },
];
