/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Ora } from 'ora';

type Primitive = string | number | boolean | null;

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export type ProviderName = 'openrouter' | 'ollama' | 'llamacpp' | 'openai';

export interface ProviderSettings {
  apiKey?: string;
  baseUrl?: string;
  port?: number;
  model: string;
}

export interface OpenRouterSettings extends ProviderSettings {
  apiKey: string;
}

export interface WorkspaceSettings {
  defaultRoot?: string;
  allowDangerousOps?: boolean;
}

export interface UISettings {
  theme?: 'dark' | 'light';
  autoConfirm?: boolean;
  readFileCharLimit?: number;
  /** Show notification when work is completed (default: true) */
  showCompletionNotification?: boolean;
  /** Show LLM thinking/reasoning process (default: true) */
  showThinking?: boolean;
}

export interface AgentSettings {
  /** Maximum iterations per user request (default: 100) */
  maxIterations?: number;
  /** Enable request queue - allow typing while agent works (default: true) */
  enableRequestQueue?: boolean;
}

export interface TelemetrySettings {
  /** Enable/disable telemetry (default: true) */
  enabled?: boolean;
  /** API endpoint (default: https://api.autohand.ai) */
  apiBaseUrl?: string;
  /** Enable session sync to cloud (default: true) */
  enableSessionSync?: boolean;
}

export type PermissionMode = 'interactive' | 'unrestricted' | 'restricted';

export interface PermissionRule {
  tool: string;
  pattern?: string;
  action: 'allow' | 'deny' | 'prompt';
}

export interface PermissionSettings {
  /** Permission mode: interactive (default), unrestricted (no prompts), restricted (deny all dangerous) */
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

export interface AutohandConfig {
  provider?: ProviderName;
  openrouter?: OpenRouterSettings;
  ollama?: ProviderSettings;
  llamacpp?: ProviderSettings;
  openai?: ProviderSettings;
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
}

export interface LoadedConfig extends AutohandConfig {
  configPath: string;
}

/** Client context determines which tools are available */
export type ClientContext = 'cli' | 'slack' | 'api' | 'restricted';

export interface CLIOptions {
  prompt?: string;
  path?: string;
  yes?: boolean;
  dryRun?: boolean;
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
  /** Auto-commit changes after completing tasks */
  autoCommit?: boolean;
  /** Auto-generate skills based on project analysis */
  autoSkill?: boolean;
}

export interface PromptContext {
  workspaceRoot: string;
  gitStatus?: string;
  recentFiles: string[];
  extraNotes?: string;
}

export interface LLMMessage {
  role: MessageRole;
  content: string;
  name?: string;
  /** Tool call ID for tool response messages (required when role is 'tool') */
  tool_call_id?: string;
  /** Tool calls made by the assistant (included when role is 'assistant' and model invoked tools) */
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
  | { type: 'read_file'; path: string }
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
  | { type: 'todo_write'; tasks: Array<{ id: string; title: string; status: 'pending' | 'in_progress' | 'completed'; description?: string }> }
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
  | { type: 'delegate_parallel'; tasks: Array<{ agent_name: string; task: string }> };

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

export interface AgentRuntime {
  config: LoadedConfig;
  workspaceRoot: string;
  options: CLIOptions;
  spinner?: Ora;
}

export interface AgentStatusSnapshot {
  model: string;
  workspace: string;
  contextPercent: number;
}
