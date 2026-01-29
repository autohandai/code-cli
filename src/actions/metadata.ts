/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import crypto from 'node:crypto';
import fs from 'fs-extra';
import path from 'node:path';
import { GitIgnoreParser } from '../utils/gitIgnore.js';

export interface TreeOptions {
  depth?: number;
  maxEntries?: number;
  workspaceRoot?: string;
}

/** Hardcoded skip patterns for non-git directories */
const ALWAYS_SKIP = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '__pycache__', '.cache']);

export async function listDirectoryTree(root: string, options: TreeOptions = {}): Promise<string[]> {
  const depth = options.depth ?? 2;
  const maxEntries = options.maxEntries ?? 200;
  const workspaceRoot = options.workspaceRoot ?? root;
  const result: string[] = [];

  // Validate that root is within workspace
  const resolvedRoot = path.resolve(root);
  const resolvedWorkspace = path.resolve(workspaceRoot);
  if (!resolvedRoot.startsWith(resolvedWorkspace)) {
    throw new Error(`Path ${root} is outside the workspace root.`);
  }

  const ignoreFilter = new GitIgnoreParser(workspaceRoot);

  async function walk(current: string, prefix: string, currentDepth: number): Promise<void> {
    if (result.length >= maxEntries) {
      return;
    }

    let entries: string[];
    try {
      entries = await fs.readdir(current);
    } catch {
      // Skip directories we can't read (permissions, etc.)
      return;
    }

    const slice = entries.slice(0, maxEntries - result.length);
    for (const entry of slice) {
      // Skip hidden files/directories that start with '.'
      if (entry.startsWith('.')) {
        continue;
      }

      const full = path.join(current, entry);
      const rel = path.relative(workspaceRoot, full);

      // Skip hardcoded patterns and gitignored files
      if (ALWAYS_SKIP.has(entry) || ignoreFilter.isIgnored(rel)) {
        continue;
      }

      try {
        const stats = await fs.stat(full);
        result.push(`${prefix}${entry}${stats.isDirectory() ? '/' : ''}`);
        if (stats.isDirectory() && currentDepth < depth) {
          await walk(full, `${prefix}  `, currentDepth + 1);
        }
      } catch {
        // Skip files/directories we can't stat
        continue;
      }

      if (result.length >= maxEntries) {
        break;
      }
    }
  }

  await walk(root, '', 0);
  return result;
}

export async function fileStats(root: string, relativePath: string): Promise<{ size: number; mtime: string; isDirectory: boolean } | null> {
  const fullPath = path.join(root, relativePath);
  if (!(await fs.pathExists(fullPath))) {
    return null;
  }
  const stats = await fs.stat(fullPath);
  return {
    size: stats.size,
    mtime: stats.mtime.toISOString(),
    isDirectory: stats.isDirectory()
  };
}

export async function checksumFile(root: string, relativePath: string, algorithm: string = 'sha256'): Promise<string> {
  const fullPath = path.join(root, relativePath);
  const exists = await fs.pathExists(fullPath);
  if (!exists) {
    throw new Error(`${relativePath} does not exist.`);
  }
  const hash = crypto.createHash(algorithm);
  const stream = fs.createReadStream(fullPath);
  return await new Promise((resolve, reject) => {
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
