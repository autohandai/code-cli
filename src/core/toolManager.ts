/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AgentAction, ToolCallRequest, ToolExecutionResult, FunctionDefinition } from '../types.js';
import { ToolFilter, type ClientContext, type ToolPolicy } from './toolFilter.js';

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
  executor: (action: AgentAction) => Promise<string | undefined>;
  confirmApproval: (message: string) => Promise<boolean>;
  definitions?: ToolDefinition[];
  /** Client context for tool filtering (default: 'cli') */
  clientContext?: ClientContext;
  /** Custom policy to override default context policy */
  customPolicy?: Partial<ToolPolicy>;
}

export const DEFAULT_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'tools_registry',
    description: 'List all available tools (built-in and meta)'
  },
  {
    name: 'plan',
    description: 'Capture a quick plan before executing',
    parameters: {
      type: 'object',
      properties: {
        notes: { type: 'string', description: 'Plan notes or description' }
      }
    }
  },
  {
    name: 'read_file',
    description: 'Read file contents',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file to read' }
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
    name: 'search',
    description: 'Search workspace text',
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
    description: 'Search workspace text with surrounding context',
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
    description: 'Search workspace text semantically with gitignore awareness',
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
    description: 'Execute shell commands with optional directory, background mode, and description. Prefer dedicated tools: read_file over cat, search over grep, search_replace over sed.',
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
    }
  },
  {
    name: 'todo_write',
    description: 'Persist structured todos',
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          description: 'Array of {id, title, status, description?}',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Task identifier' },
              title: { type: 'string', description: 'Task title' },
              status: { type: 'string', description: 'Task status' },
              description: { type: 'string', description: 'Optional details' }
            },
            required: ['id', 'title', 'status']
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
  }
];

export class ToolManager {
  private readonly definitions = new Map<AgentAction['type'], ToolDefinition>();
  private readonly executor: ToolManagerOptions['executor'];
  private readonly confirmApproval: ToolManagerOptions['confirmApproval'];
  private readonly toolFilter: ToolFilter;

  constructor(options: ToolManagerOptions) {
    this.executor = options.executor;
    this.confirmApproval = options.confirmApproval;
    this.toolFilter = new ToolFilter(options.clientContext ?? 'cli', options.customPolicy);
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

  private normalizeItems(items?: ToolParameter | { type: string; description?: string; enum?: string[]; properties?: Record<string, ToolParameter>; required?: string[] }): NormalizedItemSchema {
    if (!items) return { type: 'string' };
    if (items.type !== 'object') {
      return { type: items.type, description: items.description, enum: (items as ToolParameter).enum };
    }
    const objItems = items as { type: string; description?: string; properties?: Record<string, ToolParameter>; required?: string[] };
    return {
      type: 'object' as const,
      description: items.description,
      properties: this.normalizeObjectProperties(objItems.properties),
      required: objItems.required,
      additionalProperties: true
    };
  }

  private normalizeObjectProperties(props?: Record<string, ToolParameter>): Record<string, NormalizedPropertySchema> {
    const safeProps = props ?? {};
    return Object.fromEntries(
      Object.entries(safeProps).map(([k, v]) => [
        k,
        {
          type: v.type,
          description: v.description,
          enum: v.enum,
          items: v.type === 'array' ? this.normalizeItems(v.items) : undefined,
          properties: v.type === 'object'
            ? this.normalizeObjectProperties((v as any).properties as Record<string, ToolParameter> | undefined)
            : undefined,
          required: v.type === 'object' && Array.isArray((v as any).required)
            ? (v as any).required
            : undefined,
          additionalProperties: v.type === 'object' ? true : undefined
        }
      ])
    );
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

  async execute(toolCalls: ToolCallRequest[]): Promise<ToolExecutionResult[]> {
    const results: ToolExecutionResult[] = [];
    for (const call of toolCalls) {
      // Check if tool is allowed in current context
      if (!this.toolFilter.isAllowed(call.tool)) {
        results.push({
          tool: call.tool,
          success: false,
          error: `Tool '${call.tool}' is not available in the current context (${this.toolFilter.getContext()})`
        });
        continue;
      }

      const definition = this.definitions.get(call.tool);
      const requiresApproval = this.toolFilter.requiresApproval(call.tool, definition?.requiresApproval);

      if (requiresApproval) {
        // Build detailed approval message with action context
        let message = definition?.approvalMessage ?? `Allow tool ${call.tool}?`;

        // Add details based on tool type
        if (call.tool === 'run_command' && call.args) {
          const cmd = call.args.command || '';
          const args = Array.isArray(call.args.args) ? call.args.args.join(' ') : '';
          const dir = call.args.directory ? ` (in ${call.args.directory})` : '';
          const desc = call.args.description ? `\n   ${call.args.description}` : '';
          message = `Run command: ${cmd} ${args}${dir}${desc}`;
        } else if (call.tool === 'delete_path' && call.args?.path) {
          message = `Delete: ${call.args.path}`;
        } else if (call.tool === 'write_file' && call.args?.path) {
          message = `Write file: ${call.args.path}`;
        }

        const confirmed = await this.confirmApproval(message);
        if (!confirmed) {
          results.push({
            tool: call.tool,
            success: false,
            output: 'Tool execution skipped by user.'
          });
          continue;
        }
      }

      try {
        const action = this.toAction(call);
        const output = await this.executor(action);
        results.push({
          tool: call.tool,
          success: true,
          output
        });
      } catch (error) {
        results.push({
          tool: call.tool,
          success: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return results;
  }

  private toAction(call: ToolCallRequest): AgentAction {
    return {
      type: call.tool,
      ...(call.args ?? {})
    } as AgentAction;
  }
}
