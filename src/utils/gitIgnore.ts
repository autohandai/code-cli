/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import path from 'node:path';
import ignore from 'ignore';

export interface GitIgnoreFilter {
  isIgnored(filePath: string): boolean;
}

export class GitIgnoreParser implements GitIgnoreFilter {
  private readonly projectRoot: string;
  private cache: Map<string, string[]> = new Map();
  private globalPatterns: string[] | undefined;
  private processedExtraPatterns: string[] = [];

  constructor(projectRoot: string, private readonly extraPatterns?: string[]) {
    this.projectRoot = path.resolve(projectRoot);
    if (this.extraPatterns?.length) {
      this.processedExtraPatterns = this.processPatterns(this.extraPatterns, '.');
    }
  }

  isIgnored(filePath: string): boolean {
    if (!filePath) {
      return false;
    }

    const absoluteFilePath = path.resolve(this.projectRoot, filePath);
    if (!absoluteFilePath.startsWith(this.projectRoot)) {
      return false;
    }

    const relativePath = path.relative(this.projectRoot, absoluteFilePath);
    if (!relativePath || relativePath.startsWith('..')) {
      return false;
    }

    const normalizedPath = relativePath.replace(/\\/g, '/');

    const ig = ignore();
    ig.add('.git');

    if (this.globalPatterns === undefined) {
      const excludeFile = path.join(this.projectRoot, '.git', 'info', 'exclude');
      this.globalPatterns = fs.existsSync(excludeFile)
        ? this.loadPatternsForFile(excludeFile)
        : [];
    }
    ig.add(this.globalPatterns);

    const pathParts = relativePath.split(path.sep);
    const dirsToVisit: string[] = [];
    let current = this.projectRoot;
    dirsToVisit.push(current);
    for (let i = 0; i < pathParts.length - 1; i++) {
      current = path.join(current, pathParts[i]);
      dirsToVisit.push(current);
    }

    for (const dir of dirsToVisit) {
      const relativeDir = path.relative(this.projectRoot, dir);
      if (relativeDir) {
        const normalizedDir = relativeDir.replace(/\\/g, '/');
        const igPlusExtras = ignore()
          .add(ig)
          .add(this.processedExtraPatterns);
        if (igPlusExtras.ignores(normalizedDir)) {
          break;
        }
      }

      if (this.cache.has(dir)) {
        ig.add(this.cache.get(dir) ?? []);
      } else {
        const gitignorePath = path.join(dir, '.gitignore');
        if (fs.existsSync(gitignorePath)) {
          const patterns = this.loadPatternsForFile(gitignorePath);
          this.cache.set(dir, patterns);
          ig.add(patterns);
        } else {
          this.cache.set(dir, []);
        }
      }
    }

   ig.add(this.processedExtraPatterns);

    return ig.ignores(normalizedPath);
  }

  private loadPatternsForFile(patternsFilePath: string): string[] {
    let content = '';
    try {
      content = fs.readFileSync(patternsFilePath, 'utf8');
    } catch {
      return [];
    }

    const isExcludeFile = patternsFilePath.endsWith(path.join('.git', 'info', 'exclude'));
    const relativeBaseDir = isExcludeFile
      ? '.'
      : path
          .dirname(path.relative(this.projectRoot, patternsFilePath))
          .split(path.sep)
          .join(path.posix.sep);

    const rawPatterns = content.split('\n');
    return this.processPatterns(rawPatterns, relativeBaseDir);
  }

  private processPatterns(rawPatterns: string[], relativeBaseDir: string): string[] {
    return rawPatterns
      .map((pattern) => pattern.trimStart())
      .filter((pattern) => pattern && !pattern.startsWith('#'))
      .map((pattern) => this.normalizePattern(pattern, relativeBaseDir))
      .filter(Boolean) as string[];
  }

  private normalizePattern(pattern: string, relativeBaseDir: string): string {
    let p = pattern;
    const isNegative = p.startsWith('!');
    if (isNegative) {
      p = p.slice(1);
    }

    const isAnchored = p.startsWith('/');
    if (isAnchored) {
      p = p.slice(1);
    }

    if (!p) {
      return '';
    }

    let newPattern = p;
    if (relativeBaseDir && relativeBaseDir !== '.') {
      if (!isAnchored && !p.includes('/')) {
        newPattern = path.posix.join('**', p);
      }
      newPattern = path.posix.join(relativeBaseDir, newPattern);
      if (!newPattern.startsWith('/')) {
        newPattern = '/' + newPattern;
      }
    }

    if (isAnchored && !newPattern.startsWith('/')) {
      newPattern = '/' + newPattern;
    }

    if (isNegative) {
      newPattern = '!' + newPattern;
    }

    return newPattern;
  }
}
