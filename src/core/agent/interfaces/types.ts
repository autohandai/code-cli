/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LLMProvider } from '../../providers/LLMProvider.js';
import type { AgentRuntime, AgentAction, LLMMessage, LLMResponse, LLMToolCall, AgentStatusSnapshot, AgentOutputEvent, ToolCallRequest, ProviderName } from '../../types.js';
import type { FileActionManager } from '../../actions/filesystem.js';
import type { ConversationManager } from '../conversationManager.js';
import type { ToolManager } from '../toolManager.js';
import type { SessionManager } from '../../session/SessionManager.js';
import type { MemoryManager } from '../../memory/MemoryManager.js';
import type { PermissionManager } from '../../permissions/PermissionManager.js';
import type { HookManager } from '../HookManager.js';
import type { TeamManager } from '../teams/TeamManager.js';
import type { RepeatManager } from '../RepeatManager.js';
import type { McpClientManager } from '../../mcp/McpClientManager.js';
import type { SkillsRegistry } from '../../skills/SkillsRegistry.js';
import type { TelemetryManager } from '../../telemetry/TelemetryManager.js';
import type { FeedbackManager } from '../../feedback/FeedbackManager.js';
import type { ErrorLogger } from '../errorLogger.js';
import type { AutoReportManager } from '../../reporting/AutoReportManager.js';
import type { NotificationService } from '../../utils/notification.js';
import type { ActivityIndicator } from '../../ui/activityIndicator.js';
import type { PersistentInput } from '../../ui/persistentInput.js';
import type { GitIgnoreParser } from '../../utils/gitIgnore.js';
import type { WorkspaceFileCollector } from './WorkspaceFileCollector.js';
import type { ProviderConfigManager } from './ProviderConfigManager.js';
import type { SuggestionEngine } from '../SuggestionEngine.js';
import type { ImageManager } from '../ImageManager.js';
import type { IntentDetector } from '../IntentDetector.js';
import type { EnvironmentBootstrap } from '../EnvironmentBootstrap.js';
import type { CodeQualityPipeline } from '../CodeQualityPipeline.js';
import type { ContextManager } from '../contextManager.js';
import type { ActionExecutor } from '../actionExecutor.js';
import type { AgentDelegator } from '../agents/AgentDelegator.js';
import type { SlashCommandHandler } from '../slashCommandHandler.js';
import type { ToolsRegistry } from '../toolsRegistry.js';

/**
 * Core agent context - provides access to all shared resources
 * This is passed to all services for dependency injection
 */
export interface AgentContext {
  // Core runtime
  readonly runtime: AgentRuntime;
  readonly llm: LLMProvider;
  readonly files: FileActionManager;
  
  // Managers
  readonly conversation: ConversationManager;
  readonly toolManager: ToolManager;
  readonly sessionManager: SessionManager;
  readonly memoryManager: MemoryManager;
  readonly permissionManager: PermissionManager;
  readonly hookManager: HookManager;
  readonly teamManager: TeamManager;
  readonly repeatManager: RepeatManager;
  readonly mcpManager: McpClientManager;
  readonly skillsRegistry: SkillsRegistry;
  readonly telemetryManager: TelemetryManager;
  readonly feedbackManager: FeedbackManager;
  readonly contextManager: ContextManager;
  readonly actionExecutor: ActionExecutor;
  readonly delegator: AgentDelegator;
  readonly slashHandler: SlashCommandHandler;
  readonly toolsRegistry: ToolsRegistry;
  
  // Utilities
  readonly errorLogger: ErrorLogger;
  readonly autoReportManager: AutoReportManager;
  readonly notificationService: NotificationService;
  readonly activityIndicator: ActivityIndicator;
  readonly ignoreFilter: GitIgnoreParser;
  readonly workspaceFileCollector: WorkspaceFileCollector;
  readonly providerConfigManager: ProviderConfigManager;
  readonly suggestionEngine: SuggestionEngine | null;
  readonly imageManager: ImageManager;
  readonly intentDetector: IntentDetector;
  readonly environmentBootstrap: EnvironmentBootstrap;
  readonly codeQualityPipeline: CodeQualityPipeline;
  
  // State accessors
  readonly activeProvider: ProviderName;
  readonly contextWindow: number;
  readonly contextPercentLeft: number;
  readonly isInstructionActive: boolean;
  readonly useInkRenderer: boolean;
  readonly interactiveAutomodeEnabled: boolean;
  readonly basePermissionMode: string;
}

/**
 * Mutable agent state - services can update these values
 */
export interface AgentState {
  // Context tracking
  contextWindow: number;
  contextPercentLeft: number;
  
  // Session tracking
  taskStartedAt: number | null;
  totalTokensUsed: number;
  sessionTokensUsed: number;
  sessionStartedAt: number;
  
  // Intent tracking
  lastIntent: 'diagnostic' | 'implementation';
  filesModifiedThisSession: boolean;
  fileModCount: number;
  modifiedFilePaths: Set<string>;
  executedActionNames: string[];
  searchQueries: string[];
  
  // Error tracking
  sessionRetryCount: number;
  consecutiveCancellations: number;
  lastErrorMessage: string | null;
  consecutiveErrorCount: number;
  
  // UI state
  isInstructionActive: boolean;
  hasPrintedExplorationHeader: boolean;
  lastRenderedStatus: string;
  lastAssistantResponseForNotification: string;
  
  // Input queue
  pendingInkInstructions: string[];
  queueInput: string;
  promptSeedInput: string;
  
  // MCP state
  mcpReady: Promise<void> | null;
  mcpStartupAutoConnectServers: string[];
  mcpStartupConnectStartedAt: number | null;
  mcpStartupSummaryPrinted: boolean;
  mcpStartupSummaryPending: boolean;
  
  // Initialization
  initReady: Promise<void> | null;
  initDone: boolean;
  
  // Context compaction
  contextCompactionEnabled: boolean;
}

/**
 * Tool execution result
 */
export interface ToolExecutionResult {
  tool: AgentAction['type'];
  success: boolean;
  output?: string;
  error?: string;
  duration: number;
}

/**
 * Session initialization options
 */
export interface SessionInitOptions {
  initialInstruction?: string;
  isRpcMode?: boolean;
}

/**
 * Conversation turn result
 */
export interface ConversationTurnResult {
  success: boolean;
  response?: string;
  error?: string;
  tokensUsed?: number;
}

/**
 * UI event types
 */
export type UIEventType = 
  | 'status_update'
  | 'tool_start'
  | 'tool_end'
  | 'message'
  | 'thinking'
  | 'error';

export interface UIEvent {
  type: UIEventType;
  payload: unknown;
}

/**
 * Service interface for tool execution
 */
export interface IToolExecutionService {
  execute(action: AgentAction, context: unknown): Promise<string>;
  executeBatch(actions: ToolCallRequest[]): Promise<ToolExecutionResult[]>;
}

/**
 * Service interface for session management
 */
export interface ISessionService {
  initialize(options?: SessionInitOptions): Promise<void>;
  attach(sessionId: string): Promise<{ sessionId: string; model: string; workspaceRoot: string; messageCount: number }>;
  resume(sessionId: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * Service interface for conversation management
 */
export interface IConversationService {
  runInstruction(instruction: string): Promise<boolean>;
  runReactLoop(abortController: AbortController): Promise<void>;
  buildSystemPrompt(): Promise<string>;
}

/**
 * Service interface for UI management
 */
export interface IUIService {
  initialize(abortController: AbortController, onCancel: () => void, usePersistentInput: boolean): Promise<void>;
  setStatus(status: string): void;
  setWorking(working: boolean): void;
  setFinalResponse(response: string): void;
  addToolOutput(tool: string, success: boolean, output: string, thought?: string): void;
  stop(): void;
}

/**
 * Service interface for slash commands
 */
export interface ISlashCommandService {
  handle(command: string, args: string[]): Promise<string | null>;
  parse(input: string): { command: string; args: string[] };
  isSupported(command: string): boolean;
}

/**
 * Service interface for team management
 */
export interface ITeamService {
  createTeam(name: string): Promise<string>;
  addTeammate(name: string, agentName: string, model?: string): void;
  createTask(subject: string, description: string, blockedBy?: string[]): string;
  getTask(taskId: string): unknown;
  listTasks(status?: string, owner?: string): unknown[];
  updateTask(taskId: string, updates: Record<string, unknown>): unknown;
  stopTask(taskId: string): unknown;
  getStatus(): unknown;
  sendMessage(to: string, content: string): void;
}

/**
 * Service interface for MCP integration
 */
export interface IMCPService {
  connectAll(servers: unknown[]): Promise<void>;
  getAllTools(): unknown[];
  callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<unknown>;
  isReady(): boolean;
  ready(): Promise<void>;
}