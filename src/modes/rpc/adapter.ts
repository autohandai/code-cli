/**
 * RPC Adapter
 * Wraps AutohandAgent and bridges callbacks to JSON-RPC 2.0 notifications
 */

import type { AutohandAgent } from '../../core/agent.js';
import { McpClientManager } from '../../mcp/McpClientManager.js';
import type { ConversationManager } from '../../core/conversationManager.js';
import type {
  LLMMessage,
  ToolOutputChunk,
  AgentStatusSnapshot,
  AgentOutputEvent,
  LLMToolCall,
  McpServerConfigEntry,
} from '../../types.js';
import type {
  JsonRpcId,
  RpcMessage,
  PendingPermission,
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
} from './types.js';
import {
  RPC_NOTIFICATIONS,
  MAX_IMAGE_SIZE,
  isValidImageMimeType,
} from './types.js';
import { writeNotification, createTimestamp, generateId } from './protocol.js';
import { ImageManager, type ImageMimeType, supportsVision } from '../../core/ImageManager.js';

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
  private abortController: AbortController | null = null;
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

  /**
   * Initialize the adapter with an agent instance
   */
  initialize(
    agent: AutohandAgent,
    conversation: ConversationManager,
    model: string,
    workspace: string,
    mcpServerConfigs?: McpServerConfigEntry[]
  ): void {
    this.agent = agent;
    this.conversation = conversation;
    this.model = model;
    this.workspace = workspace;
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
   * Handle a prompt request
   * Returns result for JSON-RPC response
   */
  async handlePrompt(requestId: JsonRpcId, params: PromptParams): Promise<PromptResult> {
    if (!this.agent) {
      throw new Error('Agent not initialized');
    }

    if (this.status === 'processing') {
      throw new Error('Agent is already processing');
    }

    this.status = 'processing';
    this.abortController = new AbortController();

    // Start a new turn
    this.currentTurnId = generateId('turn');
    this.turnStartTime = Date.now();
    writeNotification(RPC_NOTIFICATIONS.TURN_START, {
      turnId: this.currentTurnId,
      timestamp: createTimestamp(),
    });

    try {
      // Process any attached images first
      const imagePlaceholders: string[] = [];
      process.stderr.write(`[RPC] handlePrompt: images=${params.images?.length || 0}, hasImageManager=${!!this.imageManager}, model=${this.model}\n`);

      // Check if model supports vision when images are provided
      if (params.images && params.images.length > 0) {
        if (!supportsVision(this.model)) {
          process.stderr.write(`[RPC] WARNING: Model '${this.model}' does not support vision. Images will not be processed.\n`);
          writeNotification(RPC_NOTIFICATIONS.ERROR, {
            code: -32000,
            message: `Model '${this.model}' does not support image inputs. Please use a vision-capable model like claude-3.5-sonnet, gpt-4o, or gemini-1.5-pro.`,
            recoverable: true,
            timestamp: createTimestamp(),
          });
          // Continue without images - still process the text
        }
      }

      if (params.images && params.images.length > 0 && this.imageManager && supportsVision(this.model)) {
        process.stderr.write(`[RPC] Processing ${params.images.length} images\n`);
        for (const img of params.images) {
          try {
            process.stderr.write(`[RPC] Image: mimeType=${img.mimeType}, dataLength=${img.data?.length || 0}\n`);

            // Validate MIME type
            if (!isValidImageMimeType(img.mimeType)) {
              process.stderr.write(`[RPC] Invalid MIME type: ${img.mimeType}\n`);
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
            process.stderr.write(`[RPC] Image decoded: ${data.length} bytes\n`);

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
          process.stderr.write(`[RPC] Image placeholders: ${imagePlaceholders.join(', ')}\n`);
          instruction = `${imagePlaceholders.join(' ')}\n\n${instruction}`;
        } else if (params.images && params.images.length > 0) {
          process.stderr.write(`[RPC] WARNING: Images provided but no placeholders generated!\n`);
        }

        if (params.context?.selection) {
          const sel = params.context.selection;
          instruction = `${instruction}\n\nContext from ${sel.file} (lines ${sel.startLine}-${sel.endLine}):\n\`\`\`\n${sel.text}\n\`\`\``;
        }
      }

      // Start message
      this.currentMessageId = generateId('msg');
      this.currentMessageContent = '';

      writeNotification(RPC_NOTIFICATIONS.MESSAGE_START, {
        messageId: this.currentMessageId,
        role: 'assistant',
        timestamp: createTimestamp(),
      });

      // Execute instruction
      let success = false;
      try {
        // Debug: log instruction being executed
        process.stderr.write(`[RPC DEBUG] Executing instruction: ${instruction.substring(0, 100)}\n`);

        // Check if it's a slash command and handle it directly
        if (isSlashCmd) {
          const { command, args } = this.agent.parseSlashCommand(instruction);
          process.stderr.write(`[RPC DEBUG] Handling slash command: ${command}, args: ${JSON.stringify(args)}\n`);

          // First check if the command is supported
          if (this.agent.isSlashCommandSupported(command)) {
            const result = await this.agent.handleSlashCommand(command, args);
            if (result !== null) {
              // Slash command returned data
              this.currentMessageContent = result;
              writeNotification(RPC_NOTIFICATIONS.MESSAGE_UPDATE, {
                messageId: this.currentMessageId,
                delta: result,
                timestamp: createTimestamp(),
              });
            } else {
              // Command was handled but returned null (output went to console)
              // This is success - the command was executed
              this.currentMessageContent = `Command ${command} executed.`;
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
          process.stderr.write(`[RPC DEBUG] previewModeEnabled=${this.previewModeEnabled}, hasFileManager=${!!fileManager}\n`);
          if (this.previewModeEnabled && fileManager) {
            this.currentChangesBatchId = generateId('changes');
            process.stderr.write(`[RPC DEBUG] Entering preview mode with batchId=${this.currentChangesBatchId}\n`);
            this.emitChangesBatchStart(this.currentChangesBatchId);
            fileManager.enterPreviewMode(this.currentChangesBatchId, (change) => {
              // Emit each change as it's batched
              this.emitChangesBatchUpdate(this.currentChangesBatchId!, {
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
            success = await this.agent.runInstruction(instruction);
          } finally {
            // Always emit batch end and handle preview mode cleanup
            if (this.previewModeEnabled && fileManager && this.currentChangesBatchId) {
              const pendingChanges = fileManager.getPendingChanges();
              process.stderr.write(`[RPC DEBUG] Turn finished, pendingChanges=${pendingChanges.length}, files=${pendingChanges.map(c => c.filePath).join(', ')}\n`);
              this.emitChangesBatchEnd(this.currentChangesBatchId, pendingChanges.length);

              if (pendingChanges.length === 0) {
                // No changes to preview - exit preview mode immediately
                fileManager.exitPreviewMode();
              }
              // If there are changes, keep preview mode active until user decision
              // fileManager.exitPreviewMode() will be called in handleChangesDecision
              this.currentChangesBatchId = null;
            }
          }
        }

        process.stderr.write(`[RPC DEBUG] Instruction completed, success=${success}, content length=${this.currentMessageContent.length}\n`);

        // Fire stop hook after turn completes (matching command mode behavior)
        // Wrapped in its own try-catch to ensure MESSAGE_END and TURN_END are always emitted
        const turnDuration = this.turnStartTime ? Date.now() - this.turnStartTime : 0;
        try {
          const hookManager = this.agent?.getHookManager?.();
          process.stderr.write(`[RPC DEBUG] Hook execution: hookManager=${!!hookManager}\n`);
          if (hookManager) {
            const snapshot = this.agent?.getStatusSnapshot();
            process.stderr.write(`[RPC DEBUG] Executing stop hooks...\n`);
            await hookManager.executeHooks('stop', {
              sessionId: this.sessionId || undefined,
              turnDuration,
              tokensUsed: snapshot?.tokensUsed ?? 0,
            });
            process.stderr.write(`[RPC DEBUG] Stop hooks completed\n`);

            // Emit HOOK_STOP notification so UI can update button state
            this.emitHookStop(
              snapshot?.tokensUsed ?? 0,
              0, // toolCallsCount - not tracked per turn currently
              turnDuration
            );
            process.stderr.write(`[RPC DEBUG] HOOK_STOP emitted\n`);
          }
        } catch (hookErr) {
          // Log but don't let hook errors block MESSAGE_END and TURN_END
          const hookErrMsg = hookErr instanceof Error ? hookErr.message : String(hookErr);
          process.stderr.write(`[RPC DEBUG] Hook execution error (non-blocking): ${hookErrMsg}\n`);
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const errorStack = err instanceof Error ? err.stack : '';
        // Debug: log the error
        process.stderr.write(`[RPC DEBUG] Error during runInstruction: ${errorMessage}\n`);
        process.stderr.write(`[RPC DEBUG] Stack: ${errorStack}\n`);
        // Emit error notification
        writeNotification(RPC_NOTIFICATIONS.ERROR, {
          code: -32000,
          message: errorMessage,
          recoverable: true,
          timestamp: createTimestamp(),
        });
        success = false;
      }

      // End message
      process.stderr.write(`[RPC DEBUG] Emitting MESSAGE_END, messageId=${this.currentMessageId}\n`);
      writeNotification(RPC_NOTIFICATIONS.MESSAGE_END, {
        messageId: this.currentMessageId!,
        content: this.currentMessageContent,
        timestamp: createTimestamp(),
      });
      process.stderr.write(`[RPC DEBUG] MESSAGE_END emitted successfully\n`);

      // End turn with stats
      const durationMs = this.turnStartTime ? Date.now() - this.turnStartTime : undefined;
      const snapshot = this.agent?.getStatusSnapshot();
      process.stderr.write(`[RPC DEBUG] Emitting TURN_END, turnId=${this.currentTurnId}\n`);
      writeNotification(RPC_NOTIFICATIONS.TURN_END, {
        turnId: this.currentTurnId!,
        timestamp: createTimestamp(),
        contextPercent: this.contextPercent,
        tokensUsed: snapshot?.tokensUsed,
        durationMs,
      });
      process.stderr.write(`[RPC DEBUG] TURN_END emitted successfully\n`);

      this.status = 'idle';
      this.currentTurnId = null;
      this.turnStartTime = null;
      this.currentMessageId = null;
      this.abortController = null;

      return { success };
    } catch (error) {
      // Emit MESSAGE_END and TURN_END even on outer error
      const errorMsg = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[RPC DEBUG] Outer catch - error: ${errorMsg}\n`);

      // End message first (if we started one)
      if (this.currentMessageId) {
        process.stderr.write(`[RPC DEBUG] Emitting MESSAGE_END from outer catch, messageId=${this.currentMessageId}\n`);
        writeNotification(RPC_NOTIFICATIONS.MESSAGE_END, {
          messageId: this.currentMessageId,
          content: this.currentMessageContent,
          timestamp: createTimestamp(),
        });
      }

      // End turn with stats
      const durationMs = this.turnStartTime ? Date.now() - this.turnStartTime : undefined;
      const snapshot = this.agent?.getStatusSnapshot();
      process.stderr.write(`[RPC DEBUG] Emitting TURN_END from outer catch, turnId=${this.currentTurnId}\n`);
      writeNotification(RPC_NOTIFICATIONS.TURN_END, {
        turnId: this.currentTurnId!,
        timestamp: createTimestamp(),
        contextPercent: this.contextPercent,
        tokensUsed: snapshot?.tokensUsed,
        durationMs,
      });

      this.status = 'idle';
      this.currentTurnId = null;
      this.turnStartTime = null;
      this.currentMessageId = null;
      this.abortController = null;

      throw error;
    }
  }

  /**
   * Handle abort request (can be notification with null id for instant abort)
   */
  handleAbort(_requestId: JsonRpcId | null): AbortResult {
    process.stderr.write(`[RPC] handleAbort called, abortController=${!!this.abortController}\n`);

    // Clear ALL pending permissions - they're no longer relevant after abort
    for (const [permId, pending] of this.pendingPermissions) {
      process.stderr.write(`[RPC] Clearing pending permission ${permId} due to abort\n`);
      if (pending.ackTimeout) clearTimeout(pending.ackTimeout);
      if (pending.responseTimeout) clearTimeout(pending.responseTimeout);
      pending.resolve(false); // Deny - operation is being aborted
    }
    this.pendingPermissions.clear();

    if (this.abortController) {
      this.abortController.abort();
      this.status = 'idle';

      // End current message if one is in progress
      if (this.currentMessageId) {
        // Send clean content with aborted flag - UI will render the abort message
        writeNotification(RPC_NOTIFICATIONS.MESSAGE_END, {
          messageId: this.currentMessageId,
          content: this.currentMessageContent, // No marker - UI handles display
          aborted: true,
          timestamp: createTimestamp(),
        });
      }

      // End turn if one is in progress
      if (this.currentTurnId) {
        const durationMs = this.turnStartTime ? Date.now() - this.turnStartTime : undefined;
        const snapshot = this.agent?.getStatusSnapshot();
        writeNotification(RPC_NOTIFICATIONS.TURN_END, {
          turnId: this.currentTurnId,
          timestamp: createTimestamp(),
          contextPercent: this.contextPercent,
          tokensUsed: snapshot?.tokensUsed,
          durationMs,
        });
      }

      // Reset state
      this.currentTurnId = null;
      this.turnStartTime = null;
      this.currentMessageId = null;
      this.currentMessageContent = '';
      this.abortController = null;

      return { success: true };
    }

    return { success: false };
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

  /**
   * Handle permission response from client
   */
  handlePermissionResponse(
    requestId: JsonRpcId,
    permRequestId: string,
    allowed: boolean
  ): PermissionResponseResult {
    process.stderr.write(`[RPC] handlePermissionResponse called: permRequestId=${permRequestId}, allowed=${allowed}, pending keys=${Array.from(this.pendingPermissions.keys()).join(',')}\n`);
    const pending = this.pendingPermissions.get(permRequestId);
    if (pending) {
      process.stderr.write(`[RPC] Found pending permission, resolving with allowed=${allowed}\n`);
      // Clear both timeouts
      if (pending.ackTimeout) {
        clearTimeout(pending.ackTimeout);
      }
      if (pending.responseTimeout) {
        clearTimeout(pending.responseTimeout);
      }
      this.pendingPermissions.delete(permRequestId);
      pending.resolve(allowed);
      this.status = 'processing';
      process.stderr.write(`[RPC] Permission resolved, status set to processing\n`);
      return { success: true };
    }

    process.stderr.write(`[RPC] Permission response for unknown request ${permRequestId}\n`);
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
  ): Promise<boolean> {
    const permRequestId = generateId('perm');
    this.status = 'waiting_permission';
    process.stderr.write(`[RPC] requestPermission: tool=${tool}, permRequestId=${permRequestId}\n`);

    writeNotification(RPC_NOTIFICATIONS.PERMISSION_REQUEST, {
      requestId: permRequestId,
      tool,
      description,
      context,
      timestamp: createTimestamp(),
    });

    return new Promise((resolve, reject) => {
      // Phase 1: Wait for acknowledgment (30s)
      // If extension doesn't acknowledge, something is wrong (extension dead/disconnected)
      const ackTimeout = setTimeout(() => {
        this.pendingPermissions.delete(permRequestId);
        this.status = 'processing';
        process.stderr.write(`[RPC] Permission ack timeout for ${permRequestId}\n`);
        resolve(false); // Deny - extension not responding
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
      process.stderr.write(`[RPC] Permission ack for unknown request ${permRequestId}\n`);
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
      process.stderr.write(`[RPC] Permission response timeout for ${permRequestId} (1 hour)\n`);
      pending.resolve(false);
    }, 3600000); // 1 hour

    process.stderr.write(`[RPC] Permission acknowledged for ${permRequestId}\n`);
    return { success: true };
  }

  /**
   * Emit tool execution start notification
   */
  emitToolStart(toolName: string, args: Record<string, unknown>): string {
    const toolId = generateId('tool');

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
    this.currentMessageContent += delta;

    writeNotification(RPC_NOTIFICATIONS.MESSAGE_UPDATE, {
      messageId: this.currentMessageId,
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
    process.stderr.write(`[RPC DEBUG] emitChangesBatchStart: batchId=${batchId}\n`);
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
    process.stderr.write(`[RPC DEBUG] emitChangesBatchUpdate: batchId=${batchId}, changeId=${change.id}, file=${change.filePath}\n`);
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
    process.stderr.write(`[RPC DEBUG] emitChangesBatchEnd: batchId=${batchId}, changeCount=${changeCount}\n`);
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
  emitHookPostResponse(tokensUsed: number, toolCallsCount: number, duration: number): void {
    writeNotification(RPC_NOTIFICATIONS.HOOK_POST_RESPONSE, {
      tokensUsed,
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
  emitHookStop(tokensUsed: number, toolCallsCount: number, duration: number): void {
    writeNotification(RPC_NOTIFICATIONS.HOOK_STOP, {
      tokensUsed,
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
        process.stderr.write('[RPC] Force refreshing skills registry from GitHub\n');
        registry = await fetcher.fetchRegistry();
        await cache.setRegistry(registry);
      } else {
        // Try cache first
        const cached = await cache.getRegistry();
        if (cached) {
          registry = cached;
        } else {
          process.stderr.write('[RPC] Fetching skills registry from GitHub\n');
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
      process.stderr.write(`[RPC] Failed to get skills registry: ${message}\n`);
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
        process.stderr.write('[RPC] Fetching skills registry for install\n');
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
      const isInstalled = await skillsRegistry.isSkillInstalled(skill.name, targetDir);
      if (isInstalled && !params.force) {
        return {
          success: false,
          error: `Skill "${skill.name}" already exists. Use force=true to overwrite.`,
        };
      }

      process.stderr.write(`[RPC] Installing skill ${skill.name} to ${params.scope}\n`);

      // Try to get from cache first
      let files = await cache.getSkillDirectory(skill.id);
      if (!files) {
        process.stderr.write(`[RPC] Fetching skill files from GitHub\n`);
        files = await fetcher.fetchSkillDirectory(skill);
        await cache.setSkillDirectory(skill.id, files);
      }

      // Import using the registry
      const result = await skillsRegistry.importCommunitySkillDirectory(
        skill.name,
        files,
        targetDir,
        isInstalled // force if overwriting
      );

      if (result.success) {
        process.stderr.write(`[RPC] Successfully installed ${skill.name}\n`);
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
      process.stderr.write(`[RPC] Failed to install skill: ${message}\n`);
      return {
        success: false,
        error: message,
      };
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
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[RPC] Failed to get history: ${message}\n`);
      return { sessions: [], currentPage: 1, totalPages: 0, totalItems: 0 };
    }
  }

  /**
   * Set YOLO (unrestricted) mode with pattern and optional timeout
   */
  handleYoloSet(_requestId: JsonRpcId, params: YoloSetParams): YoloSetResult {
    const permissionManager = this.agent?.getPermissionManager?.();
    if (!permissionManager) {
      return { success: false };
    }

    try {
      // Set unrestricted mode
      permissionManager.setMode('unrestricted');
      process.stderr.write(`[RPC] YOLO mode enabled with pattern: ${params.pattern}\n`);

      let expiresIn: number | undefined;
      if (params.timeoutSeconds && params.timeoutSeconds > 0) {
        expiresIn = params.timeoutSeconds;
        // Auto-revert to interactive mode after timeout
        setTimeout(() => {
          permissionManager.setMode('interactive');
          process.stderr.write(`[RPC] YOLO mode expired, reverted to interactive\n`);
        }, params.timeoutSeconds * 1000);
      }

      return { success: true, expiresIn };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[RPC] Failed to set YOLO mode: ${message}\n`);
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

    process.stderr.write(
      `[RPC] MCP bridge: registered ${this.vscodeTools.size} VS Code tools\n`
    );

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
      process.stderr.write(
        `[RPC] MCP bridge: invoke response for unknown request ${params.requestId}\n`
      );
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
  shutdown(reason: 'completed' | 'aborted' | 'error' = 'completed'): void {
    // Cancel any pending permissions
    for (const [, pending] of this.pendingPermissions) {
      if (pending.ackTimeout) {
        clearTimeout(pending.ackTimeout);
      }
      if (pending.responseTimeout) {
        clearTimeout(pending.responseTimeout);
      }
      pending.reject(new Error('Adapter shutdown'));
    }
    this.pendingPermissions.clear();

    // Cancel any pending VS Code tool invocations
    for (const [, pending] of this.pendingVscodeInvocations) {
      pending.reject(new Error('Adapter shutdown'));
    }
    this.pendingVscodeInvocations.clear();

    // Abort any running operation
    if (this.abortController) {
      this.abortController.abort();
    }

    writeNotification(RPC_NOTIFICATIONS.AGENT_END, {
      sessionId: this.sessionId!,
      reason,
      timestamp: createTimestamp(),
    });
  }

  /**
   * Handle output events from the agent
   */
  private handleAgentOutput(event: AgentOutputEvent): void {
    process.stderr.write(`[RPC DEBUG] handleAgentOutput: type=${event.type}, content length=${event.content?.length ?? 0}\n`);
    switch (event.type) {
      case 'thinking':
        if (event.thought) {
          process.stderr.write(`[RPC DEBUG] Emitting thinking: ${event.thought.substring(0, 50)}...\n`);
          writeNotification(RPC_NOTIFICATIONS.MESSAGE_UPDATE, {
            messageId: this.currentMessageId,
            delta: '',
            thought: event.thought,
            timestamp: createTimestamp(),
          });
        }
        break;

      case 'message':
        if (event.content) {
          process.stderr.write(`[RPC DEBUG] Emitting message content: ${event.content.substring(0, 100)}...\n`);
          this.currentMessageContent = event.content;
          writeNotification(RPC_NOTIFICATIONS.MESSAGE_UPDATE, {
            messageId: this.currentMessageId,
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
            success: event.toolSuccess ?? true,
            output: event.toolOutput,
            timestamp: createTimestamp(),
          });
        }
        break;

      case 'error':
        if (event.content) {
          process.stderr.write(`[RPC DEBUG] Emitting error: ${event.content.substring(0, 100)}...\n`);

          // Classify the error for appropriate UI treatment
          const errorType = this.classifyError(event.content);

          // Update message content with error (include icon based on type)
          const icon = errorType.icon;
          this.currentMessageContent = `${icon} ${event.content}`;
          writeNotification(RPC_NOTIFICATIONS.MESSAGE_UPDATE, {
            messageId: this.currentMessageId,
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
   * Classify error messages for appropriate UI treatment
   */
  private classifyError(message: string): {
    type: string;
    code: number;
    icon: string;
    recoverable: boolean;
  } {
    const lowerMessage = message.toLowerCase();

    // Payment/billing errors
    if (
      lowerMessage.includes('payment required') ||
      lowerMessage.includes('insufficient') ||
      lowerMessage.includes('balance') ||
      lowerMessage.includes('billing') ||
      lowerMessage.includes("can only afford")
    ) {
      return { type: 'payment', code: 402, icon: '💳', recoverable: false };
    }

    // Authentication errors
    if (
      lowerMessage.includes('authentication') ||
      lowerMessage.includes('unauthorized') ||
      lowerMessage.includes('invalid api key') ||
      lowerMessage.includes('api key')
    ) {
      return { type: 'auth', code: 401, icon: '🔐', recoverable: false };
    }

    // Rate limiting
    if (
      lowerMessage.includes('rate limit') ||
      lowerMessage.includes('too many requests') ||
      lowerMessage.includes('quota')
    ) {
      return { type: 'rate_limit', code: 429, icon: '⏱️', recoverable: true };
    }

    // Model/access errors
    if (
      lowerMessage.includes('model not found') ||
      lowerMessage.includes('access denied') ||
      lowerMessage.includes('permission')
    ) {
      return { type: 'model', code: 403, icon: '🤖', recoverable: true };
    }

    // Context/payload too large
    if (
      lowerMessage.includes('too large') ||
      lowerMessage.includes('context') ||
      lowerMessage.includes('payload') ||
      lowerMessage.includes('malformed')
    ) {
      return { type: 'context', code: 400, icon: '📦', recoverable: true };
    }

    // Network/timeout errors
    if (
      lowerMessage.includes('timeout') ||
      lowerMessage.includes('network') ||
      lowerMessage.includes('connection') ||
      lowerMessage.includes('econnrefused') ||
      lowerMessage.includes('enotfound')
    ) {
      return { type: 'network', code: 504, icon: '🌐', recoverable: true };
    }

    // Server errors
    if (
      lowerMessage.includes('internal error') ||
      lowerMessage.includes('server error') ||
      lowerMessage.includes('unavailable') ||
      lowerMessage.includes('overloaded')
    ) {
      return { type: 'server', code: 500, icon: '🔧', recoverable: true };
    }

    // Default: generic error
    return { type: 'unknown', code: -32000, icon: '⚠️', recoverable: true };
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
      process.stderr.write(`[RPC] Auto-mode start requested: ${params.prompt}\n`);

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
}
