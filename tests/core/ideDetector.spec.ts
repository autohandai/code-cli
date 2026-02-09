/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import {
  isRuntimePath,
  looksLikeWorkspace,
  getStorageBasePath,
  pathMatchesCwd,
  findProcessLines,
  extractPathsFromArgs,
  getExtensionSuggestions,
} from '../../src/core/ide/ideDetector.js';
import { IDE_REGISTRY } from '../../src/core/ide/ideTypes.js';
import type { DetectedIDE } from '../../src/core/ide/ideTypes.js';

describe('ideDetector', () => {
  // ────────────────────────────────────────────
  //  isRuntimePath
  // ────────────────────────────────────────────

  describe('isRuntimePath', () => {
    it('identifies macOS runtime paths', () => {
      expect(isRuntimePath('/Applications/Visual Studio Code.app/Contents', 'darwin')).toBe(true);
      expect(isRuntimePath('/Library/Frameworks/Python.framework', 'darwin')).toBe(true);
      expect(isRuntimePath('/System/Library/foo', 'darwin')).toBe(true);
      expect(isRuntimePath('/usr/local/bin/node', 'darwin')).toBe(true);
      expect(isRuntimePath('/private/var/folders/xx', 'darwin')).toBe(true);
    });

    it('identifies Linux runtime paths', () => {
      expect(isRuntimePath('/opt/vscode/bin/code', 'linux')).toBe(true);
      expect(isRuntimePath('/usr/share/applications/code.desktop', 'linux')).toBe(true);
      expect(isRuntimePath('/tmp/vscode-abc123', 'linux')).toBe(true);
      expect(isRuntimePath('/home/user/.config/Code/logs', 'linux')).toBe(true);
      expect(isRuntimePath('/home/user/.cache/mesa', 'linux')).toBe(true);
      expect(isRuntimePath('/home/user/.local/share/zed/db', 'linux')).toBe(true);
    });

    it('identifies Windows runtime paths', () => {
      expect(isRuntimePath('C:\\Program Files\\Microsoft VS Code\\Code.exe', 'win32')).toBe(true);
      expect(isRuntimePath('C:\\Program Files (x86)\\Common Files', 'win32')).toBe(true);
      expect(isRuntimePath('C:\\Windows\\System32\\cmd.exe', 'win32')).toBe(true);
      expect(isRuntimePath('C:\\Users\\john\\AppData\\Local\\Temp', 'win32')).toBe(true);
      expect(isRuntimePath('C:\\ProgramData\\Microsoft', 'win32')).toBe(true);
    });

    it('identifies common runtime patterns across platforms', () => {
      expect(isRuntimePath('/home/user/project/node_modules/.bin/tsc', 'linux')).toBe(true);
      expect(isRuntimePath('/Users/alex/code/.vscode/settings.json', 'darwin')).toBe(true);
      expect(isRuntimePath('/home/user/project/Frameworks/Electron', 'linux')).toBe(true);
    });

    it('does not flag workspace paths as runtime', () => {
      expect(isRuntimePath('/Users/alex/projects/my-app', 'darwin')).toBe(false);
      expect(isRuntimePath('/home/user/projects/my-app', 'linux')).toBe(false);
      expect(isRuntimePath('C:\\Users\\john\\projects\\my-app', 'win32')).toBe(false);
    });
  });

  // ────────────────────────────────────────────
  //  looksLikeWorkspace
  // ────────────────────────────────────────────

  describe('looksLikeWorkspace', () => {
    it('matches valid macOS workspace paths', () => {
      expect(looksLikeWorkspace('/Users/alex/projects/my-app', 'darwin')).toBe(true);
      expect(looksLikeWorkspace('/Users/alex/code', 'darwin')).toBe(true);
    });

    it('matches valid Linux workspace paths', () => {
      expect(looksLikeWorkspace('/home/user/projects/my-app', 'linux')).toBe(true);
      expect(looksLikeWorkspace('/root/project', 'linux')).toBe(true);
      expect(looksLikeWorkspace('/home/user/code', 'linux')).toBe(true);
    });

    it('matches valid Windows workspace paths', () => {
      expect(looksLikeWorkspace('C:\\Users\\john\\projects\\my-app', 'win32')).toBe(true);
      expect(looksLikeWorkspace('D:\\Users\\dev\\code', 'win32')).toBe(true);
    });

    it('rejects paths that are not under a user home', () => {
      expect(looksLikeWorkspace('/usr/local/bin', 'linux')).toBe(false);
      expect(looksLikeWorkspace('/opt/code', 'linux')).toBe(false);
      expect(looksLikeWorkspace('/Applications', 'darwin')).toBe(false);
    });

    it('rejects bare home directory paths on Unix', () => {
      expect(looksLikeWorkspace('/Users/alex', 'darwin')).toBe(false);
      expect(looksLikeWorkspace('/home/user', 'linux')).toBe(false);
    });
  });

  // ────────────────────────────────────────────
  //  getStorageBasePath
  // ────────────────────────────────────────────

  describe('getStorageBasePath', () => {
    const home = os.homedir();

    it('returns Application Support on darwin for both types', () => {
      const expected = path.join(home, 'Library', 'Application Support');
      expect(getStorageBasePath('vscode-family', 'darwin')).toBe(expected);
      expect(getStorageBasePath('zed', 'darwin')).toBe(expected);
    });

    it('returns XDG_CONFIG_HOME for vscode-family on linux', () => {
      // Without XDG override, should fall back to ~/.config
      const fallback = path.join(home, '.config');
      const result = getStorageBasePath('vscode-family', 'linux');
      // Either the env var or the fallback
      const expected = process.env['XDG_CONFIG_HOME'] ?? fallback;
      expect(result).toBe(expected);
    });

    it('returns XDG_DATA_HOME for zed on linux', () => {
      const fallback = path.join(home, '.local', 'share');
      const result = getStorageBasePath('zed', 'linux');
      const expected = process.env['XDG_DATA_HOME'] ?? fallback;
      expect(result).toBe(expected);
    });

    it('returns APPDATA for vscode-family on win32', () => {
      const result = getStorageBasePath('vscode-family', 'win32');
      const expected = process.env['APPDATA'] ?? path.join(home, 'AppData', 'Roaming');
      expect(result).toBe(expected);
    });

    it('returns LOCALAPPDATA for zed on win32', () => {
      const result = getStorageBasePath('zed', 'win32');
      const expected = process.env['LOCALAPPDATA'] ?? path.join(home, 'AppData', 'Local');
      expect(result).toBe(expected);
    });
  });

  // ────────────────────────────────────────────
  //  pathMatchesCwd
  // ────────────────────────────────────────────

  describe('pathMatchesCwd', () => {
    it('is case-sensitive on linux', () => {
      expect(pathMatchesCwd('/home/user/Project', '/home/user/Project', 'linux')).toBe(true);
      expect(pathMatchesCwd('/home/user/Project', '/home/user/project', 'linux')).toBe(false);
    });

    it('is case-insensitive on darwin', () => {
      expect(pathMatchesCwd('/Users/Alex/Project', '/Users/alex/project', 'darwin')).toBe(true);
      expect(pathMatchesCwd('/Users/Alex/Project', '/Users/Alex/Project', 'darwin')).toBe(true);
    });

    it('is case-insensitive on win32', () => {
      expect(pathMatchesCwd('C:\\Users\\John\\Project', 'c:\\users\\john\\project', 'win32')).toBe(true);
    });
  });

  // ────────────────────────────────────────────
  //  IDE_REGISTRY validation
  // ────────────────────────────────────────────

  describe('IDE_REGISTRY', () => {
    it('has processPatterns for all 3 platforms on each entry', () => {
      for (const entry of IDE_REGISTRY) {
        expect(entry.processPatterns).toHaveProperty('darwin');
        expect(entry.processPatterns).toHaveProperty('linux');
        expect(entry.processPatterns).toHaveProperty('win32');
        expect(Array.isArray(entry.processPatterns.darwin)).toBe(true);
        expect(Array.isArray(entry.processPatterns.linux)).toBe(true);
        expect(Array.isArray(entry.processPatterns.win32)).toBe(true);
      }
    });

    it('has at least one darwin pattern per entry', () => {
      for (const entry of IDE_REGISTRY) {
        expect(entry.processPatterns.darwin.length).toBeGreaterThan(0);
      }
    });

    it('allows empty patterns for platform-limited IDEs', () => {
      const antigravity = IDE_REGISTRY.find((e) => e.kind === 'antigravity')!;
      expect(antigravity.processPatterns.linux).toEqual([]);
      expect(antigravity.processPatterns.win32).toEqual([]);
    });

    it('has storage config for cross-platform IDEs', () => {
      const vscode = IDE_REGISTRY.find((e) => e.kind === 'vscode')!;
      expect(vscode.storage).toBeDefined();
      expect(vscode.storage!.darwin).toBe('Code');
      expect(vscode.storage!.linux).toBe('Code');
      expect(vscode.storage!.win32).toBe('Code');
    });

    it('has zed storage type for Zed entry', () => {
      const zed = IDE_REGISTRY.find((e) => e.kind === 'zed')!;
      expect(zed.storage?.type).toBe('zed');
      expect(zed.storage?.linux).toBe('zed');
    });
  });

  // ────────────────────────────────────────────
  //  findProcessLines
  // ────────────────────────────────────────────

  describe('findProcessLines', () => {
    const mockLines = [
      'igorcosta  1234  0.5 /Applications/Visual Studio Code.app/Contents/MacOS/Electron --folder-uri file:///Users/igorcosta/projects/my-app',
      'igorcosta  5678  1.2 /Applications/Zed.app/Contents/MacOS/zed /Users/igorcosta/projects/other',
      'root       9012  0.0 /usr/sbin/sshd',
      'igorcosta  3456  0.1 node /Users/igorcosta/projects/my-app/server.js',
    ];

    it('finds lines matching VS Code patterns', () => {
      const result = findProcessLines(mockLines, ['Visual Studio Code', 'code ']);
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('Visual Studio Code');
    });

    it('finds lines matching Zed patterns', () => {
      const result = findProcessLines(mockLines, ['Zed.app', '/zed ']);
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('Zed.app');
    });

    it('returns empty for non-matching patterns', () => {
      const result = findProcessLines(mockLines, ['Cursor.app', 'cursor ']);
      expect(result).toHaveLength(0);
    });

    it('matches multiple lines when patterns overlap', () => {
      const lines = [
        'user 1 code /Users/user/a',
        'user 2 code /Users/user/b',
        'user 3 vim /Users/user/c',
      ];
      const result = findProcessLines(lines, ['code ']);
      expect(result).toHaveLength(2);
    });
  });

  // ────────────────────────────────────────────
  //  extractPathsFromArgs
  // ────────────────────────────────────────────

  describe('extractPathsFromArgs', () => {
    it('extracts Unix workspace paths', () => {
      const line = 'electron --type=renderer /Users/alex/projects/my-app';
      const result = extractPathsFromArgs(line, 'vscode', 'darwin');
      expect(result).toContain('/Users/alex/projects/my-app');
    });

    it('extracts Linux home paths', () => {
      const line = 'code --unity-launch /home/user/dev/project';
      const result = extractPathsFromArgs(line, 'vscode', 'linux');
      expect(result).toContain('/home/user/dev/project');
    });

    it('extracts Windows paths', () => {
      const line = 'Code.exe C:\\Users\\john\\projects\\my-app';
      const result = extractPathsFromArgs(line, 'vscode', 'win32');
      expect(result).toContain('C:\\Users\\john\\projects\\my-app');
    });

    it('filters out runtime paths', () => {
      const line = 'electron /Applications/Code.app/Contents /Users/alex/code';
      const result = extractPathsFromArgs(line, 'vscode', 'darwin');
      expect(result).not.toContain('/Applications/Code.app/Contents');
      expect(result).toContain('/Users/alex/code');
    });

    it('returns empty for lines without paths', () => {
      const result = extractPathsFromArgs('node server.js', 'vscode', 'linux');
      expect(result).toHaveLength(0);
    });
  });

  // ────────────────────────────────────────────
  //  getExtensionSuggestions
  // ────────────────────────────────────────────

  describe('getExtensionSuggestions', () => {
    it('returns suggestions for detected IDEs with extensions', () => {
      const detected: DetectedIDE[] = [
        { kind: 'vscode', displayName: 'Visual Studio Code', workspacePath: null, matchesCwd: false },
        { kind: 'zed', displayName: 'Zed', workspacePath: null, matchesCwd: false },
      ];
      const suggestions = getExtensionSuggestions(detected);
      expect(suggestions.length).toBe(2);
      expect(suggestions.find((s) => s.displayName === 'Visual Studio Code')).toBeDefined();
      expect(suggestions.find((s) => s.displayName === 'Zed')).toBeDefined();
    });

    it('deduplicates extension URLs', () => {
      const detected: DetectedIDE[] = [
        { kind: 'vscode', displayName: 'Visual Studio Code', workspacePath: '/a', matchesCwd: false },
        { kind: 'vscode-insiders', displayName: 'VS Code Insiders', workspacePath: '/b', matchesCwd: false },
      ];
      const suggestions = getExtensionSuggestions(detected);
      // vscode and vscode-insiders share the same extension URL
      expect(suggestions.length).toBe(1);
    });

    it('excludes IDEs without extensions', () => {
      const detected: DetectedIDE[] = [
        { kind: 'cursor', displayName: 'Cursor', workspacePath: null, matchesCwd: false },
      ];
      const suggestions = getExtensionSuggestions(detected);
      expect(suggestions.length).toBe(0);
    });

    it('excludes IDEs not in detected list', () => {
      const detected: DetectedIDE[] = [];
      const suggestions = getExtensionSuggestions(detected);
      expect(suggestions.length).toBe(0);
    });
  });
});
