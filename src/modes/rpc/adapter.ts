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
} from './types.js';
import { RPC_NOTIFICATIONS } from './types.js';
import { writeNotification, createTimestamp, generateId } from './protocol.js';

/**
 * RPC Adapter for AutohandAgent
 * Handles bidirectional JSON-RPC 2.0 communication between CLI and VS Code extension
 */
export class RPCAdapter {
  private agent: AutohandAgent | null = null;
  private conversation: ConversationManager | null = null;
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
      // Build context message if provided
      let instruction = params.message;
      if (params.context?.selection) {
        const sel = params.context.selection;
        instruction = `${params.message}\n\nContext from ${sel.file} (lines ${sel.startLine}-${sel.endLine}):\n\`\`\`\n${sel.text}\n\`\`\``;
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
        success = await this.agent.runInstruction(instruction);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
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

      // End turn
      writeNotification(RPC_NOTIFICATIONS.TURN_END, {
        turnId: this.currentTurnId!,
        timestamp: createTimestamp(),
      });

      this.status = 'idle';
      this.currentTurnId = null;
      this.currentMessageId = null;
      this.abortController = null;

      return { success };
    } catch (error) {
      // End turn on error
      writeNotification(RPC_NOTIFICATIONS.TURN_END, {
        turnId: this.currentTurnId!,
        timestamp: createTimestamp(),
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

      writeNotification(RPC_NOTIFICATIONS.AGENT_END, {
        sessionId: this.sessionId!,
        reason: 'aborted',
        timestamp: createTimestamp(),
      });

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
    switch (event.type) {
      case 'thinking':
        if (event.thought) {
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
    }
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
