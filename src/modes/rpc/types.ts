/**
 * RPC Mode Type Definitions
 * JSON-RPC 2.0 protocol types for VS Code extension communication
 * Spec: https://www.jsonrpc.org/specification
 */

// ============================================================================
// JSON-RPC 2.0 Base Types
// ============================================================================

/**
 * JSON-RPC 2.0 Request object
 * A request without an id is a Notification (no response expected)
 */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: JsonRpcParams;
  id?: JsonRpcId;
}

/**
 * JSON-RPC 2.0 Response object
 * Must contain either result or error, never both
 */
export interface JsonRpcResponse {
  jsonrpc: '2.0';
  result?: unknown;
  error?: JsonRpcError;
  id: JsonRpcId;
}

/**
 * JSON-RPC 2.0 Error object
 */
export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/**
 * Valid ID types for JSON-RPC 2.0
 * null is used when the request id cannot be determined (e.g., parse error)
 */
export type JsonRpcId = string | number | null;

/**
 * Valid params types for JSON-RPC 2.0
 * Can be object (named params) or array (positional params)
 */
export type JsonRpcParams = Record<string, unknown> | unknown[];

/**
 * A batch is an array of requests/responses
 */
export type JsonRpcBatch<T> = T[];

// ============================================================================
// JSON-RPC 2.0 Standard Error Codes
// ============================================================================

export const JSON_RPC_ERROR_CODES = {
  // Standard JSON-RPC 2.0 errors
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,

  // Server errors (reserved for implementation-defined errors: -32000 to -32099)
  EXECUTION_ERROR: -32000,
  PERMISSION_DENIED: -32001,
  TIMEOUT: -32002,
  AGENT_BUSY: -32003,
  ABORTED: -32004,
} as const;

export type JsonRpcErrorCode = (typeof JSON_RPC_ERROR_CODES)[keyof typeof JSON_RPC_ERROR_CODES];

// ============================================================================
// Autohand RPC Methods
// ============================================================================

/**
 * Available RPC methods (Client -> Server requests)
 */
export const RPC_METHODS = {
  // Client -> Server requests
  PROMPT: 'autohand.prompt',
  ABORT: 'autohand.abort',
  RESET: 'autohand.reset',
  GET_STATE: 'autohand.getState',
  GET_MESSAGES: 'autohand.getMessages',
  PERMISSION_RESPONSE: 'autohand.permissionResponse',
  PERMISSION_ACKNOWLEDGED: 'autohand.permissionAcknowledged',
} as const;

export type RpcMethod = (typeof RPC_METHODS)[keyof typeof RPC_METHODS];

/**
 * Available notification methods (Server -> Client notifications)
 */
export const RPC_NOTIFICATIONS = {
  AGENT_START: 'autohand.agentStart',
  AGENT_END: 'autohand.agentEnd',
  TURN_START: 'autohand.turnStart',
  TURN_END: 'autohand.turnEnd',
  MESSAGE_START: 'autohand.messageStart',
  MESSAGE_UPDATE: 'autohand.messageUpdate',
  MESSAGE_END: 'autohand.messageEnd',
  TOOL_START: 'autohand.toolStart',
  TOOL_UPDATE: 'autohand.toolUpdate',
  TOOL_END: 'autohand.toolEnd',
  PERMISSION_REQUEST: 'autohand.permissionRequest',
  ERROR: 'autohand.error',
} as const;

export type RpcNotification = (typeof RPC_NOTIFICATIONS)[keyof typeof RPC_NOTIFICATIONS];

// ============================================================================
// Request Parameter Types
// ============================================================================

/**
 * Supported image MIME types for multimodal prompts
 */
export type RpcImageMimeType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

/**
 * Image attachment for multimodal RPC prompts
 * Used to send images via the VS Code extension
 */
export interface RpcImageAttachment {
  /** Base64-encoded image data (without data: URL prefix) */
  data: string;
  /** Image MIME type */
  mimeType: RpcImageMimeType;
  /** Optional filename for display */
  filename?: string;
}

/**
 * Maximum image size in bytes (10MB)
 */
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

/**
 * Valid image MIME types
 */
export const VALID_IMAGE_MIME_TYPES: RpcImageMimeType[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
];

/**
 * Type guard to check if a MIME type is valid
 */
export function isValidImageMimeType(mimeType: string): mimeType is RpcImageMimeType {
  return VALID_IMAGE_MIME_TYPES.includes(mimeType as RpcImageMimeType);
}

export interface PromptParams {
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
  /** Image attachments for multimodal prompts */
  images?: RpcImageAttachment[];
}

export interface AbortParams {
  // No params needed
}

export interface ResetParams {
  // No params needed
}

export interface GetStateParams {
  // No params needed
}

export interface GetMessagesParams {
  limit?: number;
}

export interface PermissionResponseParams {
  requestId: string;
  allowed: boolean;
  remember?: boolean;
}

export interface PermissionAcknowledgedParams {
  requestId: string;
}

// ============================================================================
// Notification Parameter Types (Server -> Client)
// ============================================================================

export interface AgentStartParams {
  sessionId: string;
  model: string;
  workspace: string;
  timestamp: string;
}

export interface AgentEndParams {
  sessionId: string;
  reason: 'completed' | 'aborted' | 'error';
  timestamp: string;
}

export interface TurnStartParams {
  turnId: string;
  timestamp: string;
}

export interface TurnEndParams {
  turnId: string;
  timestamp: string;
}

export interface MessageStartParams {
  messageId: string;
  role: 'assistant';
  timestamp: string;
}

export interface MessageUpdateParams {
  messageId?: string;
  delta: string;
  thought?: string;
  timestamp: string;
}

export interface MessageEndParams {
  messageId: string;
  content: string;
  timestamp: string;
}

export interface ToolStartParams {
  toolId: string;
  toolName: string;
  args: Record<string, unknown>;
  timestamp: string;
}

export interface ToolUpdateParams {
  toolId: string;
  output: string;
  stream: 'stdout' | 'stderr';
  timestamp: string;
}

export interface ToolEndParams {
  toolId: string;
  toolName: string;
  success: boolean;
  output?: string;
  error?: string;
  timestamp: string;
}

export interface PermissionRequestParams {
  requestId: string;
  tool: string;
  description: string;
  context: {
    command?: string;
    path?: string;
    args?: string[];
  };
  timestamp: string;
}

export interface ErrorNotificationParams {
  code: number;
  message: string;
  recoverable: boolean;
  timestamp: string;
}

// ============================================================================
// Response Result Types
// ============================================================================

export interface PromptResult {
  success: boolean;
}

export interface AbortResult {
  success: boolean;
}

export interface ResetResult {
  sessionId: string;
}

export interface GetStateResult {
  status: 'idle' | 'processing' | 'waiting_permission';
  sessionId: string | null;
  model: string;
  workspace: string;
  contextPercent: number;
  messageCount: number;
}

export interface GetMessagesResult {
  messages: RpcMessage[];
}

export interface PermissionResponseResult {
  success: boolean;
}

export interface PermissionAcknowledgedResult {
  success: boolean;
}

// ============================================================================
// State Types
// ============================================================================

export interface RpcMessage {
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
  /** Short timeout for acknowledgment (30s) - cleared when ack received */
  ackTimeout: NodeJS.Timeout | null;
  /** Long timeout for user response (1 hour) - set after ack received */
  responseTimeout: NodeJS.Timeout | null;
  /** Whether extension has acknowledged receiving the request */
  acknowledged: boolean;
}

// ============================================================================
// Type Guards
// ============================================================================

export function isJsonRpcRequest(obj: unknown): obj is JsonRpcRequest {
  if (typeof obj !== 'object' || obj === null) return false;
  const req = obj as Record<string, unknown>;
  return req.jsonrpc === '2.0' && typeof req.method === 'string';
}

export function isJsonRpcResponse(obj: unknown): obj is JsonRpcResponse {
  if (typeof obj !== 'object' || obj === null) return false;
  const res = obj as Record<string, unknown>;
  return res.jsonrpc === '2.0' && ('result' in res || 'error' in res);
}

export function isJsonRpcBatch(obj: unknown): obj is JsonRpcBatch<JsonRpcRequest | JsonRpcResponse> {
  return Array.isArray(obj) && obj.length > 0;
}

export function isNotification(request: JsonRpcRequest): boolean {
  return request.id === undefined;
}

// ============================================================================
// Helper Functions
// ============================================================================

export function createRequest(
  method: string,
  params?: JsonRpcParams,
  id?: JsonRpcId
): JsonRpcRequest {
  const request: JsonRpcRequest = {
    jsonrpc: '2.0',
    method,
  };
  if (params !== undefined) {
    request.params = params;
  }
  if (id !== undefined) {
    request.id = id;
  }
  return request;
}

export function createResponse(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    result,
    id,
  };
}

export function createErrorResponse(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown
): JsonRpcResponse {
  const response: JsonRpcResponse = {
    jsonrpc: '2.0',
    error: { code, message },
    id,
  };
  if (data !== undefined) {
    response.error!.data = data;
  }
  return response;
}

export function createNotification(method: string, params?: JsonRpcParams): JsonRpcRequest {
  const notification: JsonRpcRequest = {
    jsonrpc: '2.0',
    method,
  };
  if (params !== undefined) {
    notification.params = params;
  }
  // Notifications have no id
  return notification;
}
