/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { FileFinder } from '@ff-labs/fff-bun';

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

interface GrepHit {
  file: string;
  line: number;
  text: string;
  context?: {
    before?: string[];
    after?: string[];
  };
}

interface FileHit {
  path: string;
  gitStatus?: string;
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

    await result.value.waitForScan(10_000);
    return new FFFSearchProvider(result.value, workspaceRoot);
  }

  async grep(params: GrepParams): Promise<string> {
    const hits = this.finder.grep(params.query, {
      mode: 'smart',
      smartCase: !params.caseSensitive,
      beforeContext: params.beforeContext ?? 2,
      afterContext: params.afterContext ?? 2,
      classifyDefinitions: params.classifyDefinitions ?? true,
      path: params.path,
    }) as GrepHit[];

    if (!hits.length) {
      return 'No matches found.';
    }

    const limit = params.limit ?? 50;
    const limited = hits.slice(0, limit);

    const result = limited
      .map((hit) => {
        const before = hit.context?.before?.join('\n') ?? '';
        const line = `${hit.file}:${hit.line}: ${hit.text}`;
        const after = hit.context?.after?.join('\n') ?? '';
        return [before, line, after].filter(Boolean).join('\n');
      })
      .join('\n\n');

    const header =
      hits.length > limit
        ? `Found ${hits.length} matches (showing first ${limit}):\n\n`
        : `Found ${hits.length} matches:\n\n`;

    return header + result;
  }

  async fileSearch(params: FindParams): Promise<string> {
    const files = this.finder.fileSearch(params.query, {
      pageSize: params.limit ?? 50,
    }) as FileHit[];

    if (!files.length) {
      return 'No files found.';
    }

    return files
      .map((f) => {
        const gitStatus = f.gitStatus ? `[${f.gitStatus}] ` : '';
        return `${gitStatus}${f.path}`;
      })
      .join('\n');
  }

  destroy(): void {
    this.finder.destroy();
  }
}
