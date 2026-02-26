/**
 * ACP Mode Type Definitions
 * Constants, session state, and helpers for native ACP integration.
 */

import type { ToolKind, SessionConfigOption } from '@agentclientprotocol/sdk';
import type { LoadedConfig } from '../../types.js';

// ============================================================================
// Tool Kind Mapping
// ============================================================================

/**
 * Maps internal tool names to ACP ToolKind values.
 * Used to classify tool calls for the ACP UI.
 */
export const TOOL_KIND_MAP: Record<string, ToolKind> = {
  // Read operations
  read_file: 'read',
  list_tree: 'read',
  list_directory: 'read',
  file_stats: 'read',
  file_info: 'read',

  // Search operations
  search: 'search',
  search_files: 'search',
  search_with_context: 'search',
  semantic_search: 'search',
  web_search: 'fetch',
  web_repo: 'fetch',

  // Edit operations
  write_file: 'edit',
  append_file: 'edit',
  apply_patch: 'edit',
  format_file: 'edit',
  replace_in_file: 'edit',
  search_replace: 'edit',
  create_directory: 'edit',
  copy_path: 'edit',

  // Move/delete operations
  rename_path: 'move',
  delete_path: 'delete',

  // Execute operations
  run_command: 'execute',
  custom_command: 'execute',
  git_status: 'execute',
  git_diff: 'execute',
  git_commit: 'execute',
  git_add: 'execute',
  git_init: 'execute',
  git_log: 'execute',
  git_list_untracked: 'execute',
  git_checkout: 'execute',
  git_branch: 'execute',

  // Dependencies
  dependency_add: 'execute',
  dependency_remove: 'execute',
  dependency_update: 'execute',
  dependency_list: 'read',

  // Think/plan operations
  todo_write: 'think',
  plan: 'think',
  smart_context_cropper: 'think',
  thinking: 'think',

  // Memory/other operations
  save_memory: 'other',
  recall_memory: 'other',
  tools_registry: 'other',
  project_info: 'read',
  workspace_info: 'read',

  // MCP tools (prefixed with mcp__)
  // These are dynamically matched via resolveToolKind()
};

/**
 * Human-readable display names for tools.
 */
export const TOOL_DISPLAY_NAMES: Record<string, string> = {
  // Read operations
  read_file: 'Read',
  list_tree: 'List',
  list_directory: 'List',
  file_stats: 'Stats',
  file_info: 'Info',

  // Search operations
  search: 'Search',
  search_files: 'Search',
  search_with_context: 'Search',
  semantic_search: 'Search',
  web_search: 'Web Search',
  web_repo: 'Web Repo',

  // Edit operations
  write_file: 'Write',
  append_file: 'Append',
  apply_patch: 'Patch',
  format_file: 'Format',
  replace_in_file: 'Replace',
  search_replace: 'Replace',
  create_directory: 'Create',
  copy_path: 'Copy',

  // Move/delete operations
  rename_path: 'Rename',
  delete_path: 'Delete',

  // Execute operations
  run_command: 'Run',
  custom_command: 'Custom',
  git_status: 'Git Status',
  git_diff: 'Git Diff',
  git_commit: 'Git Commit',
  git_add: 'Git Add',
  git_init: 'Git Init',
  git_log: 'Git Log',
  git_list_untracked: 'Git Untracked',
  git_checkout: 'Git Checkout',
  git_branch: 'Git Branch',

  // Dependencies
  dependency_add: 'Add Dep',
  dependency_remove: 'Remove Dep',
  dependency_update: 'Update Dep',
  dependency_list: 'List Deps',

  // Think/plan operations
  todo_write: 'Todo',
  plan: 'Plan',
  smart_context_cropper: 'Thinking',
  thinking: 'Thinking',

  // Memory/other
  save_memory: 'Save Memory',
  recall_memory: 'Recall Memory',
  tools_registry: 'Tools',
  project_info: 'Project Info',
  workspace_info: 'Workspace Info',
};

/**
 * Resolve the ACP ToolKind for a given tool name.
 * Falls back to 'other' for unknown tools.
 */
export function resolveToolKind(toolName: string): ToolKind {
  // Direct match
  if (toolName in TOOL_KIND_MAP) {
    return TOOL_KIND_MAP[toolName];
  }

  // MCP tools follow naming: mcp__<server>__<tool>
  if (toolName.startsWith('mcp__')) {
    return 'execute';
  }

  return 'other';
}

/**
 * Resolve the display name for a given tool name.
 */
export function resolveToolDisplayName(toolName: string): string {
  if (toolName in TOOL_DISPLAY_NAMES) {
    return TOOL_DISPLAY_NAMES[toolName];
  }

  // MCP tools: format as "MCP: server/tool"
  if (toolName.startsWith('mcp__')) {
    const parts = toolName.split('__');
    if (parts.length >= 3) {
      return `MCP: ${parts[1]}/${parts.slice(2).join('/')}`;
    }
  }

  // Fallback: convert snake_case to Title Case
  return toolName
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ============================================================================
// Default ACP Commands (Slash Commands)
// ============================================================================

export interface AcpCommand {
  name: string;
  description: string;
}

/**
 * Slash commands exposed to the ACP client UI.
 * Mirrors the external adapter's command list for Zed compatibility.
 */
export const DEFAULT_ACP_COMMANDS: AcpCommand[] = [
  { name: 'help', description: 'Show available commands' },
  { name: 'new', description: 'Start a new conversation' },
  { name: 'model', description: 'Select or change the model' },
  { name: 'resume', description: 'Resume a previous session' },
  { name: 'sessions', description: 'List recent sessions' },
  { name: 'session', description: 'Show current session info' },
  { name: 'status', description: 'Show Autohand status' },
  { name: 'undo', description: 'Undo the last file change' },
  { name: 'init', description: 'Create AGENTS.md file' },
  { name: 'memory', description: 'Manage conversation memory' },
  { name: 'skills', description: 'List available skills' },
  { name: 'export', description: 'Export conversation' },
  { name: 'permissions', description: 'Manage tool permissions' },
  { name: 'feedback', description: 'Send feedback to Autohand' },
  { name: 'agents', description: 'List available agents' },
  { name: 'hooks', description: 'Manage lifecycle hooks' },
  { name: 'automode', description: 'Toggle autonomous agent loop' },
  { name: 'add-dir', description: 'Add additional working directory' },
  { name: 'share', description: 'Share session transcript' },
  { name: 'formatters', description: 'Manage code formatters' },
  { name: 'lint', description: 'Run code linting' },
  { name: 'mcp', description: 'Manage MCP servers' },
  { name: 'mcp install', description: 'Browse and install community MCP servers' },
  { name: 'sync', description: 'Sync settings with cloud' },
  { name: 'history', description: 'Show conversation history' },
  { name: 'about', description: 'Show Autohand version and links' },
  { name: 'plan', description: 'Toggle plan mode' },
  { name: 'ide', description: 'IDE integration settings' },
  { name: 'search', description: 'Configure web search' },
  { name: 'login', description: 'Sign in to Autohand account' },
  { name: 'logout', description: 'Sign out of Autohand account' },
];

// ============================================================================
// Default ACP Modes
// ============================================================================

export interface AcpMode {
  id: string;
  name: string;
  description: string;
}

/**
 * Session modes available in the ACP UI.
 */
export const DEFAULT_ACP_MODES: AcpMode[] = [
  {
    id: 'interactive',
    name: 'Interactive',
    description: 'Default mode with approval prompts for risky actions',
  },
  {
    id: 'full-access',
    name: 'Full Access',
    description: 'Auto-approve all actions within the workspace',
  },
  {
    id: 'unrestricted',
    name: 'Unrestricted',
    description: 'Skip all approval prompts (use with caution)',
  },
  {
    id: 'auto-mode',
    name: 'Auto Mode',
    description: 'Autonomous multi-step execution loop',
  },
  {
    id: 'restricted',
    name: 'Restricted',
    description: 'Deny all dangerous operations automatically',
  },
  {
    id: 'dry-run',
    name: 'Dry Run',
    description: 'Preview actions without applying changes',
  },
];

// ============================================================================
// Session State
// ============================================================================

/**
 * ACP session state - simplified vs. the external adapter's subprocess-heavy state.
 * No stdout buffer, no conversation file watching, no subprocess fields.
 */
export interface AcpSessionState {
  sessionId: string;
  modeId: string;
  modelId: string;
  workspaceRoot: string;
  createdAt: number;
  abortController: AbortController;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build ACP config options from the loaded config.
 */
export function buildConfigOptions(_config: LoadedConfig): SessionConfigOption[] {
  const options: SessionConfigOption[] = [];

  // Thinking level
  options.push({
    type: 'select',
    id: 'thinking_level',
    name: 'Thinking Level',
    description: 'Control the depth of LLM reasoning',
    options: [
      { value: 'none', name: 'None' },
      { value: 'normal', name: 'Normal' },
      { value: 'extended', name: 'Extended' },
    ],
    currentValue: 'normal',
  });

  // Auto-commit
  options.push({
    type: 'select',
    id: 'auto_commit',
    name: 'Auto Commit',
    description: 'Automatically commit changes with LLM-generated messages',
    options: [
      { value: 'off', name: 'Off' },
      { value: 'on', name: 'On' },
    ],
    currentValue: 'off',
  });

  // Context compaction
  options.push({
    type: 'select',
    id: 'context_compact',
    name: 'Context Compaction',
    description: 'Automatically compact context when sessions grow long',
    options: [
      { value: 'on', name: 'On' },
      { value: 'off', name: 'Off' },
    ],
    currentValue: 'on',
  });

  return options;
}

/**
 * Parse available models from config, returning a list of model IDs.
 */
export function parseAvailableModels(config: LoadedConfig): string[] {
  const models: string[] = [];

  // Add current model
  const providerName = config.provider ?? 'openrouter';
  const providerConfig = (config as Record<string, any>)[providerName];
  if (providerConfig?.model) {
    models.push(providerConfig.model);
  }

  // Popular models that work with OpenRouter
  const popularModels = [
    'anthropic/claude-sonnet-4-20250514',
    'anthropic/claude-3.5-sonnet',
    'openai/gpt-4o',
    'google/gemini-2.0-flash-001',
    'deepseek/deepseek-chat-v3-0324',
  ];

  for (const m of popularModels) {
    if (!models.includes(m)) {
      models.push(m);
    }
  }

  return models;
}

/**
 * Resolve the default mode ID based on config.
 */
export function resolveDefaultMode(config?: LoadedConfig): string {
  if (config?.permissions?.mode === 'unrestricted') return 'unrestricted';
  if (config?.permissions?.mode === 'restricted') return 'restricted';
  return 'interactive';
}

/**
 * Resolve the default model ID from config.
 */
export function resolveDefaultModel(config: LoadedConfig): string {
  const providerName = config.provider ?? 'openrouter';
  const providerConfig = (config as Record<string, any>)[providerName];
  return providerConfig?.model ?? 'anthropic/claude-3.5-sonnet';
}
