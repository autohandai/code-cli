/**
 * RPC Adapter
 * Wraps AutohandAgent and bridges callbacks to JSON-RPC 2.0 notifications
 */

import type { AutohandAgent } from '../../core/agent.js';
import type { ConversationManager } from '../../core/conversationManager.js';
import type {
  LLMMessage,
  ToolOutputChunk,
  AgentStatusSnapshot,
  AgentOutputEvent,
  LLMToolCall,
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
  RpcImageAttachment,
} from './types.js';
import {
  RPC_NOTIFICATIONS,
  MAX_IMAGE_SIZE,
  isValidImageMimeType,
} from './types.js';
import { writeNotification, createTimestamp, generateId } from './protocol.js';
import { ImageManager, type ImageMimeType } from '../../core/ImageManager.js';

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
  private currentMessageId: string | null = null;
  private currentMessageContent = '';
  private pendingPermissions = new Map<string, PendingPermission>();
  private abortController: AbortController | null = null;
  private status: 'idle' | 'processing' | 'waiting_permission' = 'idle';
  private model = '';
  private workspace = '';
  private contextPercent = 0;

  /**
   * Initialize the adapter with an agent instance
   */
  initialize(
    agent: AutohandAgent,
    conversation: ConversationManager,
    model: string,
    workspace: string
  ): void {
    this.agent = agent;
    this.conversation = conversation;
    this.model = model;
    this.workspace = workspace;
    this.sessionId = generateId('session');

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
    writeNotification(RPC_NOTIFICATIONS.TURN_START, {
      turnId: this.currentTurnId,
      timestamp: createTimestamp(),
    });

    try {
      // Process any attached images first
      const imagePlaceholders: string[] = [];
      if (params.images && params.images.length > 0 && this.imageManager) {
        for (const img of params.images) {
          try {
            // Validate MIME type
            if (!isValidImageMimeType(img.mimeType)) {
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

      // Prepend image placeholders if any were processed
      if (imagePlaceholders.length > 0) {
        instruction = `${imagePlaceholders.join(' ')}\n\n${instruction}`;
      }

      if (params.context?.selection) {
        const sel = params.context.selection;
        instruction = `${instruction}\n\nContext from ${sel.file} (lines ${sel.startLine}-${sel.endLine}):\n\`\`\`\n${sel.text}\n\`\`\``;
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
        success = await this.agent.runInstruction(instruction);
        process.stderr.write(`[RPC DEBUG] Instruction completed, success=${success}, content length=${this.currentMessageContent.length}\n`);
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
      writeNotification(RPC_NOTIFICATIONS.MESSAGE_END, {
        messageId: this.currentMessageId!,
        content: this.currentMessageContent,
        timestamp: createTimestamp(),
      });

      // End turn with context percent
      writeNotification(RPC_NOTIFICATIONS.TURN_END, {
        turnId: this.currentTurnId!,
        timestamp: createTimestamp(),
        contextPercent: this.contextPercent,
      });

      this.status = 'idle';
      this.currentTurnId = null;
      this.currentMessageId = null;
      this.abortController = null;

      return { success };
    } catch (error) {
      // End turn on error with context percent
      writeNotification(RPC_NOTIFICATIONS.TURN_END, {
        turnId: this.currentTurnId!,
        timestamp: createTimestamp(),
        contextPercent: this.contextPercent,
      });

      this.status = 'idle';
      this.currentTurnId = null;
      this.currentMessageId = null;
      this.abortController = null;

      throw error;
    }
  }

  /**
   * Handle abort request
   */
  handleAbort(requestId: JsonRpcId): AbortResult {
    if (this.abortController) {
      this.abortController.abort();
      this.status = 'idle';

      // End current message if one is in progress
      if (this.currentMessageId) {
        writeNotification(RPC_NOTIFICATIONS.MESSAGE_END, {
          messageId: this.currentMessageId,
          content: this.currentMessageContent + '\n\n*[Aborted by user]*',
          timestamp: createTimestamp(),
        });
      }

      // End turn if one is in progress
      if (this.currentTurnId) {
        writeNotification(RPC_NOTIFICATIONS.TURN_END, {
          turnId: this.currentTurnId,
          timestamp: createTimestamp(),
          contextPercent: this.contextPercent,
        });
      }

      // Reset state
      this.currentTurnId = null;
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
  handleReset(requestId: JsonRpcId): ResetResult {
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
  handleGetState(requestId: JsonRpcId): GetStateResult {
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
    const pending = this.pendingPermissions.get(permRequestId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingPermissions.delete(permRequestId);
      pending.resolve(allowed);
      this.status = 'processing';
      return { success: true };
    }

    return { success: false };
  }

  /**
   * Request permission from client (called from agent's confirmDangerousAction)
   */
  async requestPermission(
    tool: string,
    description: string,
    context: { command?: string; path?: string; args?: string[] }
  ): Promise<boolean> {
    const permRequestId = generateId('perm');
    this.status = 'waiting_permission';

    writeNotification(RPC_NOTIFICATIONS.PERMISSION_REQUEST, {
      requestId: permRequestId,
      tool,
      description,
      context,
      timestamp: createTimestamp(),
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingPermissions.delete(permRequestId);
        this.status = 'processing';
        resolve(false); // Deny on timeout
      }, 60000); // 60 second timeout

      this.pendingPermissions.set(permRequestId, {
        requestId: permRequestId,
        resolve,
        reject,
        timeout,
      });
    });
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

  /**
   * Shutdown the adapter
   */
  shutdown(reason: 'completed' | 'aborted' | 'error' = 'completed'): void {
    // Cancel any pending permissions
    for (const [, pending] of this.pendingPermissions) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Adapter shutdown'));
    }
    this.pendingPermissions.clear();

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
}
