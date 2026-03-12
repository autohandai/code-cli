# Project Tracker Tool — Design Spec

**Date**: 2026-03-13
**Status**: Draft
**Scope**: Read-only issue/PR querying via `gh` CLI

---

## Problem

The LLM has no way to query GitHub issues or pull requests for the current project. Users cannot ask things like "what issues are assigned to me?" or "show me the details of PR #42" without leaving the CLI or manually pasting information.

## Solution

Add a single `project_tracker` tool backed by the `gh` CLI. The tool provides read-only access to issues and pull requests for the current (or specified) repository.

## Design Decisions

### Why `gh` CLI only (no direct API)

- Zero auth management — leverages the user's existing `gh auth login`
- Battle-tested output parsing via `--json` flags
- Handles pagination, rate limits, and edge cases internally
- Single dependency the user likely already has

### Why a single tool with `action` parameter

- Keeps the tool list compact (1 tool vs 5+)
- Reduces token overhead in the LLM context
- The `action` enum is self-documenting
- Matches the existing `web_repo` pattern (single tool, `operation` parameter)

### MCP coexistence strategy

Handled via the tool description, not runtime logic:

> "If a GitHub MCP server is connected with equivalent tools, prefer those instead."

The LLM reads this and will naturally prefer MCP tools when available. No detection logic, no suppression, no config toggles. If the user doesn't have an MCP server, the built-in tool handles everything.

### Future extensibility

- Write actions (create_issue, comment, merge_pr) can be added to the `action` enum later
- Linear support would be a separate tool (`linear_tracker`) or the same tool with a `provider` parameter — decided when that need arises
- No premature abstraction

## Tool Definition

### Name

`project_tracker`

### Description

```
Query issues and pull requests for the current project.
Requires gh CLI installed and authenticated (https://cli.github.com).
If a GitHub MCP server is connected with equivalent tools, prefer those instead.

Actions:
- list_issues: List issues (filter by state, assignee, labels)
- get_issue: Get full issue details with comments
- list_prs: List pull requests (filter by state, author, base branch)
- get_pr: Get full PR details with checks and review status
- get_user: Get the authenticated GitHub username
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string (enum) | Yes | One of: `list_issues`, `get_issue`, `list_prs`, `get_pr`, `get_user` |
| `number` | number | No | Issue or PR number (required for `get_issue`, `get_pr`) |
| `state` | string (enum) | No | `open`, `closed`, or `all` (default: `open`) |
| `assignee` | string | No | Filter by assignee username. Use `@me` for the authenticated user |
| `author` | string | No | Filter by author username |
| `labels` | string | No | Comma-separated label names to filter by |
| `base` | string | No | Filter PRs by base branch |
| `limit` | number | No | Maximum results to return (default: 20) |
| `repo` | string | No | `owner/repo` override (default: detected from git remote) |

### Parameter validation by action

| Action | Required params | Optional params |
|--------|----------------|-----------------|
| `list_issues` | — | `state`, `assignee`, `labels`, `limit`, `repo` |
| `get_issue` | `number` | `repo` |
| `list_prs` | — | `state`, `author`, `base`, `labels`, `limit`, `repo` |
| `get_pr` | `number` | `repo` |
| `get_user` | — | — |

## Implementation

### New file: `src/actions/projectTracker.ts`

Responsibilities:
1. Validate `gh` CLI is installed and authenticated
2. Map `action` + parameters to `gh` CLI commands
3. Parse JSON output from `gh`
4. Return formatted results to the LLM

#### gh CLI commands per action

```
list_issues  → gh issue list --json number,title,state,assignees,labels,createdAt,updatedAt --limit {limit} [--state {state}] [--assignee {assignee}] [--label {labels}] [-R {repo}]
get_issue    → gh issue view {number} --json number,title,state,body,assignees,labels,comments,createdAt,updatedAt,milestone,author [-R {repo}]
list_prs     → gh pr list --json number,title,state,author,baseRefName,headRefName,labels,createdAt,updatedAt,isDraft --limit {limit} [--state {state}] [--author {author}] [--base {base}] [--label {labels}] [-R {repo}]
get_pr       → gh pr view {number} --json number,title,state,body,author,baseRefName,headRefName,labels,comments,reviews,statusCheckRollup,mergeable,additions,deletions,createdAt,updatedAt,isDraft [-R {repo}]
get_user     → gh api user --jq '.login'
```

#### Error handling

| Condition | Error message |
|-----------|---------------|
| `gh` not found | `gh CLI is not installed. Install it from https://cli.github.com` |
| Not authenticated | `gh CLI is not authenticated. Run 'gh auth login' first.` |
| Missing `number` for get_issue/get_pr | `The 'number' parameter is required for {action}` |
| Invalid action | `Unknown action: {action}. Valid actions: list_issues, get_issue, list_prs, get_pr, get_user` |
| gh command fails | Pass through the gh stderr message |

#### Output formatting

Return the raw JSON from `gh` as a formatted string. The LLM can interpret structured JSON directly — no need for custom formatting. This keeps the implementation simple and avoids lossy transformations.

### Type changes: `src/types.ts`

Add to `AgentAction` union:

```typescript
| {
    type: 'project_tracker';
    action: 'list_issues' | 'get_issue' | 'list_prs' | 'get_pr' | 'get_user';
    number?: number;
    state?: 'open' | 'closed' | 'all';
    assignee?: string;
    author?: string;
    labels?: string;
    base?: string;
    limit?: number;
    repo?: string;
  }
```

### Tool registration: `src/core/toolManager.ts`

Add to `DEFAULT_TOOL_DEFINITIONS` array (after `web_repo`).

### Tool categories: `src/core/toolFilter.ts`

```typescript
// In TOOL_CATEGORIES
project_tracker: 'git_read',  // Read-only, related to the git project

// In RELEVANCE_CATEGORIES
project_tracker: 'project_tracking',  // New relevance category

// In CATEGORY_TRIGGERS
project_tracking: ['issue', 'issues', 'pr', 'pull request', 'assigned', 'tracker', 'bug', 'feature request', 'milestone', 'review'],
```

### Action executor: `src/core/actionExecutor.ts`

Add case in the main switch:

```typescript
case 'project_tracker':
  return projectTracker(action);
```

### Approval

`requiresApproval: false` — all actions are read-only.

## Testing

- Unit tests for parameter validation and `gh` command construction
- Unit tests for error handling (missing gh, not authenticated, missing number)
- Integration test with mock `gh` output for each action
- Manual test: `list_issues` with `--assignee @me` against a real repo

## Files to create/modify

| File | Change |
|------|--------|
| `src/actions/projectTracker.ts` | **New** — full implementation |
| `src/types.ts` | Add `project_tracker` to `AgentAction` union |
| `src/core/toolManager.ts` | Add tool definition to `DEFAULT_TOOL_DEFINITIONS` |
| `src/core/toolFilter.ts` | Add to `TOOL_CATEGORIES`, `RELEVANCE_CATEGORIES`, `CATEGORY_TRIGGERS` |
| `src/core/actionExecutor.ts` | Add case for `project_tracker` |
| `tests/actions/projectTracker.test.ts` | **New** — unit tests |
