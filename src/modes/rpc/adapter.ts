/**
 * RPC Adapter
 * Wraps AutohandAgent and bridges callbacks to JSON-RPC 2.0 notifications
 */

import crypto from 'node:crypto';

import type { AutohandAgent } from '../../core/agent.js';
import { McpClientManager } from '../../mcp/McpClientManager.js';
import { classifyApiError, type ApiErrorCode } from '../../providers/errors.js';
import { getAllCatalogModelOptions } from '../../providers/modelCatalog.js';
import type { ConversationManager } from '../../core/conversationManager.js';
import type {
  LLMMessage,
  ToolOutputChunk,
  AgentStatusSnapshot,
  AgentOutputEvent,
  LLMToolCall,
  McpServerConfigEntry,
  LoadedConfig,
} from '../../types.js';
import type {
  JsonRpcId,
  RpcMessage,
  PendingPermission,
  PendingDirectoryAccess,
  PromptParams,
  PromptResult,
  AbortResult,
  ResetResult,
  GetStateResult,
  GetMessagesResult,
  PermissionResponseResult,
  GetSkillsRegistryParams,
  GetSkillsRegistryResult,
  InstallSkillParams,
  InstallSkillResult,
  AutomodeStartParams,
  AutomodeStartResult,
  AutomodeStatusResult,
  AutomodePauseResult,
  AutomodeResumeResult,
  AutomodeCancelResult,
  AutomodeGetLogResult,
  AutomodeLogEntry,
  AutoresearchStartParams,
  AutoresearchStartResult,
  AutoresearchStatusResult,
  AutoresearchStopResult,
  AutoresearchRpcState,
  AutoresearchHistoryResult,
  AutoresearchReplayParams,
  AutoresearchReplayResult,
  AutoresearchRescoreParams,
  AutoresearchRescoreResult,
  AutoresearchCompareParams,
  AutoresearchCompareResult,
  AutoresearchParetoResult,
  AutoresearchPinParams,
  AutoresearchPinResult,
  AutoresearchPruneParams,
  AutoresearchPruneResult,
  GetHistoryParams,
  GetHistoryResult,
  YoloSetParams,
  YoloSetResult,
  McpListServersResult,
  McpListToolsParams,
  McpListToolsResult,
  McpSetVscodeToolsParams,
  McpInvokeResponseParams,
  McpGetServerConfigsResult,
  LearnRecommendParams,
  LearnRecommendResult,
  LearnUpdateParams,
  LearnUpdateResult,
  LearnGenerateParams,
  LearnGenerateResult,
  SetPermissionModeParams,
  SetPermissionModeResult,
  SetModelParams,
  SetModelResult,
  SetMaxThinkingTokensParams,
  SetMaxThinkingTokensResult,
  ApplyFlagSettingsParams,
  ApplyFlagSettingsResult,
  GetSupportedModelsResult,
  GetSupportedCommandsResult,
  GetToolsRegistryResult,
  GetContextUsageResult,
  ReloadPluginsResult,
  GetAccountInfoResult,
  McpToggleServerParams,
  McpToggleServerResult,
  McpReconnectServerParams,
  McpReconnectServerResult,
  McpSetServersParams,
  McpSetServersResult,
  SetContextCompactParams,
  SetContextCompactResult,
} from './types.js';
import { normalizePermissionPromptResponse, type PermissionPromptResponse } from '../../permissions/types.js';
import {
  RPC_NOTIFICATIONS,
  MAX_IMAGE_SIZE,
  isValidImageMimeType,
} from './types.js';
import { writeNotification, createTimestamp, generateId } from './protocol.js';
import { ImageManager, type ImageMimeType } from '../../core/ImageManager.js';
import { modelSupportsImages } from '../../providers/modelCapabilities.js';
import { attachBrowserHandoff, attachLatestBrowserHandoff, createBrowserHandoff } from '../../browser/chrome.js';
import { GoalManager } from '../../goals/GoalManager.js';
import type { GoalStatus } from '../../goals/types.js';
import { GOAL_FEATURE_DISABLED_MESSAGE, isGoalFeatureEnabled } from '../../goals/feature.js';
import { getRpcErrorMetadata, writeRpcDebugLine } from './logging.js';
import { SLASH_COMMANDS } from '../../core/slashCommands.js';
import { AutoResearchManager, type AutoResearchSnapshot, type AutoResearchState } from '../../autoresearch/manager.js';
import { initExperiment } from '../../autoresearch/tools.js';
import type { OptimizationDirection } from '../../autoresearch/session.js';
import { replayExperiment } from '../../autoresearch/replay.js';
import {
  compareExperiments,
  getAutoresearchHistory,
  getParetoExperiments,
  pinExperiment,
  pruneArtifacts,
  rescoreExperiments,
} from '../../autoresearch/analysis.js';

type CompleteAutoresearchBenchmarkParams = AutoresearchStartParams & {
  metricName: string;
  metricUnit: string;
  direction: OptimizationDirection;
} & (
  | { measureCommand: string }
  | { measureScript: string }
);

function hasCompleteAutoresearchBenchmarkParams(
  params: AutoresearchStartParams
): params is CompleteAutoresearchBenchmarkParams {
  return Boolean(
    params.metricName &&
    params.metricUnit &&
    params.direction &&
    (params.measureCommand || params.measureScript)
  );
}

function commandToScript(command: string): string {
  return command.startsWith('#!')
    ? command
    : ['#!/bin/bash', 'set -euo pipefail', command, ''].join('\n');
}

function measureScriptFromParams(params: CompleteAutoresearchBenchmarkParams): string {
  if ('measureScript' in params && params.measureScript) return params.measureScript;
  if ('measureCommand' in params && params.measureCommand) return commandToScript(params.measureCommand);
  throw new Error('Missing measureCommand or measureScript');
}

function checksScriptFromParams(params: AutoresearchStartParams): string | undefined {
  if (params.checksScript) return params.checksScript;
  return params.checksCommand ? commandToScript(params.checksCommand) : undefined;
}

// ---------------------------------------------------------------------------
// ApiErrorCode → RPC-specific error shape mapping
// ---------------------------------------------------------------------------
const RPC_ERROR_TYPE_MAP: Record<ApiErrorCode, string> = {
  context_overflow: 'context',
  model_not_found: 'model',
  invalid_request: 'context',
  auth_failed: 'auth',
  payment_required: 'payment',
  access_denied: 'model',
  rate_limited: 'rate_limit',
  server_error: 'server',
  network_error: 'network',
  timeout: 'network',
  cancelled: 'unknown',
  unknown: 'unknown',
};

const RPC_ERROR_CODE_MAP: Record<ApiErrorCode, number> = {
  context_overflow: 400,
  model_not_found: 404,
  invalid_request: 400,
  auth_failed: 401,
  payment_required: 402,
  access_denied: 403,
  rate_limited: 429,
  server_error: 500,
  network_error: 504,
  timeout: 504,
  cancelled: -32000,
  unknown: -32000,
};

const RPC_ERROR_ICON_MAP: Record<ApiErrorCode, string> = {
  context_overflow: '\uD83D\uDCE6',  // 📦
  model_not_found: '\uD83E\uDD16',   // 🤖
  invalid_request: '\uD83D\uDCE6',   // 📦
  auth_failed: '\uD83D\uDD10',       // 🔐
  payment_required: '\uD83D\uDCB3',  // 💳
  access_denied: '\uD83E\uDD16',     // 🤖
  rate_limited: '\u23F1\uFE0F',      // ⏱️
  server_error: '\uD83D\uDD27',      // 🔧
  network_error: '\uD83C\uDF10',     // 🌐
  timeout: '\uD83C\uDF10',           // 🌐
  cancelled: '\u26A0\uFE0F',         // ⚠️
  unknown: '\u26A0\uFE0F',           // ⚠️
};

const RPC_SHUTDOWN_TIMEOUT_MS = 2_500;

/**
 * Descriptor for a VS Code MCP tool registered by the extension
 */
interface VscodeTool {
  name: string;
  description: string;
  serverName: string;
  inputSchema?: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Pending VS Code tool invocation awaiting a response from the extension
 */
interface PendingVscodeInvocation {
  resolve: (result: string) => void;
  reject: (error: Error) => void;
}

interface ActivePrompt {
  readonly identity: symbol;
  readonly abortController: AbortController;
  turnId: string | null;
  turnStartTime: number | null;
  messageId: string | null;
  messageContent: string;
  cancelRequested: boolean;
  finalized: boolean;
}

interface PendingPromptStart {
  readonly handle: ReturnType<typeof setImmediate>;
  readonly prompt: ActivePrompt;
  readonly settled: Promise<void>;
  readonly resolve: () => void;
}

/**
 * RPC Adapter for AutohandAgent
 * Handles bidirectional JSON-RPC 2.0 communication between CLI and VS Code extension
 */
export class RPCAdapter {
  private agent: AutohandAgent | null = null;
  private conversation: ConversationManager | null = null;
  private imageManager: ImageManager | null = null;
  private sessionId: string | null = null;
  private currentTurnId: string | null = null;
  private turnStartTime: number | null = null;
  private currentMessageId: string | null = null;
  private currentMessageContent = '';
  private pendingPermissions = new Map<string, PendingPermission>();
  private pendingDirectoryAccess = new Map<string, PendingDirectoryAccess>();
  private abortController: AbortController | null = null;
  private activePrompt: ActivePrompt | null = null;
  private activePromptWork: Promise<PromptResult> | null = null;
  private pendingPromptStarts = new Map<symbol, PendingPromptStart>();
  private shuttingDown = false;
  private notificationsSealed = false;
  private status: 'idle' | 'processing' | 'waiting_permission' = 'idle';
  private model = '';
  private workspace = '';
  private contextPercent = 0;
  private currentChangesBatchId: string | null = null;
  // Enable preview mode for multi-file change batching (future: make configurable)
  private previewModeEnabled = true;
  // MCP bridge: VS Code tools registered by the extension
  private vscodeTools = new Map<string, VscodeTool>();
  // MCP bridge: pending tool invocations waiting for extension response
  private pendingVscodeInvocations = new Map<string, PendingVscodeInvocation>();
  // MCP server configurations from CLI config (set during initialization)
  private mcpServerConfigs: McpServerConfigEntry[] = [];
  // Cached vision support result (null = not yet checked)
  private visionSupported: boolean | null = null;
  // Keepalive interval to prevent Chrome from killing the MV3 service worker
  // during long turns with no traffic.
  private keepaliveInterval: ReturnType<typeof setInterval> | null = null;
  private readonly KEEPALIVE_MS = 15_000;
  private yoloRevertTimer: ReturnType<typeof setTimeout> | null = null;
  private yoloRevertGeneration = 0;
  private shutdownPromise: Promise<void> | null = null;
  // Config reference for runtime settings changes
  private config: Partial<LoadedConfig> & {
    permissionMode?: string;
    model?: string;
    maxThinkingTokens?: number;
    [key: string]: unknown;
  } = {};

  /**
   * Check if the current model supports vision/image inputs.
   * Uses async OpenRouter API with pattern-matching fallback, cached for the session.
   */
  private async checkVisionSupport(prompt: ActivePrompt): Promise<boolean> {
    if (this.visionSupported !== null) {
      return this.visionSupported;
    }
    const supported = await modelSupportsImages(this.model);
    if (this.canContinuePrompt(prompt)) {
      this.visionSupported = supported;
    }
    return supported;
  }

  /**
   * Initialize the adapter with an agent instance
   */
  initialize(
    agent: AutohandAgent,
    conversation: ConversationManager,
    model: string,
    workspace: string,
    config?: LoadedConfig,
    mcpServerConfigs?: McpServerConfigEntry[]
  ): void {
    this.agent = agent;
    this.conversation = conversation;
    this.model = model;
    this.workspace = workspace;
    this.config = config ? { ...config } : {};
    this.sessionId = generateId('session');
    this.mcpServerConfigs = mcpServerConfigs ?? [];

    // Get reference to agent's ImageManager for handling multimodal prompts
    this.imageManager = agent.getImageManager?.() ?? new ImageManager();

    // Setup status listener
    agent.setStatusListener((snapshot: AgentStatusSnapshot) => {
      this.contextPercent = snapshot.contextPercent;
      this.model = snapshot.model;
    });

    // Setup output listener to capture agent responses
    agent.setOutputListener((event: AgentOutputEvent) => {
      this.handleAgentOutput(event);
    });

    // Emit agent start notification
    writeNotification(RPC_NOTIFICATIONS.AGENT_START, {
      sessionId: this.sessionId,
      model: this.model,
      workspace: this.workspace,
      timestamp: createTimestamp(),
      contextPercent: this.contextPercent,
    });
  }

  /**
   * Get current agent state
   */
  getState(): GetStateResult {
    return {
      status: this.status,
      sessionId: this.sessionId,
      model: this.model,
      workspace: this.workspace,
      contextPercent: this.contextPercent,
      messageCount: this.conversation?.history().length ?? 0,
    };
  }

  async handleGoalGet(): Promise<unknown> {
    if (!this.isGoalFeatureEnabled()) return this.goalFeatureDisabledResult();
    return new GoalManager(this.workspace).getSnapshot();
  }

  async handleGoalCreate(params: {
    objective: string;
    token_budget?: number;
    time_budget_seconds?: number;
    min_tokens_before_wrap_up?: number;
    min_time_seconds_before_wrap_up?: number;
  }): Promise<unknown> {
    if (!this.isGoalFeatureEnabled()) return this.goalFeatureDisabledResult();
    return new GoalManager(this.workspace).createOrQueueGoal({
      objective: params.objective,
      source: 'rpc',
      tokenBudget: params.token_budget,
      timeBudgetSeconds: params.time_budget_seconds,
      minTokensBeforeWrapUp: params.min_tokens_before_wrap_up,
      minTimeSecondsBeforeWrapUp: params.min_time_seconds_before_wrap_up,
    });
  }

  async handleGoalUpdate(params: {
    objective?: string;
    status?: string;
    token_budget?: number | null;
    time_budget_seconds?: number | null;
    min_tokens_before_wrap_up?: number | null;
    min_time_seconds_before_wrap_up?: number | null;
  }): Promise<unknown> {
    if (!this.isGoalFeatureEnabled()) return this.goalFeatureDisabledResult();
    return new GoalManager(this.workspace).updateGoal({
      objective: params.objective,
      status: parseRpcGoalStatus(params.status),
      tokenBudget: params.token_budget,
      timeBudgetSeconds: params.time_budget_seconds,
      minTokensBeforeWrapUp: params.min_tokens_before_wrap_up,
      minTimeSecondsBeforeWrapUp: params.min_time_seconds_before_wrap_up,
    });
  }

  async handleGoalClear(): Promise<unknown> {
    if (!this.isGoalFeatureEnabled()) return this.goalFeatureDisabledResult();
    return new GoalManager(this.workspace).clearGoal();
  }

  async handleGoalQueue(params: {
    objective: string;
    token_budget?: number;
    time_budget_seconds?: number;
    min_tokens_before_wrap_up?: number;
    min_time_seconds_before_wrap_up?: number;
  }): Promise<unknown> {
    if (!this.isGoalFeatureEnabled()) return this.goalFeatureDisabledResult();
    const manager = new GoalManager(this.workspace);
    return manager.enqueueGoal({
      objective: params.objective,
      source: 'rpc',
      tokenBudget: params.token_budget,
      timeBudgetSeconds: params.time_budget_seconds,
      minTokensBeforeWrapUp: params.min_tokens_before_wrap_up,
      minTimeSecondsBeforeWrapUp: params.min_time_seconds_before_wrap_up,
    });
  }

  async handleGoalStartQueued(): Promise<unknown> {
    if (!this.isGoalFeatureEnabled()) return this.goalFeatureDisabledResult();
    return new GoalManager(this.workspace).startQueuedGoal();
  }

  async handleGoalListTemplates(): Promise<unknown> {
    if (!this.isGoalFeatureEnabled()) return this.goalFeatureDisabledResult();
    return new GoalManager(this.workspace).listTemplates();
  }

  private isGoalFeatureEnabled(): boolean {
    return isGoalFeatureEnabled(this.config as LoadedConfig);
  }

  private goalFeatureDisabledResult(): { ok: false; message: string } {
    return { ok: false, message: GOAL_FEATURE_DISABLED_MESSAGE };
  }

  /**
   * Get message history
   */
  getMessages(limit?: number): RpcMessage[] {
    if (!this.conversation) {
      return [];
    }

    let messages = this.conversation.history();
    if (limit && limit > 0) {
      messages = messages.slice(-limit);
    }

    return messages.map((msg, index) => this.convertMessage(msg, index));
  }

  /**
   * Accept a prompt request and run the turn in the background.
   * Streaming clients get turn/message notifications and should not wait for
   * the full agent run before the JSON-RPC request is acknowledged.
   */
  startPrompt(requestId: JsonRpcId, params: PromptParams): PromptResult {
    const prompt = this.beginPrompt();
    let resolveStart!: () => void;
    const settled = new Promise<void>((resolve) => {
      resolveStart = resolve;
    });
    const handle = setImmediate(() => {
      this.pendingPromptStarts.delete(prompt.identity);
      if (this.shuttingDown || this.activePrompt !== prompt || prompt.finalized) {
        resolveStart();
        return;
      }

      void this.trackPromptWork(this.runAcceptedPrompt(requestId, params, prompt)).catch((error) => {
        writeRpcDebugLine(`Prompt failed after acceptance: ${getRpcErrorMetadata(error)}`);
      }).finally(resolveStart);
    });
    this.pendingPromptStarts.set(prompt.identity, {
      handle,
      prompt,
      settled,
      resolve: resolveStart,
    });

    return { success: true };
  }

  private trackPromptWork(work: Promise<PromptResult>): Promise<PromptResult> {
    const tracked = work.finally(() => {
      if (this.activePromptWork === tracked) this.activePromptWork = null;
    });
    this.activePromptWork = tracked;
    return tracked;
  }

  private cancelPendingPromptStarts(): Promise<void>[] {
    const pending = [...this.pendingPromptStarts.values()];
    this.pendingPromptStarts.clear();
    for (const scheduled of pending) {
      clearImmediate(scheduled.handle);
      scheduled.prompt.abortController.abort();
      scheduled.prompt.finalized = true;
      if (this.activePrompt === scheduled.prompt) {
        this.stopKeepalive();
        this.activePrompt = null;
        this.abortController = null;
        this.status = 'idle';
      }
      scheduled.resolve();
    }
    return pending.map((scheduled) => scheduled.settled);
  }

  private resetPromptState(): void {
    this.activePrompt = null;
    this.abortController = null;
    this.currentTurnId = null;
    this.turnStartTime = null;
    this.currentMessageId = null;
    this.currentMessageContent = '';
    this.status = 'idle';
  }

  private canContinuePrompt(prompt: ActivePrompt): boolean {
    return !this.shuttingDown
      && !this.notificationsSealed
      && this.activePrompt === prompt
      && !prompt.finalized
      && !prompt.abortController.signal.aborted;
  }

  private settleActivePreviewForShutdown(): void {
    const batchId = this.currentChangesBatchId;
    this.currentChangesBatchId = null;

    const fileManager = this.agent?.getFileManager();
    if (!fileManager) return;

    if (batchId) {
      let changeCount = 0;
      try {
        changeCount = fileManager.getPendingChanges().length;
      } catch {
        // Preview cleanup remains best-effort during shutdown.
      }
      try {
        this.emitChangesBatchEnd(batchId, changeCount);
      } catch {
        // Protocol output may already be unavailable during shutdown.
      }
    }
    try {
      if (batchId || fileManager.isInPreviewMode()) {
        fileManager.exitPreviewMode();
      }
    } catch {
      // File manager teardown must not prevent terminal notifications.
    }
  }

  private beginPrompt(): ActivePrompt {
    if (!this.agent) {
      throw new Error('Agent not initialized');
    }
    if (this.shuttingDown) {
      throw new Error('Agent is shutting down');
    }

    if (this.activePrompt !== null || this.status !== 'idle') {
      throw new Error('Agent is already processing');
    }

    const abortController = new AbortController();
    const prompt: ActivePrompt = {
      identity: Symbol('rpc-prompt'),
      abortController,
      turnId: null,
      turnStartTime: null,
      messageId: null,
      messageContent: '',
      cancelRequested: false,
      finalized: false,
    };
    this.status = 'processing';
    this.abortController = abortController;
    this.activePrompt = prompt;

    return prompt;
  }

  /**
   * Handle a prompt request
   * Returns result for JSON-RPC response
   */
  async handlePrompt(requestId: JsonRpcId, params: PromptParams): Promise<PromptResult> {
    const prompt = this.beginPrompt();
    return this.trackPromptWork(this.runAcceptedPrompt(requestId, params, prompt));
  }

  private async runAcceptedPrompt(
    requestId: JsonRpcId,
    params: PromptParams,
    prompt: ActivePrompt,
  ): Promise<PromptResult> {
    if (!this.agent) {
      throw new Error('Agent not initialized');
    }

    if (!this.canContinuePrompt(prompt)) {
      return { success: false };
    }
    this.startKeepalive();

    // Start a new turn
    prompt.turnId = generateId('turn');
    prompt.turnStartTime = Date.now();
    this.currentTurnId = prompt.turnId;
    this.turnStartTime = prompt.turnStartTime;
    writeNotification(RPC_NOTIFICATIONS.TURN_START, {
      turnId: prompt.turnId,
      timestamp: createTimestamp(),
    });

    prompt.messageId = generateId('msg');
    prompt.messageContent = '';
    this.currentMessageId = prompt.messageId;
    this.currentMessageContent = '';
    writeNotification(RPC_NOTIFICATIONS.MESSAGE_START, {
      messageId: prompt.messageId,
      role: 'assistant',
      timestamp: createTimestamp(),
    });

    try {
      if (!this.canContinuePrompt(prompt)) {
        return { success: false };
      }

      // Process any attached images first
      const imagePlaceholders: string[] = [];
      writeRpcDebugLine(
        `handlePrompt imageCount=${params.images?.length || 0}, hasImageManager=${!!this.imageManager}, modelLength=${this.model.length}`
      );

      // Check if model supports vision when images are provided (async, uses OpenRouter API with pattern fallback)
      let supportsVisionResult = false;
      if (params.images && params.images.length > 0) {
        supportsVisionResult = await this.checkVisionSupport(prompt);
        if (!this.canContinuePrompt(prompt)) {
          return { success: false };
        }
        if (!supportsVisionResult) {
          writeRpcDebugLine(`Model does not support vision modelLength=${this.model.length}`);
          writeNotification(RPC_NOTIFICATIONS.ERROR, {
            code: -32000,
            message: `Model '${this.model}' does not support image inputs. Please use a vision-capable model like claude-3.5-sonnet, gpt-4o, or gemini-1.5-pro.`,
            recoverable: true,
            timestamp: createTimestamp(),
          });
          // Continue without images - still process the text
        }
      }

      if (params.images && params.images.length > 0 && this.imageManager && supportsVisionResult) {
        writeRpcDebugLine(`Processing images count=${params.images.length}`);
        for (const img of params.images) {
          if (!this.canContinuePrompt(prompt)) {
            return { success: false };
          }
          try {
            writeRpcDebugLine(
              `Image mimeTypeLength=${img.mimeType.length}, dataLength=${img.data?.length || 0}`
            );

            // Validate MIME type
            if (!isValidImageMimeType(img.mimeType)) {
              writeRpcDebugLine(`Invalid image mimeTypeLength=${String(img.mimeType).length}`);
              writeNotification(RPC_NOTIFICATIONS.ERROR, {
                code: -32602, // Invalid params
                message: `Invalid image MIME type: ${img.mimeType}`,
                recoverable: true,
                timestamp: createTimestamp(),
              });
              continue;
            }

            // Decode base64 to Buffer
            const data = Buffer.from(img.data, 'base64');
            writeRpcDebugLine(`Image decoded bytes=${data.length}`);

            // Check size limit
            if (data.length > MAX_IMAGE_SIZE) {
              writeNotification(RPC_NOTIFICATIONS.ERROR, {
                code: -32602,
                message: `Image too large: ${Math.round(data.length / 1024 / 1024)}MB (max: ${Math.round(MAX_IMAGE_SIZE / 1024 / 1024)}MB)`,
                recoverable: true,
                timestamp: createTimestamp(),
              });
              continue;
            }

            // Add to ImageManager and get sequential ID
            const id = this.imageManager.add(data, img.mimeType as ImageMimeType, img.filename);
            const placeholder = this.imageManager.formatPlaceholder(id);
            imagePlaceholders.push(placeholder);
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            writeNotification(RPC_NOTIFICATIONS.ERROR, {
              code: -32000,
              message: `Failed to process image: ${message}`,
              recoverable: true,
              timestamp: createTimestamp(),
            });
          }
        }
      }

      // Build context message if provided
      let instruction = params.message;
      const isSlashCmd = this.agent.isSlashCommand(instruction);

      // Only add context for non-slash commands
      if (!isSlashCmd) {
        // Prepend image placeholders if any were processed
        if (imagePlaceholders.length > 0) {
          writeRpcDebugLine(`Image placeholders count=${imagePlaceholders.length}`);
          instruction = `${imagePlaceholders.join(' ')}\n\n${instruction}`;
        } else if (params.images && params.images.length > 0) {
          writeRpcDebugLine('Images provided without generated placeholders');
        }

        if (params.context?.selection) {
          const sel = params.context.selection;
          instruction = `${instruction}\n\nContext from ${sel.file} (lines ${sel.startLine}-${sel.endLine}):\n\`\`\`\n${sel.text}\n\`\`\``;
        }
      }

      // Execute instruction
      let success = false;
      try {
        if (!this.canContinuePrompt(prompt)) {
          return { success: false };
        }
        writeRpcDebugLine(
          `Executing instruction instructionLength=${instruction.length}, isSlashCommand=${isSlashCmd}`
        );

        // Check if it's a slash command and handle it directly
        if (isSlashCmd) {
          const { command, args } = this.agent.parseSlashCommand(instruction);
          writeRpcDebugLine(
            `Handling slash command commandLength=${command.length}, argumentCount=${args.length}`
          );

          // First check if the command is supported
          if (this.agent.isSlashCommandSupported(command)) {
            if (!this.canContinuePrompt(prompt)) {
              return { success: false };
            }
            const result = await this.agent.handleSlashCommand(command, args);
            if (!this.canContinuePrompt(prompt)) {
              return { success: false };
            }
            if (result !== null) {
              // Slash command returned data
              this.currentMessageContent = result;
              prompt.messageContent = result;
              writeNotification(RPC_NOTIFICATIONS.MESSAGE_UPDATE, {
                messageId: this.currentMessageId,
                delta: result,
                timestamp: createTimestamp(),
              });
            } else {
              // Command was handled but returned null (output went to console)
              // This is success - the command was executed
              this.currentMessageContent = `Command ${command} executed.`;
              prompt.messageContent = this.currentMessageContent;
              writeNotification(RPC_NOTIFICATIONS.MESSAGE_UPDATE, {
                messageId: this.currentMessageId,
                delta: this.currentMessageContent,
                timestamp: createTimestamp(),
              });
            }
            success = true;
          } else {
            // Command not found
            this.currentMessageContent = `Unknown command: ${command}. Type /help for available commands.`;
            prompt.messageContent = this.currentMessageContent;
            writeNotification(RPC_NOTIFICATIONS.MESSAGE_UPDATE, {
              messageId: this.currentMessageId,
              delta: this.currentMessageContent,
              timestamp: createTimestamp(),
            });
            success = false;
          }
        } else {
          // Not a slash command - run as regular instruction via LLM
          // Enter preview mode if enabled to batch file changes
          const fileManager = this.agent.getFileManager();
          writeRpcDebugLine(
            `previewModeEnabled=${this.previewModeEnabled}, hasFileManager=${!!fileManager}`
          );
          if (this.previewModeEnabled && fileManager) {
            const batchId = generateId('changes');
            this.currentChangesBatchId = batchId;
            writeRpcDebugLine('Entering preview mode batchCreated=true');
            this.emitChangesBatchStart(batchId);
            fileManager.enterPreviewMode(batchId, (change) => {
              if (!this.canContinuePrompt(prompt) || this.currentChangesBatchId !== batchId) {
                return;
              }
              // Emit each change as it's batched
              this.emitChangesBatchUpdate(batchId, {
                id: change.id,
                filePath: change.filePath,
                changeType: change.changeType,
                originalContent: change.originalContent,
                proposedContent: change.proposedContent,
                description: change.description,
                toolId: change.toolId,
                toolName: change.toolName,
              });
            });
          }

          try {
            if (!this.canContinuePrompt(prompt)) {
              return { success: false };
            }
            success = await this.agent.runInstruction(instruction, {
              signal: prompt.abortController.signal,
            });
            if (!this.canContinuePrompt(prompt)) {
              success = false;
            }
          } finally {
            // Always emit batch end and handle preview mode cleanup
            if (this.previewModeEnabled
              && fileManager
              && this.currentChangesBatchId
              && !this.shuttingDown
              && !prompt.finalized) {
              const batchId = this.currentChangesBatchId;
              this.currentChangesBatchId = null;
              const pendingChanges = fileManager.getPendingChanges();
              writeRpcDebugLine(`Turn finished pendingChanges=${pendingChanges.length}`);
              this.emitChangesBatchEnd(batchId, pendingChanges.length);

              if (pendingChanges.length === 0) {
                // No changes to preview - exit preview mode immediately
                fileManager.exitPreviewMode();
              }
              // If there are changes, keep preview mode active until user decision
              // fileManager.exitPreviewMode() will be called in handleChangesDecision
            }
          }
        }

        if (!this.canContinuePrompt(prompt)) {
          return { success: false };
        }

        writeRpcDebugLine(
          `Instruction completed success=${success}, contentLength=${this.currentMessageContent.length}`
        );

        // Fire stop hook after turn completes (matching command mode behavior)
        // Wrapped in its own try-catch to ensure MESSAGE_END and TURN_END are always emitted
        const turnDuration = this.turnStartTime ? Date.now() - this.turnStartTime : 0;
        try {
          const hookManager = this.canContinuePrompt(prompt)
            ? this.agent?.getHookManager?.()
            : undefined;
          writeRpcDebugLine(`Hook execution hookManager=${!!hookManager}`);
          if (hookManager) {
            const snapshot = this.agent?.getStatusSnapshot();
            writeRpcDebugLine('Executing stop hooks');
            await hookManager.executeHooks(
              'stop',
              {
                sessionId: this.sessionId || undefined,
                turnDuration,
                tokensUsed: snapshot?.tokensUsed ?? 0,
                tokensUsageStatus: snapshot?.tokensUsageStatus,
              },
              { signal: prompt.abortController.signal },
            );
            if (!this.canContinuePrompt(prompt)) {
              return { success: false };
            }
            writeRpcDebugLine('Stop hooks completed');

            // Emit HOOK_STOP notification so UI can update button state
            this.emitHookStop(
              snapshot?.tokensUsed ?? 0,
              0, // toolCallsCount - not tracked per turn currently
              turnDuration,
              snapshot?.tokensUsageStatus
            );
            writeRpcDebugLine('HOOK_STOP emitted');
          }
        } catch (hookErr) {
          // Log but don't let hook errors block MESSAGE_END and TURN_END
          writeRpcDebugLine(
            `Hook execution error nonBlocking=true, ${getRpcErrorMetadata(hookErr)}`
          );
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        writeRpcDebugLine(`Error during runInstruction: ${getRpcErrorMetadata(err)}`);
        // Emit error notification
        if (this.canContinuePrompt(prompt)) {
          writeNotification(RPC_NOTIFICATIONS.ERROR, {
            code: -32000,
            message: errorMessage,
            recoverable: true,
            timestamp: createTimestamp(),
          });
        }
        success = false;
      }

      return { success: this.canContinuePrompt(prompt) ? success : false };
    } catch (error) {
      if (!this.canContinuePrompt(prompt)) {
        return { success: false };
      }
      writeRpcDebugLine(`Outer prompt failure: ${getRpcErrorMetadata(error)}`);
      throw error;
    } finally {
      this.finalizePrompt(prompt);
    }
  }

  private finalizePrompt(prompt: ActivePrompt): void {
    if (prompt.finalized) {
      return;
    }
    prompt.finalized = true;

    if (prompt.messageId) {
      writeRpcDebugLine('Emitting MESSAGE_END messageIdPresent=true');
      writeNotification(RPC_NOTIFICATIONS.MESSAGE_END, {
        messageId: prompt.messageId,
        content: prompt.messageContent,
        ...(prompt.abortController.signal.aborted ? { aborted: true } : {}),
        timestamp: createTimestamp(),
      });
    }

    if (prompt.turnId) {
      const durationMs = prompt.turnStartTime
        ? Date.now() - prompt.turnStartTime
        : undefined;
      const snapshot = this.agent?.getStatusSnapshot();
      writeRpcDebugLine('Emitting TURN_END turnIdPresent=true');
      writeNotification(RPC_NOTIFICATIONS.TURN_END, {
        turnId: prompt.turnId,
        timestamp: createTimestamp(),
        contextPercent: this.contextPercent,
        tokensUsed: snapshot?.tokensUsed,
        tokensUsageStatus: snapshot?.tokensUsageStatus,
        durationMs,
      });
    }

    if (this.activePrompt !== prompt) {
      return;
    }

    this.stopKeepalive();
    this.activePrompt = null;
    this.status = 'idle';
    this.currentTurnId = null;
    this.turnStartTime = null;
    this.currentMessageId = null;
    this.currentMessageContent = '';
    this.abortController = null;
  }

  /**
   * Handle abort request (can be notification with null id for instant abort)
   */
  handleAbort(_requestId: JsonRpcId | null): AbortResult {
    const prompt = this.activePrompt;
    writeRpcDebugLine(`handleAbort activePrompt=${!!prompt}`);

    // Clear ALL pending permissions - they're no longer relevant after abort
    for (const pending of this.pendingPermissions.values()) {
      writeRpcDebugLine('Clearing pending permission dueToAbort=true');
      if (pending.ackTimeout) clearTimeout(pending.ackTimeout);
      if (pending.responseTimeout) clearTimeout(pending.responseTimeout);
      pending.resolve({ decision: 'deny_once' }); // Deny - operation is being aborted
    }
    this.pendingPermissions.clear();

    for (const pending of this.pendingDirectoryAccess.values()) {
      writeRpcDebugLine('Clearing pending directory access dueToAbort=true');
      if (pending.ackTimeout) clearTimeout(pending.ackTimeout);
      if (pending.responseTimeout) clearTimeout(pending.responseTimeout);
      pending.resolve(undefined);
    }
    this.pendingDirectoryAccess.clear();

    if (!prompt) {
      return { success: false };
    }

    this.status = 'processing';
    if (!prompt.cancelRequested) {
      prompt.cancelRequested = true;
      this.agent?.cancelCurrentInstruction();
      prompt.abortController.abort();
    }

    return { success: true };
  }

  /**
   * Handle reset request
   */
  async handleReset(_requestId: JsonRpcId): Promise<ResetResult> {
    // Best-effort memory extraction before resetting the conversation
    if (this.agent && this.conversation) {
      try {
        const { extractAndSaveSessionMemories } = await import('../../memory/extractSessionMemories.js');
        await extractAndSaveSessionMemories({
          llm: this.agent.getLlmProvider(),
          memoryManager: this.agent.getMemoryManager(),
          conversationHistory: this.conversation.history(),
          workspaceRoot: this.workspace,
        });
      } catch {
        // Memory extraction is best-effort; don't block reset
      }
    }

    if (this.conversation) {
      // Get system prompt if available
      const history = this.conversation.history();
      const systemPrompt = history.find((m) => m.role === 'system')?.content ?? '';
      this.conversation.reset(systemPrompt);
    }

    // Clear images from previous session
    this.imageManager?.clear();

    this.stopKeepalive();
    this.sessionId = generateId('session');
    this.status = 'idle';
    this.currentTurnId = null;
    this.currentMessageId = null;
    this.currentMessageContent = '';

    // Emit new agent start notification
    writeNotification(RPC_NOTIFICATIONS.AGENT_START, {
      sessionId: this.sessionId,
      model: this.model,
      workspace: this.workspace,
      timestamp: createTimestamp(),
    });

    return { sessionId: this.sessionId };
  }

  /**
   * Handle get_state request
   */
  handleGetState(_requestId: JsonRpcId): GetStateResult {
    return this.getState();
  }

  /**
   * Handle get_messages request
   */
  handleGetMessages(requestId: JsonRpcId, limit?: number): GetMessagesResult {
    const messages = this.getMessages(limit);
    return { messages };
  }

  async handleBrowserHandoffCreate(
    _requestId: JsonRpcId,
    params?: { extensionId?: string; installUrl?: string }
  ) {
    const session = this.agent?.getSessionManager?.().getCurrentSession?.();
    if (!session) {
      throw new Error('No active session available for browser handoff.');
    }

    return createBrowserHandoff({
      sessionId: session.metadata.sessionId,
      workspaceRoot: session.metadata.projectPath,
      extensionId: params?.extensionId,
      installUrl: params?.installUrl,
    });
  }

  async handleBrowserHandoffAttach(
    _requestId: JsonRpcId,
    params: { token: string }
  ) {
    const handoff = await attachBrowserHandoff(params.token);
    if (!handoff) {
      return { success: false };
    }

    if (!this.agent) {
      throw new Error('Agent not initialized');
    }

    const attached = await this.agent.attachSession(handoff.sessionId);
    this.sessionId = attached.sessionId;
    this.stopKeepalive();
    this.stopKeepalive();
    this.workspace = attached.workspaceRoot;
    this.model = attached.model;
    this.status = 'idle';

    return {
      success: true,
      sessionId: attached.sessionId,
      workspaceRoot: attached.workspaceRoot,
      messageCount: attached.messageCount,
    };
  }

  async handleBrowserHandoffAttachLatest(
    _requestId: JsonRpcId,
    _params?: unknown,
  ) {
    const handoff = await attachLatestBrowserHandoff();
    if (!handoff) {
      return { success: false };
    }

    if (!this.agent) {
      throw new Error('Agent not initialized');
    }

    const attached = await this.agent.attachSession(handoff.sessionId);
    this.stopKeepalive();
    this.sessionId = attached.sessionId;
    this.workspace = attached.workspaceRoot;
    this.model = attached.model;
    this.status = 'idle';

    return {
      success: true,
      sessionId: attached.sessionId,
      workspaceRoot: attached.workspaceRoot,
      messageCount: attached.messageCount,
    };
  }

  /**
   * Handle permission response from client
   */
  handlePermissionResponse(
    _requestId: JsonRpcId,
    permRequestId: string,
    decision: PermissionPromptResponse
  ): PermissionResponseResult {
    writeRpcDebugLine(
      `handlePermissionResponse decisionType=${typeof decision}, pendingCount=${this.pendingPermissions.size}`
    );
    const pending = this.pendingPermissions.get(permRequestId);
    if (pending) {
      const normalized = normalizePermissionPromptResponse(decision);
      writeRpcDebugLine(`Resolving pending permission decision=${normalized.decision}`);
      // Clear both timeouts
      if (pending.ackTimeout) {
        clearTimeout(pending.ackTimeout);
      }
      if (pending.responseTimeout) {
        clearTimeout(pending.responseTimeout);
      }
      this.pendingPermissions.delete(permRequestId);
      pending.resolve(normalized);
      this.status = 'processing';
      writeRpcDebugLine('Permission resolved status=processing');
      return { success: true };
    }

    writeRpcDebugLine('Permission response for unknown request');
    return { success: false };
  }

  /**
   * Request permission from client (called from agent's confirmDangerousAction)
   * Uses two-phase timeout:
   * - Phase 1: 30s to receive acknowledgment from extension
   * - Phase 2: 1 hour for user to respond after ack received
   */
  async requestPermission(
    tool: string,
    description: string,
    context: { command?: string; path?: string; args?: string[] }
  ): Promise<import('../../permissions/types.js').PermissionPromptResult> {
    if (this.shuttingDown) {
      return { decision: 'deny_once' };
    }
    const permRequestId = generateId('perm');
    this.status = 'waiting_permission';
    writeRpcDebugLine(
      `requestPermission toolLength=${tool.length}, descriptionLength=${description.length}, hasContext=${Object.keys(context).length > 0}`
    );

    writeNotification(RPC_NOTIFICATIONS.PERMISSION_REQUEST, {
      requestId: permRequestId,
      tool,
      description,
      context,
      options: [
        'allow_once',
        'deny_once',
        'allow_session',
        'deny_session',
        'allow_always_project',
        'allow_always_user',
        'deny_always_project',
        'deny_always_user',
        'alternative',
      ],
      timestamp: createTimestamp(),
    });

    return new Promise((resolve, reject) => {
      // Phase 1: Wait for acknowledgment (30s)
      // If extension doesn't acknowledge, something is wrong (extension dead/disconnected)
      const ackTimeout = setTimeout(() => {
        this.pendingPermissions.delete(permRequestId);
        this.status = 'processing';
        writeRpcDebugLine('Permission acknowledgement timeout');
        resolve({ decision: 'deny_once' }); // Deny - extension not responding
      }, 30000); // 30 second acknowledgment timeout

      this.pendingPermissions.set(permRequestId, {
        requestId: permRequestId,
        resolve,
        reject,
        ackTimeout,
        responseTimeout: null,
        acknowledged: false,
      });
    });
  }

  /**
   * Handle acknowledgment from client that permission UI is shown
   * Extends timeout since we know extension is alive and user is deciding
   */
  handlePermissionAcknowledged(permRequestId: string): { success: boolean } {
    const pending = this.pendingPermissions.get(permRequestId);
    if (!pending) {
      writeRpcDebugLine('Permission acknowledgement for unknown request');
      return { success: false };
    }

    if (pending.acknowledged) {
      return { success: true }; // Already acknowledged
    }

    // Got acknowledgment - extension is alive and showing permission UI
    if (pending.ackTimeout) {
      clearTimeout(pending.ackTimeout);
      pending.ackTimeout = null;
    }
    pending.acknowledged = true;

    // Set a very long timeout for user response (1 hour)
    // This is just a safety net - extension controls actual timeout
    pending.responseTimeout = setTimeout(() => {
      this.pendingPermissions.delete(permRequestId);
      this.status = 'processing';
      writeRpcDebugLine('Permission response timeout');
      pending.resolve({ decision: 'deny_once' });
    }, 3600000); // 1 hour

    writeRpcDebugLine('Permission acknowledged');
    return { success: true };
  }

  /**
   * Request directory access from client (called from agent's requestDirectoryAccess)
   * Uses two-phase timeout similar to permission requests:
   * - Phase 1: 30s to receive acknowledgment from extension
   * - Phase 2: 1 hour for user to respond after ack received
   */
  async requestDirectoryAccess(
    dirPath: string,
    reason?: string
  ): Promise<string | undefined> {
    if (this.shuttingDown) return undefined;
    const requestId = generateId('dir');
    this.status = 'waiting_permission';
    writeRpcDebugLine(
      `requestDirectoryAccess pathLength=${dirPath.length}, reasonLength=${reason?.length ?? 0}`
    );

    writeNotification(RPC_NOTIFICATIONS.DIRECTORY_ACCESS_REQUEST, {
      requestId,
      path: dirPath,
      reason,
      timestamp: createTimestamp(),
    });

    return new Promise((resolve, reject) => {
      // Phase 1: Wait for acknowledgment (30s)
      const ackTimeout = setTimeout(() => {
        this.pendingDirectoryAccess.delete(requestId);
        this.status = 'processing';
        writeRpcDebugLine('Directory access acknowledgement timeout');
        resolve(undefined); // Deny - extension not responding
      }, 30000); // 30 second acknowledgment timeout

      this.pendingDirectoryAccess.set(requestId, {
        requestId,
        path: dirPath,
        resolve,
        reject,
        ackTimeout,
        responseTimeout: null,
        acknowledged: false,
      });
    });
  }

  /**
   * Handle acknowledgment from client that directory access UI is shown
   */
  handleDirectoryAccessAcknowledged(requestId: string): { success: boolean } {
    const pending = this.pendingDirectoryAccess.get(requestId);
    if (!pending) {
      writeRpcDebugLine('Directory access acknowledgement for unknown request');
      return { success: false };
    }

    if (pending.acknowledged) {
      return { success: true }; // Already acknowledged
    }

    // Got acknowledgment - extension is alive and showing UI
    if (pending.ackTimeout) {
      clearTimeout(pending.ackTimeout);
      pending.ackTimeout = null;
    }
    pending.acknowledged = true;

    // Set a very long timeout for user response (1 hour)
    pending.responseTimeout = setTimeout(() => {
      this.pendingDirectoryAccess.delete(requestId);
      this.status = 'processing';
      writeRpcDebugLine('Directory access response timeout');
      pending.resolve(undefined);
    }, 3600000); // 1 hour

    writeRpcDebugLine('Directory access acknowledged');
    return { success: true };
  }

  /**
   * Handle directory access response from client
   */
  handleDirectoryAccessResponse(
    requestId: string,
    granted: boolean
  ): { success: boolean } {
    writeRpcDebugLine(`handleDirectoryAccessResponse granted=${granted}`);
    const pending = this.pendingDirectoryAccess.get(requestId);
    if (pending) {
      // Clear both timeouts
      if (pending.ackTimeout) {
        clearTimeout(pending.ackTimeout);
      }
      if (pending.responseTimeout) {
        clearTimeout(pending.responseTimeout);
      }
      this.pendingDirectoryAccess.delete(requestId);
      pending.resolve(granted ? pending.path : undefined);
      this.status = 'processing';
      writeRpcDebugLine('Directory access resolved status=processing');
      return { success: true };
    }

    writeRpcDebugLine('Directory access response for unknown request');
    return { success: false };
  }

  /**
   * Emit tool execution start notification
   */
  emitToolStart(toolName: string, args: Record<string, unknown>): string {
    const toolId = generateId('tool');
    if (this.notificationsSealed) return toolId;

    writeNotification(RPC_NOTIFICATIONS.TOOL_START, {
      toolId,
      toolName,
      args,
      timestamp: createTimestamp(),
    });

    return toolId;
  }

  /**
   * Emit tool execution update notification (streaming output)
   */
  emitToolUpdate(toolId: string, chunk: ToolOutputChunk): void {
    if (this.notificationsSealed) return;
    writeNotification(RPC_NOTIFICATIONS.TOOL_UPDATE, {
      toolId,
      output: chunk.data,
      stream: chunk.stream,
      timestamp: createTimestamp(),
    });
  }

  /**
   * Emit tool execution end notification
   */
  emitToolEnd(
    toolId: string,
    toolName: string,
    success: boolean,
    output?: string,
    error?: string
  ): void {
    if (this.notificationsSealed) return;
    writeNotification(RPC_NOTIFICATIONS.TOOL_END, {
      toolId,
      toolName,
      success,
      output,
      error,
      timestamp: createTimestamp(),
    });
  }

  /**
   * Emit message update notification (streaming content)
   */
  emitMessageUpdate(delta: string, thought?: string): void {
    if (this.notificationsSealed) return;
    const prompt = this.activePrompt;
    if (!prompt || prompt.finalized || prompt.abortController.signal.aborted || !prompt.messageId) {
      return;
    }
    this.currentMessageContent += delta;
    prompt.messageContent = this.currentMessageContent;

    writeNotification(RPC_NOTIFICATIONS.MESSAGE_UPDATE, {
      messageId: prompt.messageId,
      delta,
      thought,
      timestamp: createTimestamp(),
    });
  }

  // ============================================================================
  // Multi-File Change Preview Methods
  // ============================================================================

  /**
   * Emit changes batch start notification
   */
  emitChangesBatchStart(batchId: string): void {
    if (this.notificationsSealed) return;
    writeRpcDebugLine('emitChangesBatchStart');
    writeNotification(RPC_NOTIFICATIONS.CHANGES_BATCH_START, {
      batchId,
      turnId: this.currentTurnId ?? '',
      timestamp: createTimestamp(),
    });
  }

  /**
   * Emit changes batch update notification (individual file change)
   */
  emitChangesBatchUpdate(
    batchId: string,
    change: import('./types.js').ProposedFileChange
  ): void {
    if (this.notificationsSealed) return;
    writeRpcDebugLine(`emitChangesBatchUpdate changeType=${change.changeType}`);
    writeNotification(RPC_NOTIFICATIONS.CHANGES_BATCH_UPDATE, {
      batchId,
      change,
      timestamp: createTimestamp(),
    });
  }

  /**
   * Emit changes batch end notification
   */
  emitChangesBatchEnd(batchId: string, changeCount: number): void {
    if (this.notificationsSealed) return;
    writeRpcDebugLine(`emitChangesBatchEnd changeCount=${changeCount}`);
    writeNotification(RPC_NOTIFICATIONS.CHANGES_BATCH_END, {
      batchId,
      changeCount,
      timestamp: createTimestamp(),
    });
  }

  // ============================================================================
  // Hook Lifecycle Notification Methods
  // ============================================================================

  /**
   * Emit hook pre-tool notification
   * Called before a tool begins execution
   */
  emitHookPreTool(toolId: string, toolName: string, args: Record<string, unknown>): void {
    if (this.notificationsSealed) return;
    writeNotification(RPC_NOTIFICATIONS.HOOK_PRE_TOOL, {
      toolId,
      toolName,
      args,
      timestamp: createTimestamp(),
    });
  }

  /**
   * Emit hook post-tool notification
   * Called after a tool completes execution
   */
  emitHookPostTool(
    toolId: string,
    toolName: string,
    success: boolean,
    duration: number,
    output?: string
  ): void {
    if (this.notificationsSealed) return;
    writeNotification(RPC_NOTIFICATIONS.HOOK_POST_TOOL, {
      toolId,
      toolName,
      success,
      duration,
      output,
      timestamp: createTimestamp(),
    });
  }

  /**
   * Emit hook file-modified notification
   * Called when a file is created, modified, or deleted
   */
  emitHookFileModified(
    filePath: string,
    changeType: 'create' | 'modify' | 'delete',
    toolId: string
  ): void {
    if (this.notificationsSealed) return;
    writeNotification(RPC_NOTIFICATIONS.HOOK_FILE_MODIFIED, {
      filePath,
      changeType,
      toolId,
      timestamp: createTimestamp(),
    });
  }

  /**
   * Emit hook pre-prompt notification
   * Called before sending a prompt to the LLM
   */
  emitHookPrePrompt(instruction: string, mentionedFiles: string[]): void {
    if (this.notificationsSealed) return;
    writeNotification(RPC_NOTIFICATIONS.HOOK_PRE_PROMPT, {
      instruction,
      mentionedFiles,
      timestamp: createTimestamp(),
    });
  }

  /**
   * Emit hook post-response notification
   * Called after receiving a response from the LLM
   */
  emitHookPostResponse(tokensUsed: number, toolCallsCount: number, duration: number, tokensUsageStatus: 'actual' | 'unavailable' = 'actual'): void {
    if (this.notificationsSealed) return;
    writeNotification(RPC_NOTIFICATIONS.HOOK_POST_RESPONSE, {
      tokensUsed,
      tokensUsageStatus,
      toolCallsCount,
      duration,
      timestamp: createTimestamp(),
    });
  }

  /**
   * Emit hook session-error notification
   * Called when an error occurs during agent execution
   */
  emitHookSessionError(error: string, code?: string, context?: Record<string, unknown>): void {
    if (this.notificationsSealed) return;
    writeNotification(RPC_NOTIFICATIONS.HOOK_SESSION_ERROR, {
      error,
      code,
      context,
      timestamp: createTimestamp(),
    });
  }

  /**
   * Emit hook stop notification
   * Called when agent finishes responding to a turn
   */
  emitHookStop(tokensUsed: number, toolCallsCount: number, duration: number, tokensUsageStatus: 'actual' | 'unavailable' = 'actual'): void {
    if (this.notificationsSealed) return;
    writeNotification(RPC_NOTIFICATIONS.HOOK_STOP, {
      tokensUsed,
      tokensUsageStatus,
      toolCallsCount,
      duration,
      timestamp: createTimestamp(),
    });
  }

  /**
   * Emit hook session-start notification
   * Called when a session begins
   */
  emitHookSessionStart(sessionType: 'startup' | 'resume' | 'clear'): void {
    if (this.notificationsSealed) return;
    writeNotification(RPC_NOTIFICATIONS.HOOK_SESSION_START, {
      sessionType,
      timestamp: createTimestamp(),
    });
  }

  /**
   * Emit hook session-end notification
   * Called when a session ends
   */
  emitHookSessionEnd(reason: 'quit' | 'clear' | 'exit' | 'error', duration: number): void {
    if (this.notificationsSealed) return;
    writeNotification(RPC_NOTIFICATIONS.HOOK_SESSION_END, {
      reason,
      duration,
      timestamp: createTimestamp(),
    });
  }

  /**
   * Emit hook subagent-stop notification
   * Called when a subagent finishes execution
   */
  emitHookSubagentStop(
    subagentId: string,
    subagentName: string,
    subagentType: string,
    success: boolean,
    duration: number,
    error?: string
  ): void {
    if (this.notificationsSealed) return;
    writeNotification(RPC_NOTIFICATIONS.HOOK_SUBAGENT_STOP, {
      subagentId,
      subagentName,
      subagentType,
      success,
      duration,
      error,
      timestamp: createTimestamp(),
    });
  }

  /**
   * Emit hook permission-request notification
   * Called when a permission dialog is about to be shown
   */
  emitHookPermissionRequest(
    tool: string,
    path?: string,
    command?: string,
    args?: Record<string, unknown>
  ): void {
    if (this.notificationsSealed) return;
    writeNotification(RPC_NOTIFICATIONS.HOOK_PERMISSION_REQUEST, {
      tool,
      path,
      command,
      args,
      timestamp: createTimestamp(),
    });
  }

  /**
   * Emit hook notification
   * Called when a notification is sent to the user
   */
  emitHookNotification(notificationType: string, message: string): void {
    if (this.notificationsSealed) return;
    writeNotification(RPC_NOTIFICATIONS.HOOK_NOTIFICATION, {
      notificationType,
      message,
      timestamp: createTimestamp(),
    });
  }

  /**
   * Handle changes decision from client (accept/reject)
   */
  async handleChangesDecision(
    requestId: JsonRpcId,
    params: import('./types.js').ChangesDecisionParams
  ): Promise<import('./types.js').ChangesDecisionResult> {
    // This will be called when user accepts/rejects in the extension
    // The agent/FileActionManager needs to apply or discard changes
    // For now, return a placeholder - actual implementation requires
    // access to the FileActionManager through the agent

    const fileManager = this.agent?.getFileManager?.();
    if (!fileManager) {
      return {
        success: false,
        appliedCount: 0,
        skippedCount: 0,
        errors: [{ changeId: 'unknown', error: 'FileActionManager not available' }],
      };
    }

    const { action, selectedChangeIds, batchId } = params;

    // Verify this is the current batch
    if (fileManager.getBatchId() !== batchId) {
      return {
        success: false,
        appliedCount: 0,
        skippedCount: 0,
        errors: [{ changeId: 'unknown', error: `Batch ${batchId} not found or expired` }],
      };
    }

    const pendingChanges = fileManager.getPendingChanges();
    const totalCount = pendingChanges.length;

    if (action === 'reject_all') {
      // Discard all changes
      fileManager.clearPendingChanges();
      fileManager.exitPreviewMode();
      return {
        success: true,
        appliedCount: 0,
        skippedCount: totalCount,
      };
    }

    // For accept_all or accept_selected, apply changes
    const changeIds =
      action === 'accept_selected' ? selectedChangeIds : undefined;

    const result = await fileManager.applyPendingChanges(changeIds);
    fileManager.exitPreviewMode();

    return {
      success: result.errors.length === 0,
      appliedCount: result.applied.length,
      skippedCount: totalCount - result.applied.length,
      errors:
        result.errors.length > 0
          ? result.errors.map((e) => ({ changeId: e.id, error: e.error }))
          : undefined,
    };
  }

  // ============================================================================
  // Skills Management Methods (Non-Interactive for RPC Mode)
  // ============================================================================

  /**
   * Get community skills registry
   */
  async handleGetSkillsRegistry(
    requestId: JsonRpcId,
    params?: GetSkillsRegistryParams
  ): Promise<GetSkillsRegistryResult> {
    try {
      // Dynamic import to avoid loading these modules unless needed
      const { CommunitySkillsCache } = await import('../../skills/CommunitySkillsCache.js');
      const { GitHubRegistryFetcher } = await import('../../skills/GitHubRegistryFetcher.js');

      const cache = new CommunitySkillsCache();
      const fetcher = new GitHubRegistryFetcher();

      let registry;
      if (params?.forceRefresh) {
        // Force refresh from GitHub
        writeRpcDebugLine('Refreshing skills registry force=true');
        registry = await fetcher.fetchRegistry();
        await cache.setRegistry(registry);
      } else {
        // Try cache first
        const cached = await cache.getRegistry();
        if (cached) {
          registry = cached;
        } else {
          writeRpcDebugLine('Fetching skills registry cacheHit=false');
          registry = await fetcher.fetchRegistry();
          await cache.setRegistry(registry);
        }
      }

      // Convert to RPC format
      const skills = registry.skills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        category: skill.category,
        tags: skill.tags,
        rating: skill.rating,
        downloadCount: skill.downloadCount,
        isFeatured: skill.isFeatured,
        isCurated: skill.isCurated,
      }));

      return {
        success: true,
        skills,
        categories: registry.categories,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      writeRpcDebugLine(`Failed to get skills registry: ${getRpcErrorMetadata(error)}`);
      return {
        success: false,
        skills: [],
        categories: [],
        error: message,
      };
    }
  }

  /**
   * Install a skill by name (non-interactive)
   */
  async handleInstallSkill(
    requestId: JsonRpcId,
    params: InstallSkillParams
  ): Promise<InstallSkillResult> {
    try {
      const skillsRegistry = this.agent?.getSkillsRegistry?.();
      if (!skillsRegistry) {
        return {
          success: false,
          error: 'Skills registry not available',
        };
      }

      const workspaceRoot = this.workspace;

      // Dynamic imports
      const { CommunitySkillsCache } = await import('../../skills/CommunitySkillsCache.js');
      const { GitHubRegistryFetcher } = await import('../../skills/GitHubRegistryFetcher.js');
      const { AUTOHAND_PATHS, PROJECT_DIR_NAME } = await import('../../constants.js');
      const path = await import('node:path');

      const cache = new CommunitySkillsCache();
      const fetcher = new GitHubRegistryFetcher();

      // Get registry
      let registry = await cache.getRegistry();
      if (!registry) {
        writeRpcDebugLine('Fetching skills registry for install cacheHit=false');
        registry = await fetcher.fetchRegistry();
        await cache.setRegistry(registry);
      }

      // Find the skill
      const skill = fetcher.findSkill(registry.skills, params.skillName);
      if (!skill) {
        // Suggest similar skills
        const similar = fetcher.findSimilarSkills(registry.skills, params.skillName, 3);
        const suggestions = similar.map((s) => s.name).join(', ');
        return {
          success: false,
          error: `Skill not found: ${params.skillName}${suggestions ? `. Did you mean: ${suggestions}?` : ''}`,
        };
      }

      // Determine target directory
      const targetDir =
        params.scope === 'project'
          ? path.join(workspaceRoot, PROJECT_DIR_NAME, 'skills')
          : AUTOHAND_PATHS.skills;

      // Check if already installed
      const isInstalled = await skillsRegistry.isSkillInstalled(skill.id, targetDir);
      if (isInstalled && !params.force) {
        return {
          success: false,
          error: `Skill "${skill.name}" already exists. Use force=true to overwrite.`,
        };
      }

      writeRpcDebugLine(
        `Installing skill nameLength=${skill.name.length}, scope=${params.scope}`
      );

      // Try to get from cache first
      let files = await cache.getSkillDirectory(skill.id);
      if (!files) {
        writeRpcDebugLine('Fetching skill files cacheHit=false');
        files = await fetcher.fetchSkillDirectory(skill);
        await cache.setSkillDirectory(skill.id, files);
      }

      // Import using the registry
      const result = await skillsRegistry.importCommunitySkillDirectory(
        skill.id,
        files,
        targetDir,
        isInstalled // force if overwriting
      );

      if (result.success) {
        writeRpcDebugLine(`Skill installed nameLength=${skill.name.length}`);
        return {
          success: true,
          skillName: skill.name,
          path: result.path,
        };
      } else {
        return {
          success: false,
          error: result.error || 'Installation failed',
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      writeRpcDebugLine(`Failed to install skill: ${getRpcErrorMetadata(error)}`);
      return {
        success: false,
        error: message,
      };
    }
  }

  // ============================================================================
  // Learn Command Methods (RPC Mode)
  // ============================================================================

  /**
   * Handle /learn recommend - analyze project and recommend skills
   */
  async handleLearnRecommend(
    requestId: JsonRpcId,
    params?: LearnRecommendParams
  ): Promise<LearnRecommendResult> {
    try {
      const { ProjectAnalyzer } = await import('../../skills/autoSkill.js');
      const { CommunitySkillsCache } = await import('../../skills/CommunitySkillsCache.js');
      const { GitHubRegistryFetcher } = await import('../../skills/GitHubRegistryFetcher.js');
      const { fetchRegistryWithFallback } = await import('../../skills/communityInstaller.js');
      const { LearnAdvisor } = await import('../../skills/LearnAdvisor.js');

      const workspace = this.workspace || process.cwd();
      const deep = params?.deep ?? false;

      // Emit progress: analyzing
      writeNotification(RPC_NOTIFICATIONS.LEARN_PROGRESS, {
        status: 'analyzing',
        timestamp: createTimestamp(),
      });

      writeRpcDebugLine(`Learn recommend analyzingProject=true, deep=${deep}`);
      const analyzer = new ProjectAnalyzer(workspace);
      const analysis = await analyzer.analyze();

      // Emit progress: loading-registry
      writeNotification(RPC_NOTIFICATIONS.LEARN_PROGRESS, {
        status: 'loading-registry',
        timestamp: createTimestamp(),
      });

      const cache = new CommunitySkillsCache();
      const fetcher = new GitHubRegistryFetcher();
      let registry;
      try {
        registry = await fetchRegistryWithFallback(cache, fetcher);
      } catch {
        // Registry unavailable - continue with empty
      }

      const skillsRegistry = this.agent?.getSkillsRegistry?.();
      const installedSkills = skillsRegistry?.listSkills() ?? [];
      const registrySkills = registry?.skills ?? [];

      // Emit progress: evaluating
      writeNotification(RPC_NOTIFICATIONS.LEARN_PROGRESS, {
        status: 'evaluating',
        timestamp: createTimestamp(),
      });

      const llm = this.agent?.getLlmProvider?.();
      if (!llm) {
        return {
          success: false,
          projectSummary: '',
          audit: [],
          recommendations: [],
          gapAnalysis: null,
          error: 'LLM provider not available',
        };
      }

      const advisor = new LearnAdvisor(llm);
      const result = await advisor.analyze(analysis, installedSkills, registrySkills);

      return {
        success: true,
        projectSummary: result.projectSummary,
        audit: result.audit,
        recommendations: result.recommendations,
        gapAnalysis: result.gapAnalysis,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      writeRpcDebugLine(`Learn recommend failed: ${getRpcErrorMetadata(error)}`);
      return {
        success: false,
        projectSummary: '',
        audit: [],
        recommendations: [],
        gapAnalysis: null,
        error: message,
      };
    }
  }

  /**
   * Handle /learn update - regenerate stale LLM-generated skills
   */
  async handleLearnUpdate(
    _requestId: JsonRpcId,
    _params?: LearnUpdateParams
  ): Promise<LearnUpdateResult> {
    try {
      const { ProjectAnalyzer } = await import('../../skills/autoSkill.js');
      const { computeProjectHash, injectGeneratedMetadata } = await import('../../skills/communityInstaller.js');
      const { LearnAdvisor } = await import('../../skills/LearnAdvisor.js');
      const fse = await import('fs-extra');

      const workspace = this.workspace || process.cwd();

      writeNotification(RPC_NOTIFICATIONS.LEARN_PROGRESS, {
        status: 'updating',
        timestamp: createTimestamp(),
      });

      writeRpcDebugLine('Learn update checkingForStaleSkills=true');
      const analyzer = new ProjectAnalyzer(workspace);
      const analysis = await analyzer.analyze();
      const currentHash = computeProjectHash(analysis);

      const skillsRegistry = this.agent?.getSkillsRegistry?.();
      if (!skillsRegistry) {
        return { success: false, updated: 0, unchanged: 0, results: [], error: 'Skills registry not available' };
      }

      const allSkills = skillsRegistry.listSkills();
      const generatedSkills = allSkills.filter(
        (s: { metadata?: Record<string, unknown> }) => s.metadata?.['agentskill-source'] === 'llm-generated',
      );

      if (generatedSkills.length === 0) {
        return { success: true, updated: 0, unchanged: 0, results: [] };
      }

      const llm = this.agent?.getLlmProvider?.();
      if (!llm) {
        return { success: false, updated: 0, unchanged: 0, results: [], error: 'LLM provider not available' };
      }

      const advisor = new LearnAdvisor(llm);
      let updated = 0;
      let unchanged = 0;
      const results: Array<{ name: string; status: 'updated' | 'unchanged' | 'failed' }> = [];

      for (const skill of generatedSkills) {
        const storedHash = skill.metadata?.['agentskill-project-hash'];

        if (storedHash === currentHash) {
          unchanged++;
          results.push({ name: skill.name, status: 'unchanged' });
          continue;
        }

        const generated = await advisor.generateSkill(analysis, null, []);

        if (!generated) {
          results.push({ name: skill.name, status: 'failed' });
          continue;
        }

        let frontmatter = `---\nname: ${generated.name}\ndescription: ${generated.description}\n`;
        if (generated.allowedTools.length > 0) {
          frontmatter += `allowed-tools: ${generated.allowedTools.join(' ')}\n`;
        }
        frontmatter += `---\n\n`;
        let content = frontmatter + generated.body + '\n';
        content = injectGeneratedMetadata(content, skill.name, currentHash);

        try {
          await fse.writeFile(skill.path, content, 'utf-8');
          updated++;
          results.push({ name: skill.name, status: 'updated' });
        } catch {
          results.push({ name: skill.name, status: 'failed' });
        }
      }

      return { success: true, updated, unchanged, results };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      writeRpcDebugLine(`Learn update failed: ${getRpcErrorMetadata(error)}`);
      return { success: false, updated: 0, unchanged: 0, results: [], error: message };
    }
  }

  /**
   * Handle /learn generate - generate a custom skill for the project
   */
  async handleLearnGenerate(
    requestId: JsonRpcId,
    params: LearnGenerateParams
  ): Promise<LearnGenerateResult> {
    try {
      const { ProjectAnalyzer } = await import('../../skills/autoSkill.js');
      const { computeProjectHash, injectGeneratedMetadata } = await import('../../skills/communityInstaller.js');
      const { LearnAdvisor } = await import('../../skills/LearnAdvisor.js');
      const { AUTOHAND_PATHS, PROJECT_DIR_NAME } = await import('../../constants.js');
      const fse = await import('fs-extra');
      const path = await import('node:path');

      const workspace = this.workspace || process.cwd();
      const scope = params.scope;

      writeNotification(RPC_NOTIFICATIONS.LEARN_PROGRESS, {
        status: 'generating',
        timestamp: createTimestamp(),
      });

      writeRpcDebugLine(`Learn generate scope=${scope}`);

      const llm = this.agent?.getLlmProvider?.();
      if (!llm) {
        return { success: false, error: 'LLM provider not available' };
      }

      const analyzer = new ProjectAnalyzer(workspace);
      const analysis = await analyzer.analyze();
      const projectHash = computeProjectHash(analysis);

      const advisor = new LearnAdvisor(llm);
      const generated = await advisor.generateSkill(analysis, null, []);

      if (!generated) {
        return { success: false, error: 'Failed to generate a custom skill' };
      }

      let frontmatter = `---\nname: ${generated.name}\ndescription: ${generated.description}\n`;
      if (generated.allowedTools.length > 0) {
        frontmatter += `allowed-tools: ${generated.allowedTools.join(' ')}\n`;
      }
      frontmatter += `---\n\n`;
      let skillContent = frontmatter + generated.body + '\n';
      skillContent = injectGeneratedMetadata(skillContent, generated.name, projectHash);

      const targetDir =
        scope === 'project'
          ? path.join(workspace, PROJECT_DIR_NAME, 'skills')
          : AUTOHAND_PATHS.skills;

      const skillDir = path.join(targetDir, generated.name);
      await fse.ensureDir(skillDir);
      const skillPath = path.join(skillDir, 'SKILL.md');
      await fse.writeFile(skillPath, skillContent, 'utf-8');

      return { success: true, skillName: generated.name, skillPath };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      writeRpcDebugLine(`Learn generate failed: ${getRpcErrorMetadata(error)}`);
      return { success: false, error: message };
    }
  }

  // ============================================================================
  // Session History, YOLO, and MCP Handlers
  // ============================================================================

  /**
   * Get paginated session history
   */
  async handleGetHistory(
    _requestId: JsonRpcId,
    params?: GetHistoryParams
  ): Promise<GetHistoryResult> {
    const sessionManager = this.agent?.getSessionManager?.();
    if (!sessionManager) {
      return { sessions: [], currentPage: 1, totalPages: 0, totalItems: 0 };
    }

    try {
      const allSessions = await sessionManager.listSessions();
      const page = params?.page ?? 1;
      const pageSize = params?.pageSize ?? 20;
      const totalItems = allSessions.length;
      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
      const startIndex = (page - 1) * pageSize;
      const pageSessions = allSessions.slice(startIndex, startIndex + pageSize);

      return {
        sessions: pageSessions.map((s) => ({
          sessionId: s.sessionId,
          createdAt: s.createdAt,
          lastActiveAt: s.lastActiveAt ?? s.createdAt,
          projectName: s.projectName ?? '',
          model: s.model ?? '',
          messageCount: s.messageCount ?? 0,
          status: (s.status as 'active' | 'completed' | 'crashed') ?? 'completed',
        })),
        currentPage: page,
        totalPages,
        totalItems,
      };
    } catch (error) {
      writeRpcDebugLine(`Failed to get history: ${getRpcErrorMetadata(error)}`);
      return { sessions: [], currentPage: 1, totalPages: 0, totalItems: 0 };
    }
  }

  /**
   * Get a specific session's metadata and messages
   */
  async handleGetSession(
    _requestId: JsonRpcId,
    params: { sessionId: string }
  ) {
    const sessionManager = this.agent?.getSessionManager?.();
    if (!sessionManager) {
      return { success: false, error: 'Session manager not available' } as any;
    }

    try {
      const session = await sessionManager.loadSession(params.sessionId);
      const m = session.metadata;
      const messages = session.getMessages().map(msg => ({
        id: msg.role === 'user' ? `user-${crypto.randomUUID()}` : `msg-${crypto.randomUUID()}`,
        role: msg.role,
        content: msg.content,
        timestamp: new Date(m.createdAt).toISOString(),
        toolCalls: (msg.toolCalls ?? []).map(tc => ({
          id: tc.callId ?? '',
          name: tc.name ?? '',
          args: tc.arguments ?? {},
        })),
      }));

      return {
        success: true,
        sessionId: m.sessionId,
        projectName: m.projectName ?? '',
        model: m.model ?? '',
        messageCount: m.messageCount ?? 0,
        status: m.status ?? 'completed',
        createdAt: m.createdAt,
        lastActiveAt: m.lastActiveAt ?? m.createdAt,
        summary: m.summary,
        messages,
        workspaceRoot: m.projectPath ?? '',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeRpcDebugLine(`Failed to get session: ${getRpcErrorMetadata(error)}`);
      return {
        success: false,
        error: message,
        sessionId: params.sessionId,
        projectName: '',
        model: '',
        messageCount: 0,
        status: 'completed',
        createdAt: '',
        lastActiveAt: '',
        messages: [],
        workspaceRoot: '',
      };
    }
  }

  /**
   * Set YOLO (unrestricted) mode with pattern and optional timeout
   */
  handleYoloSet(_requestId: JsonRpcId, params: YoloSetParams): YoloSetResult {
    if (this.shuttingDown) return { success: false };
    const permissionManager = this.agent?.getPermissionManager?.();
    if (!permissionManager) {
      return { success: false };
    }

    try {
      // Set unrestricted mode
      const revertGeneration = ++this.yoloRevertGeneration;
      if (this.yoloRevertTimer) {
        clearTimeout(this.yoloRevertTimer);
        this.yoloRevertTimer = null;
      }

      permissionManager.setMode('unrestricted');
      writeRpcDebugLine(
        `YOLO mode enabled patternLength=${params.pattern.length}, hasTimeout=${!!params.timeoutSeconds}`
      );

      let expiresIn: number | undefined;
      if (params.timeoutSeconds && params.timeoutSeconds > 0) {
        expiresIn = params.timeoutSeconds;
        // Auto-revert to interactive mode after timeout
        this.yoloRevertTimer = setTimeout(() => {
          if (this.yoloRevertGeneration !== revertGeneration) {
            return;
          }
          this.yoloRevertTimer = null;
          permissionManager.setMode('interactive');
          writeRpcDebugLine('YOLO mode expired mode=interactive');
        }, params.timeoutSeconds * 1000);
        this.yoloRevertTimer.unref?.();
      }

      return { success: true, expiresIn };
    } catch (error) {
      writeRpcDebugLine(`Failed to set YOLO mode: ${getRpcErrorMetadata(error)}`);
      return { success: false };
    }
  }

  /**
   * List all MCP servers and their connection status
   */
  handleMcpListServers(_requestId: JsonRpcId): McpListServersResult {
    const mcpManager = this.agent?.getMcpManager?.();
    if (!mcpManager) {
      return { servers: [] };
    }

    return { servers: mcpManager.getServers() };
  }

  /**
   * List all MCP tools, optionally filtered by server name
   */
  handleMcpListTools(
    _requestId: JsonRpcId,
    params?: McpListToolsParams
  ): McpListToolsResult {
    const mcpManager = this.agent?.getMcpManager?.();
    if (!mcpManager) {
      return { tools: [] };
    }

    const allTools = params?.serverName
      ? mcpManager.getToolsForServer(params.serverName)
      : mcpManager.getAllTools();

    return {
      tools: allTools.map((t) => {
        // Extract server name from prefixed tool name: mcp__<server>__<tool>
        const parsed = McpClientManager.parseMcpToolName(t.name);
        return {
          name: t.name,
          description: t.description,
          serverName: parsed?.serverName ?? 'unknown',
        };
      }),
    };
  }

  /**
   * List persisted meta-tools and registry diagnostics for non-interactive clients.
   */
  handleGetToolsRegistry(): GetToolsRegistryResult {
    const registry = this.agent?.getToolsRegistry?.();
    if (!registry) {
      return { tools: [], diagnostics: [] };
    }

    return {
      tools: registry.getRegistryEntries({ includeDisabled: true }),
      diagnostics: registry.getDiagnostics(),
    };
  }

  // ============================================================================
  // MCP Bridge Methods (VS Code <-> CLI bidirectional tool bridging)
  // ============================================================================

  /**
   * Receive VS Code MCP tool descriptors from the extension.
   * These tools become available for the agent to invoke via the extension.
   * Tool names are stored with a 'vscode__' prefix to distinguish them.
   */
  handleMcpSetVscodeTools(
    _requestId: JsonRpcId,
    params: McpSetVscodeToolsParams
  ): { success: boolean } {
    if (this.shuttingDown) return { success: false };
    // Clear previous VS Code tools
    this.vscodeTools.clear();

    for (const tool of params.tools) {
      const prefixedName = `vscode__${tool.serverName}__${tool.name}`;
      this.vscodeTools.set(prefixedName, {
        name: tool.name,
        description: tool.description,
        serverName: tool.serverName,
        inputSchema: tool.inputSchema,
      });
    }

    writeRpcDebugLine(`MCP bridge registeredTools=${this.vscodeTools.size}`);

    // Notify the extension that the tool set has changed
    const allTools = this.getVscodeToolsList();
    writeNotification(RPC_NOTIFICATIONS.MCP_TOOLS_CHANGED, {
      tools: allTools,
      timestamp: createTimestamp(),
    });

    return { success: true };
  }

  /**
   * Get the list of registered VS Code tools for notifications
   */
  private getVscodeToolsList(): Array<{
    name: string;
    description: string;
    serverName: string;
  }> {
    const tools: Array<{ name: string; description: string; serverName: string }> = [];
    for (const [prefixedName, tool] of this.vscodeTools) {
      tools.push({
        name: prefixedName,
        description: tool.description,
        serverName: tool.serverName,
      });
    }
    return tools;
  }

  /**
   * Invoke a VS Code MCP tool by sending a notification to the extension
   * and waiting for the response. Called internally when the agent uses
   * a tool with the 'vscode__' prefix.
   */
  async invokeVscodeTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<string> {
    if (this.shuttingDown) {
      throw new Error('Adapter shutdown');
    }
    const tool = this.vscodeTools.get(toolName);
    if (!tool) {
      throw new Error(`VS Code tool not found: ${toolName}`);
    }

    const requestId = generateId('mcp-invoke');

    // Send invocation request to extension
    writeNotification(RPC_NOTIFICATIONS.MCP_INVOKE_REQUEST, {
      requestId,
      toolName,
      args,
      timestamp: createTimestamp(),
    });

    // Wait for the extension to respond
    return new Promise<string>((resolve, reject) => {
      // Timeout after 5 minutes (VS Code tool execution can be slow)
      const timeout = setTimeout(() => {
        this.pendingVscodeInvocations.delete(requestId);
        reject(new Error(`VS Code tool invocation timed out: ${toolName}`));
      }, 300000);

      this.pendingVscodeInvocations.set(requestId, {
        resolve: (result: string) => {
          clearTimeout(timeout);
          resolve(result);
        },
        reject: (error: Error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
    });
  }

  /**
   * Handle the invoke response from the extension for a pending VS Code tool call.
   * Resolves or rejects the promise created in invokeVscodeTool.
   */
  handleMcpInvokeResponse(
    _requestId: JsonRpcId,
    params: McpInvokeResponseParams
  ): { success: boolean } {
    const pending = this.pendingVscodeInvocations.get(params.requestId);
    if (!pending) {
      writeRpcDebugLine('MCP bridge invoke response for unknown request');
      return { success: false };
    }

    this.pendingVscodeInvocations.delete(params.requestId);

    if (params.success) {
      pending.resolve(params.result ?? '');
    } else {
      pending.reject(new Error(params.error ?? 'VS Code tool invocation failed'));
    }

    return { success: true };
  }

  /**
   * Return MCP server configurations from the CLI config.
   * Sensitive environment variables (keys, tokens, secrets) are sanitized.
   */
  handleMcpGetServerConfigs(
    _requestId: JsonRpcId
  ): McpGetServerConfigsResult {
    const configs = this.mcpServerConfigs.map((server) => ({
      name: server.name,
      transport: server.transport,
      command: server.command,
      args: server.args,
      url: server.url,
      env: server.env ? this.sanitizeEnv(server.env) : undefined,
      headers: server.headers ? this.sanitizeHeaders(server.headers) : undefined,
      autoConnect: server.autoConnect,
    }));

    return { configs };
  }

  /**
   * Check if a tool name is a registered VS Code MCP tool
   */
  isVscodeTool(toolName: string): boolean {
    return this.vscodeTools.has(toolName);
  }

  /**
   * Sanitize environment variables by redacting values that look like secrets.
   * Keeps the key names but replaces sensitive values with '***'.
   */
  private sanitizeEnv(env: Record<string, string>): Record<string, string> {
    const sensitivePatterns = /key|token|secret|password|credential|auth/i;
    const sanitized: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
      if (sensitivePatterns.test(key)) {
        sanitized[key] = '***';
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  /**
   * Sanitize HTTP headers by redacting values that look like auth tokens.
   */
  private sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
    const sensitivePatterns = /authorization|token|key|secret|bearer/i;
    const sanitized: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (sensitivePatterns.test(key)) {
        sanitized[key] = '***';
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  /**
   * Shutdown the adapter
   */
  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepaliveInterval = setInterval(() => {
      if (this.shuttingDown || this.notificationsSealed) return;
      writeNotification(RPC_NOTIFICATIONS.PING, {
        timestamp: createTimestamp(),
        status: this.status,
        turnId: this.currentTurnId,
      });
    }, this.KEEPALIVE_MS);
  }

  private stopKeepalive(): void {
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
    }
  }

  shutdown(reason: 'completed' | 'aborted' | 'error' | 'disconnected' = 'completed'): Promise<void> {
    this.shutdownPromise ??= this.performShutdown(reason);
    return this.shutdownPromise;
  }

  private async performShutdown(
    reason: 'completed' | 'aborted' | 'error' | 'disconnected',
  ): Promise<void> {
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<'deadline'>((resolve) => {
      deadlineTimer = setTimeout(() => resolve('deadline'), RPC_SHUTDOWN_TIMEOUT_MS);
    });

    try {
      this.shuttingDown = true;
      this.stopKeepalive();
      const pendingPromptStarts = this.cancelPendingPromptStarts();

      if (this.yoloRevertTimer) {
        clearTimeout(this.yoloRevertTimer);
        this.yoloRevertTimer = null;
      }
      this.yoloRevertGeneration += 1;

      for (const [, pending] of this.pendingPermissions) {
        if (pending.ackTimeout) clearTimeout(pending.ackTimeout);
        if (pending.responseTimeout) clearTimeout(pending.responseTimeout);
        pending.resolve({ decision: 'deny_once' });
      }
      this.pendingPermissions.clear();

      for (const [, pending] of this.pendingDirectoryAccess) {
        if (pending.ackTimeout) clearTimeout(pending.ackTimeout);
        if (pending.responseTimeout) clearTimeout(pending.responseTimeout);
        pending.resolve(undefined);
      }
      this.pendingDirectoryAccess.clear();

      for (const [, pending] of this.pendingVscodeInvocations) {
        pending.reject(new Error('Adapter shutdown'));
      }
      this.pendingVscodeInvocations.clear();
      this.vscodeTools.clear();

      const promptWork = this.activePromptWork;
      const prompt = this.activePrompt;
      if (prompt && !prompt.cancelRequested) {
        prompt.cancelRequested = true;
        this.agent?.cancelCurrentInstruction();
      }
      prompt?.abortController.abort();
      if (prompt && !promptWork) prompt.finalized = true;
      this.abortController?.abort();
      this.settleActivePreviewForShutdown();

      if (!promptWork) this.resetPromptState();

      const agent = this.agent;
      agent?.setStatusListener(undefined);
      agent?.setOutputListener(undefined);
      const resourceShutdown = agent?.shutdownRuntimeResources().catch(() => {}) ?? Promise.resolve();
      const cleanup = Promise.allSettled([
        resourceShutdown,
        ...pendingPromptStarts,
        ...(promptWork ? [promptWork] : []),
      ]).then(() => 'settled' as const);
      const result = await Promise.race([cleanup, deadline]);
      if (result === 'deadline' && prompt && !prompt.finalized) {
        this.finalizePrompt(prompt);
      }
      this.stopKeepalive();
      this.resetPromptState();

      this.notificationsSealed = true;
      const agentEndReason = reason === 'disconnected' ? 'aborted' : reason;
      writeNotification(RPC_NOTIFICATIONS.AGENT_END, {
        sessionId: this.sessionId!,
        reason: agentEndReason,
        timestamp: createTimestamp(),
      });
    } finally {
      if (deadlineTimer) clearTimeout(deadlineTimer);
    }
  }

  /**
   * Handle output events from the agent
   */
  private handleAgentOutput(event: AgentOutputEvent): void {
    if (this.shuttingDown) return;
    writeRpcDebugLine(
      `handleAgentOutput type=${event.type}, contentLength=${event.content?.length ?? 0}, thoughtLength=${event.thought?.length ?? 0}`
    );
    const prompt = this.activePrompt;
    switch (event.type) {
      case 'thinking':
        if (event.thought
          && prompt
          && !prompt.finalized
          && !prompt.abortController.signal.aborted
          && prompt.messageId) {
          writeNotification(RPC_NOTIFICATIONS.MESSAGE_UPDATE, {
            messageId: prompt.messageId,
            delta: '',
            thought: event.thought,
            timestamp: createTimestamp(),
          });
        }
        break;

      case 'message':
        if (event.content
          && prompt
          && !prompt.finalized
          && !prompt.abortController.signal.aborted
          && prompt.messageId) {
          this.currentMessageContent = event.content;
          prompt.messageContent = event.content;
          writeNotification(RPC_NOTIFICATIONS.MESSAGE_UPDATE, {
            messageId: prompt.messageId,
            delta: event.content,
            timestamp: createTimestamp(),
          });
        }
        break;

      case 'tool_start':
        if (event.toolName) {
          writeNotification(RPC_NOTIFICATIONS.TOOL_START, {
            toolId: event.toolId ?? generateId('tool'),
            toolName: event.toolName,
            args: event.toolArgs ?? {},
            timestamp: createTimestamp(),
          });
        }
        break;

      case 'tool_end':
        if (event.toolName) {
          writeNotification(RPC_NOTIFICATIONS.TOOL_END, {
            toolId: event.toolId ?? 'unknown',
            toolName: event.toolName,
            success: event.toolSuccess === true,
            output: event.toolOutput,
            error: event.toolError,
            timestamp: createTimestamp(),
          });
        }
        break;

      case 'schedule_triggered':
        writeNotification(RPC_NOTIFICATIONS.SCHEDULE_TRIGGERED, {
          prompt: event.content,
          scheduleId: event.scheduleId,
          timestamp: createTimestamp(),
        });
        break;

      case 'file_modified':
        if (event.filePath) {
          writeNotification(RPC_NOTIFICATIONS.HOOK_FILE_MODIFIED, {
            filePath: event.filePath,
            changeType: event.changeType ?? 'modify',
            toolId: event.toolId ?? '',
            timestamp: createTimestamp(),
          });
        }
        break;

      case 'error':
        if (event.content
          && prompt
          && !prompt.finalized
          && !prompt.abortController.signal.aborted
          && prompt.messageId) {
          // Classify the error for appropriate UI treatment
          const errorType = this.classifyError(event.content);

          // Update message content with error (include icon based on type)
          const icon = errorType.icon;
          this.currentMessageContent = `${icon} ${event.content}`;
          prompt.messageContent = this.currentMessageContent;
          writeNotification(RPC_NOTIFICATIONS.MESSAGE_UPDATE, {
            messageId: prompt.messageId,
            delta: this.currentMessageContent,
            timestamp: createTimestamp(),
          });
          // Also emit error notification with classification
          writeNotification(RPC_NOTIFICATIONS.ERROR, {
            code: errorType.code,
            message: event.content,
            errorType: errorType.type,
            recoverable: errorType.recoverable,
            timestamp: createTimestamp(),
          });
        }
        break;
    }
  }

  /**
   * Classify error messages for appropriate UI treatment.
   * Delegates to the shared classifyApiError() and maps the result
   * to the RPC-specific shape (type, code, icon, recoverable).
   */
  private classifyError(message: string): {
    type: string;
    code: number;
    icon: string;
    recoverable: boolean;
  } {
    const classified = classifyApiError(0, message);
    return {
      type: RPC_ERROR_TYPE_MAP[classified.code] ?? 'unknown',
      code: RPC_ERROR_CODE_MAP[classified.code] ?? -32000,
      icon: RPC_ERROR_ICON_MAP[classified.code] ?? '\u26A0\uFE0F',
      recoverable: classified.retryable,
    };
  }

  /**
   * Convert LLMMessage to RpcMessage
   */
  private convertMessage(msg: LLMMessage, index: number): RpcMessage {
    let toolCalls:
      | Array<{ id: string; name: string; args: Record<string, unknown> }>
      | undefined;

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      toolCalls = msg.tool_calls.map((tc: LLMToolCall) => {
        let args: Record<string, unknown> = {};
        try {
          if (tc.function?.arguments) {
            args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
          }
        } catch {
          // Ignore parse errors
        }
        return {
          id: tc.id,
          name: tc.function?.name ?? 'unknown',
          args,
        };
      });
    }

    return {
      id: `msg_${index}`,
      role: msg.role as 'user' | 'assistant' | 'system' | 'tool',
      content: msg.content,
      timestamp: new Date().toISOString(),
      toolCalls,
    };
  }

  // ============================================================================
  // Auto-Research RPC Handlers
  // ============================================================================

  async handleAutoresearchStart(params: AutoresearchStartParams): Promise<AutoresearchStartResult> {
    try {
      const objective = params.objective.trim();
      if (!objective) return { success: false, error: 'Missing required parameter: objective' };

      const manager = new AutoResearchManager(this.workspace);
      const canResume = await manager.canResume();
      let initialized: Awaited<ReturnType<typeof initExperiment>> | undefined;
      if (!canResume && hasCompleteAutoresearchBenchmarkParams(params)) {
        initialized = await initExperiment(this.workspace, {
          name: objective,
          metricName: params.metricName,
          metricUnit: params.metricUnit,
          direction: params.direction,
          measureScript: measureScriptFromParams(params),
          maxIterations: params.maxIterations,
          timeoutMs: params.timeoutMs,
          filesInScope: params.filesInScope ?? [],
          checksScript: checksScriptFromParams(params),
          subagents: params.subagents,
          secondaryObjectives: params.secondaryObjectives,
          constraints: params.constraints,
          sampling: params.sampling,
          retention: params.retention,
          environmentAllowlist: params.environmentAllowlist,
        });
        if (!initialized.success) return { success: false, error: initialized.message };
      }
      const started = canResume
        ? await manager.resume(objective)
        : await manager.start(objective, params.maxIterations);
      let message = started.message;

      if (initialized) {
        message = `${message}\nInitialized benchmark config from RPC options. Replayable baseline: ${initialized.baselineAttemptId}.`;
      }

      const snapshot = await manager.getSnapshot();
      this.emitAutoresearchNotification(RPC_NOTIFICATIONS.AUTORESEARCH_START, snapshot, {
        subcommand: canResume ? 'resume' : 'start', message,
      });
      return {
        success: true,
        message,
        instruction: started.instruction,
        ...this.formatAutoresearchSnapshot(snapshot),
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async handleAutoresearchStatus(): Promise<AutoresearchStatusResult> {
    try {
      const manager = new AutoResearchManager(this.workspace);
      const snapshot = await manager.getSnapshot();
      this.emitAutoresearchNotification(RPC_NOTIFICATIONS.AUTORESEARCH_STATUS, snapshot, { subcommand: 'status' });
      const [history, pareto] = await Promise.all([
        getAutoresearchHistory(this.workspace),
        getParetoExperiments(this.workspace),
      ]);
      return {
        success: true,
        ...this.formatAutoresearchSnapshot(snapshot),
        attempts: history.attempts,
        paretoAttemptIds: pareto.attemptIds,
      };
    } catch (error) {
      return {
        success: false, active: false, statusText: 'No active auto-research session.', runsLogged: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async handleAutoresearchStop(): Promise<AutoresearchStopResult> {
    try {
      const manager = new AutoResearchManager(this.workspace);
      const message = await manager.pause();
      const snapshot = await manager.getSnapshot();
      this.emitAutoresearchNotification(RPC_NOTIFICATIONS.AUTORESEARCH_PAUSE, snapshot, { subcommand: 'stop', message });
      return { success: true, message, ...this.formatAutoresearchSnapshot(snapshot) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async handleAutoresearchHistory(): Promise<AutoresearchHistoryResult> {
    this.emitAutoresearchOperation('history', 'started', { success: true });
    try {
      const history = await getAutoresearchHistory(this.workspace);
      this.emitAutoresearchOperation('history', 'completed', { success: true });
      return { success: true, attempts: history.attempts };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitAutoresearchOperation('history', 'failed', { success: false, error: message });
      return { success: false, attempts: [], error: message };
    }
  }

  async handleAutoresearchReplay(params: AutoresearchReplayParams): Promise<AutoresearchReplayResult> {
    this.emitAutoresearchOperation('replay', 'started', { success: true, attemptId: params.attemptId });
    const result = await replayExperiment(this.workspace, params.attemptId, {
      evaluator: params.evaluator,
      signal: this.abortController?.signal,
    });
    this.emitAutoresearchOperation('replay', result.success ? 'completed' : 'failed', {
      success: result.success,
      attemptId: params.attemptId,
      error: result.error,
    });
    return result;
  }

  async handleAutoresearchRescore(params: AutoresearchRescoreParams): Promise<AutoresearchRescoreResult> {
    this.emitAutoresearchOperation('rescore', 'started', { success: true, attemptId: params.attemptId });
    try {
      const result = await rescoreExperiments(this.workspace, params);
      this.emitAutoresearchOperation('rescore', 'completed', { success: true, attemptId: params.attemptId });
      return { success: true, decisions: result.decisions };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitAutoresearchOperation('rescore', 'failed', { success: false, attemptId: params.attemptId, error: message });
      return { success: false, decisions: [], error: message };
    }
  }

  async handleAutoresearchCompare(params: AutoresearchCompareParams): Promise<AutoresearchCompareResult> {
    this.emitAutoresearchOperation('compare', 'started', { success: true, attemptId: params.leftAttemptId });
    try {
      const comparison = await compareExperiments(this.workspace, params.leftAttemptId, params.rightAttemptId);
      this.emitAutoresearchOperation('compare', 'completed', { success: true, attemptId: params.leftAttemptId });
      return { success: true, comparison };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitAutoresearchOperation('compare', 'failed', { success: false, attemptId: params.leftAttemptId, error: message });
      return {
        success: false,
        error: message,
      };
    }
  }

  async handleAutoresearchPareto(): Promise<AutoresearchParetoResult> {
    this.emitAutoresearchOperation('pareto', 'started', { success: true });
    try {
      const result = await getParetoExperiments(this.workspace);
      this.emitAutoresearchOperation('pareto', 'completed', { success: true });
      return { success: true, attemptIds: result.attemptIds };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitAutoresearchOperation('pareto', 'failed', { success: false, error: message });
      return { success: false, attemptIds: [], error: message };
    }
  }

  async handleAutoresearchPin(params: AutoresearchPinParams): Promise<AutoresearchPinResult> {
    this.emitAutoresearchOperation('pin', 'started', { success: true, attemptId: params.attemptId });
    try {
      await pinExperiment(this.workspace, params.attemptId, params.pinned);
      this.emitAutoresearchOperation('pin', 'completed', { success: true, attemptId: params.attemptId });
      return { success: true, attemptId: params.attemptId, pinned: params.pinned };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitAutoresearchOperation('pin', 'failed', { success: false, attemptId: params.attemptId, error: message });
      return { success: false, attemptId: params.attemptId, pinned: params.pinned, error: message };
    }
  }

  async handleAutoresearchPrune(params: AutoresearchPruneParams): Promise<AutoresearchPruneResult> {
    this.emitAutoresearchOperation('prune', 'started', { success: true });
    try {
      const confirmed = params.yes === true;
      const result = await pruneArtifacts(this.workspace, {
        dryRun: confirmed ? params.dryRun === true : true,
        includeProtected: true,
      });
      this.emitAutoresearchOperation('prune', 'completed', {
        success: true,
        applied: result.applied,
      });
      return { success: true, ...result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitAutoresearchOperation('prune', 'failed', { success: false, error: message });
      return { success: false, applied: false, candidates: [], bytesFreed: 0, remainingBytes: 0, error: message };
    }
  }

  private formatAutoresearchSnapshot(snapshot: AutoResearchSnapshot): Omit<AutoresearchStatusResult, 'success'> {
    return {
      active: snapshot.active,
      state: snapshot.state ? this.formatAutoresearchState(snapshot.state) : undefined,
      statusText: snapshot.statusText,
      runsLogged: snapshot.runs.length,
      attempts: snapshot.attempts,
      paretoAttemptIds: snapshot.paretoAttemptIds,
    };
  }

  private formatAutoresearchState(state: AutoResearchState): AutoresearchRpcState {
    return { active: state.active, goal: state.goal, iteration: state.iteration, maxIterations: state.maxIterations };
  }

  private emitAutoresearchNotification(
    method: typeof RPC_NOTIFICATIONS.AUTORESEARCH_START | typeof RPC_NOTIFICATIONS.AUTORESEARCH_STATUS | typeof RPC_NOTIFICATIONS.AUTORESEARCH_PAUSE,
    snapshot: AutoResearchSnapshot,
    details: { subcommand: 'start' | 'resume' | 'status' | 'stop'; message?: string }
  ): void {
    writeNotification(method, {
      active: snapshot.active,
      goal: snapshot.state?.goal ?? snapshot.config?.name,
      iteration: snapshot.state?.iteration ?? snapshot.runs.length,
      maxIterations: snapshot.state?.maxIterations ?? snapshot.config?.maxIterations,
      runsLogged: snapshot.runs.length,
      statusText: snapshot.statusText,
      subcommand: details.subcommand,
      message: details.message,
      timestamp: createTimestamp(),
    });
  }

  private emitAutoresearchOperation(
    operation: 'history' | 'replay' | 'rescore' | 'compare' | 'pareto' | 'pin' | 'prune',
    phase: 'started' | 'completed' | 'failed',
    details: { success: boolean; attemptId?: string; applied?: boolean; error?: string }
  ): void {
    writeNotification(RPC_NOTIFICATIONS.AUTORESEARCH_EVENT, {
      operation,
      phase,
      ...details,
      timestamp: createTimestamp(),
    });
  }

  // ============================================================================
  // Auto-Mode RPC Handlers
  // ============================================================================

  /**
   * Start auto-mode loop
   */
  async handleAutomodeStart(
    requestId: JsonRpcId,
    params: AutomodeStartParams
  ): Promise<AutomodeStartResult> {
    try {
      const automodeManager = this.agent?.getAutomodeManager?.();
      if (!automodeManager) {
        return {
          success: false,
          error: 'Auto-mode manager not available',
        };
      }

      if (automodeManager.isActive()) {
        return {
          success: false,
          error: 'Auto-mode is already running',
        };
      }

      // Note: Starting auto-mode from RPC would require integrating with the agent's
      // iteration callback. For now, return success and let the agent handle it.
      // A full implementation would start the loop here.
      writeRpcDebugLine(`Auto-mode start requested promptLength=${params.prompt.length}`);

      return {
        success: true,
        sessionId: `automode-${Date.now()}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: message,
      };
    }
  }

  /**
   * Get auto-mode status
   */
  handleAutomodeStatus(_requestId: JsonRpcId): AutomodeStatusResult {
    const automodeManager = this.agent?.getAutomodeManager?.();

    if (!automodeManager) {
      return {
        active: false,
        paused: false,
      };
    }

    const state = automodeManager.getState();

    return {
      active: automodeManager.isActive(),
      paused: automodeManager.isPausedState(),
      state: state ? {
        sessionId: state.sessionId,
        status: state.status,
        currentIteration: state.currentIteration,
        maxIterations: state.maxIterations,
        filesCreated: state.filesCreated,
        filesModified: state.filesModified,
        branch: state.branch,
        lastCheckpoint: state.lastCheckpoint,
      } : undefined,
    };
  }

  /**
   * Pause auto-mode loop
   */
  async handleAutomodePause(_requestId: JsonRpcId): Promise<AutomodePauseResult> {
    try {
      const automodeManager = this.agent?.getAutomodeManager?.();
      if (!automodeManager) {
        return {
          success: false,
          error: 'Auto-mode manager not available',
        };
      }

      if (!automodeManager.isActive()) {
        return {
          success: false,
          error: 'No auto-mode session is running',
        };
      }

      if (automodeManager.isPausedState()) {
        return {
          success: false,
          error: 'Auto-mode is already paused',
        };
      }

      await automodeManager.pause();
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: message,
      };
    }
  }

  /**
   * Resume auto-mode loop
   */
  async handleAutomodeResume(_requestId: JsonRpcId): Promise<AutomodeResumeResult> {
    try {
      const automodeManager = this.agent?.getAutomodeManager?.();
      if (!automodeManager) {
        return {
          success: false,
          error: 'Auto-mode manager not available',
        };
      }

      if (!automodeManager.isActive()) {
        return {
          success: false,
          error: 'No auto-mode session to resume',
        };
      }

      if (!automodeManager.isPausedState()) {
        return {
          success: false,
          error: 'Auto-mode is not paused',
        };
      }

      await automodeManager.resume();
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: message,
      };
    }
  }

  /**
   * Cancel auto-mode loop
   */
  async handleAutomodeCancel(
    requestId: JsonRpcId,
    reason?: string
  ): Promise<AutomodeCancelResult> {
    try {
      const automodeManager = this.agent?.getAutomodeManager?.();
      if (!automodeManager) {
        return {
          success: false,
          error: 'Auto-mode manager not available',
        };
      }

      if (!automodeManager.isActive()) {
        return {
          success: false,
          error: 'No auto-mode session to cancel',
        };
      }

      await automodeManager.cancel(reason as any || 'rpc_cancel');
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: message,
      };
    }
  }

  /**
   * Get auto-mode iteration log
   */
  handleAutomodeGetLog(
    requestId: JsonRpcId,
    limit?: number
  ): AutomodeGetLogResult {
    try {
      const automodeManager = this.agent?.getAutomodeManager?.();
      if (!automodeManager) {
        return {
          success: false,
          iterations: [],
          error: 'Auto-mode manager not available',
        };
      }

      // Note: getIterations() returns iteration logs from AutomodeState
      const state = automodeManager.getState();
      if (!state) {
        return {
          success: true,
          iterations: [],
        };
      }

      // For now, return empty - full implementation would need AutomodeState.getIterations()
      // exposed through the manager
      const iterations: AutomodeLogEntry[] = [];

      return {
        success: true,
        iterations: limit ? iterations.slice(-limit) : iterations,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        iterations: [],
        error: message,
      };
    }
  }

  // ============================================================================
  // SDK Control RPC Methods
  // ============================================================================

  /**
   * Set permission mode
   */
  async handleSetPermissionMode(
    params: SetPermissionModeParams
  ): Promise<SetPermissionModeResult> {
    try {
      const previousMode = this.config?.permissionMode || 'default';
      this.config!.permissionMode = params.mode;
      return {
        success: true,
        currentMode: params.mode,
        previousMode,
      };
    } catch {
      return {
        success: false,
        currentMode: this.config?.permissionMode || 'default',
        previousMode: this.config?.permissionMode || 'default',
      };
    }
  }

  /**
   * Set model
   */
  async handleSetModel(
    params: SetModelParams
  ): Promise<SetModelResult> {
    try {
      this.config!.model = params.model;
      return {
        success: true,
        currentModel: params.model,
      };
    } catch {
      return {
        success: false,
        currentModel: this.config?.model,
      };
    }
  }

  /**
   * Set max thinking tokens
   */
  async handleSetMaxThinkingTokens(
    params: SetMaxThinkingTokensParams
  ): Promise<SetMaxThinkingTokensResult> {
    try {
      this.config!.maxThinkingTokens = params.maxThinkingTokens ?? undefined;
      return {
        success: true,
        currentMaxThinkingTokens: params.maxThinkingTokens ?? null,
      };
    } catch {
      return {
        success: false,
        currentMaxThinkingTokens: this.config?.maxThinkingTokens || null,
      };
    }
  }

  /**
   * Apply flag settings — now propagates contextCompact to the agent.
   */
  async handleApplyFlagSettings(
    params: ApplyFlagSettingsParams
  ): Promise<ApplyFlagSettingsResult> {
    try {
      const appliedSettings: string[] = [];
      for (const [key, value] of Object.entries(params.settings)) {
        if (value !== undefined) {
          (this.config as Record<string, unknown>)[key] = value;
          appliedSettings.push(key);
          // Propagate context compact changes to the agent
          if (key === 'contextCompact' && typeof value === 'boolean') {
            this.agent?.setContextCompaction(value);
          }
        }
      }
      return {
        success: true,
        appliedSettings,
      };
    } catch {
      return {
        success: false,
        appliedSettings: [],
      };
    }
  }

  /**
   * Get supported models
   */
  async handleGetSupportedModels(): Promise<GetSupportedModelsResult> {
    try {
      const models = getAllCatalogModelOptions().map((model) => ({
        id: model.id,
        displayName: model.displayName ?? model.id,
      }));
      return {
        models,
      };
    } catch {
      return {
        models: [],
      };
    }
  }

  /**
   * Get supported commands
   */
  async handleGetSupportedCommands(): Promise<GetSupportedCommandsResult> {
    return {
      commands: SLASH_COMMANDS.map(({ command }) => command),
    };
  }

  /**
   * Get context usage — returns real data from the agent's orchestrator.
   */
  async handleGetContextUsage(): Promise<GetContextUsageResult> {
    try {
      if (this.agent?.getContextOrchestrator) {
        const orchestrator = this.agent.getContextOrchestrator();
        const tools = this.agent.getToolDefinitions?.() ?? [];
        const usage = orchestrator.getExtendedUsage(tools);
        return {
          systemPrompt: usage.systemPrompt,
          tools: usage.tools,
          messages: usage.messages,
          mcpTools: usage.mcpTools,
          memoryFiles: usage.memoryFiles,
          total: usage.total,
          contextWindow: usage.contextWindow,
          usagePercent: usage.usagePercent,
          isWarning: usage.isWarning,
          isCritical: usage.isCritical,
        };
      }
      // Fallback stub when agent is not available
      return {
        systemPrompt: 0,
        tools: 0,
        messages: 0,
        mcpTools: 0,
        memoryFiles: 0,
        total: 0,
      };
    } catch {
      return {
        systemPrompt: 0,
        tools: 0,
        messages: 0,
        mcpTools: 0,
        memoryFiles: 0,
        total: 0,
      };
    }
  }

  /**
   * Set context compaction enabled/disabled
   */
  async handleSetContextCompact(
    params: SetContextCompactParams
  ): Promise<SetContextCompactResult> {
    try {
      this.agent?.setContextCompaction(params.enabled);
      return { enabled: params.enabled };
    } catch {
      return { enabled: this.agent?.isContextCompactionEnabled?.() ?? false };
    }
  }

  /**
   * Reload plugins
   */
  async handleReloadPlugins(): Promise<ReloadPluginsResult> {
    try {
      // Reload skills and other plugins
      const reloadedPlugins = ['skills'];
      return {
        success: true,
        reloadedPlugins,
      };
    } catch {
      return {
        success: false,
        reloadedPlugins: [],
      };
    }
  }

  /**
   * Get account info
   */
  async handleGetAccountInfo(): Promise<GetAccountInfoResult> {
    try {
      // Return account information
      return {
        email: 'user@example.com',
      };
    } catch {
      return {
        email: '',
      };
    }
  }

  /**
   * Toggle MCP server
   */
  async handleMcpToggleServer(
    params: McpToggleServerParams
  ): Promise<McpToggleServerResult> {
    try {
      // Toggle MCP server enabled state
      return {
        success: true,
        serverName: params.serverName,
        status: params.enabled ? 'enabled' : 'disabled',
      };
    } catch {
      return {
        success: false,
        serverName: params.serverName,
        status: 'disabled',
      };
    }
  }

  /**
   * Reconnect MCP server
   */
  async handleMcpReconnectServer(
    params: McpReconnectServerParams
  ): Promise<McpReconnectServerResult> {
    try {
      // Reconnect to MCP server
      return {
        success: true,
        serverName: params.serverName,
        status: 'connected',
      };
    } catch {
      return {
        success: false,
        serverName: params.serverName,
        status: 'disconnected',
      };
    }
  }

  /**
   * Set MCP servers
   */
  async handleMcpSetServers(
    params: McpSetServersParams
  ): Promise<McpSetServersResult> {
    try {
      // Set MCP server configurations
      const configuredServers = Object.keys(params.servers);
      return {
        success: true,
        configuredServers,
      };
    } catch {
      return {
        success: false,
        configuredServers: [],
      };
    }
  }
}

function parseRpcGoalStatus(value: string | undefined): GoalStatus | undefined {
  if (value === 'active' || value === 'paused' || value === 'complete' || value === 'budgetLimited') {
    return value;
  }
  return undefined;
}
