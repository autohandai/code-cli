/**
 * Declarative native trace Adapter registry. Parsing implementations consume
 * these bounded locations rather than probing arbitrary user directories.
 *
 * @license Apache-2.0
 */
import path from 'node:path';
import { TRACE_HARNESSES, type TraceHarness } from '../model.js';
import { createNativeTraceAdapter } from './NativeTraceAdapter.js';

export { TRACE_HARNESSES };

export type TraceSourceFormat = 'json' | 'jsonl' | 'sqlite' | 'jsonl-zstd';

export interface TraceSourceAdapter {
  readonly harness: TraceHarness;
  readonly displayName: string;
  readonly formats: readonly TraceSourceFormat[];
  readonly locations: readonly string[];
  scan(options?: TraceAdapterScanOptions): Promise<TraceAdapterScanResult>;
}

export interface TraceAdapterScanOptions {
  signal?: AbortSignal;
  maxFiles?: number;
  maxBytesPerFile?: number;
  maxTotalBytes?: number;
  maxRecords?: number;
  knownFingerprints?: Readonly<Record<string, string>>;
}

export interface TraceSourceFileSnapshot {
  harness: TraceHarness;
  key: string;
  fingerprint: string;
  changed: boolean;
  parsed: boolean;
  traceIds: string[];
}

export interface TraceAdapterScanResult {
  traces: import('../model.js').NormalizedTrace[];
  filesScanned: number;
  bytesRead: number;
  warnings: string[];
  truncated: boolean;
  sourceFiles: TraceSourceFileSnapshot[];
}

export interface TraceSourceRegistryOptions {
  homeDirectory: string;
  autohandHome: string;
  environment?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  locationOverrides?: Partial<Record<TraceHarness, readonly string[]>>;
}

export interface TraceSourceRegistry {
  list(): TraceSourceAdapter[];
  get(harness: TraceHarness): TraceSourceAdapter | undefined;
}

export interface SourceDefinition {
  harness: TraceHarness;
  displayName: string;
  formats: readonly TraceSourceFormat[];
  locations(options: NormalizedRegistryOptions): string[];
}

interface NormalizedRegistryOptions {
  homeDirectory: string;
  autohandHome: string;
  environment: Record<string, string | undefined>;
  platform: NodeJS.Platform;
  locationOverrides: Partial<Record<TraceHarness, readonly string[]>>;
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function joinHome(options: NormalizedRegistryOptions, ...parts: string[]): string {
  const pathApi = options.platform === 'win32' ? path.win32 : path;
  return pathApi.join(options.homeDirectory, ...parts);
}

function applicationSupport(options: NormalizedRegistryOptions, app: string): string {
  if (options.platform === 'darwin') {
    return joinHome(options, 'Library', 'Application Support', app);
  }
  if (options.platform === 'win32') {
    const appData = options.environment.APPDATA ?? path.win32.join(options.homeDirectory, 'AppData', 'Roaming');
    return path.win32.join(appData, app);
  }
  return path.join(options.environment.XDG_CONFIG_HOME ?? joinHome(options, '.config'), app);
}

const DEFINITIONS: readonly SourceDefinition[] = [
  {
    harness: 'autohand', displayName: 'Autohand', formats: ['json', 'jsonl'],
    locations: (options) => [path.join(options.autohandHome, 'sessions')],
  },
  {
    harness: 'claude-code', displayName: 'Claude Code', formats: ['jsonl'],
    locations: (options) => unique([
      path.join(
        options.environment.CLAUDE_CONFIG_DIR ?? joinHome(options, '.claude'),
        'projects',
      ),
      options.environment.CLAUDE_CONFIG_DIR
        ? undefined
        : path.join(applicationSupport(options, 'Claude'), 'local-agent-mode-sessions'),
      options.environment.CLAUDE_CONFIG_DIR
        ? undefined
        : path.join(applicationSupport(options, 'Claude'), 'claude-code-sessions'),
    ]),
  },
  {
    harness: 'cursor', displayName: 'Cursor', formats: ['json', 'jsonl', 'sqlite'],
    locations: (options) => unique([
      options.environment.TRACES_CURSOR_GLOBAL_DB,
      joinHome(options, '.cursor', 'projects'),
      path.join(applicationSupport(options, 'Cursor'), 'User', 'globalStorage', 'state.vscdb'),
      path.join(applicationSupport(options, 'Cursor'), 'User', 'workspaceStorage'),
    ]),
  },
  {
    harness: 'opencode', displayName: 'OpenCode', formats: ['json', 'sqlite'],
    locations: (options) => unique([
      path.join(options.environment.XDG_DATA_HOME ?? joinHome(options, '.local', 'share'), 'opencode'),
      joinHome(options, '.opencode'),
    ]),
  },
  {
    harness: 'opencode2', displayName: 'OpenCode 2', formats: ['sqlite'],
    locations: (options) => unique([
      path.join(options.environment.XDG_DATA_HOME ?? joinHome(options, '.local', 'share'), 'opencode'),
      joinHome(options, '.opencode'),
    ]),
  },
  {
    harness: 'codex', displayName: 'Codex', formats: ['json', 'jsonl'],
    locations: (options) => {
      const codexHome = options.environment.CODEX_HOME ?? joinHome(options, '.codex');
      return [path.join(codexHome, 'sessions'), path.join(codexHome, 'codex.json')];
    },
  },
  {
    harness: 'pi', displayName: 'Pi', formats: ['json', 'jsonl'],
    locations: (options) => [joinHome(options, '.pi', 'agent', 'sessions'), joinHome(options, '.pi')],
  },
  {
    harness: 'amp', displayName: 'Amp', formats: ['json', 'jsonl'],
    locations: (options) => unique([
      joinHome(options, '.amp'),
      path.join(options.environment.XDG_DATA_HOME ?? joinHome(options, '.local', 'share'), 'amp'),
    ]),
  },
  {
    harness: 'copilot', displayName: 'GitHub Copilot', formats: ['json', 'jsonl'],
    locations: (options) => [
      joinHome(options, '.copilot'),
      path.join(applicationSupport(options, 'Code'), 'User', 'globalStorage', 'emptyWindowChatSessions'),
      path.join(applicationSupport(options, 'Code'), 'User', 'workspaceStorage'),
    ],
  },
  {
    harness: 'cline', displayName: 'Cline', formats: ['json'],
    locations: (options) => [
      joinHome(options, '.cline'),
      path.join(
        applicationSupport(options, 'Code'),
        'User',
        'globalStorage',
        'saoudrizwan.claude-dev',
      ),
    ],
  },
  {
    harness: 'openclaw', displayName: 'OpenClaw', formats: ['jsonl'],
    locations: (options) => [joinHome(options, '.openclaw', 'agents')],
  },
  {
    harness: 'hermes', displayName: 'Hermes', formats: ['sqlite'],
    locations: (options) => [joinHome(options, '.hermes'), joinHome(options, '.local', 'share', 'hermes')],
  },
  {
    harness: 'droid', displayName: 'Droid', formats: ['jsonl'],
    locations: (options) => [joinHome(options, '.factory', 'sessions')],
  },
  {
    harness: 'grok', displayName: 'Grok', formats: ['json', 'jsonl'],
    locations: (options) => [joinHome(options, '.grok', 'sessions'), joinHome(options, '.grok')],
  },
  {
    harness: 'kimi', displayName: 'Kimi Code', formats: ['json', 'jsonl'],
    locations: (options) => unique([
      options.environment.KIMI_CODE_HOME,
      joinHome(options, '.kimi-code'),
      joinHome(options, '.kimi'),
    ]),
  },
  {
    harness: 'antigravity', displayName: 'Antigravity', formats: ['jsonl'],
    locations: (options) => [
      joinHome(options, '.gemini', 'antigravity-cli'),
      joinHome(options, '.gemini', 'antigravity'),
      joinHome(options, '.gemini', 'antigravity-ide'),
      path.join(applicationSupport(options, 'Antigravity'), 'User', 'workspaceStorage'),
    ],
  },
  {
    harness: 'prime-agent', displayName: 'Prime Agent', formats: ['jsonl'],
    locations: (options) => [joinHome(options, '.prime')],
  },
  {
    harness: 'fx', displayName: 'fx', formats: ['jsonl'],
    locations: (options) => [joinHome(options, '.fx', 'sessions')],
  },
  {
    harness: 'deepseek', displayName: 'DeepSeek Harness', formats: ['jsonl-zstd'],
    locations: (options) => unique([
      options.environment.DSH_HOME,
      joinHome(options, '.dsh', 'sessions'),
    ]),
  },
];

export function createTraceSourceRegistry(options: TraceSourceRegistryOptions): TraceSourceRegistry {
  const normalized: NormalizedRegistryOptions = {
    environment: options.environment ?? process.env,
    platform: options.platform ?? process.platform,
    homeDirectory: options.homeDirectory,
    autohandHome: options.autohandHome,
    locationOverrides: options.locationOverrides ?? {},
  };
  const adapters = DEFINITIONS.map<TraceSourceAdapter>((definition) => createNativeTraceAdapter({
    harness: definition.harness,
    displayName: definition.displayName,
    formats: definition.formats,
    locations: normalized.locationOverrides[definition.harness] ?? definition.locations(normalized),
  }));
  const byHarness = new Map(adapters.map((adapter) => [adapter.harness, adapter]));

  return {
    list: () => [...adapters],
    get: (harness) => byHarness.get(harness),
  };
}

if (DEFINITIONS.length !== TRACE_HARNESSES.length) {
  throw new Error('Trace Adapter registry is out of sync with the canonical harness list.');
}
