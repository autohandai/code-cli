declare module '@ff-labs/fff-bun' {
  export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

  export interface InitOptions {
    basePath: string;
    frecencyDbPath?: string;
    historyDbPath?: string;
    useUnsafeNoLock?: boolean;
    disableMmapCache?: boolean;
    disableContentIndexing?: boolean;
    disableWatch?: boolean;
    aiMode?: boolean;
    logFilePath?: string;
    logLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
    cacheBudgetMaxFiles?: number;
    cacheBudgetMaxBytes?: number;
    cacheBudgetMaxFileSize?: number;
  }

  export interface SearchOptions {
    maxThreads?: number;
    currentFile?: string;
    comboBoostMultiplier?: number;
    minComboCount?: number;
    pageIndex?: number;
    pageSize?: number;
  }

  export interface GrepOptions {
    maxFileSize?: number;
    maxMatchesPerFile?: number;
    smartCase?: boolean;
    cursor?: unknown;
    mode?: string;
    timeBudgetMs?: number;
    beforeContext?: number;
    afterContext?: number;
    classifyDefinitions?: boolean;
    path?: string;
  }

  export class FileFinder {
    static create(options: InitOptions): Result<FileFinder>;
    waitForScan(timeoutMs?: number): Promise<void>;
    grep(query: string, options?: GrepOptions): unknown;
    fileSearch(query: string, options?: SearchOptions): unknown;
    destroy(): void;
  }
}
