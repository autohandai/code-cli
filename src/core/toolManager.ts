/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  AgentAction,
  ToolCallRequest,
  ToolActionOutcome,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolFailureKind,
  FunctionDefinition
} from '../types.js';
import {
  getPermissionPolicyDisposition,
  isAllowedPermissionPrompt,
  normalizePermissionPromptResponse,
  type PermissionContext,
  type PermissionPromptResponse,
} from '../permissions/types.js';
import { PermissionManager } from '../permissions/PermissionManager.js';
import type { HookExecutionResult } from './HookManager.js';
import {
  getToolCategory,
  ToolFilter,
  type ClientContext,
  type ToolCategory,
  type ToolPolicy
} from './toolFilter.js';
import { getPlanModeManager } from '../commands/plan.js';
import { randomUUID } from 'node:crypto';

type ReadyToolExecutionTask = {
  call: ToolCallRequest;
  index: number;
};

const TOOL_ABORTED_MESSAGE = 'Tool execution aborted.';

class ToolExecutionAbortedError extends Error {
  constructor() {
    super(TOOL_ABORTED_MESSAGE);
    this.name = 'AbortError';
  }
}

const SEQUENTIAL_TOOL_CATEGORIES = new Set<ToolCategory>([
  'write',
  'create',
  'delete',
  'git_write',
  'shell'
]);

export function shouldPromptForToolPermission(
  tool: string,
  explicitlyRequired = false,
  authorizedTool = tool
): boolean {
  return explicitlyRequired
    || SEQUENTIAL_TOOL_CATEGORIES.has(getToolCategory(tool))
    || authorizedTool !== tool;
}

export interface ToolParameter {
  type: string;
  description: string;
  enum?: string[];
  properties?: Record<string, ToolParameter>;
  required?: string[];
  /** Optional schema for array items */
  items?: ToolParameter | {
    type: string;
    description?: string;
    enum?: string[];
    properties?: Record<string, ToolParameter>;
    required?: string[];
  };
}

export interface ToolParameters {
  type: 'object';
  properties: Record<string, ToolParameter>;
  required?: string[];
}

/** Normalized item schema for array types */
export interface NormalizedItemSchema {
  type: string;
  description?: string;
  enum?: string[];
  properties?: Record<string, NormalizedPropertySchema>;
  required?: string[];
  additionalProperties?: boolean;
}

/** Normalized property schema */
export interface NormalizedPropertySchema {
  type: string;
  description?: string;
  enum?: string[];
  items?: NormalizedItemSchema;
  properties?: Record<string, NormalizedPropertySchema>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolDefinition {
  name: AgentAction['type'];
  description: string;
  parameters?: ToolParameters;
  requiresApproval?: boolean;
  approvalMessage?: string;
}

export interface ToolManagerOptions {
  executor: (action: AgentAction, context?: ToolExecutionContext) => Promise<ToolActionOutcome>;
  confirmApproval: (message: string, context?: { tool?: string; path?: string; command?: string }) => Promise<PermissionPromptResponse>;
  definitions?: ToolDefinition[];
  /** Client context for tool filtering (default: 'cli') */
  clientContext?: ClientContext;
  /** Custom policy to override default context policy */
  customPolicy?: Partial<ToolPolicy>;
  /** Max concurrent tool executions (default: 5) */
  maxConcurrency?: number;
  /** Canonical authorization dependencies used before any tool-side effects. */
  authorization?: ToolAuthorizationOptions;
}

export interface PreToolHookContext {
  tool: string;
  toolCallId: string;
  args: Record<string, unknown>;
  path?: string;
  signal?: AbortSignal;
}

export interface ToolAuthorizationOptions {
  permissionManager: PermissionManager;
  /** Resolve specialized contexts, such as the expanded shell command for a meta-tool. */
  resolvePermissionContext?: (action: AgentAction) => PermissionContext | undefined;
  runPreToolHooks?: (context: PreToolHookContext) => Promise<HookExecutionResult[]>;
  onAdditionalContext?: (context: string) => void | Promise<void>;
}

const WRITE_CAPABILITY_TOOLS = new Set<AgentAction['type']>([
  'write_file',
  'append_file',
  'apply_patch',
  'notebook_edit',
  'search_replace',
  'format_file',
  'multi_file_edit',
  'delete_path',
  'rename_path',
  'copy_path',
]);

function resolveEffectivePermissionTool(
  action: AgentAction,
  values: Record<string, unknown>,
): string {
  if (action.type === 'custom_command' || action.type === 'git_worktree_run_parallel') {
    return 'run_command';
  }
  if ((action.type === 'code_review' && values.scope === 'file' && values.path !== undefined)
    || (action.type === 'git_diff' && values.path !== undefined)
    || (action.type === 'fff_grep' && values.path !== undefined)
    || (action.type === 'find' && values.path !== undefined)
    || action.type === 'checksum') {
    return 'read_file';
  }
  if (action.type === 'git_checkout'
    || action.type === 'add_dependency'
    || action.type === 'remove_dependency'
    || WRITE_CAPABILITY_TOOLS.has(action.type)) {
    return 'write_file';
  }
  return action.type;
}

/** Build all standard permission contexts shared by canonical and direct callers. */
export function buildToolPermissionContexts(action: AgentAction): PermissionContext[] {
  const values = action as unknown as Record<string, unknown>;
  const effectiveTool = resolveEffectivePermissionTool(action, values);
  const context: PermissionContext = { tool: effectiveTool };

  if (action.type === 'run_command'
    || action.type === 'shell'
    || action.type === 'custom_command'
    || action.type === 'git_worktree_run_parallel') {
    if (typeof values.command !== 'string' || values.command.length === 0) {
      throw new Error(`Tool '${action.type}' requires a string command for authorization.`);
    }
    context.command = values.command;
    if (values.args !== undefined) {
      if (!Array.isArray(values.args) || values.args.some(value => typeof value !== 'string')) {
        throw new Error(`Tool '${action.type}' requires string command arguments for authorization.`);
      }
      context.args = [...values.args];
    }
  }

  if (action.type === 'add_dependency' || action.type === 'remove_dependency') {
    return [{ ...context, path: 'package.json' }];
  }

  if (action.type === 'rename_path' || action.type === 'copy_path') {
    if (typeof values.from !== 'string' || typeof values.to !== 'string') {
      throw new Error(`Tool '${action.type}' requires string source and destination paths for authorization.`);
    }
    return [
      { ...context, path: values.from },
      { ...context, path: values.to },
    ];
  }

  const pathValue = values.path ?? values.file_path ?? values.from ?? values.to;
  if (pathValue !== undefined) {
    if (typeof pathValue !== 'string') {
      throw new Error(`Tool '${action.type}' requires a string path for authorization.`);
    }
    context.path = pathValue;
  }

  if (typeof values.description === 'string') {
    context.description = values.description;
  }
  return [context];
}

/** Build the primary standard permission context for compatibility callers. */
export function buildToolPermissionContext(action: AgentAction): PermissionContext {
  return buildToolPermissionContexts(action)[0];
}

export const GOAL_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'get_goal',
    description: 'Inspect the current persistent goal, queue, status, time and token budgets, and progress metadata. Use only for explicit goal-management requests.'
  },
  {
    name: 'create_goal',
    description: 'Create a persistent goal only when the user explicitly asks for durable goal tracking or long-running goal pursuit. If a non-terminal goal is already active, the new goal is queued. Do not infer goals from ordinary tasks.',
    parameters: {
      type: 'object',
      properties: {
        objective: { type: 'string', description: 'Explicit user-requested goal objective' },
        token_budget: { type: 'number', description: 'Optional positive token budget' },
        time_budget_seconds: { type: 'number', description: 'Optional positive time budget in seconds' },
        min_tokens_before_wrap_up: { type: 'number', description: 'Optional minimum tokens before normal completion is allowed' },
        min_time_seconds_before_wrap_up: { type: 'number', description: 'Optional minimum time in seconds before normal completion is allowed' }
      },
      required: ['objective']
    }
  },
  {
    name: 'create_goal_from_template',
    description: 'Resolve a reusable .pi-goals template and create the resulting persistent goal when the user explicitly requests a template/workflow goal. If a non-terminal goal is already active, the new goal is queued.',
    parameters: {
      type: 'object',
      properties: {
        template: { type: 'string', description: 'Template name or alias' },
        flags: { type: 'object', description: 'Template flag values' },
        args: { type: 'string', description: 'Trailing template arguments' },
        token_budget: { type: 'number', description: 'Optional positive token budget' },
        time_budget_seconds: { type: 'number', description: 'Optional positive time budget in seconds' },
        min_tokens_before_wrap_up: { type: 'number', description: 'Optional minimum tokens before normal completion is allowed' },
        min_time_seconds_before_wrap_up: { type: 'number', description: 'Optional minimum time in seconds before normal completion is allowed' }
      },
      required: ['template']
    }
  },
  {
    name: 'update_goal',
    description: 'Update the current goal when the user explicitly asks to edit, pause, resume, complete, or adjust budgets.',
    parameters: {
      type: 'object',
      properties: {
        objective: { type: 'string', description: 'Optional replacement objective' },
        status: { type: 'string', description: 'Optional status', enum: ['active', 'paused', 'complete', 'budgetLimited'] },
        token_budget: { type: 'number', description: 'Optional positive token budget; use clear_goal for removal requests' },
        time_budget_seconds: { type: 'number', description: 'Optional positive time budget in seconds' },
        min_tokens_before_wrap_up: { type: 'number', description: 'Optional token floor' },
        min_time_seconds_before_wrap_up: { type: 'number', description: 'Optional time floor in seconds' }
      }
    }
  },
  {
    name: 'clear_goal',
    description: 'Clear the current persistent goal only when the user explicitly asks to clear, remove, delete, or dismiss it.'
  },
  {
    name: 'list_goal_templates',
    description: 'List reusable .pi-goals templates from bounded project template directories.'
  },
  {
    name: 'enqueue_goal',
    description: 'Add a persistent goal to the FIFO queue only when the user explicitly asks to queue later goal work.',
    parameters: {
      type: 'object',
      properties: {
        objective: { type: 'string', description: 'Goal objective to queue' },
        token_budget: { type: 'number', description: 'Optional positive token budget' },
        time_budget_seconds: { type: 'number', description: 'Optional positive time budget in seconds' },
        min_tokens_before_wrap_up: { type: 'number', description: 'Optional token floor' },
        min_time_seconds_before_wrap_up: { type: 'number', description: 'Optional time floor in seconds' }
      },
      required: ['objective']
    }
  },
  {
    name: 'list_goal_queue',
    description: 'List queued goal objectives waiting to run after the active goal completes or clears.'
  },
  {
    name: 'start_queued_goal',
    description: 'Start the next queued direct goal after verifying no non-terminal goal is active. The queue item is removed only after goal creation succeeds.'
  },
  {
    name: 'dequeue_goal',
    description: 'Remove the first queued goal after it is truly satisfied or the user explicitly authorized removing it. Requires audit rationale and authority.',
    parameters: {
      type: 'object',
      properties: {
        rationale: { type: 'string', description: 'Why this queue head is being dequeued now' },
        authority: { type: 'string', description: 'User authorization or completion evidence for dequeuing' }
      },
      required: ['rationale', 'authority']
    }
  },
  {
    name: 'remove_queued_goal',
    description: 'Remove a specific queued goal by queue ID only when the user explicitly asks.',
    parameters: {
      type: 'object',
      properties: {
        queueId: { type: 'string', description: 'Queue ID to remove' }
      },
      required: ['queueId']
    }
  },
];

export const DEFAULT_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'tools_registry',
    description: 'List all available tools (built-in and meta)'
  },
  {
    name: 'tool_search',
    description: 'Search available tools by capability, name, or description. Use this when you need to discover the best built-in or meta tool for a task instead of guessing.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms for the capability or tool you need (e.g. "delegate agent", "git worktree", "browser screenshot")' },
        limit: { type: 'number', description: 'Maximum matching tools to return (default: 10)' }
      },
      required: ['query']
    }
  },
  {
    name: 'ask_followup_question',
    description: 'Ask the user a follow-up question to gather clarification or preferences. Use when you need specific information to proceed. Include suggested answers when possible to guide the response. Only available in interactive and plan mode.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The specific question to ask the user' },
        suggested_answers: {
          type: 'array',
          description: 'Optional list of 2-4 suggested answers to guide the user response',
          items: { type: 'string', description: 'A suggested answer option' }
        }
      },
      required: ['question']
    },
    requiresApproval: false // User interaction, not a mutation
  },
  {
    name: 'read_file',
    description: 'Read file contents. For large files (>2500 lines), use offset and limit to read in chunks.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file to read' },
        offset: { type: 'number', description: 'Line number to start reading from (0-indexed). Use for large files.' },
        limit: { type: 'number', description: 'Maximum number of lines to read. Use for large files.' }
      },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description: 'Write full contents to a file',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file' },
        contents: { type: 'string', description: 'Full file contents to write' }
      },
      required: ['path', 'contents']
    }
  },
  {
    name: 'notebook_edit',
    description: 'Edit a Jupyter notebook cell without treating the .ipynb file as plain text. Supports replace, insert, and delete by cell index or cell ID.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the .ipynb notebook file' },
        cell_index: { type: 'number', description: '0-based cell index to target. For insert, inserts after this index; omit to append.' },
        cell_id: { type: 'string', description: 'Optional cell ID to target instead of cell_index' },
        new_source: { type: 'string', description: 'New source for replace or insert operations' },
        cell_type: { type: 'string', description: 'Cell type for insert operations', enum: ['code', 'markdown'] },
        edit_mode: { type: 'string', description: 'Notebook edit mode', enum: ['replace', 'insert', 'delete'] }
      },
      required: ['path']
    }
  },
  {
    name: 'append_file',
    description: 'Append text to a file',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file' },
        contents: { type: 'string', description: 'Text to append' }
      },
      required: ['path', 'contents']
    }
  },
  {
    name: 'apply_patch',
    description: 'Apply a unified diff to a file',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file' },
        patch: { type: 'string', description: 'Unified diff patch content' }
      },
      required: ['path', 'patch']
    }
  },
  {
    name: 'fff_grep',
    description: 'Content search with frecency ranking and definition detection when native FFF is available, plus a ripgrep-backed fallback. Use this for content search.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search pattern (regex auto-detected)' },
        path: { type: 'string', description: 'Optional subdirectory to search in' },
        exclude: { type: 'string', description: 'Exclude patterns (comma/space separated)' },
        caseSensitive: { type: 'boolean', description: 'Force case-sensitive matching' },
        beforeContext: { type: 'number', description: 'Lines of context before match (default: 2)' },
        afterContext: { type: 'number', description: 'Lines of context after match (default: 2)' },
        classifyDefinitions: { type: 'boolean', description: 'Prioritize code definitions (default: true)' },
        limit: { type: 'number', description: 'Maximum results (default: 50)' }
      },
      required: ['query']
    }
  },
  {
    name: 'fff_find',
    description: 'Path and filename search with frecency ranking when native FFF is available, plus a ripgrep-backed fallback. Use this for file path discovery.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Filename or path pattern to search' },
        limit: { type: 'number', description: 'Maximum results (default: 50)' }
      },
      required: ['query']
    }
  },
  {
    name: 'create_directory',
    description: 'Create a directory',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path for new directory' }
      },
      required: ['path']
    }
  },
  {
    name: 'delete_path',
    description: 'Remove files or directories from the workspace',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to delete' }
      },
      required: ['path']
    },
    requiresApproval: true
  },
  {
    name: 'rename_path',
    description: 'Rename a file or directory',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Current relative path' },
        to: { type: 'string', description: 'New relative path' }
      },
      required: ['from', 'to']
    }
  },
  {
    name: 'copy_path',
    description: 'Copy a file or directory',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Source relative path' },
        to: { type: 'string', description: 'Destination relative path' }
      },
      required: ['from', 'to']
    }
  },
  {
    name: 'search_replace',
    description: 'Apply precise text replacements using SEARCH/REPLACE blocks. SEARCH must match exactly. Multiple blocks applied in sequence.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        blocks: { type: 'string', description: 'SEARCH/REPLACE block content' }
      },
      required: ['path', 'blocks']
    }
  },
  {
    name: 'run_command',
    description: 'Execute a shell command in the user\'s shell with full pipe, redirect, and environment variable support. Cross-platform (bash/zsh on macOS/Linux, cmd/PowerShell on Windows). Prefer dedicated tools for file operations (read_file, write_file, fff_grep, fff_find). For most commands, prefer the `shell` tool instead - it shows real-time output. Use this only for quick commands where you don\'t need progress monitoring.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to execute. Supports pipes (|), redirects (>), env vars ($HOME), globs (*), and chaining (&&).' },
        args: { type: 'array', description: 'Command arguments. Joined with the command into a single shell string. For complex commands with pipes/redirects, put everything in the command field instead.', items: { type: 'string', description: 'Single argument' } },
        directory: { type: 'string', description: 'Directory relative to workspace root to execute in' },
        description: { type: 'string', description: 'Brief description of what this command does (shown to user)' },
        background: { type: 'boolean', description: 'Run process in background (returns PID, useful for dev servers)' }
      },
      required: ['command']
    },
    requiresApproval: true,
    approvalMessage: 'Allow the agent to run a shell command?'
  },
  {
    name: 'shell',
    description: 'Execute a shell command with real-time output displayed in a live, isolated box in the TUI. Use this as the DEFAULT for running shell commands - it shows stdout/stderr in real-time while keeping the CLI input responsive. Ideal for tests, builds, installs, dev servers, and any command where you want to see progress. For quick one-liners where output monitoring isn\'t needed, you can use run_command instead.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to execute. Supports pipes (|), redirects (>), env vars ($HOME), globs (*), and chaining (&&).' },
        args: { type: 'array', description: 'Command arguments. Joined with the command into a single shell string.', items: { type: 'string', description: 'Single argument' } },
        directory: { type: 'string', description: 'Directory relative to workspace root to execute in' },
        description: { type: 'string', description: 'Brief description of what this command does (shown to user)' },
        background: { type: 'boolean', description: 'Run process in background (detached). Returns immediately with PID. Use for dev servers, long-running processes, or when you don\'t need to wait for completion.' }
      },
      required: ['command']
    },
    requiresApproval: true,
    approvalMessage: 'Allow the agent to run a shell command with live output?'
  },
  {
    name: 'add_dependency',
    description: 'Add a package dependency (supports dev flag)',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Package name' },
        version: { type: 'string', description: 'Version specifier' },
        dev: { type: 'boolean', description: 'Install as dev dependency' }
      },
      required: ['name']
    }
  },
  {
    name: 'remove_dependency',
    description: 'Remove a package dependency (supports dev flag)',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Package name' },
        dev: { type: 'boolean', description: 'Remove from dev dependencies' }
      },
      required: ['name']
    }
  },
  {
    name: 'format_file',
    description: 'Format a file with a named formatter',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file' },
        formatter: { type: 'string', description: 'Formatter name (prettier, eslint, etc.)' }
      },
      required: ['path', 'formatter']
    }
  },
  {
    name: 'list_tree',
    description: 'List a directory tree for the workspace',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path (default: workspace root)' },
        depth: { type: 'number', description: 'Maximum depth (default: 2)' }
      }
    }
  },
  {
    name: 'file_stats',
    description: 'Return file statistics and metadata',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file' }
      },
      required: ['path']
    }
  },
  {
    name: 'checksum',
    description: 'Compute a checksum for a file',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file' },
        algorithm: { type: 'string', description: 'Hash algorithm (default: sha256)' }
      },
      required: ['path']
    }
  },
  {
    name: 'git_diff',
    description: 'Show git diff. When path is provided, shows diff for that file only. When omitted, shows all uncommitted changes in the workspace.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to a specific file (optional). Omit to diff the entire workspace.' }
      }
    }
  },
  {
    name: 'git_checkout',
    description: 'Restore a file from git',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file' }
      },
      required: ['path']
    }
  },
  {
    name: 'git_status',
    description: 'Show git status for the workspace'
  },
  {
    name: 'git_list_untracked',
    description: 'List untracked git files'
  },
  {
    name: 'git_diff_range',
    description: 'Show git diff for a range or staged files',
    parameters: {
      type: 'object',
      properties: {
        range: { type: 'string', description: 'Commit range (e.g., HEAD~3..HEAD)' },
        staged: { type: 'boolean', description: 'Show staged changes only' },
        paths: { type: 'array', description: 'Specific paths to diff', items: { type: 'string', description: 'Path to diff' } }
      }
    }
  },
  {
    name: 'git_apply_patch',
    description: 'Apply a git patch to the working tree',
    parameters: {
      type: 'object',
      properties: {
        patch: { type: 'string', description: 'Git patch content' }
      },
      required: ['patch']
    },
    requiresApproval: true
  },
  {
    name: 'git_worktree_list',
    description: 'List git worktrees'
  },
  {
    name: 'git_worktree_add',
    description: 'Add a git worktree (may modify git state)',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path for the new worktree' },
        ref: { type: 'string', description: 'Branch or commit to checkout' }
      },
      required: ['path']
    },
    requiresApproval: true
  },
  {
    name: 'git_worktree_remove',
    description: 'Remove a git worktree',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path of the worktree to remove' },
        force: { type: 'boolean', description: 'Force removal' }
      },
      required: ['path']
    },
    requiresApproval: true
  },
  {
    name: 'git_worktree_status_all',
    description: 'Get comprehensive status of all worktrees (changes, commits, sync state)'
  },
  {
    name: 'git_worktree_cleanup',
    description: 'Find and clean up stale/merged worktrees',
    parameters: {
      type: 'object',
      properties: {
        dry_run: { type: 'boolean', description: 'Preview without removing' },
        remove_merged: { type: 'boolean', description: 'Remove merged branches' },
        remove_stale: { type: 'boolean', description: 'Remove stale worktrees' }
      }
    },
    requiresApproval: true
  },
  {
    name: 'git_worktree_run_parallel',
    description: 'Run a command in parallel across all worktrees',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to run' },
        timeout: { type: 'number', description: 'Timeout in ms' },
        max_concurrent: { type: 'number', description: 'Max parallel executions' }
      },
      required: ['command']
    },
    requiresApproval: true
  },
  {
    name: 'git_worktree_sync',
    description: 'Sync changes from main branch to all worktrees (rebase or merge)',
    parameters: {
      type: 'object',
      properties: {
        strategy: { type: 'string', description: 'Sync strategy: rebase or merge' },
        main_branch: { type: 'string', description: 'Main branch name' },
        dry_run: { type: 'boolean', description: 'Preview without syncing' }
      }
    },
    requiresApproval: true
  },
  {
    name: 'git_worktree_create_for_pr',
    description: 'Create a worktree for reviewing a specific PR',
    parameters: {
      type: 'object',
      properties: {
        pr_number: { type: 'number', description: 'PR number' },
        remote: { type: 'string', description: 'Remote name (default: origin)' }
      },
      required: ['pr_number']
    },
    requiresApproval: true
  },
  {
    name: 'git_worktree_create_from_template',
    description: 'Create a worktree using a template (feature, hotfix, release, review, experiment)',
    parameters: {
      type: 'object',
      properties: {
        template: { type: 'string', description: 'Template name' },
        branch: { type: 'string', description: 'Branch name for the worktree' },
        base_branch: { type: 'string', description: 'Base branch to branch from' },
        run_setup: { type: 'boolean', description: 'Run setup commands' }
      },
      required: ['template', 'branch']
    },
    requiresApproval: true
  },
  {
    name: 'git_stash',
    description: 'Stash current changes (supports message, include-untracked, keep-index)',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Stash message' },
        include_untracked: { type: 'boolean', description: 'Include untracked files' },
        keep_index: { type: 'boolean', description: 'Keep staged changes' }
      }
    }
  },
  {
    name: 'git_stash_list',
    description: 'List all stashed changes'
  },
  {
    name: 'git_stash_pop',
    description: 'Apply and remove the most recent stash (or specified stash)',
    parameters: {
      type: 'object',
      properties: {
        stash_ref: { type: 'string', description: 'Stash reference (e.g., stash@{0})' }
      }
    },
    requiresApproval: true
  },
  {
    name: 'git_stash_apply',
    description: 'Apply a stash without removing it',
    parameters: {
      type: 'object',
      properties: {
        stash_ref: { type: 'string', description: 'Stash reference (e.g., stash@{0})' }
      }
    }
  },
  {
    name: 'git_stash_drop',
    description: 'Drop a stash entry',
    parameters: {
      type: 'object',
      properties: {
        stash_ref: { type: 'string', description: 'Stash reference (e.g., stash@{0})' }
      }
    },
    requiresApproval: true
  },
  {
    name: 'git_branch',
    description: 'List or create/delete branches',
    parameters: {
      type: 'object',
      properties: {
        branch_name: { type: 'string', description: 'Branch name (omit to list)' },
        delete: { type: 'boolean', description: 'Delete the branch' },
        force: { type: 'boolean', description: 'Force delete' }
      }
    }
  },
  {
    name: 'git_switch',
    description: 'Switch to a branch (can create with -c flag)',
    parameters: {
      type: 'object',
      properties: {
        branch_name: { type: 'string', description: 'Branch to switch to' },
        create: { type: 'boolean', description: 'Create new branch' }
      },
      required: ['branch_name']
    }
  },
  {
    name: 'git_cherry_pick',
    description: 'Cherry-pick commits onto current branch',
    parameters: {
      type: 'object',
      properties: {
        commits: { type: 'array', description: 'Commit SHAs to cherry-pick', items: { type: 'string', description: 'Commit SHA' } },
        no_commit: { type: 'boolean', description: 'Apply without committing' },
        mainline: { type: 'number', description: 'Parent number for merge commits' }
      },
      required: ['commits']
    },
    requiresApproval: true
  },
  {
    name: 'git_cherry_pick_abort',
    description: 'Abort an in-progress cherry-pick'
  },
  {
    name: 'git_cherry_pick_continue',
    description: 'Continue an in-progress cherry-pick after resolving conflicts'
  },
  {
    name: 'git_rebase',
    description: 'Rebase current branch onto another (non-interactive)',
    parameters: {
      type: 'object',
      properties: {
        upstream: { type: 'string', description: 'Upstream branch to rebase onto' },
        onto: { type: 'string', description: 'New base commit' },
        autosquash: { type: 'boolean', description: 'Auto-squash fixup commits' }
      },
      required: ['upstream']
    },
    requiresApproval: true
  },
  {
    name: 'git_rebase_abort',
    description: 'Abort an in-progress rebase'
  },
  {
    name: 'git_rebase_continue',
    description: 'Continue an in-progress rebase after resolving conflicts'
  },
  {
    name: 'git_rebase_skip',
    description: 'Skip the current commit during a rebase'
  },
  {
    name: 'git_merge',
    description: 'Merge a branch into current branch',
    parameters: {
      type: 'object',
      properties: {
        branch: { type: 'string', description: 'Branch to merge' },
        no_commit: { type: 'boolean', description: 'Merge without committing' },
        no_ff: { type: 'boolean', description: 'No fast-forward' },
        squash: { type: 'boolean', description: 'Squash commits' },
        message: { type: 'string', description: 'Merge commit message' }
      },
      required: ['branch']
    },
    requiresApproval: true
  },
  {
    name: 'git_merge_abort',
    description: 'Abort an in-progress merge'
  },
  {
    name: 'git_commit',
    description: 'Create a commit with the staged changes',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Commit message' },
        amend: { type: 'boolean', description: 'Amend previous commit' },
        allow_empty: { type: 'boolean', description: 'Allow empty commit' }
      },
      required: ['message']
    },
    requiresApproval: true
  },
  {
    name: 'git_add',
    description: 'Stage files for commit',
    parameters: {
      type: 'object',
      properties: {
        paths: { type: 'array', description: 'Paths to stage (default: all)', items: { type: 'string', description: 'Path to stage' } }
      }
    }
  },
  {
    name: 'git_reset',
    description: 'Reset HEAD and/or working tree (soft/mixed/hard)',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', description: 'Reset mode: soft, mixed, or hard', enum: ['soft', 'mixed', 'hard'] },
        ref: { type: 'string', description: 'Commit reference to reset to' }
      }
    },
    requiresApproval: true
  },
  {
    name: 'auto_commit',
    description: 'Automatically stage all changes and create a commit. In interactive mode, user can accept/edit/reject the message. In yes/non-interactive mode, commits immediately with the suggested or provided message.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Optional commit message (auto-generated if not provided)' },
        stage_all: { type: 'boolean', description: 'Stage all changes before committing (default: true)' }
      }
    },
    requiresApproval: false  // Interactive flow prompts inside the tool; yes/non-interactive auto-approves
  },
  {
    name: 'git_log',
    description: 'Show commit history',
    parameters: {
      type: 'object',
      properties: {
        max_count: { type: 'number', description: 'Maximum commits to show' },
        oneline: { type: 'boolean', description: 'One line per commit' },
        graph: { type: 'boolean', description: 'Show branch graph' },
        all: { type: 'boolean', description: 'Show all branches' }
      }
    }
  },
  {
    name: 'git_fetch',
    description: 'Fetch from remote repository',
    parameters: {
      type: 'object',
      properties: {
        remote: { type: 'string', description: 'Remote name (default: origin)' },
        branch: { type: 'string', description: 'Branch to fetch' }
      }
    }
  },
  {
    name: 'git_pull',
    description: 'Pull changes from remote',
    parameters: {
      type: 'object',
      properties: {
        remote: { type: 'string', description: 'Remote name (default: origin)' },
        branch: { type: 'string', description: 'Branch to pull' }
      }
    },
    requiresApproval: true
  },
  {
    name: 'git_push',
    description: 'Push changes to remote',
    parameters: {
      type: 'object',
      properties: {
        remote: { type: 'string', description: 'Remote name (default: origin)' },
        branch: { type: 'string', description: 'Branch to push' },
        force: { type: 'boolean', description: 'Force push' },
        set_upstream: { type: 'boolean', description: 'Set upstream tracking' }
      }
    },
    requiresApproval: true
  },
  {
    name: 'custom_command',
    description: 'Define and execute a one-off command (saved for reuse)',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Command name for reuse' },
        command: { type: 'string', description: 'Shell command' },
        args: { type: 'array', description: 'Command arguments', items: { type: 'string', description: 'Single argument' } },
        description: { type: 'string', description: 'Command description' },
        dangerous: { type: 'boolean', description: 'Mark as dangerous' }
      },
      required: ['name', 'command']
    }
  },
  {
    name: 'todo_write',
    description: 'Persist and update the todo list. Send the COMPLETE updated todo list each time (not incremental changes).',
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          description: 'The complete updated todo list with all tasks and their current statuses',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string', description: 'Task description (what needs to be done)' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed'], description: 'Current task status' },
              activeForm: { type: 'string', description: 'Present continuous form shown during execution (e.g., "Running tests")' }
            },
            required: ['content', 'status', 'activeForm']
          }
        }
      },
      required: ['tasks']
    }
  },
  {
    name: 'smart_context_cropper',
    description: 'Trim conversation history when context is full',
    parameters: {
      type: 'object',
      properties: {
        crop_direction: { type: 'string', description: 'Direction: top or bottom', enum: ['top', 'bottom'] },
        crop_amount: { type: 'number', description: 'Number of messages to crop' },
        need_user_approve: { type: 'boolean', description: 'Ask user for approval' },
        deleted_messages_summary: { type: 'string', description: 'Summary of cropped content' }
      },
      required: ['crop_direction', 'crop_amount']
    }
  },
  {
    name: 'save_memory',
    description: 'Save a fact or preference to memory for recall in future sessions. Use for important user preferences, project conventions, or key information worth remembering.',
    parameters: {
      type: 'object',
      properties: {
        fact: { type: 'string', description: 'The fact or preference to remember. Should be a clear, self-contained statement.' },
        level: { type: 'string', description: 'Storage level: "user" (global across projects) or "project" (specific to current workspace)', enum: ['user', 'project'] }
      },
      required: ['fact']
    }
  },
  {
    name: 'recall_memory',
    description: 'Recall stored memories and preferences. Use to check what preferences are already saved or to find specific information.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional search query to filter memories. If omitted, returns all memories.' },
        level: { type: 'string', description: 'Filter by level: "user" (global) or "project" (workspace-specific). If omitted, returns both.', enum: ['user', 'project'] }
      },
      required: []
    }
  },
  {
    name: 'create_meta_tool',
    description: 'Create a new reusable tool that persists across sessions. Use for automating repetitive shell commands or extending capabilities.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Tool name in snake_case (e.g., analyze_imports, count_lines)' },
        description: { type: 'string', description: 'Clear description of what the tool does' },
        parameters: { type: 'object', description: 'JSON Schema defining tool parameters' },
        handler: { type: 'string', description: 'Shell command template with {{param}} placeholders (e.g., "grep -E {{pattern}} {{path}}")' },
        scope: { type: 'string', description: 'Where to persist the tool: "user" for all workspaces or "project" for this repository only', enum: ['user', 'project'] }
      },
      required: ['name', 'description', 'parameters', 'handler']
    }
  },
  {
    name: 'delegate_task',
    description: 'Delegate a focused task to a specialized sub-agent. Use for broader exploration, verification, or work you want to keep out of the main context.',
    parameters: {
      type: 'object',
      properties: {
        agent_name: { type: 'string', description: 'Registered agent name to delegate to' },
        task: { type: 'string', description: 'Concrete task for the delegated agent' }
      },
      required: ['agent_name', 'task']
    }
  },
  {
    name: 'delegate_parallel',
    description: 'Delegate multiple independent tasks to specialized sub-agents in parallel.',
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          description: 'Independent agent tasks to run in parallel',
          items: {
            type: 'object',
            properties: {
              agent_name: { type: 'string', description: 'Registered agent name to delegate to' },
              task: { type: 'string', description: 'Concrete task for that agent' }
            },
            required: ['agent_name', 'task']
          }
        }
      },
      required: ['tasks']
    }
  },
  {
    name: 'create_team',
    description: 'Create or reuse a teammate coordination group for multi-agent work.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Team name' }
      },
      required: ['name']
    }
  },
  {
    name: 'add_teammate',
    description: 'Add a teammate process to the active team using a registered agent.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Human-readable teammate name' },
        agent_name: { type: 'string', description: 'Registered agent name to run' },
        model: { type: 'string', description: 'Optional model override for that teammate' }
      },
      required: ['name', 'agent_name']
    }
  },
  {
    name: 'create_task',
    description: 'Create a team task that can be assigned to an idle teammate.',
    parameters: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: 'Short task title' },
        description: { type: 'string', description: 'Detailed task description' },
        blocked_by: {
          type: 'array',
          description: 'Optional prerequisite task IDs that must complete first',
          items: { type: 'string', description: 'Task ID' }
        }
      },
      required: ['subject', 'description']
    }
  },
  {
    name: 'task_get',
    description: 'Get a single team task by ID from the active team task list.',
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID to retrieve' }
      },
      required: ['task_id']
    }
  },
  {
    name: 'task_list',
    description: 'List tasks from the active team task list, optionally filtered by status or owner.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Optional status filter', enum: ['pending', 'in_progress', 'completed'] },
        owner: { type: 'string', description: 'Optional owner filter' }
      }
    }
  },
  {
    name: 'task_update',
    description: 'Update a task in the active team task list.',
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID to update' },
        subject: { type: 'string', description: 'Updated short task title' },
        description: { type: 'string', description: 'Updated task description' },
        blocked_by: {
          type: 'array',
          description: 'Updated prerequisite task IDs',
          items: { type: 'string', description: 'Task ID' }
        },
        status: { type: 'string', description: 'Updated task status', enum: ['pending', 'in_progress', 'completed'] }
      },
      required: ['task_id']
    }
  },
  {
    name: 'task_stop',
    description: 'Stop an active or queued team task and return it to pending state.',
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID to stop' }
      },
      required: ['task_id']
    }
  },
  {
    name: 'task_output',
    description: 'Store or update the latest output/progress note for a task in the active team task list.',
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID to update' },
        output: { type: 'string', description: 'Latest progress note, result, or output summary for the task' }
      },
      required: ['task_id', 'output']
    }
  },
  {
    name: 'skill',
    description: 'List, inspect, activate, or deactivate a loaded skill. Activating a skill adds its instructions to the active session prompt.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Skill operation to perform', enum: ['list', 'info', 'activate', 'deactivate'] },
        name: { type: 'string', description: 'Skill name for info, activate, or deactivate' }
      },
      required: ['command']
    }
  },
  {
    name: 'sleep',
    description: 'Pause execution for a short time when waiting for another system or process to settle. Use sparingly and prefer explicit polling when possible.',
    parameters: {
      type: 'object',
      properties: {
        seconds: { type: 'number', description: 'Number of seconds to wait (maximum 300)' },
        reason: { type: 'string', description: 'Optional short reason for the wait' }
      },
      required: ['seconds']
    }
  },
  {
    name: 'enter_worktree',
    description: 'Create and enter an isolated git worktree for the current session. Subsequent file, git, and command tools operate in that worktree until exit_worktree is called.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Optional branch/worktree name to use for the new session worktree' }
      }
    }
  },
  {
    name: 'exit_worktree',
    description: 'Exit the current session worktree and return to the original workspace. Optionally keep the worktree on disk for inspection.',
    parameters: {
      type: 'object',
      properties: {
        keep: { type: 'boolean', description: 'When true, keep the worktree and branch instead of removing them' }
      }
    }
  },
  {
    name: 'team_status',
    description: 'Show the active team, teammate statuses, and current task queue.'
  },
  {
    name: 'send_team_message',
    description: 'Send a direct message from the lead agent to a teammate.',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Teammate name' },
        content: { type: 'string', description: 'Message content' }
      },
      required: ['to', 'content']
    }
  },
  // Web Search Operations
  {
    name: 'web_search',
    description: 'Search the web for up-to-date information about packages, libraries, frameworks, documentation, changelogs, and more. Use this when you need current information that may have changed after your training data.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (e.g., "react 19 new features", "zod changelog latest")' },
        max_results: { type: 'number', description: 'Maximum results to return (default: 5)' },
        search_type: { type: 'string', description: 'Type of search: general, packages, docs, changelog', enum: ['general', 'packages', 'docs', 'changelog'] }
      },
      required: ['query']
    }
  },
  {
    name: 'fetch_url',
    description: 'Fetch and extract text content from a URL. Useful for reading documentation, changelogs, release notes, or any web page.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
        max_length: { type: 'number', description: 'Maximum characters to return (default: 30000)' }
      },
      required: ['url']
    }
  },
  {
    name: 'package_info',
    description: 'Get detailed information about a package from npm, PyPI (Python), crates.io (Rust), Go modules, or RubyGems. Auto-detects registry or specify explicitly.',
    parameters: {
      type: 'object',
      properties: {
        package_name: { type: 'string', description: 'Package name (e.g., "react", "requests", "serde", "github.com/gin-gonic/gin")' },
        registry: { type: 'string', description: 'Package registry: npm, pypi, crates, go, rubygems (auto-detected if not specified)', enum: ['npm', 'pypi', 'crates', 'go', 'rubygems'] },
        version: { type: 'string', description: 'Specific version to get info for (default: latest)' }
      },
      required: ['package_name']
    }
  },
  {
    name: 'web_repo',
    description: `Browse GitHub and GitLab repositories. Supports three operations:

- 'info': Get repo metadata (description, stars, language, license, default branch)
- 'list': List directory contents (files and folders at a path)
- 'fetch': Get raw file content (defaults to README.md)

Repo formats: HTTPS or schemeless URLs, .git clone URLs, SSH clone URLs, GitHub tree/blob URLs, or shorthand (owner/repo, github:owner/repo, gitlab:group/project).

Examples:
  { repo: "github:openai/codex", operation: "info" }
  { repo: "gitlab:inkscape/inkscape", operation: "list", path: "src" }
  { repo: "github:openai/codex", operation: "fetch", path: "codex-cli/src/utils.ts" }`,
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Repository URL or shorthand (github:owner/repo, gitlab:group/project)' },
        operation: { type: 'string', description: 'Operation to perform', enum: ['info', 'list', 'fetch'] },
        path: { type: 'string', description: 'File/directory path (default: root for list, README.md for fetch)' },
        branch: { type: 'string', description: 'Branch name (default: repo default branch)' }
      },
      required: ['repo', 'operation']
    }
  },
  // Project Tracker
  {
    name: 'project_tracker',
    description: `Query issues and pull requests for the current project via gh CLI.
Requires gh CLI installed and authenticated (https://cli.github.com).
If a GitHub MCP server is connected with equivalent tools, prefer those instead.

Actions:
- list_issues: List issues (filter by state, assignee, labels)
- get_issue: Get full issue details with comments
- list_prs: List pull requests (filter by state, author, base branch)
- get_pr: Get full PR details with checks and review status
- get_user: Get the authenticated GitHub username`,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'The operation to perform',
          enum: ['list_issues', 'get_issue', 'list_prs', 'get_pr', 'get_user']
        },
        number: { type: 'number', description: 'Issue or PR number (required for get_issue, get_pr). Must be a positive integer.' },
        state: { type: 'string', description: 'Filter by state (default: open). "merged" is only valid for list_prs.', enum: ['open', 'closed', 'merged', 'all'] },
        assignee: { type: 'string', description: 'Filter issues by assignee username. Use @me for the authenticated user.' },
        author: { type: 'string', description: 'Filter PRs by author username' },
        labels: { type: 'string', description: 'Comma-separated label names to filter by' },
        base: { type: 'string', description: 'Filter PRs by base branch' },
        limit: { type: 'number', description: 'Max results to return (default: 20)' },
        repo: { type: 'string', description: 'owner/repo override (default: detected from git remote)' }
      },
      required: ['action']
    }
  },
  // Skills Discovery
  {
    name: 'find_agent_skills',
    description: 'Search the community skills registry for agent skills that match a query. Returns skills with name, description, category, languages, and frameworks. Use this to discover skills that could help with the current task or project.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms — skill name, language, framework, or use-case (e.g. "react testing", "python api", "docker deployment")' },
        category: { type: 'string', description: 'Optional category filter (e.g. "languages", "frameworks", "workflows", "testing")' },
        limit: { type: 'number', description: 'Maximum results to return (default: 10, max: 20)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'install_agent_skill',
    description: 'Install a community skill by exact skill id or name, then optionally activate it for the current session. Prefer asking the user before using this unless they explicitly requested installation or started with --auto-skill.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Exact community skill id or name to install' },
        scope: { type: 'string', description: 'Install scope (default: project)', enum: ['project', 'user'] },
        activate: { type: 'boolean', description: 'Activate the installed skill for the current session (default: true)' },
      },
      required: ['name'],
    },
  },
  // Schedule Management
  {
    name: 'cron_create',
    description: 'Create a recurring scheduled job using an explicit interval and prompt. Use this for structured schedule creation instead of natural-language slash command parsing.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The prompt/instruction to run on each schedule trigger' },
        interval: { type: 'string', description: 'Repeat interval shorthand like 5m, 2h, 1d, or 30s' },
        max_runs: { type: 'number', description: 'Optional maximum number of times to trigger before auto-cancel' },
        expires_in: { type: 'string', description: 'Optional expiry duration shorthand like 7d, 2h, or 30m' },
      },
      required: ['prompt', 'interval']
    }
  },
  {
    name: 'cron_delete',
    description: 'Cancel an active recurring scheduled job by its ID.',
    parameters: {
      type: 'object',
      properties: {
        schedule_id: { type: 'string', description: 'The job ID to cancel' },
      },
      required: ['schedule_id']
    }
  },
  {
    name: 'list_schedules',
    description: 'List all active recurring scheduled jobs. Returns job IDs, prompts, intervals, run counts, and expiry times.',
  },
  {
    name: 'cancel_schedule',
    description: 'Cancel an active recurring scheduled job by its ID. When reporting the result to the user, tell them they can also cancel jobs with the slash command: /repeat cancel <job-id>',
    parameters: {
      type: 'object',
      properties: {
        schedule_id: { type: 'string', description: 'The job ID to cancel (from list_schedules)' },
      },
      required: ['schedule_id'],
    },
  },
  // ── Directory Access ──
  {
    name: 'request_directory_access',
    description: 'Request access to a directory outside the current workspace. Use this when the user mentions a folder or path that is not within the allowed directories. In yolo/auto-mode, access is granted automatically. In interactive mode, the user will be asked to approve. Returns the resolved path if access was granted, or an error message if denied.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The directory path to request access to (absolute or relative to cwd)' },
        reason: { type: 'string', description: 'Optional reason why access is needed (shown to user in interactive mode)' },
      },
      required: ['path'],
    },
    requiresApproval: false, // This tool handles its own approval flow
  },
  // ── Code review ──
  {
    name: 'code_review',
    description: 'Perform a staff-engineer-level code review. Analyzes code quality, architecture, security, performance, and maintainability. Returns 10 prioritized actionable findings with specific file paths, line numbers, and suggested fixes. Use when the user asks to review code, audit quality, or find improvements.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File or directory to review. Defaults to workspace root.' },
        scope: {
          type: 'string',
          description: 'Review scope: "full" analyzes the entire path, "diff" reviews only uncommitted changes, "file" reviews a single file.',
          enum: ['full', 'diff', 'file'],
        },
        instructions: { type: 'string', description: 'Additional review focus areas from the user (e.g., "focus on error handling", "check for memory leaks").' },
      },
    },
  },
  // ── Browser tools (available when Chrome extension is connected via /chrome) ──
  {
    name: 'browser_screenshot',
    description: 'Capture a screenshot of the page currently visible in the Chrome browser tab. Returns a base64 PNG image. Only available when the Chrome extension is connected.',
    parameters: {
      type: 'object',
      properties: {
        format: { type: 'string', description: 'Image format', enum: ['png', 'jpeg'] },
        quality: { type: 'number', description: 'JPEG quality 0-100 (default: 80)' },
      },
    },
  },
  {
    name: 'browser_click',
    description: 'Click an element on the current browser page by CSS selector. Scrolls the element into view first. Only available when the Chrome extension is connected.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the element to click' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_type',
    description: 'Type text into an input, textarea, or contenteditable element on the current browser page. Only available when the Chrome extension is connected.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the input element' },
        text: { type: 'string', description: 'Text to type' },
        clear: { type: 'boolean', description: 'Clear the field before typing (default: false)' },
      },
      required: ['selector', 'text'],
    },
  },
  {
    name: 'browser_navigate',
    description: 'Navigate the active Chrome browser tab to a URL. Only available when the Chrome extension is connected.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate to' },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_scroll',
    description: 'Scroll the browser page in a direction, or scroll a specific element into view. Only available when the Chrome extension is connected.',
    parameters: {
      type: 'object',
      properties: {
        direction: { type: 'string', description: 'Scroll direction', enum: ['up', 'down', 'left', 'right'] },
        amount: { type: 'number', description: 'Pixels to scroll (default: 500)' },
        selector: { type: 'string', description: 'CSS selector to scroll into view (overrides direction)' },
      },
    },
  },
  {
    name: 'browser_find_element',
    description: 'Find elements on the current browser page by CSS selector, visible text content, or ARIA role. Returns up to 20 matches with their selectors. Only available when the Chrome extension is connected.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector to match' },
        text: { type: 'string', description: 'Text content to search for' },
        role: { type: 'string', description: 'ARIA role to match' },
      },
    },
  },
  {
    name: 'browser_press_key',
    description: 'Press a keyboard key on the current browser page. For modifier combos use ctrl/shift/alt/meta params. Only available when the Chrome extension is connected.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key name (e.g. Enter, Escape, Tab, a, 1)' },
        ctrl: { type: 'string', description: 'Hold Ctrl (true/false)', enum: ['true', 'false'] },
        shift: { type: 'string', description: 'Hold Shift (true/false)', enum: ['true', 'false'] },
        alt: { type: 'string', description: 'Hold Alt (true/false)', enum: ['true', 'false'] },
        meta: { type: 'string', description: 'Hold Cmd/Meta (true/false)', enum: ['true', 'false'] },
      },
      required: ['key'],
    },
  },
  {
    name: 'browser_get_page_context',
    description: 'Extract the current browser page title, URL, headings, metadata, and body text content. Only available when the Chrome extension is connected.',
    parameters: {
      type: 'object',
      properties: {
        max_chars: { type: 'number', description: 'Max body text characters (default: 7000, max: 12000)' },
      },
    },
  },
  {
    name: 'browser_get_element',
    description: 'Get detailed properties of a DOM element on the current browser page: bounding rect, computed styles, attributes, value, disabled state. Only available when the Chrome extension is connected.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the element' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_wait_for_element',
    description: 'Wait for an element matching a CSS selector to appear on the current browser page. Only available when the Chrome extension is connected.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector to wait for' },
        timeout: { type: 'number', description: 'Max wait time in ms (default: 5000)' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_read_network',
    description: 'Read captured network requests from the current browser page. Shows URLs, methods, status codes, sizes. Requires debugger to be attached first. Only available when the Chrome extension is connected.',
    parameters: {
      type: 'object',
      properties: {
        urlPattern: { type: 'string', description: 'Filter requests by URL substring' },
        method: { type: 'string', description: 'Filter by HTTP method (GET, POST, etc.)' },
        status: { type: 'string', description: 'Filter by status code prefix (e.g. "4" for 4xx errors)' },
        limit: { type: 'number', description: 'Max requests to return (default: 50)' },
      },
    },
  },
  {
    name: 'browser_get_tabs',
    description: 'List all open browser tabs with their titles, URLs, and tab group IDs. Only available when the Chrome extension is connected.',
  },
  {
    name: 'browser_get_tab_groups',
    description: 'List all tab groups with their titles, colors, and member tabs. Only available when the Chrome extension is connected.',
  },
  {
    name: 'browser_execute_js',
    description: 'Execute JavaScript code in the current browser page context. Use for DOM queries, data extraction, or page manipulation that other tools cannot achieve. Only available when the Chrome extension is connected.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JavaScript code to execute in the page context. Use return statements for values.' },
      },
      required: ['code'],
    },
  },
  {
    name: 'browser_read_console',
    description: 'Read captured console log messages from the current browser page. Includes errors, warnings, and info messages. Useful for debugging. Only available when the Chrome extension is connected.',
    parameters: {
      type: 'object',
      properties: {
        level: { type: 'string', description: 'Filter by level', enum: ['error', 'warn', 'log', 'info', 'debug'] },
        limit: { type: 'number', description: 'Max messages to return (default: 50)' },
      },
    },
  },
  {
    name: 'init_experiment',
    description: 'Create or reset an auto-research session in the .auto/ directory. Defines the benchmark metric and optimization direction.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short session name' },
        metricName: { type: 'string', description: 'Metric key printed by the benchmark, e.g. total_ms' },
        metricUnit: { type: 'string', description: 'Display unit, e.g. ms or KB' },
        direction: { type: 'string', description: 'Whether lower or higher metric values are better', enum: ['lower', 'higher'] },
        measureScript: { type: 'string', description: 'Shell script that prints METRIC <metricName>=<number> to stdout' },
        maxIterations: { type: 'number', description: 'Maximum number of experiment iterations (default: 30)' },
        timeoutMs: { type: 'number', description: 'Benchmark, checks, and local hook timeout in milliseconds (default: 600000)' },
        filesInScope: {
          type: 'array',
          description: 'Optional workspace paths or globs that the experiment may edit',
          items: { type: 'string', description: 'Path or glob in scope for edits' },
        },
        checksScript: { type: 'string', description: 'Optional shell script written to .auto/checks.sh for correctness checks after a passing benchmark' },
        subagents: {
          type: 'object',
          description: 'Optional phases that should use existing delegate_task or delegate_parallel subagent tools',
          properties: {
            ideaGeneration: { type: 'boolean', description: 'Delegate experiment idea generation before selecting changes' },
            measurementAnalysis: { type: 'boolean', description: 'Delegate analysis of noisy or surprising benchmark results' },
            finalization: { type: 'boolean', description: 'Delegate final review of kept runs and changeset grouping recommendations' },
          },
        },
      },
      required: ['name', 'metricName', 'metricUnit', 'direction', 'measureScript'],
    },
  },
  {
    name: 'run_experiment',
    description: 'Run the auto-research benchmark script and extract the current metric value.',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'Short description of the change being measured' },
      },
      required: ['description'],
    },
  },
  {
    name: 'log_experiment',
    description: 'Record the result of an experiment in .auto/log.jsonl and decide whether to keep or discard the change.',
    parameters: {
      type: 'object',
      properties: {
        metric: { type: 'number', description: 'Measured metric value' },
        status: { type: 'string', description: 'Outcome of the run', enum: ['kept', 'discarded', 'checks_failed', 'crashed'] },
        description: { type: 'string', description: 'What was tried' },
        commit: { type: 'string', description: 'Git commit hash that preserves this run, when status is kept' },
        output: { type: 'string', description: 'Benchmark/check output to store as a bounded excerpt in .auto/log.jsonl' },
        hypothesis: { type: 'string', description: 'Hypothesis that led to the change' },
        learned: { type: 'string', description: 'What the result teaches us' },
        nextFocus: { type: 'string', description: 'Suggested next focus area' },
      },
      required: ['metric', 'status', 'description'],
    },
  },
];

/**
 * Standalone plan tool definition — only registered when plan mode is enabled.
 * Exported so agent.ts can dynamically inject/remove it.
 */
export const PLAN_TOOL_DEFINITION: ToolDefinition = {
  name: 'plan',
  description: 'Create a structured implementation plan with detailed numbered steps before executing a task. Always break the task into concrete, actionable steps (e.g. "1. Read existing auth code\n2. Create JWT utility module\n3. Add login endpoint"). Each step should be a single clear action. Aim for 3-10 steps depending on complexity. You may call this tool multiple times to refine the plan. When you are satisfied with the plan, call `exit_plan_mode` to present it to the user for approval.',
  parameters: {
    type: 'object',
    properties: {
      notes: {
        type: 'string',
        description: 'A numbered step-by-step plan. Each step on its own line starting with "N. " (e.g. "1. Read existing code\n2. Create new module\n3. Write tests"). Be specific and actionable - avoid single vague descriptions.'
      }
    }
  }
};

/**
 * Standalone exit_plan_mode tool definition — only registered when plan mode is enabled.
 * Exported so agent.ts can dynamically inject/remove it.
 */
export const EXIT_PLAN_MODE_TOOL_DEFINITION: ToolDefinition = {
  name: 'exit_plan_mode',
  description: 'Present the current plan to the user for approval and exit the planning phase. Call this ONLY after you have created a plan using the `plan` tool and are ready for the user to review it. Do NOT call this tool before creating a plan.',
  parameters: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'A brief summary of the plan you created, highlighting the key changes and approach.'
      }
    }
  }
};

export class ToolManager {
  private readonly definitions = new Map<AgentAction['type'], ToolDefinition>();
  private readonly executor: ToolManagerOptions['executor'];
  private readonly confirmApproval: ToolManagerOptions['confirmApproval'];
  private readonly toolFilter: ToolFilter;
  private readonly maxConcurrency: number;
  private readonly permissionManager: PermissionManager;
  private readonly resolveSpecializedPermissionContext?: ToolAuthorizationOptions['resolvePermissionContext'];
  private readonly runPreToolHooks?: ToolAuthorizationOptions['runPreToolHooks'];
  private readonly onAdditionalContext?: ToolAuthorizationOptions['onAdditionalContext'];

  constructor(options: ToolManagerOptions) {
    this.executor = options.executor;
    this.confirmApproval = options.confirmApproval;
    this.toolFilter = new ToolFilter(options.clientContext ?? 'cli', options.customPolicy);
    this.maxConcurrency = options.maxConcurrency ?? 5;
    this.permissionManager = options.authorization?.permissionManager ?? new PermissionManager();
    this.resolveSpecializedPermissionContext = options.authorization?.resolvePermissionContext;
    this.runPreToolHooks = options.authorization?.runPreToolHooks;
    this.onAdditionalContext = options.authorization?.onAdditionalContext;
    const defs = options.definitions ?? DEFAULT_TOOL_DEFINITIONS;
    for (const def of defs) {
      this.register(def);
    }
  }

  register(definition: ToolDefinition): void {
    this.definitions.set(definition.name, definition);
  }

  /**
   * Unregister a tool definition by name.
   * Used to dynamically remove tools (e.g. plan tool when plan mode is disabled).
   */
  unregister(name: AgentAction['type']): boolean {
    return this.definitions.delete(name);
  }

  /**
   * Register meta-tools from ToolsRegistry dynamically
   * Called during session initialization to load persisted tools
   */
  registerMetaTools(toolDefinitions: ToolDefinition[]): void {
    for (const def of toolDefinitions) {
      // Skip if conflicts with a built-in tool
      if (DEFAULT_TOOL_DEFINITIONS.some(d => d.name === def.name) || GOAL_TOOL_DEFINITIONS.some(d => d.name === def.name)) {
        continue;
      }
      this.definitions.set(def.name, def);
    }
  }

  /**
   * Replace all MCP tools (mcp__*) with a fresh set.
   * Keeps built-ins and non-MCP meta-tools intact.
   */
  replaceMcpTools(toolDefinitions: ToolDefinition[]): void {
    for (const name of Array.from(this.definitions.keys())) {
      if ((name as string).startsWith('mcp__')) {
        this.definitions.delete(name);
      }
    }
    this.registerMetaTools(toolDefinitions);
  }

  /**
   * Check if a tool name conflicts with built-in definitions
   */
  isBuiltInTool(name: string): boolean {
    return DEFAULT_TOOL_DEFINITIONS.some(d => d.name === name) || GOAL_TOOL_DEFINITIONS.some(d => d.name === name);
  }

  listToolNames(): AgentAction['type'][] {
    return Array.from(this.definitions.keys())
      .filter(name => this.toolFilter.isAllowed(name));
  }

  /**
   * List all tool definitions (unfiltered)
   */
  listAllDefinitions(): ToolDefinition[] {
    return Array.from(this.definitions.values());
  }

  /**
   * List tool definitions filtered by client context
   */
  listDefinitions(): ToolDefinition[] {
    return this.toolFilter.filterDefinitions(Array.from(this.definitions.values()));
  }

  /**
   * Get the current tool filter
   */
  getFilter(): ToolFilter {
    return this.toolFilter;
  }

  /**
   * Check if a specific tool is allowed in the current context
   */
  isToolAllowed(toolName: string): boolean {
    return this.toolFilter.isAllowed(toolName);
  }

  /**
   * Convert tool definitions to FunctionDefinition format for LLM function calling
   * This is used when passing tools to the LLM API
   */
  toFunctionDefinitions(): FunctionDefinition[] {
    return this.listDefinitions().map(def => ToolManager.toFunctionDefinition(def));
  }

  /**
   * Convert a single tool definition to FunctionDefinition format
   */
  static toFunctionDefinition(def: ToolDefinition): FunctionDefinition {
    return {
      name: def.name,
      description: def.description,
      parameters: def.parameters ? {
        type: 'object' as const,
        properties: Object.fromEntries(
          Object.entries(def.parameters.properties).map(([key, param]) => [
            key,
            {
              type: param.type,
              description: param.description,
              enum: param.enum,
              items: param.type === 'array'
                ? ToolManager.normalizeItemsStatic(param.items)
                : undefined,
              properties: param.type === 'object'
                ? ToolManager.normalizeObjectPropertiesStatic(
                    (param as any).properties as Record<string, ToolParameter> | undefined
                  )
                : undefined,
              required: param.type === 'object' && Array.isArray((param as any).required)
                ? (param as any).required
                : undefined,
              additionalProperties: param.type === 'object' ? true : undefined
            }
          ])
        ),
        required: def.parameters.required
      } : undefined
    };
  }

  private static normalizeItemsStatic(items?: ToolParameter | { type: string; description?: string; enum?: string[]; properties?: Record<string, ToolParameter>; required?: string[] }): NormalizedItemSchema {
    if (!items) return { type: 'string' };
    if (items.type !== 'object') {
      return { type: items.type, description: items.description, enum: (items as ToolParameter).enum };
    }
    const objItems = items as { type: string; description?: string; properties?: Record<string, ToolParameter>; required?: string[] };
    return {
      type: 'object' as const,
      description: items.description,
      properties: ToolManager.normalizeObjectPropertiesStatic(objItems.properties),
      required: objItems.required,
      additionalProperties: true
    };
  }

  private static normalizeObjectPropertiesStatic(props?: Record<string, ToolParameter>): Record<string, NormalizedPropertySchema> {
    const safeProps = props ?? {};
    return Object.fromEntries(
      Object.entries(safeProps).map(([k, v]) => [
        k,
        {
          type: v.type,
          description: v.description,
          enum: v.enum,
          items: v.type === 'array' ? ToolManager.normalizeItemsStatic(v.items) : undefined,
          properties: v.type === 'object'
            ? ToolManager.normalizeObjectPropertiesStatic((v as any).properties as Record<string, ToolParameter> | undefined)
            : undefined,
          required: v.type === 'object' && Array.isArray((v as any).required)
            ? (v as any).required
            : undefined,
          additionalProperties: v.type === 'object' ? true : undefined
        }
      ])
    );
  }

  async execute(
    toolCalls: ToolCallRequest[],
    onToolComplete?: (index: number, result: ToolExecutionResult) => void,
    executionContext: Pick<ToolExecutionContext, 'signal'> = {},
  ): Promise<ToolExecutionResult[]> {
    const signal = executionContext.signal;
    const results = new Map<number, ToolExecutionResult>();

    // Get plan mode manager to check read-only enforcement
    const planModeManager = getPlanModeManager();
    const isInPlanningPhase = planModeManager.isEnabled() && planModeManager.getPhase() === 'planning';
    const readOnlyTools = isInPlanningPhase ? new Set(planModeManager.getReadOnlyTools()) : null;

    // Phase 1: Pre-flight + Approval (sequential)
    // Categorize each call as rejected, denied, or ready-to-execute
    const readyToExecute: ReadyToolExecutionTask[] = [];

    for (let i = 0; i < toolCalls.length; i++) {
      let call = this.cloneToolCallWithStableId(toolCalls[i]);

      const reject = (
        error: string,
        kind: ToolFailureKind = 'authorization',
        output?: string,
      ): void => {
        const readableError = error.trim() || output?.trim() || 'Tool execution failed.';
        const result: ToolExecutionResult = {
          tool: call.tool,
          success: false,
          kind,
          error: readableError,
          ...(output === undefined ? {} : { output }),
        };
        results.set(i, result);
        onToolComplete?.(i, result);
      };

      if (signal?.aborted) {
        reject(TOOL_ABORTED_MESSAGE, 'aborted', TOOL_ABORTED_MESSAGE);
        continue;
      }

      // Check if tool is allowed in current context
      if (!this.toolFilter.isAllowed(call.tool)) {
        reject(`Tool '${call.tool}' is not available in the current context (${this.toolFilter.getContext()})`, 'authorization');
        continue;
      }

      // Check plan mode restrictions - only read-only tools allowed during planning phase
      if (readOnlyTools && !readOnlyTools.has(call.tool)) {
        reject(`Tool '${call.tool}' is not available in plan mode. Only read-only tools are allowed during planning. Use 'plan' tool to create a plan, then accept it to execute write operations.`, 'authorization');
        continue;
      }

      const definition = this.definitions.get(call.tool);
      if (!definition) {
        reject(`Tool '${call.tool}' is not available. Use tool_search or tools_registry to find an available tool.`, 'validation');
        continue;
      }

      try {
        this.assertValidUpdatedInput(definition, {}, this.getCallArgs(call));
      } catch (error) {
        reject(error instanceof Error ? error.message : String(error), 'validation');
        continue;
      }

      const requiresApproval = this.toolFilter.requiresApproval(call.tool, definition.requiresApproval);

      try {
        this.assertNotAborted(signal);
        let action = this.toAction(call);
        let permissionContexts = this.resolvePermissionContexts(action);
        let policyEvaluation = this.evaluatePermissionContexts(permissionContexts);
        if (policyEvaluation.denied) {
          reject(`Tool '${call.tool}' was denied by the permission policy.`);
          continue;
        }

        let permissionContext = policyEvaluation.promptContext;
        let policyRequiresPrompt = policyEvaluation.requiresPrompt
          && shouldPromptForToolPermission(call.tool, requiresApproval, permissionContext.tool);
        let hookPromptOverride: boolean | undefined;

        if (this.runPreToolHooks) {
          const hookResults = await this.runPreToolHooks({
            tool: call.tool,
            toolCallId: call.id!,
            args: this.getCallArgs(call),
            path: permissionContext.path,
            ...(signal === undefined ? {} : { signal }),
          });
          this.assertNotAborted(signal);

          if (!Array.isArray(hookResults)) {
            throw new Error('Pre-tool hooks returned an invalid result.');
          }

          for (const hookResult of hookResults) {
            this.assertValidHookResult(hookResult);
            if (!hookResult.success) {
              throw new Error(hookResult.error ?? 'Pre-tool hook failed.');
            }

            const response = hookResult.response;
            if (response === undefined) {
              if (hookResult.stdout?.trim().startsWith('{')) {
                throw new Error('Pre-tool hook returned malformed JSON output.');
              }
              continue;
            }
            this.assertValidHookResponse(response);

            if (response.additionalContext !== undefined) {
              if (!this.onAdditionalContext) {
                throw new Error('Pre-tool hook supplied additional context without a conversation handler.');
              }
              await this.onAdditionalContext(response.additionalContext);
              this.assertNotAborted(signal);
            }

            if (response.updatedInput !== undefined) {
              const mergedArgs = {
                ...this.getCallArgs(call),
                ...response.updatedInput,
              };
              this.assertValidUpdatedInput(definition, response.updatedInput, mergedArgs);
              call = this.cloneToolCall(call, mergedArgs);
              action = this.toAction(call);
              permissionContexts = this.resolvePermissionContexts(action);
              policyEvaluation = this.evaluatePermissionContexts(permissionContexts);
              if (policyEvaluation.denied) {
                throw new Error(`Updated input for '${call.tool}' was denied by the permission policy.`);
              }
              permissionContext = policyEvaluation.promptContext;
              policyRequiresPrompt = policyEvaluation.requiresPrompt
                && shouldPromptForToolPermission(call.tool, requiresApproval, permissionContext.tool);
            }

            if (response.continue === false) {
              throw new Error(response.stopReason ?? 'Pre-tool hook stopped execution.');
            }

            if (response.decision === 'deny' || response.decision === 'block') {
              throw new Error(response.reason ?? `Pre-tool hook ${response.decision}ed execution.`);
            }
            if (response.decision === 'ask') {
              hookPromptOverride = true;
            } else if (response.decision === 'allow') {
              hookPromptOverride = false;
            }
          }
        }

        const shouldPrompt = hookPromptOverride ?? policyRequiresPrompt;
        if (shouldPrompt) {
          const decision = normalizePermissionPromptResponse(
            await this.confirmApproval(
              this.buildApprovalMessage(call, definition),
              this.toPromptContext(permissionContext)
            )
          );
          this.assertNotAborted(signal);
          for (const promptedContext of policyEvaluation.promptedContexts) {
            await this.permissionManager.applyPromptDecision(promptedContext, decision);
            this.assertNotAborted(signal);
          }

          if (!isAllowedPermissionPrompt(decision)) {
            reject('Tool execution skipped by user.', 'authorization', 'Tool execution skipped by user.');
            continue;
          }

          if (decision.decision === 'alternative') {
            const alternativeArgs = this.applyAlternative(call, decision.alternative!);
            this.assertValidUpdatedInput(definition, alternativeArgs.changed, alternativeArgs.args);
            call = this.cloneToolCall(call, alternativeArgs.args);
            action = this.toAction(call);
            permissionContexts = this.resolvePermissionContexts(action);
            policyEvaluation = this.evaluatePermissionContexts(permissionContexts);
            permissionContext = policyEvaluation.promptContext;
            if (policyEvaluation.denied) {
              reject(`Alternative input for '${call.tool}' was denied by the permission policy.`);
              continue;
            }
          }
        }
        this.assertNotAborted(signal);
      } catch (error) {
        if (error instanceof ToolExecutionAbortedError) {
          reject(error.message, 'aborted', error.message);
        } else {
          reject(error instanceof Error ? error.message : String(error));
        }
        continue;
      }

      if (signal?.aborted) {
        reject(TOOL_ABORTED_MESSAGE, 'aborted', TOOL_ABORTED_MESSAGE);
        continue;
      }
      readyToExecute.push({ call, index: i });
    }

    // Phase 2: Scheduled execution of approved calls
    if (readyToExecute.length > 0) {
      const execResults = await this.executeScheduled(
        readyToExecute,
        onToolComplete,
        signal,
      );
      for (const [index, result] of execResults) {
        results.set(index, result);
      }
    }

    // Phase 3: Reassemble in original input order
    return toolCalls.map((_, i) => results.get(i)!);
  }

  private cloneToolCallWithStableId(call: ToolCallRequest): ToolCallRequest {
    return {
      ...call,
      id: call.id ?? `tool_${randomUUID()}`,
      args: { ...this.getCallArgs(call) } as ToolCallRequest['args'],
    };
  }

  private cloneToolCall(call: ToolCallRequest, args: Record<string, unknown>): ToolCallRequest {
    return {
      ...call,
      args: { ...args } as ToolCallRequest['args'],
    };
  }

  private getCallArgs(call: ToolCallRequest): Record<string, unknown> {
    return (call.args ?? {}) as Record<string, unknown>;
  }

  private resolvePermissionContexts(action: AgentAction): PermissionContext[] {
    const specialized = this.resolveSpecializedPermissionContext?.(action);
    const standardContexts = buildToolPermissionContexts(action);
    const contexts = specialized === undefined
      ? standardContexts
      : [specialized, ...standardContexts.slice(1)];
    for (const context of contexts) {
      this.assertValidPermissionContext(context);
    }
    return contexts;
  }

  private evaluatePermissionContexts(contexts: PermissionContext[]): {
    denied: boolean;
    requiresPrompt: boolean;
    promptContext: PermissionContext;
    promptedContexts: PermissionContext[];
  } {
    if (contexts.length === 0) {
      throw new Error('Permission context list is empty.');
    }
    const dispositions = contexts.map(context => getPermissionPolicyDisposition(
      this.permissionManager.checkPermission(context)
    ));
    const promptIndex = dispositions.indexOf('prompt');
    return {
      denied: dispositions.includes('deny'),
      requiresPrompt: promptIndex !== -1,
      promptContext: promptIndex === -1 ? contexts[0] : contexts[promptIndex],
      promptedContexts: contexts.filter((_, index) => dispositions[index] === 'prompt'),
    };
  }

  private assertValidPermissionContext(context: unknown): asserts context is PermissionContext {
    if (!this.isPlainObject(context) || typeof context.tool !== 'string' || context.tool.length === 0) {
      throw new Error('Permission context is malformed.');
    }
    if (context.command !== undefined && typeof context.command !== 'string') {
      throw new Error('Permission context command is malformed.');
    }
    if (context.command !== undefined && context.command.length === 0) {
      throw new Error('Permission context command is empty.');
    }
    if (context.path !== undefined && typeof context.path !== 'string') {
      throw new Error('Permission context path is malformed.');
    }
    if (context.args !== undefined
      && (!Array.isArray(context.args) || context.args.some(value => typeof value !== 'string'))) {
      throw new Error('Permission context arguments are malformed.');
    }
    if (context.description !== undefined && typeof context.description !== 'string') {
      throw new Error('Permission context description is malformed.');
    }
  }

  private assertValidHookResult(result: unknown): asserts result is HookExecutionResult {
    if (!this.isPlainObject(result) || typeof result.success !== 'boolean') {
      throw new Error('Pre-tool hook returned a malformed execution result.');
    }
    if (result.blockingError === true || result.exitCode === 2) {
      throw new Error(typeof result.error === 'string' ? result.error : 'Pre-tool hook blocked execution.');
    }
    if (!this.isPlainObject(result.hook)
      || result.hook.event !== 'pre-tool'
      || typeof result.hook.command !== 'string') {
      throw new Error('Pre-tool hook returned a malformed hook definition.');
    }
    if (typeof result.duration !== 'number' || !Number.isFinite(result.duration) || result.duration < 0) {
      throw new Error('Pre-tool hook returned a malformed duration.');
    }
    if (result.blockingError !== undefined && typeof result.blockingError !== 'boolean') {
      throw new Error('Pre-tool hook returned a malformed blocking status.');
    }
    if (result.exitCode !== undefined
      && (typeof result.exitCode !== 'number' || !Number.isInteger(result.exitCode))) {
      throw new Error('Pre-tool hook returned a malformed exit code.');
    }
    if (result.success && result.exitCode !== undefined && result.exitCode !== 0) {
      throw new Error('Pre-tool hook returned a contradictory execution status.');
    }
    if (result.error !== undefined && typeof result.error !== 'string') {
      throw new Error('Pre-tool hook returned a malformed error.');
    }
    if (result.stdout !== undefined && typeof result.stdout !== 'string') {
      throw new Error('Pre-tool hook returned malformed stdout.');
    }
    if (result.stderr !== undefined && typeof result.stderr !== 'string') {
      throw new Error('Pre-tool hook returned malformed stderr.');
    }
  }

  private assertValidHookResponse(response: unknown): asserts response is NonNullable<HookExecutionResult['response']> {
    if (!this.isPlainObject(response)) {
      throw new Error('Pre-tool hook returned a malformed response.');
    }
    if (response.decision !== undefined
      && !['allow', 'deny', 'ask', 'block'].includes(String(response.decision))) {
      throw new Error('Pre-tool hook returned an unknown decision.');
    }
    if (response.continue !== undefined && typeof response.continue !== 'boolean') {
      throw new Error('Pre-tool hook returned a malformed continue decision.');
    }
    for (const field of ['reason', 'stopReason', 'additionalContext'] as const) {
      if (response[field] !== undefined && typeof response[field] !== 'string') {
        throw new Error(`Pre-tool hook returned a malformed ${field}.`);
      }
    }
    if (response.updatedInput !== undefined && !this.isPlainObject(response.updatedInput)) {
      throw new Error('Pre-tool hook returned malformed updated input.');
    }
  }

  private assertValidUpdatedInput(
    definition: ToolDefinition,
    changed: Record<string, unknown>,
    args: Record<string, unknown>
  ): void {
    for (const forbiddenKey of ['type', 'tool', '__proto__', 'prototype', 'constructor']) {
      if (Object.prototype.hasOwnProperty.call(changed, forbiddenKey)) {
        throw new Error(`Updated tool input cannot change reserved field '${forbiddenKey}'.`);
      }
    }

    const parameters = definition.parameters;
    if (!parameters) {
      if (Object.keys(changed).length > 0) {
        throw new Error(`Tool '${definition.name}' does not accept updated input fields.`);
      }
      return;
    }
    for (const field of Object.keys(changed)) {
      if (!Object.prototype.hasOwnProperty.call(parameters.properties, field)) {
        throw new Error(`Updated input field '${field}' is not supported by '${definition.name}'.`);
      }
    }
    for (const required of parameters.required ?? []) {
      if (args[required] === undefined || args[required] === null) {
        throw new Error(`Updated input for '${definition.name}' is missing required field '${required}'.`);
      }
    }
    for (const [name, schema] of Object.entries(parameters.properties)) {
      if (args[name] !== undefined && !this.matchesParameterSchema(args[name], schema)) {
        throw new Error(`Updated input field '${name}' is invalid for '${definition.name}'.`);
      }
    }
  }

  private matchesParameterSchema(value: unknown, schema: ToolParameter): boolean {
    if (schema.enum && (!schema.enum.includes(String(value)) || typeof value !== 'string')) {
      return false;
    }
    switch (schema.type) {
      case 'string':
        return typeof value === 'string';
      case 'number':
      case 'integer':
        return typeof value === 'number'
          && Number.isFinite(value)
          && (schema.type !== 'integer' || Number.isInteger(value));
      case 'boolean':
        return typeof value === 'boolean';
      case 'array':
        return Array.isArray(value) && (schema.items === undefined
          || value.every(item => this.matchesItemSchema(item, schema.items!)));
      case 'object':
        return this.isPlainObject(value);
      default:
        return false;
    }
  }

  private matchesItemSchema(
    value: unknown,
    schema: NonNullable<ToolParameter['items']>
  ): boolean {
    if (schema.enum && (!schema.enum.includes(String(value)) || typeof value !== 'string')) {
      return false;
    }
    if (schema.type === 'object') {
      if (!this.isPlainObject(value)) {
        return false;
      }
      const objectSchema = schema as {
        properties?: Record<string, ToolParameter>;
        required?: string[];
      };
      for (const required of objectSchema.required ?? []) {
        if (value[required] === undefined || value[required] === null) {
          return false;
        }
      }
      return Object.entries(objectSchema.properties ?? {}).every(([name, property]) =>
        value[name] === undefined || this.matchesParameterSchema(value[name], property)
      );
    }
    return this.matchesParameterSchema(value, {
      type: schema.type,
      description: schema.description ?? '',
      enum: schema.enum,
    });
  }

  private applyAlternative(
    call: ToolCallRequest,
    alternative: string
  ): { args: Record<string, unknown>; changed: Record<string, unknown> } {
    const args = this.getCallArgs(call);
    let changed: Record<string, unknown>;
    if (call.tool === 'run_command' || call.tool === 'shell') {
      changed = { command: alternative, args: [] };
    } else if (typeof args.path === 'string') {
      changed = { path: alternative };
    } else if (typeof args.file_path === 'string') {
      changed = { file_path: alternative };
    } else {
      throw new Error('Tool execution skipped because the alternative input could not be applied.');
    }
    return { args: { ...args, ...changed }, changed };
  }

  private buildApprovalMessage(call: ToolCallRequest, definition: ToolDefinition): string {
    const args = this.getCallArgs(call);
    if (call.tool === 'run_command' || call.tool === 'shell') {
      const command = String(args.command ?? '');
      const commandArgs = Array.isArray(args.args) ? args.args.join(' ') : '';
      const fullCommand = commandArgs ? `${command} ${commandArgs}` : command;
      const directory = args.directory ? ` (in ${String(args.directory)})` : '';
      return call.tool === 'shell'
        ? `Run this shell command with live output${directory}?\n  $ ${fullCommand}`
        : `Run this command${directory}?\n  $ ${fullCommand}`;
    }
    if (call.tool === 'delete_path' && args.path) {
      return `Delete this path?\n  ${String(args.path)}`;
    }
    if (call.tool === 'write_file' && args.path) {
      return `Write to this file?\n  ${String(args.path)}`;
    }
    if (call.tool === 'multi_file_edit' && args.file_path) {
      const editCount = Array.isArray(args.edits) ? args.edits.length : 0;
      return `Edit this file (${editCount} change${editCount === 1 ? '' : 's'})?\n  ${String(args.file_path)}`;
    }
    return definition.approvalMessage ?? `Allow tool ${call.tool}?`;
  }

  private toPromptContext(context: PermissionContext): { tool?: string; path?: string; command?: string } {
    const args = context.args?.join(' ') ?? '';
    return {
      tool: context.tool,
      path: context.path,
      command: context.command ? (args ? `${context.command} ${args}` : context.command) : undefined,
    };
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  private assertNotAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new ToolExecutionAbortedError();
    }
  }

  private createAbortedResult(call: ToolCallRequest): ToolExecutionResult {
    return {
      tool: call.tool,
      success: false,
      kind: 'aborted',
      error: TOOL_ABORTED_MESSAGE,
      output: TOOL_ABORTED_MESSAGE,
    };
  }

  /**
   * Execute approved calls in model order while preserving safe parallelism.
   *
   * Read-only batches can run concurrently. Mutating tools are ordering
   * barriers because they may affect following reads or other writes.
   */
  private async executeScheduled(
    tasks: ReadyToolExecutionTask[],
    onToolComplete?: (index: number, result: ToolExecutionResult) => void,
    signal?: AbortSignal,
  ): Promise<Map<number, ToolExecutionResult>> {
    const results = new Map<number, ToolExecutionResult>();
    let parallelBatch: ReadyToolExecutionTask[] = [];

    const mergeResults = (batchResults: Map<number, ToolExecutionResult>) => {
      for (const [index, result] of batchResults) {
        results.set(index, result);
      }
    };

    const flushParallelBatch = async () => {
      if (parallelBatch.length === 0) {
        return;
      }
      const batchResults = await this.executeWithConcurrency(
        parallelBatch,
        this.maxConcurrency,
        onToolComplete,
        signal,
      );
      mergeResults(batchResults);
      parallelBatch = [];
    };

    for (const task of tasks) {
      if (!this.shouldExecuteSequentially(task.call)) {
        parallelBatch.push(task);
        continue;
      }

      await flushParallelBatch();
      const sequentialResult = await this.executeWithConcurrency(
        [task],
        1,
        onToolComplete,
        signal,
      );
      mergeResults(sequentialResult);
    }

    await flushParallelBatch();
    return results;
  }

  private shouldExecuteSequentially(call: ToolCallRequest): boolean {
    return SEQUENTIAL_TOOL_CATEGORIES.has(getToolCategory(call.tool));
  }

  /**
   * Execute tool calls with a concurrency limit using a worker-pool pattern.
   */
  private async executeWithConcurrency(
    tasks: ReadyToolExecutionTask[],
    maxConcurrency: number,
    onToolComplete?: (index: number, result: ToolExecutionResult) => void,
    signal?: AbortSignal,
  ): Promise<Map<number, ToolExecutionResult>> {
    const results = new Map<number, ToolExecutionResult>();
    let cursor = 0;

    const runNext = async (): Promise<void> => {
      while (cursor < tasks.length) {
        if (signal?.aborted) {
          return;
        }
        const taskIndex = cursor++;
        const { call, index } = tasks[taskIndex];
        let result: ToolExecutionResult;
        try {
          const action = this.toAction(call);
          const outcome = this.normalizeToolOutcome(await this.executor(action, {
            toolCallId: call.id,
            tool: call.tool,
            approvalHandled: true,
            signal,
          }));
          result = signal?.aborted
            ? this.createAbortedResult(call)
            : { tool: call.tool, ...outcome };
        } catch (error) {
          result = signal?.aborted || (error instanceof Error && error.name === 'AbortError')
            ? this.createAbortedResult(call)
            : {
                tool: call.tool,
                success: false,
                kind: 'operational',
                error: this.normalizeError(error),
              };
        }
        results.set(index, result);
        onToolComplete?.(index, result);
      }
    };

    const workers = Array.from(
      { length: Math.min(maxConcurrency, tasks.length) },
      () => runNext()
    );
    await Promise.all(workers);

    while (cursor < tasks.length) {
      const { call, index } = tasks[cursor++];
      const result = this.createAbortedResult(call);
      results.set(index, result);
      onToolComplete?.(index, result);
    }
    return results;
  }

  private normalizeToolOutcome(outcome: ToolActionOutcome): ToolActionOutcome {
    if (!this.isPlainObject(outcome) || typeof outcome.success !== 'boolean') {
      throw new Error('Tool executor returned a malformed outcome.');
    }
    if (outcome.success) {
      if (outcome.output !== undefined && typeof outcome.output !== 'string') {
        throw new Error('Tool executor returned malformed success output.');
      }
      return outcome.output === undefined
        ? { success: true }
        : { success: true, output: outcome.output };
    }

    const validKinds: ToolFailureKind[] = [
      'authorization',
      'validation',
      'command',
      'aborted',
      'operational',
    ];
    if (!validKinds.includes(outcome.kind)) {
      throw new Error('Tool executor returned an unknown failure kind.');
    }
    if (typeof outcome.error !== 'string' || outcome.error.trim().length === 0) {
      throw new Error('Tool executor returned a failure without an error.');
    }
    if (outcome.output !== undefined && typeof outcome.output !== 'string') {
      throw new Error('Tool executor returned malformed failure output.');
    }
    if (outcome.exitCode !== undefined
      && outcome.exitCode !== null
      && (typeof outcome.exitCode !== 'number' || !Number.isInteger(outcome.exitCode))) {
      throw new Error('Tool executor returned a malformed exit code.');
    }
    return {
      success: false,
      kind: outcome.kind,
      error: outcome.error,
      ...(outcome.output === undefined ? {} : { output: outcome.output }),
      ...(outcome.exitCode === undefined ? {} : { exitCode: outcome.exitCode }),
    };
  }

  private normalizeError(error: unknown): string {
    if (error instanceof Error && error.message.trim().length > 0) {
      return error.message;
    }
    const message = String(error).trim();
    return message || 'Tool execution failed.';
  }

  private toAction(call: ToolCallRequest): AgentAction {
    return {
      ...(call.args ?? {}),
      type: call.tool,
    } as AgentAction;
  }
}
