import type { RunToolScope } from '../permissions/runToolScope.js';

/** Local inspection only: no shell, writes, network, delegation, or plan execution. */
export const REVIEW_INSPECTION_SCOPE: RunToolScope = {
  allowed: [
    'read_file', 'find_grep', 'fff_find', 'search_with_context', 'list_tree',
    'file_stats', 'checksum', 'git_status', 'git_diff', 'git_diff_range', 'git_log',
    'git_stash_list', 'git_worktree_list', 'git_worktree_status_all',
    'tools_registry', 'tool_search',
  ].map(kind => ({ kind })),
  denied: [],
};
