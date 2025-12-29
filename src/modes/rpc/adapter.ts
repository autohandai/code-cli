/**
 * RPC Adapter
 * Wraps AutohandAgent and bridges callbacks to RPC events
 */

import type { AutohandAgent } from '../../core/agent.js';
import type { ConversationManager } from '../../core/conversationManager.js';
import type { LLMMessage, ToolOutputChunk, AgentStatusSnapshot, AgentOutputEvent, LLMToolCall } from '../../types.js';
import type {
  RPCAgentState,
  RPCMessage,
  PendingPermission,
  PromptCommand,
} from './types.js';
import {
  writeEvent,
  writeResponse,
  writeError,
  createTimestamp,
  generateId,
} from './protocol.js';

/**
 * RPC Adapter for AutohandAgent
 * Handles bidirectional communication between CLI and VS Code extension
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

    // Emit agent start event
    writeEvent({
      type: 'agent_start',
      timestamp: createTimestamp(),
      data: {
        sessionId: this.sessionId,
        model: this.model,
        workspace: this.workspace,
      },
    });
  }

  /**
   * Get current agent state
   */
  getState(): RPCAgentState {
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
  getMessages(limit?: number): RPCMessage[] {
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
   * Handle a prompt command
   */
  async handlePrompt(command: PromptCommand): Promise<boolean> {
    if (!this.agent) {
      writeResponse(command.id, 'prompt', false, undefined, 'Agent not initialized');
      return false;
    }

    if (this.status === 'processing') {
      writeResponse(command.id, 'prompt', false, undefined, 'Agent is already processing');
      return false;
    }

    this.status = 'processing';
    this.abortController = new AbortController();

    // Start a new turn
    this.currentTurnId = generateId('turn');
    writeEvent({
      type: 'turn_start',
      timestamp: createTimestamp(),
      data: { turnId: this.currentTurnId },
    });

    try {
      // Build context message if provided
      let instruction = command.message;
      if (command.context?.selection) {
        const sel = command.context.selection;
        instruction = `${command.message}\n\nContext from ${sel.file} (lines ${sel.startLine}-${sel.endLine}):\n\`\`\`\n${sel.text}\n\`\`\``;
      }

      // Run the instruction through the agent
      // We need to hook into the agent's message streaming
      this.currentMessageId = generateId('msg');
      this.currentMessageContent = '';

      writeEvent({
        type: 'message_start',
        timestamp: createTimestamp(),
        data: {
          messageId: this.currentMessageId,
          role: 'assistant',
        },
      });

      // Execute instruction
      let success = false;
      let execError: string | undefined;
      try {
        success = await this.agent.runInstruction(instruction);
      } catch (err) {
        execError = err instanceof Error ? err.message : String(err);
        success = false;
      }

      // End message
      writeEvent({
        type: 'message_end',
        timestamp: createTimestamp(),
        data: {
          messageId: this.currentMessageId!,
          content: this.currentMessageContent,
        },
      });

      // End turn
      writeEvent({
        type: 'turn_end',
        timestamp: createTimestamp(),
        data: { turnId: this.currentTurnId! },
      });

      this.status = 'idle';
      this.currentTurnId = null;
      this.currentMessageId = null;
      this.abortController = null;

      writeResponse(command.id, 'prompt', success, undefined, execError);
      return success;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      writeEvent({
        type: 'turn_end',
        timestamp: createTimestamp(),
        data: { turnId: this.currentTurnId! },
      });

      this.status = 'idle';
      this.currentTurnId = null;
      this.currentMessageId = null;
      this.abortController = null;

      writeResponse(command.id, 'prompt', false, undefined, message);
      writeError('EXECUTION_ERROR', message, true);
      return false;
    }
  }

  /**
   * Handle abort command
   */
  handleAbort(commandId: string): void {
    if (this.abortController) {
      this.abortController.abort();
      this.status = 'idle';
      writeResponse(commandId, 'abort', true);

      writeEvent({
        type: 'agent_end',
        timestamp: createTimestamp(),
        data: {
          sessionId: this.sessionId!,
          reason: 'aborted',
        },
      });
    } else {
      writeResponse(commandId, 'abort', false, undefined, 'No operation to abort');
    }
  }

  /**
   * Handle reset command
   */
  handleReset(commandId: string): void {
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

    writeResponse(commandId, 'reset', true, { sessionId: this.sessionId });

    writeEvent({
      type: 'agent_start',
      timestamp: createTimestamp(),
      data: {
        sessionId: this.sessionId,
        model: this.model,
        workspace: this.workspace,
      },
    });
  }

  /**
   * Handle get_state command
   */
  handleGetState(commandId: string): void {
    writeResponse(commandId, 'get_state', true, this.getState());
  }

  /**
   * Handle get_messages command
   */
  handleGetMessages(commandId: string, limit?: number): void {
    const messages = this.getMessages(limit);
    writeResponse(commandId, 'get_messages', true, { messages });
  }

  /**
   * Handle permission response from client
   */
  handlePermissionResponse(commandId: string, requestId: string, allowed: boolean): void {
    const pending = this.pendingPermissions.get(requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingPermissions.delete(requestId);
      pending.resolve(allowed);
      this.status = 'processing';
      writeResponse(commandId, 'permission_response', true);
    } else {
      writeResponse(commandId, 'permission_response', false, undefined, 'Permission request not found or expired');
    }
  }

  /**
   * Request permission from client (called from agent's confirmDangerousAction)
   */
  async requestPermission(
    tool: string,
    description: string,
    context: { command?: string; path?: string; args?: string[] }
  ): Promise<boolean> {
    const requestId = generateId('perm');
    this.status = 'waiting_permission';

    writeEvent({
      type: 'permission_request',
      timestamp: createTimestamp(),
      data: {
        requestId,
        tool,
        description,
        context,
      },
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingPermissions.delete(requestId);
        this.status = 'processing';
        resolve(false); // Deny on timeout
      }, 60000); // 60 second timeout

      this.pendingPermissions.set(requestId, {
        requestId,
        resolve,
        reject,
        timeout,
      });
    });
  }

  /**
   * Emit tool execution start event
   */
  emitToolStart(toolName: string, args: Record<string, unknown>): string {
    const toolId = generateId('tool');

    writeEvent({
      type: 'tool_execution_start',
      timestamp: createTimestamp(),
      data: {
        toolId,
        toolName,
        args,
      },
    });

    return toolId;
  }

  /**
   * Emit tool execution update event (streaming output)
   */
  emitToolUpdate(toolId: string, chunk: ToolOutputChunk): void {
    writeEvent({
      type: 'tool_execution_update',
      timestamp: createTimestamp(),
      data: {
        toolId,
        output: chunk.data,
        stream: chunk.stream,
      },
    });
  }

  /**
   * Emit tool execution end event
   */
  emitToolEnd(
    toolId: string,
    toolName: string,
    success: boolean,
    output?: string,
    error?: string
  ): void {
    writeEvent({
      type: 'tool_execution_end',
      timestamp: createTimestamp(),
      data: {
        toolId,
        toolName,
        success,
        output,
        error,
      },
    });
  }

  /**
   * Emit message update (streaming content)
   */
  emitMessageUpdate(delta: string, thought?: string): void {
    this.currentMessageContent += delta;

    writeEvent({
      type: 'message_update',
      timestamp: createTimestamp(),
      data: {
        messageId: this.currentMessageId,
        delta,
        thought,
      },
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

    writeEvent({
      type: 'agent_end',
      timestamp: createTimestamp(),
      data: {
        sessionId: this.sessionId!,
        reason,
      },
    });
  }

  /**
   * Handle output events from the agent
   */
  private handleAgentOutput(event: AgentOutputEvent): void {
    switch (event.type) {
      case 'thinking':
        if (event.thought) {
          writeEvent({
            type: 'message_update',
            timestamp: createTimestamp(),
            data: {
              messageId: this.currentMessageId,
              delta: '',
              thought: event.thought,
            },
          });
        }
        break;

      case 'message':
        if (event.content) {
          this.currentMessageContent = event.content;
          writeEvent({
            type: 'message_update',
            timestamp: createTimestamp(),
            data: {
              messageId: this.currentMessageId,
              delta: event.content,
            },
          });
        }
        break;

      case 'tool_start':
        if (event.toolName) {
          writeEvent({
            type: 'tool_execution_start',
            timestamp: createTimestamp(),
            data: {
              toolId: event.toolId ?? generateId('tool'),
              toolName: event.toolName,
              args: event.toolArgs ?? {},
            },
          });
        }
        break;

      case 'tool_end':
        if (event.toolName) {
          writeEvent({
            type: 'tool_execution_end',
            timestamp: createTimestamp(),
            data: {
              toolId: event.toolId ?? 'unknown',
              toolName: event.toolName,
              success: event.toolSuccess ?? true,
              output: event.toolOutput,
            },
          });
        }
        break;
    }
  }

  /**
   * Convert LLMMessage to RPCMessage
   */
  private convertMessage(msg: LLMMessage, index: number): RPCMessage {
    let toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> | undefined;

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
