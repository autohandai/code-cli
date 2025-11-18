/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import crypto from 'node:crypto';
import fs from 'fs-extra';
import path from 'node:path';

export interface TreeOptions {
  depth?: number;
  maxEntries?: number;
}

export async function listDirectoryTree(root: string, options: TreeOptions = {}): Promise<string[]> {
  const depth = options.depth ?? 2;
  const maxEntries = options.maxEntries ?? 200;
  const result: string[] = [];

  async function walk(current: string, prefix: string, currentDepth: number): Promise<void> {
    if (result.length >= maxEntries) {
      return;
    }
    const entries = await fs.readdir(current);
    const slice = entries.slice(0, maxEntries - result.length);
    for (const entry of slice) {
      const full = path.join(current, entry);
      const rel = path.relative(root, full) || '.';
      const stats = await fs.stat(full);
      result.push(`${prefix}${entry}${stats.isDirectory() ? '/' : ''}`);
      if (stats.isDirectory() && currentDepth < depth) {
        await walk(full, `${prefix}  `, currentDepth + 1);
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
