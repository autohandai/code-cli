/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tool filtering based on client context and risk categories
 * Inspired by Claude Code's permission model
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
  team_status: 'meta',
  send_team_message: 'meta',
  ask_followup_question: 'meta',

  // Read operations
  read_file: 'read',
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
  custom_command: 'shell'
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
      'search',              // Don't allow broad searches
      'search_with_context', // Don't allow broad searches
      'semantic_search',     // Don't allow broad searches
      'run_command',         // No shell access
      'custom_command',      // No shell access
      'file_stats',          // Don't expose file metadata
      'checksum',            // Don't expose file checksums
      'ask_followup_question' // Requires interactive terminal
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

  // Restricted: Read-only mode
  restricted: {
    allowedCategories: ['read', 'git_read', 'meta'],
    blockedTools: [
      'list_tree',           // Even in read mode, don't expose full structure
      'ask_followup_question' // Requires interactive terminal (may be running in restricted non-interactive mode)
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
  | 'git_basic'   // Basic git operations
  | 'git_advanced'// Advanced git (worktree, rebase, cherry-pick)
  | 'search'      // Search operations
  | 'dependencies'// Package management
  | 'meta';       // Planning, memory, delegation

/**
 * Map tools to relevance categories
 */
const RELEVANCE_CATEGORIES: Record<string, RelevanceCategory> = {
  // Always include
  read_file: 'always',
  write_file: 'always',
  search: 'always',
  list_tree: 'always',
  plan: 'always',
  run_command: 'always',
  todo_write: 'always',

  // Filesystem
  append_file: 'filesystem',
  apply_patch: 'filesystem',
  create_directory: 'filesystem',
  delete_path: 'filesystem',
  rename_path: 'filesystem',
  copy_path: 'filesystem',
  search_replace: 'filesystem',
  format_file: 'filesystem',
  file_stats: 'filesystem',
  checksum: 'filesystem',
  multi_file_edit: 'filesystem',
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
  git_push: 'git_basic',
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

  // Meta
  tools_registry: 'meta',
  save_memory: 'meta',
  recall_memory: 'meta',
  smart_context_cropper: 'meta',
  create_meta_tool: 'meta',
  custom_command: 'meta',
  delegate_task: 'meta',
  delegate_parallel: 'meta',
  create_team: 'meta',
  add_teammate: 'meta',
  create_task: 'meta',
  team_status: 'meta',
  send_team_message: 'meta',
  ask_followup_question: 'always', // User interaction should always be available when in interactive mode
};

/**
 * Keywords that trigger inclusion of certain categories
 */
const CATEGORY_TRIGGERS: Record<RelevanceCategory, string[]> = {
  always: [],
  filesystem: ['file', 'directory', 'folder', 'create', 'delete', 'rename', 'copy', 'move', 'format', 'edit'],
  git_basic: ['git', 'commit', 'branch', 'diff', 'status', 'stash', 'pull', 'push'],
  git_advanced: ['merge', 'rebase', 'cherry-pick', 'worktree', 'reset'],
  search: ['search', 'find', 'grep', 'look for', 'locate', 'where is'],
  dependencies: ['dependency', 'dependencies', 'package', 'npm', 'install', 'yarn', 'bun add'],
  meta: ['tool', 'delegate', 'agent', 'remember', 'memory', 'recall',
         'team', 'teammate', 'together', 'engineers', 'crew', 'collaborate'],
};

/**
 * Detect which relevance categories are needed based on conversation
 */
export function detectRelevantCategories(messages: LLMMessage[]): Set<RelevanceCategory> {
  const categories = new Set<RelevanceCategory>(['always']);

  // Look at recent messages
  const recentMessages = messages.slice(-8);
  const recentText = recentMessages
    .map(m => m.content ?? '')
    .join(' ')
    .toLowerCase();

  // Check for trigger keywords
  for (const [category, triggers] of Object.entries(CATEGORY_TRIGGERS)) {
    if (triggers.some(trigger => recentText.includes(trigger))) {
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
  messages: LLMMessage[]
): FunctionDefinition[] {
  const relevantCategories = detectRelevantCategories(messages);

  return tools.filter(tool => {
    const category = RELEVANCE_CATEGORIES[tool.name];
    // Include if category is relevant or if tool is unknown (be safe)
    return !category || relevantCategories.has(category);
  });
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
