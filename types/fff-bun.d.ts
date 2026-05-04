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

export interface FileItem {
  relativePath: string;
  fileName: string;
  size: number;
  modified: number;
  accessFrecencyScore: number;
  modificationFrecencyScore: number;
  totalFrecencyScore: number;
  gitStatus: string;
}

export interface Score {
  total: number;
  baseScore: number;
  filenameBonus: number;
  specialFilenameBonus: number;
  frecencyBoost: number;
  distancePenalty: number;
  currentFilePenalty: number;
  comboMatchBoost: number;
  exactMatch: boolean;
  matchType: string;
}

export type Location =
  | { type: 'line'; line: number }
  | { type: 'position'; line: number; col: number }
  | {
      type: 'range';
      start: { line: number; col: number };
      end: { line: number; col: number };
    };

export interface SearchResult {
  items: FileItem[];
  scores: Score[];
  totalMatched: number;
  totalFiles: number;
  location?: Location;
}

export type GrepMode = 'plain' | 'regex' | 'fuzzy' | 'smart';

export interface GrepCursor {
  readonly __brand: 'GrepCursor';
  readonly _offset: number;
}

export interface GrepOptions {
  maxFileSize?: number;
  maxMatchesPerFile?: number;
  smartCase?: boolean;
  cursor?: GrepCursor | null;
  mode?: GrepMode;
  timeBudgetMs?: number;
  beforeContext?: number;
  afterContext?: number;
  classifyDefinitions?: boolean;
  path?: string;
}

export interface GrepMatch {
  relativePath: string;
  fileName: string;
  gitStatus: string;
  size: number;
  modified: number;
  isBinary: boolean;
  totalFrecencyScore: number;
  accessFrecencyScore: number;
  modificationFrecencyScore: number;
  lineNumber: number;
  col: number;
  byteOffset: number;
  lineContent: string;
  matchRanges: [number, number][];
  fuzzyScore?: number;
  contextBefore?: string[];
  contextAfter?: string[];
}

export interface GrepResult {
  items: GrepMatch[];
  totalMatched: number;
  totalFilesSearched: number;
  totalFiles: number;
  filteredFileCount: number;
  nextCursor: GrepCursor | null;
  regexFallbackError?: string;
}

export class FileFinder {
  static create(options: InitOptions): Result<FileFinder>;
  waitForScan(timeoutMs?: number): Result<boolean>;
  grep(query: string, options?: GrepOptions): Result<GrepResult>;
  fileSearch(query: string, options?: SearchOptions): Result<SearchResult>;
  destroy(): void;
}
