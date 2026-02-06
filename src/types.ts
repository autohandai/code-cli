/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Ora } from 'ora';

// InkRenderer type defined inline to avoid tsx dev mode issues with .tsx imports
interface InkRendererInterface {
  start(): void;
  stop(): void;
  setWorking(isWorking: boolean, status?: string): void;
  setStatus(status: string): void;
  setElapsed(elapsed: string): void;
  setTokens(tokens: string): void;
  addToolOutput(tool: string, success: boolean, output: string): void;
  addToolOutputs(outputs: Array<{ tool: string; success: boolean; output: string }>): void;
  clearToolOutputs(): void;
  setThinking(thought: string | null): void;
  addQueuedInstruction(instruction: string): void;
  dequeueInstruction(): string | undefined;
  hasQueuedInstructions(): boolean;
  getQueueCount(): number;
  setFinalResponse(response: string): void;
  reset(): void;
}

type Primitive = string | number | boolean | null;

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export type ProviderName = 'openrouter' | 'ollama' | 'llamacpp' | 'openai' | 'mlx' | 'llmgateway';

export interface ProviderSettings {
  apiKey?: string;
  baseUrl?: string;
  port?: number;
  model: string;
}

export interface OpenRouterSettings extends ProviderSettings {
  apiKey: string;
}

export interface LLMGatewaySettings extends ProviderSettings {
  apiKey: string;
}

export interface WorkspaceSettings {
  defaultRoot?: string;
  allowDangerousOps?: boolean;
}

export interface UISettings {
  /** Theme name: 'dark', 'light', or custom theme from ~/.autohand/themes/*.json */
  theme?: string;
  autoConfirm?: boolean;
  /** Max characters to display from read/search tool output (full content still sent to the model) */
  readFileCharLimit?: number;
  /** Show notification when work is completed (default: true) */
  showCompletionNotification?: boolean;
  /** Show LLM thinking/reasoning process (default: true) */
  showThinking?: boolean;
  /** Use Ink-based renderer for flicker-free UI (experimental, default: false) */
  useInkRenderer?: boolean;
  /** Ring terminal bell when task completes - shows badge on terminal tab (default: true) */
  terminalBell?: boolean;
  /** Check for CLI updates on startup (default: true) */
  checkForUpdates?: boolean;
  /** Hours between update checks (default: 24) */
  updateCheckInterval?: number;
  /** Display language locale (e.g., 'en', 'zh-cn', 'fr') */
  locale?: string;
}

export interface AgentSettings {
  /** Maximum iterations per user request (default: 100) */
  maxIterations?: number;
  /** Enable request queue - allow typing while agent works (default: true) */
  enableRequestQueue?: boolean;
  /** Maximum session failure retries before giving up (default: 3) */
  sessionRetryLimit?: number;
  /** Delay in milliseconds between retries (default: 1000) */
  sessionRetryDelay?: number;
  /** Enable debug output (default: false) */
  debug?: boolean;
}

export interface TelemetrySettings {
  /** Enable/disable telemetry (default: false, opt-in) */
  enabled?: boolean;
  /** API endpoint (default: https://api.autohand.ai) */
  apiBaseUrl?: string;
  /** Enable session sync to cloud (default: false, requires telemetry enabled) */
  enableSessionSync?: boolean;
}

export type PermissionMode = 'interactive' | 'unrestricted' | 'restricted' | 'external';

export interface PermissionRule {
  tool: string;
  pattern?: string;
  action: 'allow' | 'deny' | 'prompt';
}

export interface PermissionSettings {
  /** Permission mode: interactive (default), unrestricted (no prompts), restricted (deny all dangerous), external (callback) */
  mode?: PermissionMode;
  /** Commands/tools that never require approval (e.g., "run_command:npm *") */
  whitelist?: string[];
  /** Commands/tools that are always blocked (e.g., "run_command:rm -rf *") */
  blacklist?: string[];
  /** Custom rules for fine-grained control */
  rules?: PermissionRule[];
  /** Remember user decisions for this session (default: true) */
  rememberSession?: boolean;
}

export interface NetworkSettings {
  /** Maximum retry attempts for failed requests (default: 3, max: 5) */
  maxRetries?: number;
  /** Timeout in milliseconds for requests (default: 30000) */
  timeout?: number;
  /** Delay between retries in milliseconds (default: 1000) */
  retryDelay?: number;
}

export interface ExternalAgentsConfig {
  enabled?: boolean;
  paths?: string[];
}

/** Authenticated user information */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar?: string;
}

/** Auth settings stored in config */
export interface AuthSettings {
  token?: string;
  user?: AuthUser;
  expiresAt?: string;
}

export interface CommunitySkillsSettings {
  /** Enable community skills features (default: true) */
  enabled?: boolean;
  /** Show skill suggestions on startup when no vendor skills exist (default: true) */
  showSuggestionsOnStartup?: boolean;
  /** Automatically backup discovered vendor skills to API (default: true) */
  autoBackup?: boolean;
}

// ============ Auto-Mode Types ============

/** Status of an auto-mode session */
export type AutomodeStatus = 'running' | 'paused' | 'completed' | 'cancelled' | 'failed';

/** Cancel reason for auto-mode */
export type AutomodeCancelReason =
  | 'user_escape'      // ESC key pressed
  | 'user_cancel'      // /automode cancel command
  | 'hook_cancel'      // Cancelled via hook
  | 'rpc_cancel'       // Cancelled via RPC call
  | 'acp_cancel'       // Cancelled via ACP
  | 'max_iterations'   // Hit iteration limit
  | 'max_runtime'      // Hit runtime limit
  | 'max_cost'         // Hit cost limit
  | 'circuit_breaker'  // Circuit breaker triggered
  | 'completion'       // Completion promise detected
  | 'error';           // Error occurred

/** Auto-mode session state (stored in .autohand/automode.local.md) */
export interface AutomodeSessionState {
  /** Session ID */
  sessionId: string;
  /** Original prompt */
  prompt: string;
  /** Start timestamp */
  startedAt: string;
  /** Current iteration */
  currentIteration: number;
  /** Maximum iterations */
  maxIterations: number;
  /** Current status */
  status: AutomodeStatus;
  /** Git branch name */
  branch?: string;
  /** Worktree path (if using worktree) */
  worktreePath?: string;
  /** Last checkpoint commit */
  lastCheckpoint?: {
    commit: string;
    message: string;
    timestamp: string;
  };
  /** Files created during session */
  filesCreated: number;
  /** Files modified during session */
  filesModified: number;
  /** Completion promise to detect */
  completionPromise: string;
  /** Cancel reason if cancelled */
  cancelReason?: AutomodeCancelReason;
  /** Error message if failed */
  errorMessage?: string;
}

/** Iteration log entry for changelog */
export interface AutomodeIterationLog {
  iteration: number;
  timestamp: string;
  actions: string[];
  checkpoint?: {
    commit: string;
    message: string;
  };
  tokensUsed?: number;
  cost?: number;
}

/** Circuit breaker state */
export interface AutomodeCircuitBreaker {
  /** Consecutive iterations with no file changes */
  noProgressCount: number;
  /** Consecutive iterations with same error output */
  sameErrorCount: number;
  /** Last error hash for comparison */
  lastErrorHash?: string;
  /** Consecutive test-only iterations */
  testOnlyCount: number;
}

/** Share settings in config */
export interface ShareSettings {
  /** Enable/disable /share command (default: true) */
  enabled?: boolean;
}

/** Settings sync configuration */
export interface SyncSettings {
  /** Enable/disable sync (default: true for logged users) */
  enabled?: boolean;
  /** Sync interval in milliseconds (default: 300000 = 5 min) */
  interval?: number;
  /** Glob patterns to exclude from sync */
  exclude?: string[];
  /** Include telemetry data in sync (requires user consent, default: false) */
  includeTelemetry?: boolean;
  /** Include feedback data in sync (requires user consent, default: false) */
  includeFeedback?: boolean;
}

/** Auto-mode settings in config */
export interface AutomodeSettings {
  /** Default max iterations (default: 50) */
  maxIterations?: number;
  /** Default max runtime in minutes (default: 120) */
  maxRuntime?: number;
  /** Default max cost in dollars (default: 10) */
  maxCost?: number;
  /** Default checkpoint interval (default: 5) */
  checkpointInterval?: number;
  /** Default completion promise text (default: "DONE") */
  completionPromise?: string;
  /** Use git worktree by default (default: true) */
  useWorktree?: boolean;
  /** Circuit breaker: max no-progress iterations (default: 3) */
  noProgressThreshold?: number;
  /** Circuit breaker: max same-error iterations (default: 5) */
  sameErrorThreshold?: number;
  /** Circuit breaker: max test-only iterations (default: 3) */
  testOnlyThreshold?: number;
}

// ============ Hooks System Types ============

/** Hook events that can be subscribed to */
export type HookEvent =
  | 'pre-tool'
  | 'post-tool'
  | 'file-modified'
  | 'pre-prompt'
  | 'stop'              // Agent finished responding (turn complete)
  | 'post-response'     // Alias for 'stop' (backward compatibility)
  | 'session-error'
  | 'subagent-stop'     // Subagent (Task tool) finished
  | 'session-start'     // Session begins (startup, resume, clear)
  | 'session-end'       // Session ends (quit, exit)
  | 'permission-request' // Permission dialog shown
  | 'notification'      // Notification sent to user
  // Auto-mode events
  | 'automode:start'    // Auto-mode loop started
  | 'automode:iteration' // Each iteration of auto-mode loop
  | 'automode:checkpoint' // Git commit checkpoint made
  | 'automode:pause'    // Auto-mode loop paused
  | 'automode:resume'   // Auto-mode loop resumed
  | 'automode:cancel'   // Auto-mode loop cancelled (trigger to cancel)
  | 'automode:complete' // Auto-mode loop completed successfully
  | 'automode:error';   // Auto-mode error occurred

/** Filter to limit when a hook fires */
export interface HookFilter {
  /** Only fire for specific tools (e.g., ["run_command", "write_file"]) */
  tool?: string[];
  /** Only fire for specific file paths (glob patterns like "src/**.ts") */
  path?: string[];
}

/** Hook definition for config-based hooks */
export interface HookDefinition {
  /** Event to hook into */
  event: HookEvent;
  /** Shell command to execute (receives context via env vars and JSON via stdin) */
  command: string;
  /** Description for /hooks display */
  description?: string;
  /** Whether hook is enabled (default: true) */
  enabled?: boolean;
  /** Timeout in ms (default: 5000) */
  timeout?: number;
  /** Run async without blocking (default: false) */
  async?: boolean;
  /** Regex pattern to match tool names, notification types, session types, etc. */
  matcher?: string;
  /** Filter to specific tools or paths */
  filter?: HookFilter;
}

/** Hooks configuration settings */
export interface HooksSettings {
  /** Enable/disable hooks globally (default: true) */
  enabled?: boolean;
  /** Registered hook definitions */
  hooks?: HookDefinition[];
}

/** Hook response for control flow decisions (parsed from stdout JSON) */
export interface HookResponse {
  /** Decision for tool/permission hooks: allow, deny, ask, or block */
  decision?: 'allow' | 'deny' | 'ask' | 'block';
  /** Reason for decision (shown to agent or user) */
  reason?: string;
  /** Whether to continue execution (false stops the agent) */
  continue?: boolean;
  /** Message shown when continue is false */
  stopReason?: string;
  /** Modified tool input (for pre-tool/permission-request hooks) */
  updatedInput?: Record<string, unknown>;
  /** Additional context to add to conversation */
  additionalContext?: string;
}

export interface AutohandConfig {
  provider?: ProviderName;
  openrouter?: OpenRouterSettings;
  ollama?: ProviderSettings;
  llamacpp?: ProviderSettings;
  openai?: ProviderSettings;
  mlx?: ProviderSettings;
  llmgateway?: LLMGatewaySettings;
  workspace?: WorkspaceSettings;
  ui?: UISettings;
  agent?: AgentSettings;
  telemetry?: TelemetrySettings;
  permissions?: PermissionSettings;
  network?: NetworkSettings;
  externalAgents?: ExternalAgentsConfig;
  api?: {
    baseUrl?: string;
    companySecret?: string;
  };
  /** Authentication settings */
  auth?: AuthSettings;
  /** Community skills settings */
  communitySkills?: CommunitySkillsSettings;
  /** Hooks system settings */
  hooks?: HooksSettings;
  /** Auto-mode settings */
  automode?: AutomodeSettings;
  /** Share settings */
  share?: ShareSettings;
  /** Settings sync configuration (syncs ~/.autohand/ to cloud for logged users) */
  sync?: SyncSettings;
  /** Web search provider settings */
  search?: SearchSettings;
}

/** Supported web search providers */
export type SearchProvider = 'brave' | 'duckduckgo' | 'parallel';

/** Web search provider settings */
export interface SearchSettings {
  /** Active search provider (default: duckduckgo) */
  provider?: SearchProvider;
  /** Brave Search API key */
  braveApiKey?: string;
  /** Parallel.ai API key */
  parallelApiKey?: string;
}

export interface LoadedConfig extends AutohandConfig {
  configPath: string;
  /** True if config was just created (first run) */
  isNewConfig?: boolean;
}

/** Client context determines which tools are available */
export type ClientContext = 'cli' | 'slack' | 'api' | 'restricted';

export interface CLIOptions {
  prompt?: string;
  path?: string;
  yes?: boolean;
  dryRun?: boolean;
  debug?: boolean;
  model?: string;
  config?: string;
  temperature?: number;
  resumeSessionId?: string;
  /** Run in unrestricted mode - no approval prompts */
  unrestricted?: boolean;
  /** Run in restricted mode - deny all dangerous operations */
  restricted?: boolean;
  /** Client context for tool filtering (default: 'cli') */
  clientContext?: ClientContext;
  /** Auto-commit with LLM-generated message (runs lint & test first) */
  autoCommit?: boolean;
  /** Auto-generate skills based on project analysis */
  autoSkill?: boolean;
  /** Display current permission settings and exit */
  permissions?: boolean;
  /** Sign in to Autohand account */
  login?: boolean;
  /** Sign out of Autohand account */
  logout?: boolean;
  /** Enable/disable settings sync (default: true for logged users, false otherwise) */
  syncSettings?: boolean;
  /** Generate git patch without applying changes */
  patch?: boolean;
  /** Output file for patch (default: stdout) */
  output?: string;
  // Auto-mode options
  /** Enable auto-mode autonomous loop */
  autoMode?: string;
  /** Max iterations for auto-mode (default: 50) */
  maxIterations?: number;
  /** Completion promise text to detect (default: "DONE") */
  completionPromise?: string;
  /** Disable git worktree isolation */
  noWorktree?: boolean;
  /** Checkpoint interval (default: 5) */
  checkpointInterval?: number;
  /** Max runtime in minutes (default: 120) */
  maxRuntime?: number;
  /** Max API cost in dollars (default: 10) */
  maxCost?: number;
  /** Additional directories to include in workspace scope */
  addDir?: string[];
  /** Display language override (e.g., 'en', 'zh-cn', 'fr') */
  displayLanguage?: string;
  /** Enable/disable context compaction (default: true) */
  contextCompact?: boolean;
  /** Web search provider (brave, duckduckgo, parallel) */
  searchEngine?: SearchProvider;
  /** Replace entire system prompt (inline string or file path) */
  sysPrompt?: string;
  /** Append to system prompt (inline string or file path) */
  appendSysPrompt?: string;
  /** Thinking/reasoning depth level (none, normal, extended) */
  thinking?: string | boolean;
  /** Granular auto-approve pattern (e.g., 'allow:read,write') */
  yolo?: string;
  /** Timeout in seconds for auto-approve mode */
  timeout?: number;
}

export interface PromptContext {
  workspaceRoot: string;
  gitStatus?: string;
  recentFiles: string[];
  extraNotes?: string;
}

/** Message priority for context management - higher priority messages are retained longer */
export type MessagePriority = 'critical' | 'high' | 'medium' | 'low';

/** Metadata for smart context compression */
export interface MessageMetadata {
  /** Files mentioned or read in this message */
  files?: string[];
  /** Tools used in this message */
  tools?: string[];
  /** Whether this contains a user decision or preference */
  isDecision?: boolean;
  /** Whether this contains error information */
  isError?: boolean;
  /** Original token count before compression */
  originalTokens?: number;
  /** Whether this message was compressed */
  isCompressed?: boolean;
}

/**
 * Text content part for multimodal messages
 */
export interface TextContentPart {
  type: 'text';
  text: string;
}

/**
 * Image content part for multimodal messages (OpenAI/OpenRouter format)
 */
export interface ImageContentPart {
  type: 'image_url';
  image_url: {
    url: string; // data:image/...;base64,... format
  };
}

/**
 * Content parts for multimodal messages
 */
export type ContentPart = TextContentPart | ImageContentPart;

export interface LLMMessage {
  role: MessageRole;
  content: string;
  name?: string;
  /** Tool call ID for tool response messages (required when role is 'tool') */
  tool_call_id?: string;
  /** Tool calls made by the assistant (included when role is 'assistant' and model invoked tools) */
  tool_calls?: LLMToolCall[];
  /** Priority for context management (default: medium) */
  priority?: MessagePriority;
  /** Metadata for smart compression */
  metadata?: MessageMetadata;
}

/**
 * Message with multimodal content for API requests
 * Used when converting LLMMessage to API format with images
 */
export interface MultimodalMessage {
  role: MessageRole;
  content: string | ContentPart[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: LLMToolCall[];
}

/**
 * Function/tool definition for LLM function calling
 * Compatible with OpenAI/OpenRouter function calling API
 */
export interface FunctionDefinition {
  name: string;
  description: string;
  parameters?: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
      items?: { type: string };
    }>;
    required?: string[];
  };
}

/**
 * Tool call returned by the LLM
 */
export interface LLMToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;  // JSON string of arguments
  };
}

/**
 * Tool choice option for function calling
 */
export type ToolChoice =
  | 'auto'      // LLM decides whether to call a function
  | 'required'  // LLM must call at least one function
  | 'none'      // LLM should not call any function
  | { type: 'function'; function: { name: string } };  // Force specific function

/** Thinking/reasoning depth level for LLM requests */
export type ThinkingLevel = 'none' | 'normal' | 'extended';

export interface LLMRequest {
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  /** Tool/function definitions for function calling */
  tools?: FunctionDefinition[];
  /** How the model should choose which tool to use */
  toolChoice?: ToolChoice;
  model?: string;
  signal?: AbortSignal;
  /** Thinking/reasoning depth level (default: 'normal') */
  thinkingLevel?: ThinkingLevel;
}

/** Token usage statistics from LLM response */
export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LLMResponse {
  id: string;
  created: number;
  content: string;
  /** Tool calls from the LLM (native function calling) */
  toolCalls?: LLMToolCall[];
  /** Finish reason from the API */
  finishReason?: 'stop' | 'tool_calls' | 'length' | 'content_filter';
  /** Token usage statistics */
  usage?: LLMUsage;
  raw: unknown;
}

export interface ToolRegistryEntry {
  name: string;
  description: string;
  requiresApproval?: boolean;
  approvalMessage?: string;
  source: 'builtin' | 'meta';
}

export type AgentAction =
  | { type: 'read_file'; path: string; offset?: number; limit?: number }
  | { type: 'write_file'; path: string; contents?: string; content?: string }
  | { type: 'append_file'; path: string; contents?: string; content?: string }
  | { type: 'apply_patch'; path: string; patch?: string; diff?: string }
  | { type: 'tools_registry' }
  | { type: 'search'; query: string; path?: string }
  | { type: 'create_directory'; path: string }
  | { type: 'delete_path'; path: string }
  | { type: 'rename_path'; from: string; to: string }
  | { type: 'copy_path'; from: string; to: string }
  | { type: 'search_replace'; path: string; blocks: string }
  | {
      type: 'run_command';
      command: string;
      args?: string[];
      /** Directory relative to workspace root to execute in */
      directory?: string;
      /** Brief description shown to user */
      description?: string;
      /** Run process in background with PID tracking */
      background?: boolean;
    }
  | { type: 'add_dependency'; name: string; version: string; dev?: boolean }
  | { type: 'remove_dependency'; name: string; dev?: boolean }
  | { type: 'format_file'; path: string; formatter: string }
  | { type: 'search_with_context'; query: string; limit?: number; context?: number; path?: string }
  | { type: 'semantic_search'; query: string; limit?: number; window?: number; path?: string }
  | { type: 'list_tree'; path?: string; depth?: number }
  | { type: 'file_stats'; path: string }
  | { type: 'checksum'; path: string; algorithm?: string }
  | { type: 'git_diff'; path: string }
  | { type: 'git_checkout'; path: string }
  | { type: 'git_status' }
  | { type: 'git_list_untracked' }
  | { type: 'git_diff_range'; range?: string; staged?: boolean; paths?: string[] }
  | { type: 'git_apply_patch'; patch?: string; diff?: string }
  | { type: 'git_worktree_list' }
  | { type: 'git_worktree_add'; path: string; ref?: string }
  | { type: 'git_worktree_remove'; path: string; force?: boolean }
  // Advanced Worktree Operations
  | { type: 'git_worktree_status_all' }
  | { type: 'git_worktree_cleanup'; dry_run?: boolean; remove_merged?: boolean; remove_stale?: boolean }
  | { type: 'git_worktree_run_parallel'; command: string; timeout?: number; max_concurrent?: number }
  | { type: 'git_worktree_sync'; strategy?: 'rebase' | 'merge'; main_branch?: string; dry_run?: boolean }
  | { type: 'git_worktree_create_for_pr'; pr_number: number | string; remote?: string }
  | { type: 'git_worktree_create_from_template'; branch: string; template: string; base_branch?: string; run_setup?: boolean }
  // Git Stash Operations
  | { type: 'git_stash'; message?: string; include_untracked?: boolean; keep_index?: boolean }
  | { type: 'git_stash_list' }
  | { type: 'git_stash_pop'; stash_ref?: string }
  | { type: 'git_stash_apply'; stash_ref?: string }
  | { type: 'git_stash_drop'; stash_ref?: string }
  // Git Branch Operations
  | { type: 'git_branch'; branch_name?: string; delete?: boolean; force?: boolean }
  | { type: 'git_switch'; branch_name: string; create?: boolean }
  // Git Cherry-pick Operations
  | { type: 'git_cherry_pick'; commits: string[]; no_commit?: boolean; mainline?: number }
  | { type: 'git_cherry_pick_abort' }
  | { type: 'git_cherry_pick_continue' }
  // Git Rebase Operations
  | { type: 'git_rebase'; upstream: string; onto?: string; autosquash?: boolean }
  | { type: 'git_rebase_abort' }
  | { type: 'git_rebase_continue' }
  | { type: 'git_rebase_skip' }
  // Git Merge Operations
  | { type: 'git_merge'; branch: string; no_commit?: boolean; no_ff?: boolean; squash?: boolean; message?: string }
  | { type: 'git_merge_abort' }
  // Git Commit Operations
  | { type: 'git_commit'; message: string; amend?: boolean; allow_empty?: boolean }
  | { type: 'git_add'; paths: string[] }
  | { type: 'git_reset'; mode?: 'soft' | 'mixed' | 'hard'; ref?: string }
  // Auto Commit
  | { type: 'auto_commit'; message?: string; stage_all?: boolean }
  // Git Log Operations
  | { type: 'git_log'; max_count?: number; oneline?: boolean; graph?: boolean; all?: boolean }
  // Git Remote Operations
  | { type: 'git_fetch'; remote?: string; branch?: string }
  | { type: 'git_pull'; remote?: string; branch?: string }
  | { type: 'git_push'; remote?: string; branch?: string; force?: boolean; set_upstream?: boolean }
  | { type: 'custom_command'; name: string; command: string; args?: string[]; description?: string; dangerous?: boolean }
  | { type: 'plan'; notes: string }
  | { type: 'multi_file_edit'; file_path: string; edits: Array<{ old_string: string; new_string: string; replace_all?: boolean }> }
  | { type: 'todo_write'; tasks: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm: string }> }
  | {
    type: 'smart_context_cropper';
    need_user_approve?: boolean;
    crop_direction: 'top' | 'bottom';
    crop_amount: number;
    deleted_messages_summary?: string;
  }
  | { type: 'save_memory'; fact: string; level?: 'user' | 'project' }
  | { type: 'recall_memory'; query?: string; level?: 'user' | 'project' }
  | { type: 'create_meta_tool'; name: string; description: string; parameters: Record<string, unknown>; handler: string }
  | { type: 'delegate_task'; agent_name: string; task: string }
  | { type: 'delegate_parallel'; tasks: Array<{ agent_name: string; task: string }> }
  // Web Search Operations
  | { type: 'web_search'; query: string; max_results?: number; search_type?: 'general' | 'packages' | 'docs' | 'changelog' }
  | { type: 'fetch_url'; url: string; selector?: string; max_length?: number }
  | { type: 'package_info'; package_name: string; registry?: 'npm' | 'pypi' | 'crates' | 'go' | 'rubygems'; version?: string }
  | { type: 'web_repo'; repo: string; operation: 'info' | 'list' | 'fetch'; path?: string; branch?: string }
  // User interaction
  | { type: 'ask_followup_question'; question: string; suggested_answers?: string[] };

export type ExplorationEvent = { kind: 'read' | 'list' | 'search'; target: string };

export interface ToolCallRequest {
  /** Unique ID for this tool call (required for native function calling) */
  id?: string;
  tool: AgentAction['type'];
  args?: Record<string, Primitive | Record<string, Primitive> | Primitive[]>;
}

export interface AssistantReactPayload {
  thought?: string;
  toolCalls?: ToolCallRequest[];
  finalResponse?: string;
  response?: string;
}

export interface ToolExecutionResult {
  tool: AgentAction['type'];
  success: boolean;
  output?: string;
  error?: string;
}

export interface ToolExecutionContext {
  toolCallId?: string;
  tool?: AgentAction['type'];
}

export interface ToolOutputChunk {
  tool: AgentAction['type'];
  toolCallId?: string;
  stream: 'stdout' | 'stderr';
  data: string;
}

export interface AgentRuntime {
  config: LoadedConfig;
  workspaceRoot: string;
  /** Additional directories with same access as workspaceRoot */
  additionalDirs?: string[];
  options: CLIOptions;
  spinner?: Ora;
  /** Ink-based renderer for flicker-free UI (experimental) */
  inkRenderer?: InkRendererInterface;
  /** True when running in RPC mode (stdout must be JSON-RPC only) */
  isRpcMode?: boolean;
}

export interface AgentStatusSnapshot {
  model: string;
  workspace: string;
  contextPercent: number;
  tokensUsed: number;
}

export interface AgentOutputEvent {
  type: 'message' | 'thinking' | 'tool_start' | 'tool_end' | 'error';
  content?: string;
  thought?: string;
  toolName?: string;
  toolId?: string;
  toolArgs?: Record<string, unknown>;
  toolOutput?: string;
  toolSuccess?: boolean;
}

// ============ Community Skills Marketplace Types ============

/** Skill category in the community registry */
export interface SkillCategory {
  id: string;
  name: string;
  count: number;
  icon?: string;
}

/** Community skill from GitHub registry with multi-file support */
export interface GitHubCommunitySkill {
  id: string;
  name: string;
  description: string;
  /** Category ID (e.g., "languages", "frameworks", "workflows") */
  category: string;
  /** Tags for search/filtering */
  tags?: string[];
  /** Programming languages this skill is relevant to */
  languages?: string[];
  /** Frameworks this skill is relevant to */
  frameworks?: string[];
  /** Whether this skill is featured/highlighted */
  isFeatured?: boolean;
  /** Whether this skill has been curated/reviewed */
  isCurated?: boolean;
  /** Average user rating (0-5) */
  rating?: number;
  /** Number of times this skill has been installed */
  downloadCount?: number;
  /** Directory name in the GitHub repo */
  directory: string;
  /** List of files in the skill directory (relative paths) */
  files: string[];
  /** Skill version */
  version?: string;
  /** License (e.g., "MIT", "Apache-2.0") */
  license?: string;
  /** Author or maintainer */
  author?: string;
  /** Allowed tools for this skill */
  allowedTools?: string;
}

/** Registry index fetched from GitHub */
export interface CommunitySkillsRegistry {
  version: string;
  updatedAt: string;
  skills: GitHubCommunitySkill[];
  categories: SkillCategory[];
}

/** Cached registry with timestamp */
export interface CachedRegistry {
  registry: CommunitySkillsRegistry;
  fetchedAt: number;
  etag?: string;
}

/** Cache configuration */
export interface SkillsCacheConfig {
  /** TTL in milliseconds (default: 24 hours) */
  ttlMs?: number;
  /** Cache directory path */
  cacheDir?: string;
  /** Maximum number of skill bodies to cache */
  maxSkillsCache?: number;
}

/** Skill install scope */
export type SkillInstallScope = 'user' | 'project';

/** Browser tab type */
export type SkillsBrowserTab = 'featured' | 'categories' | 'search';

/** Browser state for Ink component */
export interface SkillsBrowserState {
  activeTab: SkillsBrowserTab;
  selectedCategory: string | null;
  searchQuery: string;
  selectedIndex: number;
  skills: GitHubCommunitySkill[];
  filteredSkills: GitHubCommunitySkill[];
  isLoading: boolean;
  error: string | null;
  previewSkill: GitHubCommunitySkill | null;
}
