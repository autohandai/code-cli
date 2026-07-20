/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tool filtering based on client context and risk categories
 */
import type { ToolDefinition } from './toolManager.js';
import type { ClientContext } from '../types.js';

// Re-export for convenience
export type { ClientContext } from '../types.js';

/**
 * Tool categories based on risk level and operation type
 */
export type ToolCategory =
  | 'read'       // Read files, search, list directories
  | 'write'      // Write/edit files
  | 'create'     // Create directories, add dependencies
  | 'delete'     // Delete paths, remove dependencies
  | 'git_read'   // Git status, diff, log (read-only)
  | 'git_write'  // Git commit, push, merge (mutating)
  | 'shell'      // Run arbitrary shell commands
  | 'browser'    // Browser automation (Chrome extension only)
  | 'meta';      // Planning, todos, tool registry

/**
 * Policy defining allowed tools for a context
 */
export interface ToolPolicy {
  allowedCategories: ToolCategory[];
  blockedTools?: string[];        // Explicit blocklist (overrides categories)
  allowedTools?: string[];        // Explicit allowlist (if set, only these tools)
  requireApprovalFor?: string[];  // Force approval even if tool doesn't require it
}

/**
 * Extended tool definition with category
 */
export interface CategorizedToolDefinition extends ToolDefinition {
  category: ToolCategory;
}

/**
 * Map of tool names to their categories
 */
const TOOL_CATEGORIES: Record<string, ToolCategory> = {
  // Meta tools
  tools_registry: 'meta',
  tool_search: 'meta',
  plan: 'meta',
  todo_write: 'meta',
  smart_context_cropper: 'meta',
  save_memory: 'meta',
  recall_memory: 'meta',
  create_meta_tool: 'meta',
  delegate_task: 'meta',
  delegate_parallel: 'meta',
  create_team: 'meta',
  add_teammate: 'meta',
  create_task: 'meta',
  task_get: 'meta',
  task_list: 'meta',
  task_update: 'meta',
  task_stop: 'meta',
  task_output: 'meta',
  skill: 'meta',
  install_agent_skill: 'create',
  find_sub_agents: 'meta',
  install_sub_agent: 'create',
  sleep: 'meta',
  enter_worktree: 'meta',
  exit_worktree: 'meta',
  team_status: 'meta',
  send_team_message: 'meta',
  ask_followup_question: 'meta',
  find_agent_skills: 'meta',
  request_directory_access: 'meta',
  exit_plan_mode: 'meta',
  cron_create: 'meta',
  cron_delete: 'meta',
  list_schedules: 'meta',
  cancel_schedule: 'meta',

  // Read operations
  read_file: 'read',
  fff_find: 'read',
  fff_grep: 'read',
  find: 'read',
  glob: 'read',
  search: 'read',
  search_with_context: 'read',
  semantic_search: 'read',
  list_tree: 'read',
  file_stats: 'read',
  checksum: 'read',

  // Write operations
  write_file: 'write',
  append_file: 'write',
  apply_patch: 'write',
  notebook_edit: 'write',
  search_replace: 'write',
  format_file: 'write',
  multi_file_edit: 'write',

  // Create operations
  create_directory: 'create',
  copy_path: 'create',
  rename_path: 'create',
  add_dependency: 'create',

  // Delete operations
  delete_path: 'delete',
  remove_dependency: 'delete',
  package_info: 'read',

  // Web read operations
  web_search: 'read',
  fetch_url: 'read',
  web_repo: 'read',

  // Git read operations
  git_diff: 'git_read',
  git_status: 'git_read',
  git_list_untracked: 'git_read',
  git_diff_range: 'git_read',
  git_stash_list: 'git_read',
  git_branch: 'git_read',
  git_log: 'git_read',
  git_worktree_list: 'git_read',
  git_worktree_status_all: 'git_read',
  project_tracker: 'git_read',

  // Git write operations
  git_checkout: 'git_write',
  git_apply_patch: 'git_write',
  git_worktree_add: 'git_write',
  git_worktree_remove: 'git_write',
  git_worktree_cleanup: 'git_write',
  git_worktree_run_parallel: 'git_write',
  git_worktree_sync: 'git_write',
  git_worktree_create_for_pr: 'git_write',
  git_worktree_create_from_template: 'git_write',
  git_stash: 'git_write',
  git_stash_pop: 'git_write',
  git_stash_apply: 'git_write',
  git_stash_drop: 'git_write',
  git_switch: 'git_write',
  git_cherry_pick: 'git_write',
  git_cherry_pick_abort: 'git_write',
  git_cherry_pick_continue: 'git_write',
  git_rebase: 'git_write',
  git_rebase_abort: 'git_write',
  git_rebase_continue: 'git_write',
  git_rebase_skip: 'git_write',
  git_merge: 'git_write',
  git_merge_abort: 'git_write',
  git_commit: 'git_write',
  git_add: 'git_write',
  git_reset: 'git_write',
  git_fetch: 'git_write',
  git_pull: 'git_write',
  git_push: 'git_write',

  // Shell operations
  run_command: 'shell',
  shell: 'shell',
  custom_command: 'shell',

  // Browser operations (Chrome extension bridge only)
  browser_screenshot: 'browser',
  browser_take_full_page_screenshot: 'browser',
  browser_click: 'browser',
  browser_type: 'browser',
  browser_navigate: 'browser',
  browser_scroll: 'browser',
  browser_find_element: 'browser',
  browser_press_key: 'browser',
  browser_get_page_context: 'browser',
  browser_get_element: 'browser',
  browser_wait_for_element: 'browser',
  browser_read_console: 'browser',
  browser_read_network: 'browser',
  browser_get_tabs: 'browser',
  browser_get_tab_groups: 'browser',
  browser_execute_js: 'browser',
};

/**
 * Default policies for each client context
 */
export const CONTEXT_POLICIES: Record<ClientContext, ToolPolicy> = {
  // CLI: Full access to everything
  cli: {
    allowedCategories: ['read', 'write', 'create', 'delete', 'git_read', 'git_write', 'shell', 'meta']
  },

  // Slack: Chat-based, no file exploration or shell access
  // Focuses on answering questions and simple operations
  slack: {
    allowedCategories: ['meta', 'git_read'],
    blockedTools: [
      'list_tree',           // Don't expose directory structure
      'find',                // Don't allow broad searches
      'search',              // Don't allow broad searches
      'search_with_context', // Don't allow broad searches
      'semantic_search',     // Don't allow broad searches
      'run_command',         // No shell access
      'custom_command',      // No shell access
      'file_stats',          // Don't expose file metadata
      'checksum',            // Don't expose file checksums
      'ask_followup_question', // Requires interactive terminal
      'project_tracker'      // Requires gh CLI binary
    ]
  },

  // API: Programmatic access with sensible defaults
  // Allows most operations except dangerous ones
  api: {
    allowedCategories: ['read', 'write', 'create', 'git_read', 'git_write', 'meta'],
    blockedTools: [
      'delete_path',         // No deletions via API
      'run_command',         // No shell access
      'custom_command',      // No shell access
      'git_push',            // No pushing via API
      'git_reset',           // No resets via API
      'ask_followup_question' // Requires interactive terminal
    ],
    requireApprovalFor: [
      'git_commit',
      'git_merge',
      'git_rebase'
    ]
  },

  // Chrome: Browser-first, limited file access
  // Only browser_* tools + basic read/write for Downloads
  chrome: {
    allowedCategories: ['read', 'write', 'browser', 'meta'],
    allowedTools: [
      // Browser tools — ALWAYS available, highest priority
      'browser_screenshot', 'browser_take_full_page_screenshot',
      'browser_click', 'browser_type', 'browser_navigate',
      'browser_scroll', 'browser_find_element', 'browser_press_key',
      'browser_get_page_context', 'browser_get_element', 'browser_wait_for_element',
      'browser_read_console', 'browser_read_network', 'browser_get_tabs',
      'browser_get_tab_groups', 'browser_execute_js',
      // Basic file ops — restricted scope
      'read_file', 'write_file', 'fff_grep', 'fff_find', 'search', 'list_tree',
      // Web
      'web_search', 'fetch_url',
      // Communication
      'plan', 'ask_followup_question', 'todo_write',
      'save_memory', 'recall_memory',
      'tools_registry',
    ],
    blockedTools: [
      'run_command', 'custom_command',
      'git_push', 'git_reset', 'git_rebase', 'git_merge',
      'git_cherry_pick', 'auto_commit', 'delete_path',
      'create_directory', 'rename_path', 'copy_path',
      'git_worktree_add', 'git_worktree_remove',
      'delegate_task', 'delegate_parallel',
    ],
  },

  // Restricted: Read-only mode
  restricted: {
    allowedCategories: ['read', 'git_read', 'meta'],
    blockedTools: [
      'list_tree',
      'ask_followup_question'
    ]
  }
};

/**
 * Get the category for a tool
 */
export function getToolCategory(toolName: string): ToolCategory {
  return TOOL_CATEGORIES[toolName] ?? 'meta';
}

/**
 * Filter tools based on context and policy
 */
export class ToolFilter {
  private readonly policy: ToolPolicy;
  private readonly context: ClientContext;

  constructor(context: ClientContext = 'cli', customPolicy?: Partial<ToolPolicy>) {
    this.context = context;
    const basePolicy = CONTEXT_POLICIES[context];

    // Merge custom policy with base policy
    this.policy = {
      ...basePolicy,
      ...customPolicy,
      allowedCategories: customPolicy?.allowedCategories ?? basePolicy.allowedCategories,
      blockedTools: [
        ...(basePolicy.blockedTools ?? []),
        ...(customPolicy?.blockedTools ?? [])
      ],
      allowedTools: customPolicy?.allowedTools,
      requireApprovalFor: [
        ...(basePolicy.requireApprovalFor ?? []),
        ...(customPolicy?.requireApprovalFor ?? [])
      ]
    };
  }

  /**
   * Check if a tool is allowed in the current context
   */
  isAllowed(toolName: string): boolean {
    // If explicit allowlist is set, only those tools are allowed
    if (this.policy.allowedTools && this.policy.allowedTools.length > 0) {
      return this.policy.allowedTools.includes(toolName);
    }

    // Check explicit blocklist
    if (this.policy.blockedTools?.includes(toolName)) {
      return false;
    }

    // Check category
    const category = getToolCategory(toolName);
    return this.policy.allowedCategories.includes(category);
  }

  /**
   * Check if a tool requires approval (beyond its default setting)
   */
  requiresApproval(toolName: string, defaultRequiresApproval?: boolean): boolean {
    if (this.policy.requireApprovalFor?.includes(toolName)) {
      return true;
    }
    return defaultRequiresApproval ?? false;
  }

  /**
   * Filter a list of tool definitions
   */
  filterDefinitions(definitions: ToolDefinition[]): ToolDefinition[] {
    return definitions
      .filter(def => this.isAllowed(def.name))
      .map(def => ({
        ...def,
        requiresApproval: this.requiresApproval(def.name, def.requiresApproval)
      }));
  }

  /**
   * Get the current context
   */
  getContext(): ClientContext {
    return this.context;
  }

  /**
   * Get a summary of what's allowed/blocked for logging
   */
  getSummary(): { allowed: string[]; blocked: string[]; categories: ToolCategory[] } {
    const allTools = Object.keys(TOOL_CATEGORIES);
    const allowed = allTools.filter(t => this.isAllowed(t));
    const blocked = allTools.filter(t => !this.isAllowed(t));

    return {
      allowed,
      blocked,
      categories: this.policy.allowedCategories
    };
  }
}

/**
 * Create a tool filter for a specific context
 */
export function createToolFilter(
  context: ClientContext = 'cli',
  customPolicy?: Partial<ToolPolicy>
): ToolFilter {
  return new ToolFilter(context, customPolicy);
}

/**
 * Annotate tool definitions with their categories
 */
export function categorizeTools(definitions: ToolDefinition[]): CategorizedToolDefinition[] {
  return definitions.map(def => ({
    ...def,
    category: getToolCategory(def.name)
  }));
}

// ============================================================================
// Relevance-based filtering (reduces token overhead)
// ============================================================================

import type { LLMMessage, FunctionDefinition } from '../types.js';

/**
 * Tool relevance categories for dynamic filtering
 */
export type RelevanceCategory =
  | 'always'      // Always include (core operations)
  | 'filesystem'  // File operations
  | 'editing'     // File mutation operations
  | 'git_basic'   // Basic git operations
  | 'git_advanced'// Advanced git (worktree, rebase, cherry-pick)
  | 'search'      // Search operations
  | 'verification'// Shell/build/test operations
  | 'web'         // Web search/fetch/repo reads
  | 'browser'     // Browser automation
  | 'dependencies'// Package management
  | 'meta'             // Planning, memory, delegation
  | 'project_tracking'; // Issue/PR tracking

/**
 * Map tools to relevance categories
 */
const RELEVANCE_CATEGORIES: Record<string, RelevanceCategory> = {
  // Always include
  read_file: 'always',
  fff_find: 'always',
  fff_grep: 'always',
  tool_search: 'always',
  ask_followup_question: 'always',
  find_agent_skills: 'always',
  find_sub_agents: 'always',
  tools_registry: 'always',
  request_directory_access: 'always',
  plan: 'always',
  exit_plan_mode: 'always',
  todo_write: 'always',

  // Filesystem
  find: 'filesystem',
  glob: 'filesystem',
  search: 'filesystem',
  list_tree: 'filesystem',
  file_stats: 'filesystem',
  checksum: 'filesystem',

  // Editing
  write_file: 'editing',
  append_file: 'filesystem',
  apply_patch: 'editing',
  create_directory: 'filesystem',
  delete_path: 'filesystem',
  rename_path: 'filesystem',
  copy_path: 'filesystem',
  search_replace: 'editing',
  format_file: 'editing',
  multi_file_edit: 'editing',
  notebook_edit: 'editing',
  search_with_context: 'search',
  semantic_search: 'search',

  // Basic git
  git_diff: 'git_basic',
  git_status: 'git_basic',
  git_list_untracked: 'git_basic',
  git_add: 'git_basic',
  git_commit: 'git_basic',
  git_log: 'git_basic',
  git_branch: 'git_basic',
  git_switch: 'git_basic',
  git_checkout: 'git_basic',
  git_diff_range: 'git_basic',
  git_apply_patch: 'git_basic',
  git_fetch: 'git_basic',
  git_pull: 'git_basic',
  git_push: 'git_advanced',
  git_stash: 'git_basic',
  git_stash_list: 'git_basic',
  git_stash_pop: 'git_basic',
  git_stash_apply: 'git_basic',
  git_stash_drop: 'git_basic',

  // Advanced git
  git_merge: 'git_advanced',
  git_merge_abort: 'git_advanced',
  git_rebase: 'git_advanced',
  git_rebase_abort: 'git_advanced',
  git_rebase_continue: 'git_advanced',
  git_rebase_skip: 'git_advanced',
  git_cherry_pick: 'git_advanced',
  git_cherry_pick_abort: 'git_advanced',
  git_cherry_pick_continue: 'git_advanced',
  git_reset: 'git_advanced',
  git_worktree_list: 'git_advanced',
  git_worktree_add: 'git_advanced',
  git_worktree_remove: 'git_advanced',
  git_worktree_status_all: 'git_advanced',
  git_worktree_cleanup: 'git_advanced',
  git_worktree_run_parallel: 'git_advanced',
  git_worktree_sync: 'git_advanced',
  git_worktree_create_for_pr: 'git_advanced',
  git_worktree_create_from_template: 'git_advanced',

  // Dependencies
  add_dependency: 'dependencies',
  remove_dependency: 'dependencies',
  package_info: 'dependencies',

  // Verification and shell
  run_command: 'verification',
  shell: 'verification',

  // Web
  web_search: 'web',
  fetch_url: 'web',
  web_repo: 'web',

  // Browser
  browser_screenshot: 'browser',
  browser_take_full_page_screenshot: 'browser',
  browser_click: 'browser',
  browser_type: 'browser',
  browser_navigate: 'browser',
  browser_scroll: 'browser',
  browser_find_element: 'browser',
  browser_press_key: 'browser',
  browser_get_page_context: 'browser',
  browser_get_element: 'browser',
  browser_wait_for_element: 'browser',
  browser_read_console: 'browser',
  browser_read_network: 'browser',
  browser_get_tabs: 'browser',
  browser_get_tab_groups: 'browser',
  browser_execute_js: 'browser',

  // Meta
  save_memory: 'meta',
  recall_memory: 'meta',
  smart_context_cropper: 'meta',
  create_meta_tool: 'meta',
  custom_command: 'verification',
  delegate_task: 'meta',
  delegate_parallel: 'meta',
  create_team: 'meta',
  add_teammate: 'meta',
  create_task: 'meta',
  task_get: 'meta',
  task_list: 'meta',
  task_update: 'meta',
  task_stop: 'meta',
  task_output: 'meta',
  enter_worktree: 'meta',
  exit_worktree: 'meta',
  team_status: 'meta',
  send_team_message: 'meta',
  cron_create: 'meta',
  cron_delete: 'meta',
  list_schedules: 'meta',
  cancel_schedule: 'meta',

  // Project tracking
  project_tracker: 'project_tracking',
};

/**
 * Keywords that trigger inclusion of certain categories
 */
const CATEGORY_TRIGGERS: Record<RelevanceCategory, string[]> = {
  always: [],
  filesystem: ['file', 'directory', 'folder', 'create', 'delete', 'rename', 'copy', 'move', 'format', 'path', 'open'],
  editing: ['fix', 'edit', 'change', 'modify', 'patch', 'write', 'implement', 'refactor', 'update', 'replace', 'create', 'delete', 'remove', 'format', 'add', 'build', 'document', 'docs', 'config', 'configure'],
  git_basic: [
    'git',
    'commit',
    'branch',
    'diff',
    'status',
    'stash',
    'pull',
    'push',
    'recent changes',
    'recent change',
    'what changed',
    'changes introduced',
    'changes were introduced',
    'changed recently',
    'repo recently',
    'repository recently',
    'uncommitted',
    'working tree',
    'staged',
  ],
  git_advanced: ['merge', 'rebase', 'cherry-pick', 'worktree', 'reset', 'push', 'force-push'],
  search: ['search', 'find', 'grep', 'look for', 'locate', 'where is', 'symbol', 'definition'],
  verification: ['test', 'tests', 'build', 'lint', 'typecheck', 'verify', 'run', 'command', 'script', 'proof', 'install'],
  web: ['web', 'url', 'http', 'https', 'fetch', 'search internet', 'latest', 'docs', 'documentation', 'changelog'],
  browser: ['browser', 'chrome', 'page', 'tab', 'click', 'screenshot', 'console', 'network'],
  dependencies: ['dependency', 'dependencies', 'package', 'npm', 'install', 'yarn', 'bun add', 'cargo add', 'pip install'],
  meta: ['tool', 'delegate', 'agent', 'remember', 'memory', 'recall',
         'team', 'teammate', 'together', 'engineers', 'crew', 'collaborate'],
  project_tracking: ['issue', 'issues', 'pr', 'pull request', 'assigned', 'tracker', 'bug', 'feature request', 'milestone', 'review'],
};

const TOOL_SELECTION_CACHE_LIMIT = 100;
const toolSelectionCache = new Map<string, string[]>();

export interface ToolRelevanceOptions {
  /** Local cache for equivalent tool-selection inputs. Default: true. */
  cache?: boolean;
}

const CATALOG_LABELS: Record<RelevanceCategory, string> = {
  always: 'core',
  filesystem: 'filesystem',
  editing: 'editing',
  git_basic: 'git',
  git_advanced: 'advanced git',
  search: 'search',
  verification: 'verification',
  web: 'web',
  browser: 'browser',
  dependencies: 'dependencies',
  meta: 'coordination',
  project_tracking: 'project tracking',
};

function extractRecentToolArguments(message: LLMMessage): string {
  if (!message.tool_calls?.length) {
    return '';
  }

  return message.tool_calls
    .map((call) => call.function.arguments)
    .join(' ');
}

function getRecentSelectionText(messages: LLMMessage[]): string {
  return messages
    .slice(-8)
    .map((message) => `${message.content ?? ''} ${extractRecentToolArguments(message)}`)
    .join(' ')
    .toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesCategoryTrigger(recentText: string, trigger: string): boolean {
  if (!recentText || !trigger) {
    return false;
  }

  if (trigger.includes(' ')) {
    return recentText.includes(trigger);
  }

  return new RegExp(`\\b${escapeRegExp(trigger)}\\b`).test(recentText);
}

function stableToolCacheKey(tools: FunctionDefinition[], messages: LLMMessage[]): string {
  const toolNames = tools.map((tool) => tool.name).sort().join(',');
  return `${toolNames}\n${getRecentSelectionText(messages)}`;
}

function rememberToolSelection(key: string, names: string[]): void {
  if (toolSelectionCache.size >= TOOL_SELECTION_CACHE_LIMIT) {
    const oldestKey = toolSelectionCache.keys().next().value as string | undefined;
    if (oldestKey) {
      toolSelectionCache.delete(oldestKey);
    }
  }
  toolSelectionCache.set(key, names);
}

function restoreCachedSelection(tools: FunctionDefinition[], names: string[]): FunctionDefinition[] {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  return names
    .map((name) => byName.get(name))
    .filter((tool): tool is FunctionDefinition => Boolean(tool));
}

function matchesToolByText(tool: FunctionDefinition, recentText: string): boolean {
  if (!recentText) {
    return false;
  }

  const normalizedName = tool.name.toLowerCase();
  const spacedName = normalizedName.replace(/_/g, ' ');
  if (recentText.includes(normalizedName) || recentText.includes(spacedName)) {
    return true;
  }

  return tool.description
    .toLowerCase()
    .split(/[^a-z0-9_/-]+/)
    .filter((token) => token.length >= 5)
    .some((token) => recentText.includes(token));
}

/**
 * Detect which relevance categories are needed based on conversation
 */
export function detectRelevantCategories(messages: LLMMessage[]): Set<RelevanceCategory> {
  const categories = new Set<RelevanceCategory>(['always']);
  const recentMessages = messages.slice(-8);
  const recentText = getRecentSelectionText(messages);

  // Check for trigger keywords
  for (const [category, triggers] of Object.entries(CATEGORY_TRIGGERS)) {
    if (triggers.some(trigger => matchesCategoryTrigger(recentText, trigger))) {
      categories.add(category as RelevanceCategory);
    }
  }

  // Check recent tool usage for continuity
  for (const msg of recentMessages) {
    if (msg.tool_calls) {
      for (const call of msg.tool_calls) {
        const category = RELEVANCE_CATEGORIES[call.function.name];
        if (category) {
          categories.add(category);
        }
      }
    }
    if (msg.role === 'tool' && msg.name) {
      const category = RELEVANCE_CATEGORIES[msg.name];
      if (category) {
        categories.add(category);
      }
    }
  }

  return categories;
}

/**
 * Filter tools by relevance to reduce token overhead
 */
export function filterToolsByRelevance(
  tools: FunctionDefinition[],
  messages: LLMMessage[],
  options: ToolRelevanceOptions = {},
): FunctionDefinition[] {
  const cacheEnabled = options.cache !== false;
  const cacheKey = cacheEnabled ? stableToolCacheKey(tools, messages) : '';
  const cachedNames = cacheEnabled ? toolSelectionCache.get(cacheKey) : undefined;
  if (cachedNames) {
    return restoreCachedSelection(tools, cachedNames);
  }

  const relevantCategories = detectRelevantCategories(messages);
  const recentText = getRecentSelectionText(messages);

  const selected = tools.filter(tool => {
    const category = RELEVANCE_CATEGORIES[tool.name];
    if (category && relevantCategories.has(category)) {
      return true;
    }

    return matchesToolByText(tool, recentText);
  });

  if (cacheEnabled) {
    rememberToolSelection(cacheKey, selected.map((tool) => tool.name));
  }

  return selected;
}

export function formatToolCapabilityCatalog(tools: ToolDefinition[]): string {
  const grouped = new Map<string, string[]>();
  for (const tool of tools) {
    const relevance = RELEVANCE_CATEGORIES[tool.name] ?? 'meta';
    const label = CATALOG_LABELS[relevance];
    const existing = grouped.get(label) ?? [];
    existing.push(tool.name);
    grouped.set(label, existing);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, names]) => `- ${label}: ${[...new Set(names)].sort().join(', ')}`)
    .join('\n');
}

/**
 * Get summary of filtering for debugging
 */
export function getRelevanceFilteringSummary(
  originalCount: number,
  filteredCount: number,
  categories: Set<RelevanceCategory>
): string {
  const saved = originalCount - filteredCount;
  const percent = originalCount > 0 ? Math.round((saved / originalCount) * 100) : 0;
  return `Tools: ${filteredCount}/${originalCount} (-${percent}%, categories: ${[...categories].join(', ')})`;
}

/**
 * Estimate token savings from filtering
 */
export function estimateTokenSavings(
  originalTools: FunctionDefinition[],
  filteredTools: FunctionDefinition[]
): number {
  const originalSize = JSON.stringify(originalTools).length;
  const filteredSize = JSON.stringify(filteredTools).length;
  return Math.floor((originalSize - filteredSize) / 4);
}
