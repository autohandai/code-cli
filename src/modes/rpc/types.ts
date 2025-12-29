/**
 * RPC Mode Type Definitions
 * JSON-RPC protocol types for VS Code extension communication
 */

// ============================================================================
// Command Types (Client -> CLI)
// ============================================================================

export type RPCCommandType =
  | 'prompt'
  | 'abort'
  | 'reset'
  | 'get_state'
  | 'get_messages'
  | 'permission_response';

export interface RPCCommand {
  type: RPCCommandType;
  id: string;
  timestamp?: string;
}

export interface PromptCommand extends RPCCommand {
  type: 'prompt';
  message: string;
  context?: {
    files?: string[];
    selection?: {
      file: string;
      startLine: number;
      endLine: number;
      text: string;
    };
  };
}

export interface AbortCommand extends RPCCommand {
  type: 'abort';
}

export interface ResetCommand extends RPCCommand {
  type: 'reset';
}

export interface GetStateCommand extends RPCCommand {
  type: 'get_state';
}

export interface GetMessagesCommand extends RPCCommand {
  type: 'get_messages';
  limit?: number;
}

export interface PermissionResponseCommand extends RPCCommand {
  type: 'permission_response';
  requestId: string;
  allowed: boolean;
  remember?: boolean;
}

// ============================================================================
// Event Types (CLI -> Client)
// ============================================================================

export type RPCEventType =
  | 'agent_start'
  | 'agent_end'
  | 'turn_start'
  | 'turn_end'
  | 'message_start'
  | 'message_update'
  | 'message_end'
  | 'tool_execution_start'
  | 'tool_execution_update'
  | 'tool_execution_end'
  | 'permission_request'
  | 'error'
  | 'response';

export interface RPCEvent {
  type: RPCEventType;
  timestamp: string;
  data?: unknown;
}

export interface AgentStartEvent extends RPCEvent {
  type: 'agent_start';
  data: {
    sessionId: string;
    model: string;
    workspace: string;
  };
}

export interface AgentEndEvent extends RPCEvent {
  type: 'agent_end';
  data: {
    sessionId: string;
    reason: 'completed' | 'aborted' | 'error';
  };
}

export interface TurnStartEvent extends RPCEvent {
  type: 'turn_start';
  data: {
    turnId: string;
  };
}

export interface TurnEndEvent extends RPCEvent {
  type: 'turn_end';
  data: {
    turnId: string;
  };
}

export interface MessageStartEvent extends RPCEvent {
  type: 'message_start';
  data: {
    messageId: string;
    role: 'assistant';
  };
}

export interface MessageUpdateEvent extends RPCEvent {
  type: 'message_update';
  data: {
    messageId?: string;
    delta: string;
    thought?: string;
  };
}

export interface MessageEndEvent extends RPCEvent {
  type: 'message_end';
  data: {
    messageId: string;
    content: string;
  };
}

export interface ToolExecutionStartEvent extends RPCEvent {
  type: 'tool_execution_start';
  data: {
    toolId: string;
    toolName: string;
    args: Record<string, unknown>;
  };
}

export interface ToolExecutionUpdateEvent extends RPCEvent {
  type: 'tool_execution_update';
  data: {
    toolId: string;
    output: string;
    stream: 'stdout' | 'stderr';
  };
}

export interface ToolExecutionEndEvent extends RPCEvent {
  type: 'tool_execution_end';
  data: {
    toolId: string;
    toolName: string;
    success: boolean;
    output?: string;
    error?: string;
  };
}

export interface PermissionRequestEvent extends RPCEvent {
  type: 'permission_request';
  data: {
    requestId: string;
    tool: string;
    description: string;
    context: {
      command?: string;
      path?: string;
      args?: string[];
    };
  };
}

export interface ErrorEvent extends RPCEvent {
  type: 'error';
  data: {
    code: string;
    message: string;
    recoverable: boolean;
  };
}

export interface ResponseEvent extends RPCEvent {
  type: 'response';
  data: {
    id: string;
    command: RPCCommandType;
    success: boolean;
    error?: string;
    result?: unknown;
  };
}

// ============================================================================
// State Types
// ============================================================================

export interface RPCAgentState {
  status: 'idle' | 'processing' | 'waiting_permission';
  sessionId: string | null;
  model: string;
  workspace: string;
  contextPercent: number;
  messageCount: number;
}

export interface RPCMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
  }>;
}

// ============================================================================
// Permission Handling
// ============================================================================

export interface PendingPermission {
  requestId: string;
  resolve: (allowed: boolean) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}
