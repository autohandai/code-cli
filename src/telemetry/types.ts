/**
 * Telemetry Types
 * @license Apache-2.0
 */

import type { SessionUsageMetadata } from '../session/types.js';

/** Client type identifier for telemetry events */
export type ClientType = 'cli' | 'vscode' | 'zed' | 'unknown';

export type TelemetryEventType =
  | 'session_start'
  | 'session_end'
  | 'tool_use'
  | 'error'
  | 'model_switch'
  | 'command_use'
  | 'heartbeat'
  | 'session_sync'
  | 'skill_use'
  | 'session_failure_bug'
  | 'goal_event'
  | 'outcome'
  | 'context_compaction';

export interface TelemetryEvent {
  id: string;
  eventType: TelemetryEventType;
  eventData?: Record<string, unknown>;
  deviceId: string;
  sessionId: string;
  clientType: ClientType;
  clientVersion?: string;
  cliVersion: string;
  platform: string;
  osVersion?: string;
  nodeVersion?: string;
  cpuArch?: string;
  cpuCores?: number;
  memoryTotal?: number;
  memoryFree?: number;
  sessionDuration?: number;
  interactionCount?: number;
  toolsUsed?: string[];
  errorsCount?: number;
  timestamp: string;
}

export interface TelemetryConfig {
  /** Enable/disable telemetry collection */
  enabled: boolean;
  /** API endpoint */
  apiBaseUrl: string;
  /** Batch size before auto-flush */
  batchSize: number;
  /** Flush interval in ms */
  flushIntervalMs: number;
  /** Max queue size before dropping old events */
  maxQueueSize: number;
  /** Retry attempts for failed requests */
  maxRetries: number;
  /** Include session data for cloud sync */
  enableSessionSync: boolean;
  /** Company secret for API authentication */
  companySecret: string;
  /** Authenticated Autohand session token for user-scoped features */
  authToken?: string;
  /** Skip every network request and keep events and session snapshots in the durable queues */
  offline?: boolean;
  /** Client type (cli, vscode, zed) */
  clientType: ClientType;
  /** Client/extension version (for non-CLI clients) */
  clientVersion?: string;
}

export interface TelemetryStats {
  totalEvents: number;
  eventsSent: number;
  eventsFailed: number;
  eventsQueued: number;
  lastSyncTime: string | null;
  sessionId: string | null;
}

export interface ToolUseData {
  tool: string;
  success: boolean;
  duration?: number;
  error?: string;
  /**
   * Tokens this tool's result added to the context. Ranking tools by call
   * count alone hides the one that ran twice and returned a fifty-thousand
   * token file, which is usually the expensive one.
   */
  resultTokens?: number;
  /** True when the result was clipped, so `resultTokens` is a floor. */
  resultTruncated?: boolean;
}

export interface ErrorData {
  type: string;
  message: string;
  stack?: string;
  context?: string;
}

export interface CommandUseData {
  command: string;
  /** @deprecated Free-form arguments are never emitted. */
  args?: string[];
  subcommand?: string;
  surface?: CommandUseSurface;
}

export type CommandUseSurface = 'interactive' | 'cli' | 'acp' | 'json_rpc' | 'mobile';

export interface ProviderModelMetadata {
  providerDisplayName?: string;
  providerApiFormat?: string;
  reasoningEffort?: string;
  contextWindow?: number;
}

export interface ModelSwitchData extends ProviderModelMetadata {
  fromModel?: string;
  toModel: string;
  provider: string;
}

export interface SessionSyncData {
  messageCount: number;
  totalTokens?: number;
  workspaceRoot?: string;
  projectName?: string;
  status?: string;
  summary?: string;
  title?: string;
  additions?: number;
  deletions?: number;
  client?: string;
  clientVersion?: string;
  usage?: SessionUsageMetadata;
  startTime?: string;
  endTime?: string;
  durationSeconds?: number;
}

export interface SkillUseData {
  skillName: string;
  source: string;
  activationType: 'auto' | 'explicit';
  /**
   * `release` closes the span a matching `activate` opened. An activated
   * skill is added to the session prompt and stays there, so its body is
   * re-sent on every later request — without a release there is no way to
   * know how many requests that was, and therefore no way to price it.
   */
  action?: 'activate' | 'install' | 'remove' | 'update' | 'release';
  /** Correlates an activate with its release. Present on both. */
  spanId?: string;
  /** Measured tokens of the injected skill body. Activate only. */
  tokenSize?: number;
  /** Bytes of the SKILL.md file on disk. Activate only. */
  sizeBytes?: number;
  /** Author-declared version from frontmatter metadata, when present. */
  version?: string;
  /** ISO timestamps from the file itself, so a skill can be aged. Activate only. */
  createdAt?: string;
  modifiedAt?: string;
  /** Release only. */
  releaseReason?: 'deactivated' | 'session_end' | 'compacted_out';
}

/**
 * A compaction is the only point in a session where the context shrinks
 * without anyone asking.
 *
 * A skill is priced as size x requests carried, so a skill that leaves the
 * window keeps accruing rent for the rest of the run unless something says it
 * stopped being sent. `survivingSpanIds` is that statement: the spans still
 * carried after the compaction. An empty array means no skill was open, which
 * is a different claim from a client too old to report survivors at all, so
 * the field is required rather than optional.
 */
export interface ContextCompactionData {
  tokensBefore: number;
  tokensAfter: number;
  survivingSpanIds: string[];
  /** Which compaction path ran: tiered, mid-turn, legacy-critical, overflow. */
  reason?: string;
  croppedCount?: number;
}

/**
 * A goal's lifecycle. Emitted so the console can report how work actually
 * ends, rather than an acceptance rate — an agent has no "suggestion shown"
 * to accept, so a rate borrowed from autocomplete would mean nothing.
 */
export interface GoalEventData {
  goalId?: string;
  action: 'created' | 'started' | 'paused' | 'resumed' | 'completed' | 'blocked' | 'cancelled' | 'updated';
  /** Free-form reason, carried on `blocked` so stalls can be aggregated. */
  status?: string;
  source?: string;
}

export interface OutcomeData {
  outcome: 'success' | 'failure' | 'cancelled' | 'timeout';
  surface?: string;
  action?: string;
  message?: string;
}

export interface SessionFailureBugData {
  type: string;
  errorMessage: string;
  errorName: string;
  stack?: string;
  retryAttempt: number;
  maxRetries: number;
  conversationLength: number;
  lastToolCalls?: string[];
  iterationCount?: number;
  contextUsage?: number;
  model?: string;
  provider?: string;
  isRetrying: boolean;
}
