/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  AgentAction,
  ToolCallRequest,
  ToolExecutionContext,
  ToolExecutionResult,
  FunctionDefinition
} from '../types.js';
import { ToolFilter, type ClientContext, type ToolPolicy } from './toolFilter.js';
import { getPlanModeManager } from '../commands/plan.js';

export interface ToolParameter {
  type: string;
  description: string;
  enum?: string[];
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
  executor: (action: AgentAction, context?: ToolExecutionContext) => Promise<string | undefined>;
  confirmApproval: (message: string, context?: { tool?: string; path?: string; command?: string }) => Promise<boolean>;
  definitions?: ToolDefinition[];
  /** Client context for tool filtering (default: 'cli') */
  clientContext?: ClientContext;
  /** Custom policy to override default context policy */
  customPolicy?: Partial<ToolPolicy>;
  /** Max concurrent tool executions (default: 5) */
  maxConcurrency?: number;
}

export const DEFAULT_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'tools_registry',
    description: 'List all available tools (built-in and meta)'
  },
  {
    name: 'plan',
    description: 'Create a structured implementation plan with detailed numbered steps before executing a task. Always break the task into concrete, actionable steps (e.g. "1. Read existing auth code\\n2. Create JWT utility module\\n3. Add login endpoint"). Each step should be a single clear action. Aim for 3-10 steps depending on complexity.',
    parameters: {
      type: 'object',
      properties: {
        notes: {
          type: 'string',
          description: 'A numbered step-by-step plan. Each step on its own line starting with "N. " (e.g. "1. Read existing code\\n2. Create new module\\n3. Write tests"). Be specific and actionable - avoid single vague descriptions.'
        }
      }
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
    name: 'find',
    description: 'Find code, functions, variables, symbols, and surrounding context in the workspace. Use this as the default discovery tool. mode=exact uses ripgrep, mode=context returns surrounding lines, mode=semantic does broader fuzzy retrieval, and mode=auto picks the best strategy.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text, regex, symbol name, or concept to find' },
        path: { type: 'string', description: 'Optional relative path to search in' },
        mode: { type: 'string', description: 'Search strategy: auto, exact, context, or semantic', enum: ['auto', 'exact', 'context', 'semantic'] },
        context: { type: 'number', description: 'Number of surrounding lines to include when you want nearby code context' },
        limit: { type: 'number', description: 'Maximum number of results to return' },
        window: { type: 'number', description: 'Snippet window size for semantic mode (default 400)' }
      },
      required: ['query']
    }
  },
  {
    name: 'search',
    description: 'Legacy alias for `find` in exact mode. Prefer `find` for new tool calls.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to search for' },
        path: { type: 'string', description: 'Optional relative path to search in' }
      },
      required: ['query']
    }
  },
  {
    name: 'search_with_context',
    description: 'Legacy alias for `find` with context. Prefer `find` with the `context` argument for new tool calls.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to search for' },
        path: { type: 'string', description: 'Optional relative path to search in' },
        context: { type: 'number', description: 'Number of context lines (default 2)' },
        limit: { type: 'number', description: 'Maximum results (default 10)' }
      },
      required: ['query']
    }
  },
  {
    name: 'semantic_search',
    description: 'Legacy alias for `find` in semantic mode. Prefer `find` with `mode: "semantic"` for new tool calls.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to search for' },
        path: { type: 'string', description: 'Optional relative path to search in' },
        limit: { type: 'number', description: 'Maximum results (default 5)' },
        window: { type: 'number', description: 'Context window size (default 400)' }
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
    description: 'Execute shell commands with optional directory, background mode, and description. Prefer dedicated tools: read_file over cat, find over grep, search_replace over sed.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to execute' },
        args: { type: 'array', description: 'Command arguments', items: { type: 'string', description: 'Single argument' } },
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
    description: 'Show git diff for a file',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file' }
      },
      required: ['path']
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
    name: 'multi_file_edit',
    description: 'Apply multiple edits to a file',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Relative path to the file' },
        edits: {
          type: 'array',
          description: 'Array of {old_string, new_string, replace_all?}',
          items: {
            type: 'object',
            properties: {
              old_string: { type: 'string', description: 'Text to replace' },
              new_string: { type: 'string', description: 'Replacement text' },
              replace_all: { type: 'boolean', description: 'Replace all occurrences (default: false)' }
            },
            required: ['old_string', 'new_string']
          }
        }
      },
      required: ['file_path', 'edits']
    },
    requiresApproval: true
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
        handler: { type: 'string', description: 'Shell command template with {{param}} placeholders (e.g., "grep -E {{pattern}} {{path}}")' }
      },
      required: ['name', 'description', 'parameters', 'handler']
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

Repo formats: Full URL (https://github.com/owner/repo), or shorthand (github:owner/repo, gitlab:group/project).

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
  // Schedule Management
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
];

export class ToolManager {
  private readonly definitions = new Map<AgentAction['type'], ToolDefinition>();
  private readonly executor: ToolManagerOptions['executor'];
  private readonly confirmApproval: ToolManagerOptions['confirmApproval'];
  private readonly toolFilter: ToolFilter;
  private readonly maxConcurrency: number;

  constructor(options: ToolManagerOptions) {
    this.executor = options.executor;
    this.confirmApproval = options.confirmApproval;
    this.toolFilter = new ToolFilter(options.clientContext ?? 'cli', options.customPolicy);
    this.maxConcurrency = options.maxConcurrency ?? 5;
    const defs = options.definitions ?? DEFAULT_TOOL_DEFINITIONS;
    for (const def of defs) {
      this.register(def);
    }
  }

  register(definition: ToolDefinition): void {
    this.definitions.set(definition.name, definition);
  }

  /**
   * Register meta-tools from ToolsRegistry dynamically
   * Called during session initialization to load persisted tools
   */
  registerMetaTools(toolDefinitions: ToolDefinition[]): void {
    for (const def of toolDefinitions) {
      // Skip if conflicts with a built-in tool
      if (DEFAULT_TOOL_DEFINITIONS.some(d => d.name === def.name)) {
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
    return DEFAULT_TOOL_DEFINITIONS.some(d => d.name === name);
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
    onToolComplete?: (index: number, result: ToolExecutionResult) => void
  ): Promise<ToolExecutionResult[]> {
    const results = new Map<number, ToolExecutionResult>();

    // Get plan mode manager to check read-only enforcement
    const planModeManager = getPlanModeManager();
    const isInPlanningPhase = planModeManager.isEnabled() && planModeManager.getPhase() === 'planning';
    const readOnlyTools = isInPlanningPhase ? new Set(planModeManager.getReadOnlyTools()) : null;

    // Phase 1: Pre-flight + Approval (sequential)
    // Categorize each call as rejected, denied, or ready-to-execute
    const readyToExecute: Array<{ call: ToolCallRequest; index: number }> = [];

    for (let i = 0; i < toolCalls.length; i++) {
      const call = toolCalls[i];

      // Check if tool is allowed in current context
      if (!this.toolFilter.isAllowed(call.tool)) {
        const result: ToolExecutionResult = {
          tool: call.tool,
          success: false,
          error: `Tool '${call.tool}' is not available in the current context (${this.toolFilter.getContext()})`
        };
        results.set(i, result);
        onToolComplete?.(i, result);
        continue;
      }

      // Check plan mode restrictions - only read-only tools allowed during planning phase
      if (readOnlyTools && !readOnlyTools.has(call.tool)) {
        const result: ToolExecutionResult = {
          tool: call.tool,
          success: false,
          error: `Tool '${call.tool}' is not available in plan mode. Only read-only tools are allowed during planning. Use 'plan' tool to create a plan, then accept it to execute write operations.`
        };
        results.set(i, result);
        onToolComplete?.(i, result);
        continue;
      }

      const definition = this.definitions.get(call.tool);
      const requiresApproval = this.toolFilter.requiresApproval(call.tool, definition?.requiresApproval);

      if (requiresApproval) {
        // Build detailed approval message with action context
        let message = definition?.approvalMessage ?? `Allow tool ${call.tool}?`;

        // Add details based on tool type and build context for permission tracking
        const permContext: { tool?: string; path?: string; command?: string } = { tool: call.tool };

        if (call.tool === 'run_command' && call.args) {
          const cmd = String(call.args.command || '');
          const args = Array.isArray(call.args.args) ? call.args.args.join(' ') : '';
          const fullCommand = args ? `${cmd} ${args}` : cmd;
          const dir = call.args.directory ? ` (in ${call.args.directory})` : '';
          message = `Run this command${dir}?\n  $ ${fullCommand}`;
          permContext.command = fullCommand;
        } else if (call.tool === 'delete_path' && call.args?.path) {
          message = `Delete this path?\n  ${call.args.path}`;
          permContext.path = String(call.args.path);
        } else if (call.tool === 'write_file' && call.args?.path) {
          message = `Write to this file?\n  ${call.args.path}`;
          permContext.path = String(call.args.path);
        } else if (call.tool === 'multi_file_edit' && call.args?.file_path) {
          const editCount = Array.isArray(call.args.edits) ? call.args.edits.length : 0;
          message = `Edit this file (${editCount} change${editCount === 1 ? '' : 's'})?\n  ${call.args.file_path}`;
          permContext.path = String(call.args.file_path);
        }

        const confirmed = await this.confirmApproval(message, permContext);
        if (!confirmed) {
          const result: ToolExecutionResult = {
            tool: call.tool,
            success: false,
            output: 'Tool execution skipped by user.'
          };
          results.set(i, result);
          onToolComplete?.(i, result);
          continue;
        }
      }

      readyToExecute.push({ call, index: i });
    }

    // Phase 2: Parallel execution of approved calls
    if (readyToExecute.length > 0) {
      const execResults = await this.executeWithConcurrency(
        readyToExecute,
        this.maxConcurrency,
        onToolComplete
      );
      for (const [index, result] of execResults) {
        results.set(index, result);
      }
    }

    // Phase 3: Reassemble in original input order
    return toolCalls.map((_, i) => results.get(i)!);
  }

  /**
   * Execute tool calls with a concurrency limit using a worker-pool pattern.
   */
  private async executeWithConcurrency(
    tasks: Array<{ call: ToolCallRequest; index: number }>,
    maxConcurrency: number,
    onToolComplete?: (index: number, result: ToolExecutionResult) => void
  ): Promise<Map<number, ToolExecutionResult>> {
    const results = new Map<number, ToolExecutionResult>();
    let cursor = 0;

    const runNext = async (): Promise<void> => {
      while (cursor < tasks.length) {
        const taskIndex = cursor++;
        const { call, index } = tasks[taskIndex];
        let result: ToolExecutionResult;
        try {
          const action = this.toAction(call);
          const output = await this.executor(action, { toolCallId: call.id, tool: call.tool });
          result = { tool: call.tool, success: true, output };
        } catch (error) {
          result = {
            tool: call.tool,
            success: false,
            error: error instanceof Error ? error.message : String(error)
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
    return results;
  }

  private toAction(call: ToolCallRequest): AgentAction {
    return {
      type: call.tool,
      ...(call.args ?? {})
    } as AgentAction;
  }
}
