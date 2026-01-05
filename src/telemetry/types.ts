/**
 * Telemetry Types
 * @license Apache-2.0
 */

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
  | 'session_failure_bug';

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
}

export interface ErrorData {
  type: string;
  message: string;
  stack?: string;
  context?: string;
}

export interface CommandUseData {
  command: string;
  args?: string[];
}

export interface ModelSwitchData {
  fromModel?: string;
  toModel: string;
  provider: string;
}

export interface SessionSyncData {
  messageCount: number;
  totalTokens?: number;
  workspaceRoot?: string;
}

export interface SkillUseData {
  skillName: string;
  source: string;
  activationType: 'auto' | 'explicit';
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
