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
}

export interface AutohandConfig {
  provider?: ProviderName;
  openrouter?: OpenRouterSettings;
  ollama?: ProviderSettings;
  llamacpp?: ProviderSettings;
  openai?: ProviderSettings;
  workspace?: WorkspaceSettings;
  ui?: UISettings;
}

export interface LoadedConfig extends AutohandConfig {
  configPath: string;
}

export interface CLIOptions {
  prompt?: string;
  path?: string;
  yes?: boolean;
  dryRun?: boolean;
  model?: string;
  config?: string;
  temperature?: number;
  resumeSessionId?: string;
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
}

export interface LLMRequest {
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  tools?: Primitive[];
  model?: string;
  signal?: AbortSignal;
}

export interface LLMResponse {
  id: string;
  created: number;
  content: string;
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
  | { type: 'replace_in_file'; path: string; search: string; replace: string }
  | { type: 'run_command'; command: string; args?: string[] }
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
  | { type: 'delegate_task'; agent_name: string; task: string }
  | { type: 'delegate_parallel'; tasks: Array<{ agent_name: string; task: string }> };

export type ExplorationEvent = { kind: 'read' | 'list' | 'search'; target: string };

export interface ToolCallRequest {
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
