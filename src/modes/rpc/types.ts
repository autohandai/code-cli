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
  // Multi-file change preview
  CHANGES_DECISION: 'autohand.changesDecision',
  // Skills management (non-interactive for RPC mode)
  GET_SKILLS_REGISTRY: 'autohand.getSkillsRegistry',
  INSTALL_SKILL: 'autohand.installSkill',
  // Auto-mode control
  AUTOMODE_START: 'autohand.automode.start',
  AUTOMODE_STATUS: 'autohand.automode.status',
  AUTOMODE_PAUSE: 'autohand.automode.pause',
  AUTOMODE_RESUME: 'autohand.automode.resume',
  AUTOMODE_CANCEL: 'autohand.automode.cancel',
  AUTOMODE_GET_LOG: 'autohand.automode.getLog',
  // Plan mode control
  PLAN_MODE_SET: 'autohand.planModeSet',
  // Session history
  GET_HISTORY: 'autohand.getHistory',
  // YOLO mode control
  YOLO_SET: 'autohand.yoloSet',
  // MCP (Model Context Protocol) management
  MCP_LIST_SERVERS: 'autohand.mcp.listServers',
  MCP_LIST_TOOLS: 'autohand.mcp.listTools',
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
  // Multi-file change preview notifications
  CHANGES_BATCH_START: 'autohand.changesBatchStart',
  CHANGES_BATCH_UPDATE: 'autohand.changesBatchUpdate',
  CHANGES_BATCH_END: 'autohand.changesBatchEnd',
  // Hook lifecycle notifications
  HOOK_PRE_TOOL: 'autohand.hook.preTool',
  HOOK_POST_TOOL: 'autohand.hook.postTool',
  HOOK_FILE_MODIFIED: 'autohand.hook.fileModified',
  HOOK_PRE_PROMPT: 'autohand.hook.prePrompt',
  HOOK_POST_RESPONSE: 'autohand.hook.postResponse',
  HOOK_SESSION_ERROR: 'autohand.hook.sessionError',
  HOOK_STOP: 'autohand.hook.stop',
  HOOK_SESSION_START: 'autohand.hook.sessionStart',
  HOOK_SESSION_END: 'autohand.hook.sessionEnd',
  HOOK_SUBAGENT_STOP: 'autohand.hook.subagentStop',
  HOOK_PERMISSION_REQUEST: 'autohand.hook.permissionRequest',
  HOOK_NOTIFICATION: 'autohand.hook.notification',
  // Auto-mode lifecycle notifications
  AUTOMODE_START: 'autohand.automode.start',
  AUTOMODE_ITERATION: 'autohand.automode.iteration',
  AUTOMODE_CHECKPOINT: 'autohand.automode.checkpoint',
  AUTOMODE_PAUSE: 'autohand.automode.pause',
  AUTOMODE_RESUME: 'autohand.automode.resume',
  AUTOMODE_CANCEL: 'autohand.automode.cancel',
  AUTOMODE_COMPLETE: 'autohand.automode.complete',
  AUTOMODE_ERROR: 'autohand.automode.error',
  // Pipe mode notifications
  PIPE_OUTPUT: 'autohand.pipe.output',
  PIPE_COMPLETE: 'autohand.pipe.complete',
  PIPE_ERROR: 'autohand.pipe.error',
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
  /** Thinking/reasoning depth level */
  thinkingLevel?: 'none' | 'normal' | 'extended';
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
// Plan Mode Types
// ============================================================================

export interface PlanModeSetParams {
  enabled: boolean;
}

export interface PlanModeSetResult {
  success: boolean;
}

// ============================================================================
// YOLO Mode Types
// ============================================================================

export interface YoloSetParams {
  pattern: string;
  timeoutSeconds?: number;
}

export interface YoloSetResult {
  success: boolean;
  expiresIn?: number;
}

// ============================================================================
// Session History Types (RPC Mode)
// ============================================================================

/**
 * Request params for getting paginated session history
 */
export interface GetHistoryParams {
  page?: number;
  pageSize?: number;
}

/**
 * A history entry returned via RPC
 */
export interface RpcHistoryEntry {
  sessionId: string;
  createdAt: string;
  lastActiveAt: string;
  projectName: string;
  model: string;
  messageCount: number;
  status: 'active' | 'completed' | 'crashed';
}

/**
 * Response for paginated session history
 */
export interface GetHistoryResult {
  sessions: RpcHistoryEntry[];
  currentPage: number;
  totalPages: number;
  totalItems: number;
}

// ============================================================================
// Skills Management Types (RPC Mode)
// ============================================================================

/**
 * Community skill info for RPC responses
 */
export interface RpcCommunitySkill {
  id: string;
  name: string;
  description: string;
  category: string;
  tags?: string[];
  rating?: number;
  downloadCount?: number;
  isFeatured?: boolean;
  isCurated?: boolean;
}

/**
 * Get skills registry request params (no params needed)
 */
export interface GetSkillsRegistryParams {
  /** Force refresh from GitHub (ignore cache) */
  forceRefresh?: boolean;
}

/**
 * Get skills registry response
 */
export interface GetSkillsRegistryResult {
  success: boolean;
  skills: RpcCommunitySkill[];
  categories: Array<{ name: string; count: number }>;
  error?: string;
}

/**
 * Install skill request params
 */
export interface InstallSkillParams {
  /** Skill name or ID to install */
  skillName: string;
  /** Install scope: 'user' (~/.autohand/skills) or 'project' (.autohand/skills) */
  scope: 'user' | 'project';
  /** Force overwrite if skill already exists */
  force?: boolean;
}

/**
 * Install skill response
 */
export interface InstallSkillResult {
  success: boolean;
  skillName?: string;
  path?: string;
  error?: string;
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
  tokensUsed?: number;
  durationMs?: number;
  contextPercent?: number;
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
// Hook Lifecycle Notification Types
// ============================================================================

/**
 * Notification params for pre-tool hook event
 * Fired before a tool begins execution
 */
export interface HookPreToolNotificationParams {
  toolId: string;
  toolName: string;
  args: Record<string, unknown>;
  timestamp: string;
}

/**
 * Notification params for post-tool hook event
 * Fired after a tool completes execution
 */
export interface HookPostToolNotificationParams {
  toolId: string;
  toolName: string;
  success: boolean;
  duration: number;
  output?: string;
  timestamp: string;
}

/**
 * Notification params for file-modified hook event
 * Fired when a file is created, modified, or deleted
 */
export interface HookFileModifiedNotificationParams {
  filePath: string;
  changeType: 'create' | 'modify' | 'delete';
  toolId: string;
  timestamp: string;
}

/**
 * Notification params for pre-prompt hook event
 * Fired before sending a prompt to the LLM
 */
export interface HookPrePromptNotificationParams {
  instruction: string;
  mentionedFiles: string[];
  timestamp: string;
}

/**
 * Notification params for post-response hook event
 * Fired after receiving a response from the LLM
 */
export interface HookPostResponseNotificationParams {
  tokensUsed: number;
  toolCallsCount: number;
  duration: number;
  timestamp: string;
}

/**
 * Notification params for session-error hook event
 * Fired when an error occurs during agent execution
 */
export interface HookSessionErrorNotificationParams {
  error: string;
  code?: string;
  context?: Record<string, unknown>;
  timestamp: string;
}

// ============================================================================
// Multi-File Change Preview Types
// ============================================================================

/**
 * Proposed file change for preview
 */
export interface ProposedFileChange {
  id: string;
  filePath: string;
  changeType: 'create' | 'modify' | 'delete';
  originalContent: string;
  proposedContent: string;
  description: string;
  toolId: string;
  toolName: string;
}

export interface ChangesBatchStartParams {
  batchId: string;
  turnId: string;
  timestamp: string;
}

export interface ChangesBatchUpdateParams {
  batchId: string;
  change: ProposedFileChange;
  timestamp: string;
}

export interface ChangesBatchEndParams {
  batchId: string;
  changeCount: number;
  timestamp: string;
}

export interface ChangesDecisionParams {
  batchId: string;
  action: 'accept_all' | 'reject_all' | 'accept_selected';
  selectedChangeIds?: string[];
}

export interface ChangesDecisionResult {
  success: boolean;
  appliedCount: number;
  skippedCount: number;
  errors?: Array<{ changeId: string; error: string }>;
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

// ============================================================================
// Auto-Mode RPC Types
// ============================================================================

/**
 * Auto-mode start request params
 */
export interface AutomodeStartParams {
  /** Task description/prompt */
  prompt: string;
  /** Maximum iterations (default: 50) */
  maxIterations?: number;
  /** Completion marker text (default: "DONE") */
  completionPromise?: string;
  /** Use git worktree isolation (default: true) */
  useWorktree?: boolean;
  /** Checkpoint interval in iterations (default: 5) */
  checkpointInterval?: number;
  /** Maximum runtime in minutes (default: 120) */
  maxRuntime?: number;
  /** Maximum cost in dollars (default: 10) */
  maxCost?: number;
}

/**
 * Auto-mode start result
 */
export interface AutomodeStartResult {
  success: boolean;
  sessionId?: string;
  error?: string;
}

/**
 * Auto-mode status result
 */
export interface AutomodeStatusResult {
  active: boolean;
  paused: boolean;
  state?: {
    sessionId: string;
    status: 'running' | 'paused' | 'completed' | 'cancelled' | 'failed';
    currentIteration: number;
    maxIterations: number;
    filesCreated: number;
    filesModified: number;
    branch?: string;
    lastCheckpoint?: {
      commit: string;
      message: string;
      timestamp: string;
    };
  };
}

/**
 * Auto-mode pause result
 */
export interface AutomodePauseResult {
  success: boolean;
  error?: string;
}

/**
 * Auto-mode resume result
 */
export interface AutomodeResumeResult {
  success: boolean;
  error?: string;
}

/**
 * Auto-mode cancel params
 */
export interface AutomodeCancelParams {
  /** Reason for cancellation */
  reason?: string;
}

/**
 * Auto-mode cancel result
 */
export interface AutomodeCancelResult {
  success: boolean;
  error?: string;
}

/**
 * Auto-mode get log params
 */
export interface AutomodeGetLogParams {
  /** Limit number of iterations returned */
  limit?: number;
}

/**
 * Auto-mode iteration log entry
 */
export interface AutomodeLogEntry {
  iteration: number;
  timestamp: string;
  actions: string[];
  tokensUsed?: number;
  cost?: number;
  checkpoint?: {
    commit: string;
    message: string;
  };
}

/**
 * Auto-mode get log result
 */
export interface AutomodeGetLogResult {
  success: boolean;
  iterations: AutomodeLogEntry[];
  error?: string;
}

// ============================================================================
// Auto-Mode Notification Types
// ============================================================================

/**
 * Auto-mode start notification
 */
export interface AutomodeStartNotificationParams {
  sessionId: string;
  prompt: string;
  maxIterations: number;
  timestamp: string;
}

/**
 * Auto-mode iteration notification
 */
export interface AutomodeIterationNotificationParams {
  sessionId: string;
  iteration: number;
  actions: string[];
  tokensUsed?: number;
  timestamp: string;
}

/**
 * Auto-mode checkpoint notification
 */
export interface AutomodeCheckpointNotificationParams {
  sessionId: string;
  iteration: number;
  commit: string;
  timestamp: string;
}

/**
 * Auto-mode pause notification
 */
export interface AutomodePauseNotificationParams {
  sessionId: string;
  iteration: number;
  timestamp: string;
}

/**
 * Auto-mode resume notification
 */
export interface AutomodeResumeNotificationParams {
  sessionId: string;
  iteration: number;
  timestamp: string;
}

/**
 * Auto-mode cancel notification
 */
export interface AutomodeCancelNotificationParams {
  sessionId: string;
  reason: string;
  iteration: number;
  timestamp: string;
}

/**
 * Auto-mode complete notification
 */
export interface AutomodeCompleteNotificationParams {
  sessionId: string;
  iterations: number;
  filesCreated: number;
  filesModified: number;
  timestamp: string;
}

/**
 * Auto-mode error notification
 */
export interface AutomodeErrorNotificationParams {
  sessionId: string;
  error: string;
  timestamp: string;
}

// ============================================================================
// Pipe Mode Notification Types
// ============================================================================

/**
 * Notification params for pipe mode output events.
 * Sent to RPC clients when pipe mode produces output.
 */
export interface PipeOutputNotificationParams {
  type: 'progress' | 'result' | 'error';
  content: string;
  timestamp: string;
}



// ============================================================================
// MCP (Model Context Protocol) RPC Types
// ============================================================================

/**
 * Result for autohand.mcp.listServers
 * Returns a list of all known MCP servers and their connection status.
 */
export interface McpListServersResult {
  servers: Array<{ name: string; status: string; toolCount: number }>;
}

/**
 * Params for autohand.mcp.listTools
 * Optionally filter tools by server name.
 */
export interface McpListToolsParams {
  serverName?: string;
}

/**
 * Result for autohand.mcp.listTools
 * Returns a list of all available MCP tools, optionally filtered by server.
 */
export interface McpListToolsResult {
  tools: Array<{ name: string; description: string; serverName: string }>;
}
