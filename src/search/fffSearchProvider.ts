/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  FileFinder,
  type GrepResult,
  type Result,
  type SearchResult,
} from '@ff-labs/fff-bun';

export interface GrepParams {
  query: string;
  path?: string;
  exclude?: string;
  caseSensitive?: boolean;
  beforeContext?: number;
  afterContext?: number;
  classifyDefinitions?: boolean;
  limit?: number;
}

export interface FindParams {
  query: string;
  limit?: number;
}

export class FFFSearchProvider {
  private finder: FileFinder;
  private workspaceRoot: string;

  private constructor(finder: FileFinder, workspaceRoot: string) {
    this.finder = finder;
    this.workspaceRoot = workspaceRoot;
  }

  static async create(workspaceRoot: string): Promise<FFFSearchProvider> {
    const result = FileFinder.create({
      basePath: workspaceRoot,
      aiMode: true,
    });

    if (!result.ok) {
      throw new Error(`Failed to initialize FFF: ${result.error}`);
    }

    const scanResult = result.value.waitForScan(10_000);
    if (!scanResult.ok) {
      throw new Error(`Failed to scan workspace with FFF: ${scanResult.error}`);
    }

    return new FFFSearchProvider(result.value, workspaceRoot);
  }

  async grep(params: GrepParams): Promise<string> {
    const searchResult = this.unwrap(this.finder.grep(params.query, {
      mode: 'smart',
      smartCase: !params.caseSensitive,
      beforeContext: params.beforeContext ?? 2,
      afterContext: params.afterContext ?? 2,
      classifyDefinitions: params.classifyDefinitions ?? true,
      path: params.path,
    }));
    const hits = searchResult.items;

    if (!hits.length) {
      return 'No matches found.';
    }

    const limit = params.limit ?? 50;
    const limited = hits.slice(0, limit);

    const formattedHits = limited
      .map((hit) => {
        const before = hit.contextBefore?.join('\n') ?? '';
        const line = `${hit.relativePath}:${hit.lineNumber}: ${hit.lineContent}`;
        const after = hit.contextAfter?.join('\n') ?? '';
        return [before, line, after].filter(Boolean).join('\n');
      })
      .join('\n\n');

    const header =
      hits.length > limit
        ? `Found ${hits.length} matches (showing first ${limit}):\n\n`
        : `Found ${hits.length} match${hits.length === 1 ? '' : 'es'}:\n\n`;

    return header + formattedHits;
  }

  async fileSearch(params: FindParams): Promise<string> {
    const result = this.unwrap(this.finder.fileSearch(params.query, {
      pageSize: params.limit ?? 50,
    }));
    const files = result.items;

    if (!files.length) {
      return 'No files found.';
    }

    return files
      .map((f) => {
        const gitStatus = f.gitStatus && f.gitStatus !== 'clean' ? `[${f.gitStatus}] ` : '';
        return `${gitStatus}${f.relativePath}`;
      })
      .join('\n');
  }

  destroy(): void {
    this.finder.destroy();
  }

  private unwrap<T extends GrepResult | SearchResult>(result: Result<T>): T {
    if (!result.ok) {
      throw new Error(result.error);
    }

    return result.value;
  }
}
