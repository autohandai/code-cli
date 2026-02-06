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
  /** Process name patterns to search for in `ps` output */
  processPatterns: string[];
  /** Marketplace/extension URL, if available */
  extensionUrl?: string;
  /**
   * macOS Application Support subdirectory name for this IDE.
   * Used to locate the IDE's state database for workspace resolution.
   */
  macStorageName?: string;
}

/**
 * Registry of all supported IDEs with detection metadata.
 */
export const IDE_REGISTRY: IDERegistryEntry[] = [
  {
    kind: 'vscode',
    displayName: 'Visual Studio Code',
    processPatterns: ['Visual Studio Code', 'code '],
    extensionUrl: 'https://marketplace.visualstudio.com/items?itemName=AutohandAI.vscode-autohand',
    macStorageName: 'Code',
  },
  {
    kind: 'vscode-insiders',
    displayName: 'Visual Studio Code Insiders',
    processPatterns: ['Code - Insiders', 'code-insiders '],
    extensionUrl: 'https://marketplace.visualstudio.com/items?itemName=AutohandAI.vscode-autohand',
    macStorageName: 'Code - Insiders',
  },
  {
    kind: 'cursor',
    displayName: 'Cursor',
    processPatterns: ['Cursor.app', 'cursor '],
    macStorageName: 'Cursor',
  },
  {
    kind: 'zed',
    displayName: 'Zed',
    processPatterns: ['Zed.app', '/zed '],
    extensionUrl: 'https://zed.dev/extensions/autohand-acp',
    macStorageName: 'Zed',
  },
  {
    kind: 'antigravity',
    displayName: 'Antigravity',
    processPatterns: ['Antigravity.app', 'antigravity '],
    macStorageName: 'Antigravity',
  },
];
