/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'node:path';
import { showFilePalette, type FilePaletteOptions } from '../../ui/filePalette.js';

interface MentionFileReader {
  readFile(file: string): Promise<string>;
}

export interface MentionResolverOptions {
  getWorkspaceRoot: () => string;
  files: MentionFileReader;
  collectWorkspaceFiles: () => Promise<string[]>;
  getStatusLine: () => string;
  selectFile?: (options: FilePaletteOptions) => Promise<string | null>;
  logWarning?: (message: string) => void;
}

export interface MentionContextFlush {
  block: string;
  files: string[];
}

export class MentionResolver {
  private readonly selectFile: (options: FilePaletteOptions) => Promise<string | null>;
  private mentionContexts: { path: string; contents: string }[] = [];

  constructor(private readonly options: MentionResolverOptions) {
    this.selectFile = options.selectFile ?? showFilePalette;
  }

  async resolve(instruction: string): Promise<string> {
    const mentionRegex = /@([A-Za-z0-9_./\\-]*)/g;
    const matches: Array<{ start: number; end: number; token: string; seed: string }> = [];
    let match: RegExpExecArray | null;
    while ((match = mentionRegex.exec(instruction)) !== null) {
      const token = match[0];
      const seed = match[1] ?? '';
      const start = match.index ?? 0;
      const prevChar = start > 0 ? instruction[start - 1] : ' ';
      if (prevChar && /[^\s\(\[]/.test(prevChar)) {
        continue;
      }
      matches.push({ start, end: start + token.length, token, seed });
    }

    if (!matches.length) {
      return instruction;
    }

    let result = '';
    let lastIndex = 0;
    for (const entry of matches) {
      if (entry.start < lastIndex) {
        continue;
      }
      result += instruction.slice(lastIndex, entry.start);
      const replacement = await this.resolveMentionToken(entry.token, entry.seed);
      if (replacement) {
        result += replacement;
      } else {
        result += instruction.slice(entry.start, entry.end);
      }
      lastIndex = entry.end;
    }
    result += instruction.slice(lastIndex);
    return result;
  }

  flush(): MentionContextFlush | null {
    if (!this.mentionContexts.length) {
      return null;
    }
    const contexts = [...this.mentionContexts];
    const block = contexts
      .map((ctx) => `File: ${ctx.path}\n${ctx.contents}`)
      .join('\n\n');
    this.mentionContexts = [];
    return {
      block,
      files: contexts.map((ctx) => ctx.path)
    };
  }

  clear(): void {
    this.mentionContexts = [];
  }

  private async resolveMentionToken(_token: string, seed: string): Promise<string | null> {
    const normalizedSeed = seed.trim();
    if (normalizedSeed && (await this.fileExists(normalizedSeed))) {
      await this.captureMentionContext(normalizedSeed);
      return normalizedSeed;
    }

    const workspaceFiles = await this.options.collectWorkspaceFiles();
    if (!workspaceFiles.length) {
      return normalizedSeed || null;
    }

    const selection = await this.selectFile({
      files: workspaceFiles,
      statusLine: this.options.getStatusLine(),
      seed: normalizedSeed
    });
    if (selection) {
      await this.captureMentionContext(selection);
      return selection;
    }

    return normalizedSeed || null;
  }

  private async fileExists(relativePath: string): Promise<boolean> {
    const workspaceRoot = this.options.getWorkspaceRoot();
    const fullPath = path.resolve(workspaceRoot, relativePath);
    const rootWithSep = workspaceRoot.endsWith(path.sep) ? workspaceRoot : `${workspaceRoot}${path.sep}`;
    if (fullPath !== workspaceRoot && !fullPath.startsWith(rootWithSep)) {
      return false;
    }
    const exists = await fs.pathExists(fullPath);
    if (!exists) {
      return false;
    }
    try {
      const stats = await fs.stat(fullPath);
      return stats.isFile();
    } catch {
      return false;
    }
  }

  private async captureMentionContext(file: string): Promise<void> {
    try {
      const contents = await this.options.files.readFile(file);
      this.mentionContexts.push({ path: file, contents: this.trimContext(contents) });
    } catch (error) {
      const message = chalk.yellow(`Unable to read ${file} for context: ${(error as Error).message}`);
      if (this.options.logWarning) {
        this.options.logWarning(message);
      } else {
        console.log(message);
      }
    }
  }

  private trimContext(content: string): string {
    const limit = 2000;
    if (content.length > limit) {
      return content.slice(0, limit) + '\n...trimmed';
    }
    return content;
  }
}
