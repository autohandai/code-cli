/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyPatch as applyUnifiedPatch } from 'diff';
import { GitIgnoreParser } from '../utils/gitIgnore.js';

interface UndoEntry {
  absolutePath: string;
  previousContents: string;
}

export interface SearchHit {
  file: string;
  line: number;
  text: string;
}

export interface SearchOptions {
  limit?: number;
  context?: number;
  relativePath?: string;
}

export class FileActionManager {
  private undoStack: UndoEntry[] = [];
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
  }

  get root(): string {
    return this.workspaceRoot;
  }

  async readFile(target: string): Promise<string> {
    const filePath = this.resolvePath(target);
    const exists = await fs.pathExists(filePath);
    if (!exists) {
      throw new Error(`File ${target} not found in workspace.`);
    }
    return fs.readFile(filePath, 'utf8');
  }

  async writeFile(target: string, contents: string): Promise<void> {
    const filePath = this.resolvePath(target);
    await fs.ensureDir(path.dirname(filePath));
    const previous = (await fs.pathExists(filePath)) ? await fs.readFile(filePath, 'utf8') : '';
    this.undoStack.push({ absolutePath: filePath, previousContents: previous });
    await fs.writeFile(filePath, contents, 'utf8');
  }

  async appendFile(target: string, contents: string): Promise<void> {
    const current = await this.readFileSafe(target);
    await this.writeFile(target, `${current}${contents}`);
  }

  async applyPatch(target: string, patch: string): Promise<void> {
    const filePath = this.resolvePath(target);
    const current = await this.readFileSafe(target);
    const updated = applyUnifiedPatch(current, patch);
    if (updated === false) {
      throw new Error(`Failed to apply patch to ${target}`);
    }
    this.undoStack.push({ absolutePath: filePath, previousContents: current });
    await fs.writeFile(filePath, updated, 'utf8');
  }

  async undoLast(): Promise<void> {
    const entry = this.undoStack.pop();
    if (!entry) {
      throw new Error('Undo stack is empty');
    }
    await fs.writeFile(entry.absolutePath, entry.previousContents, 'utf8');
  }

  search(query: string, relativePath?: string): SearchHit[] {
    const searchDir = this.resolvePath(relativePath ?? '.');
    const rgResult = spawnSync('rg', ['--line-number', '--color', 'never', query, '.'], {
      cwd: searchDir,
      encoding: 'utf8'
    });

    if (rgResult.status === 0 && rgResult.stdout) {
      return rgResult.stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line: string) => {
          const [file, lineNo, ...rest] = line.split(':');
          return {
            file: path.relative(this.workspaceRoot, path.join(searchDir, file)),
            line: Number(lineNo),
            text: rest.join(':')
          };
        });
    }

    return this.walkFallback(query, searchDir);
  }

  searchWithContext(query: string, options: SearchOptions = {}): string {
    const limit = options.limit ?? 10;
    const contextLines = options.context ?? 2;
    const results = this.search(query, options.relativePath);
    return results.slice(0, limit)
      .map((hit) => this.renderContext(hit, contextLines))
      .join('\n\n');
  }

  semanticSearch(query: string, opts: { limit?: number; window?: number; relativePath?: string } = {}): Array<{ file: string; snippet: string }> {
    const limit = opts.limit ?? 5;
    const window = opts.window ?? 400;
    const baseDir = this.resolvePath(opts.relativePath ?? '.');
    const ignoreFilter = new GitIgnoreParser(baseDir);
    const results: Array<{ file: string; snippet: string }> = [];
    const stack = [baseDir];
    const lowerQuery = query.toLowerCase();

    while (stack.length && results.length < limit) {
      const current = stack.pop();
      if (!current) continue;
      const relative = path.relative(this.workspaceRoot, current);
      const normalizedRel = relative.replace(/\\/g, '/');

      // Skip hidden files/directories and ignored paths
      if (path.basename(current).startsWith('.') || ignoreFilter.isIgnored(normalizedRel)) {
        continue;
      }

      try {
        const stats = fs.statSync(current);
        if (stats.isDirectory()) {
          const entries = fs.readdirSync(current);
          for (const entry of entries) {
            // Skip hidden entries
            if (!entry.startsWith('.')) {
              stack.push(path.join(current, entry));
            }
          }
          continue;
        }
        if (!stats.isFile()) {
          continue;
        }

        const contents = fs.readFileSync(current, 'utf8');
        const haystack = contents.toLowerCase();
        const idx = haystack.indexOf(lowerQuery);
        if (idx === -1) continue;

        const start = Math.max(0, idx - window);
        const end = Math.min(contents.length, idx + query.length + window);
        const prefixEllipsis = start > 0 ? '…' : '';
        const suffixEllipsis = end < contents.length ? '…' : '';
        const snippet = `${prefixEllipsis}${contents.slice(start, end)}${suffixEllipsis}`;

        results.push({
          file: normalizedRel || path.basename(current),
          snippet
        });
      } catch {
        // Skip files/directories we can't access
        continue;
      }
    }

    return results;
  }

  private async readFileSafe(target: string): Promise<string> {
    const filePath = this.resolvePath(target);
    if (!(await fs.pathExists(filePath))) {
      return '';
    }
    return fs.readFile(filePath, 'utf8');
  }

  private resolvePath(target: string): string {
    const normalized = path.isAbsolute(target) ? target : path.join(this.workspaceRoot, target);
    const resolved = path.resolve(normalized);
    const rootWithSep = this.workspaceRoot.endsWith(path.sep)
      ? this.workspaceRoot
      : `${this.workspaceRoot}${path.sep}`;
    if (resolved !== this.workspaceRoot && !resolved.startsWith(rootWithSep)) {
      throw new Error(`Path ${target} escapes the workspace root ${this.workspaceRoot}`);
    }
    return resolved;
  }

  private walkFallback(query: string, baseDir: string): SearchHit[] {
    const hits: SearchHit[] = [];
    const stack = [baseDir];
    while (stack.length) {
      const current = stack.pop();
      if (!current) {
        continue;
      }
      const basename = path.basename(current);
      const relative = path.relative(this.workspaceRoot, current);

      // Skip hidden files/directories and common excludes
      if (basename.startsWith('.') || relative.includes('node_modules') || relative.startsWith('dist')) {
        continue;
      }
      try {
        const stats = fs.statSync(current);
        if (stats.isDirectory()) {
          const entries = fs.readdirSync(current);
          for (const entry of entries) {
            // Skip hidden entries
            if (!entry.startsWith('.')) {
              stack.push(path.join(current, entry));
            }
          }
        } else if (stats.isFile()) {
          const contents = fs.readFileSync(current, 'utf8');
          const lines = contents.split(/\r?\n/);
          lines.forEach((line: string, idx: number) => {
            if (line.includes(query)) {
              hits.push({
                file: path.relative(this.workspaceRoot, current),
                line: idx + 1,
                text: line.trim()
              });
            }
          });
        }
      } catch {
        // Skip files/directories that don't exist or can't be accessed
        continue;
      }
    }
    return hits;
  }

  async createDirectory(relativePath: string): Promise<void> {
    const dirPath = this.resolvePath(relativePath);
    await fs.ensureDir(dirPath);
  }

  async deletePath(relativePath: string): Promise<void> {
    const fullPath = this.resolvePath(relativePath);
    const exists = await fs.pathExists(fullPath);
    if (!exists) {
      throw new Error(`${relativePath} does not exist.`);
    }
    const stats = await fs.stat(fullPath);
    this.undoStack.push({
      absolutePath: fullPath,
      previousContents: stats.isFile() ? await fs.readFile(fullPath, 'utf8') : ''
    });
    await fs.remove(fullPath);
  }

  async renamePath(from: string, to: string): Promise<void> {
    const fromPath = this.resolvePath(from);
    const toPath = this.resolvePath(to);
    await fs.ensureDir(path.dirname(toPath));
    await fs.move(fromPath, toPath, { overwrite: true });
  }

  async copyPath(from: string, to: string): Promise<void> {
    const fromPath = this.resolvePath(from);
    const toPath = this.resolvePath(to);
    await fs.copy(fromPath, toPath, { overwrite: true });
  }

  async replaceInFile(relativePath: string, searchValue: string | RegExp, replaceValue: string): Promise<void> {
    const current = await this.readFile(relativePath);
    const updated = current.replace(searchValue as any, replaceValue);
    await this.writeFile(relativePath, updated);
  }

  async formatFile(
    relativePath: string,
    formatter: (contents: string, file: string) => Promise<string>
  ): Promise<void> {
    const current = await this.readFile(relativePath);
    const formatted = await formatter(current, relativePath);
    await this.writeFile(relativePath, formatted);
  }

  private renderContext(hit: SearchHit, contextLines: number): string {
    const filePath = this.resolvePath(hit.file);
    if (!fs.existsSync(filePath)) {
      return `${hit.file}:${hit.line}`;
    }
    const contents = fs.readFileSync(filePath, 'utf8');
    const lines = contents.split(/\r?\n/);
    const start = Math.max(0, hit.line - 1 - contextLines);
    const end = Math.min(lines.length, hit.line - 1 + contextLines + 1);
    const snippet = lines.slice(start, end).map((line, idx) => {
      const number = start + idx + 1;
      const marker = number === hit.line ? '>' : ' ';
      return `${marker} ${number.toString().padStart(4, ' ')} | ${line}`;
    });
    return `${hit.file}:${hit.line}\n${snippet.join('\n')}`;
  }
}
