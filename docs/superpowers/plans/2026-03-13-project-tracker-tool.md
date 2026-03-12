# Project Tracker Tool Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `project_tracker` tool that lets the LLM query GitHub issues and PRs via `gh` CLI so users can ask "what issues are assigned to me?"

**Architecture:** Single tool with `action` parameter, backed by `gh` CLI shell-outs. JSON output parsed and returned to LLM. No provider abstraction — gh-only for now.

**Tech Stack:** TypeScript, `gh` CLI, vitest for tests, `node:child_process.execFile` for shell-outs.

**Spec:** `docs/superpowers/specs/2026-03-13-project-tracker-tool-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/actions/projectTracker.ts` | **New** — gh CLI execution, parameter validation, command building |
| `src/types.ts` | Add `project_tracker` to `AgentAction` discriminated union |
| `src/core/toolManager.ts` | Add tool definition to `DEFAULT_TOOL_DEFINITIONS` |
| `src/core/toolFilter.ts` | Add `project_tracking` relevance category, register in all maps |
| `src/core/actionExecutor.ts` | Add `case 'project_tracker'` routing to handler |
| `tests/tools/project-tracker.test.ts` | **New** — unit tests for tool definition, validation, command building |

---

## Chunk 1: Core Implementation

### Task 1: Add type to AgentAction union

**Files:**
- Modify: `src/types.ts:908-912` (after `web_repo`, before `find_agent_skills`)

- [ ] **Step 1: Write the failing test**

Create `tests/tools/project-tracker.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { DEFAULT_TOOL_DEFINITIONS } from '../../src/core/toolManager.js';

describe('project_tracker tool', () => {
  describe('tool definition', () => {
    it('exists in DEFAULT_TOOL_DEFINITIONS', () => {
      const def = DEFAULT_TOOL_DEFINITIONS.find((t) => t.name === 'project_tracker');
      expect(def).toBeDefined();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools/project-tracker.test.ts`
Expected: FAIL — `project_tracker` not found in definitions.

- [ ] **Step 3: Add the AgentAction type**

In `src/types.ts`, after the `web_repo` line (`| { type: 'web_repo'; ... }`), add:

```typescript
  // Project Tracker
  | {
      type: 'project_tracker';
      action: 'list_issues' | 'get_issue' | 'list_prs' | 'get_pr' | 'get_user';
      number?: number;
      state?: 'open' | 'closed' | 'merged' | 'all';
      assignee?: string;
      author?: string;
      labels?: string;
      base?: string;
      limit?: number;
      repo?: string;
    }
```

- [ ] **Step 4: Commit**

```bash
git add src/types.ts tests/tools/project-tracker.test.ts
git commit -m "feat(types): add project_tracker to AgentAction union"
```

---

### Task 2: Add tool definition to toolManager

**Files:**
- Modify: `src/core/toolManager.ts:918-933` (after `web_repo` definition, before `find_agent_skills`)

- [ ] **Step 1: Add the tool definition**

In `src/core/toolManager.ts`, in the `DEFAULT_TOOL_DEFINITIONS` array, after the `web_repo` definition block and before `// Skills Discovery`, add:

```typescript
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
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npx vitest run tests/tools/project-tracker.test.ts`
Expected: PASS — `project_tracker` found in definitions.

- [ ] **Step 3: Add more definition tests**

Append to `tests/tools/project-tracker.test.ts` inside the `tool definition` describe block:

```typescript
    it('requires action parameter', () => {
      const def = DEFAULT_TOOL_DEFINITIONS.find((t) => t.name === 'project_tracker');
      expect(def!.parameters?.required).toContain('action');
    });

    it('has all action enum values', () => {
      const def = DEFAULT_TOOL_DEFINITIONS.find((t) => t.name === 'project_tracker');
      const actionProp = def!.parameters?.properties?.action;
      expect(actionProp?.enum).toEqual(['list_issues', 'get_issue', 'list_prs', 'get_pr', 'get_user']);
    });

    it('has state enum including merged', () => {
      const def = DEFAULT_TOOL_DEFINITIONS.find((t) => t.name === 'project_tracker');
      const stateProp = def!.parameters?.properties?.state;
      expect(stateProp?.enum).toContain('merged');
    });

    it('does not require approval (read-only)', () => {
      const def = DEFAULT_TOOL_DEFINITIONS.find((t) => t.name === 'project_tracker');
      expect(def!.requiresApproval).toBeUndefined();
    });

    it('description instructs LLM to prefer MCP when available', () => {
      const def = DEFAULT_TOOL_DEFINITIONS.find((t) => t.name === 'project_tracker');
      expect(def!.description).toContain('MCP');
    });
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/tools/project-tracker.test.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/toolManager.ts tests/tools/project-tracker.test.ts
git commit -m "feat(tools): add project_tracker tool definition"
```

---

### Task 3: Register in toolFilter

**Files:**
- Modify: `src/core/toolFilter.ts:18-26` (RelevanceCategory type)
- Modify: `src/core/toolFilter.ts:48-138` (TOOL_CATEGORIES)
- Modify: `src/core/toolFilter.ts:335-422` (RELEVANCE_CATEGORIES)
- Modify: `src/core/toolFilter.ts:427-436` (CATEGORY_TRIGGERS)

- [ ] **Step 1: Write the failing relevance test**

Append to `tests/tools/project-tracker.test.ts`:

```typescript
import { filterToolsByRelevance, getToolCategory } from '../../src/core/toolFilter.js';
import type { LLMMessage } from '../../src/types.js';

describe('tool categorization', () => {
  it('is categorized as git_read', () => {
    expect(getToolCategory('project_tracker')).toBe('git_read');
  });
});

describe('relevance filtering', () => {
  it('is included when user mentions issues', () => {
    const messages: LLMMessage[] = [{ role: 'user', content: 'show me the open issues assigned to me' }];
    const toolDef = DEFAULT_TOOL_DEFINITIONS.find((t) => t.name === 'project_tracker')!;
    const filtered = filterToolsByRelevance([toolDef], messages);
    expect(filtered).toHaveLength(1);
  });

  it('is included when user mentions pull requests', () => {
    const messages: LLMMessage[] = [{ role: 'user', content: 'list the pull requests for this repo' }];
    const toolDef = DEFAULT_TOOL_DEFINITIONS.find((t) => t.name === 'project_tracker')!;
    const filtered = filterToolsByRelevance([toolDef], messages);
    expect(filtered).toHaveLength(1);
  });

  it('is excluded when conversation has no tracker keywords', () => {
    const messages: LLMMessage[] = [{ role: 'user', content: 'hello world' }];
    const toolDef = DEFAULT_TOOL_DEFINITIONS.find((t) => t.name === 'project_tracker')!;
    const filtered = filterToolsByRelevance([toolDef], messages);
    expect(filtered).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools/project-tracker.test.ts`
Expected: FAIL — `project_tracker` not in relevance categories, so it falls through as unknown (included by default).

- [ ] **Step 3: Add to toolFilter.ts**

1. Add `'project_tracking'` to the `RelevanceCategory` type union:

```typescript
export type RelevanceCategory =
  | 'always'
  | 'filesystem'
  | 'git_basic'
  | 'git_advanced'
  | 'search'
  | 'dependencies'
  | 'meta'
  | 'project_tracking';
```

2. Add to `TOOL_CATEGORIES` (in the git read section):

```typescript
  project_tracker: 'git_read',
```

3. Add to `slack.blockedTools` in `CONTEXT_POLICIES` (requires `gh` binary, unavailable in Slack context):

```typescript
  slack: {
    allowedCategories: ['meta', 'git_read'],
    blockedTools: [
      // ... existing entries ...
      'project_tracker',    // Requires gh CLI binary
    ]
  },
```

4. Add to `RELEVANCE_CATEGORIES`:

```typescript
  project_tracker: 'project_tracking',
```

5. Add to `CATEGORY_TRIGGERS`:

```typescript
  project_tracking: ['issue', 'issues', 'pr', 'pull request', 'assigned', 'tracker', 'bug', 'feature request', 'milestone', 'review'],
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/tools/project-tracker.test.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/toolFilter.ts tests/tools/project-tracker.test.ts
git commit -m "feat(toolFilter): register project_tracker in categories and relevance"
```

---

### Task 4: Implement projectTracker action handler

**Files:**
- Create: `src/actions/projectTracker.ts`

- [ ] **Step 1: Write the failing test for gh availability check**

Append to `tests/tools/project-tracker.test.ts`:

```typescript
import { vi, beforeEach } from 'vitest';
import * as child_process from 'node:child_process';

// Mock node:child_process — must match the import specifier in projectTracker.ts
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

describe('projectTracker execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns error when gh is not installed', async () => {
    const mockExecFile = vi.mocked(child_process.execFile);
    mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
      const cb = (typeof _opts === 'function' ? _opts : callback) as Function;
      cb(new Error('command not found: gh'), '', '');
      return {} as any;
    });

    const { projectTracker } = await import('../../src/actions/projectTracker.js');
    const result = await projectTracker({
      type: 'project_tracker',
      action: 'get_user',
    });
    expect(result).toContain('gh CLI is not installed');
  });

  it('returns error when number is missing for get_issue', async () => {
    const { projectTracker } = await import('../../src/actions/projectTracker.js');
    const result = await projectTracker({
      type: 'project_tracker',
      action: 'get_issue',
    });
    expect(result).toContain("'number' parameter is required");
  });

  it('returns error when merged state used with list_issues', async () => {
    const { projectTracker } = await import('../../src/actions/projectTracker.js');
    const result = await projectTracker({
      type: 'project_tracker',
      action: 'list_issues',
      state: 'merged',
    });
    expect(result).toContain("'merged' state is only valid for list_prs");
  });

  it('builds correct gh command for list_issues with filters', async () => {
    const mockExecFile = vi.mocked(child_process.execFile);
    mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
      const cb = (typeof _opts === 'function' ? _opts : callback) as Function;
      cb(null, '[]', '');
      return {} as any;
    });

    const { projectTracker } = await import('../../src/actions/projectTracker.js');
    await projectTracker({
      type: 'project_tracker',
      action: 'list_issues',
      assignee: '@me',
      state: 'open',
      labels: 'bug,urgent',
      limit: 10,
    });

    const callArgs = mockExecFile.mock.calls[0];
    expect(callArgs[0]).toBe('gh');
    const args = callArgs[1] as string[];
    expect(args).toContain('issue');
    expect(args).toContain('list');
    expect(args).toContain('--assignee');
    expect(args).toContain('@me');
    expect(args).toContain('--state');
    expect(args).toContain('open');
    expect(args).toContain('--label');
    expect(args).toContain('bug,urgent');
    expect(args).toContain('--limit');
    expect(args).toContain('10');
  });

  it('builds correct gh command for get_pr', async () => {
    const mockExecFile = vi.mocked(child_process.execFile);
    mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
      const cb = (typeof _opts === 'function' ? _opts : callback) as Function;
      cb(null, '{}', '');
      return {} as any;
    });

    const { projectTracker } = await import('../../src/actions/projectTracker.js');
    await projectTracker({
      type: 'project_tracker',
      action: 'get_pr',
      number: 42,
      repo: 'owner/repo',
    });

    const callArgs = mockExecFile.mock.calls[0];
    const args = callArgs[1] as string[];
    expect(args).toContain('pr');
    expect(args).toContain('view');
    expect(args).toContain('42');
    expect(args).toContain('-R');
    expect(args).toContain('owner/repo');
  });

  it('returns parsed JSON from gh for get_user', async () => {
    const mockExecFile = vi.mocked(child_process.execFile);
    mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
      const cb = (typeof _opts === 'function' ? _opts : callback) as Function;
      cb(null, 'octocat\n', '');
      return {} as any;
    });

    const { projectTracker } = await import('../../src/actions/projectTracker.js');
    const result = await projectTracker({
      type: 'project_tracker',
      action: 'get_user',
    });
    expect(result).toContain('octocat');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools/project-tracker.test.ts`
Expected: FAIL — `../../src/actions/projectTracker.js` does not exist.

- [ ] **Step 3: Implement projectTracker.ts**

Create `src/actions/projectTracker.ts`:

```typescript
/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Project tracker — queries GitHub issues and PRs via gh CLI.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** JSON fields requested per action */
const ISSUE_LIST_FIELDS = 'number,title,state,assignees,labels,createdAt,url';
const ISSUE_VIEW_FIELDS = 'number,title,state,body,assignees,labels,comments,createdAt,milestone,author,url';
const PR_LIST_FIELDS = 'number,title,state,author,baseRefName,headRefName,labels,createdAt,isDraft,url';
const PR_VIEW_FIELDS = 'number,title,state,body,author,baseRefName,headRefName,labels,comments,latestReviews,statusCheckRollup,mergeable,additions,deletions,createdAt,isDraft,url';

interface ProjectTrackerAction {
  type: 'project_tracker';
  action: 'list_issues' | 'get_issue' | 'list_prs' | 'get_pr' | 'get_user';
  number?: number;
  state?: 'open' | 'closed' | 'merged' | 'all';
  assignee?: string;
  author?: string;
  labels?: string;
  base?: string;
  limit?: number;
  repo?: string;
}

/**
 * Execute a gh CLI command and return stdout.
 * Throws with a user-friendly message on failure.
 */
async function runGh(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('gh', args, {
      timeout: 30_000,
      maxBuffer: 5 * 1024 * 1024, // 5MB
    });
    return stdout;
  } catch (err: unknown) {
    const error = err as Error & { stderr?: string; code?: string };

    // gh not installed
    if (error.code === 'ENOENT' || error.message?.includes('command not found')) {
      throw new Error('gh CLI is not installed. Install it from https://cli.github.com');
    }

    // Auth / API errors — pass through gh's stderr
    const stderr = error.stderr ?? error.message ?? 'Unknown error';
    if (stderr.includes('auth login') || stderr.includes('not logged')) {
      throw new Error("gh CLI is not authenticated. Run 'gh auth login' first.");
    }

    throw new Error(`gh command failed: ${stderr.trim()}`);
  }
}

/**
 * Main entry point for the project_tracker tool.
 */
export async function projectTracker(action: ProjectTrackerAction): Promise<string> {
  // --- Parameter validation ---
  if (action.action === 'get_issue' || action.action === 'get_pr') {
    if (action.number == null) {
      return `Error: The 'number' parameter is required for ${action.action}`;
    }
    if (!Number.isInteger(action.number) || action.number <= 0) {
      return `Error: The 'number' parameter must be a positive integer`;
    }
  }

  if (action.state === 'merged' && action.action === 'list_issues') {
    return `Error: The 'merged' state is only valid for list_prs`;
  }

  // --- Build and execute gh command ---
  try {
    switch (action.action) {
      case 'list_issues':
        return await listIssues(action);
      case 'get_issue':
        return await getIssue(action);
      case 'list_prs':
        return await listPrs(action);
      case 'get_pr':
        return await getPr(action);
      case 'get_user':
        return await getUser();
      default:
        return `Error: Unknown action: ${(action as any).action}. Valid actions: list_issues, get_issue, list_prs, get_pr, get_user`;
    }
  } catch (err: unknown) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function listIssues(action: ProjectTrackerAction): Promise<string> {
  const args = ['issue', 'list', '--json', ISSUE_LIST_FIELDS];
  args.push('--limit', String(action.limit ?? 20));
  if (action.state) args.push('--state', action.state);
  if (action.assignee) args.push('--assignee', action.assignee);
  if (action.labels) args.push('--label', action.labels);
  if (action.repo) args.push('-R', action.repo);
  return runGh(args);
}

async function getIssue(action: ProjectTrackerAction): Promise<string> {
  const args = ['issue', 'view', String(action.number), '--json', ISSUE_VIEW_FIELDS];
  if (action.repo) args.push('-R', action.repo);
  return runGh(args);
}

async function listPrs(action: ProjectTrackerAction): Promise<string> {
  const args = ['pr', 'list', '--json', PR_LIST_FIELDS];
  args.push('--limit', String(action.limit ?? 20));
  if (action.state) args.push('--state', action.state);
  if (action.author) args.push('--author', action.author);
  if (action.base) args.push('--base', action.base);
  if (action.labels) args.push('--label', action.labels);
  if (action.repo) args.push('-R', action.repo);
  return runGh(args);
}

async function getPr(action: ProjectTrackerAction): Promise<string> {
  const args = ['pr', 'view', String(action.number), '--json', PR_VIEW_FIELDS];
  if (action.repo) args.push('-R', action.repo);
  return runGh(args);
}

async function getUser(): Promise<string> {
  try {
    const stdout = await runGh(['api', 'user', '--jq', '.login']);
    return `Authenticated as: ${stdout.trim()}`;
  } catch {
    throw new Error("Failed to get GitHub user. Ensure gh is authenticated: run 'gh auth status'");
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/tools/project-tracker.test.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/actions/projectTracker.ts tests/tools/project-tracker.test.ts
git commit -m "feat(actions): implement projectTracker gh CLI handler"
```

---

### Task 5: Wire into actionExecutor

**Files:**
- Modify: `src/core/actionExecutor.ts:1469-1470` (after `web_repo` case, before `find_agent_skills` case)

- [ ] **Step 1: Add the import and case**

At the top of `actionExecutor.ts`, add to imports:

```typescript
import { projectTracker } from '../actions/projectTracker.js';
```

In the main switch statement, after the `case 'web_repo'` block and before `case 'find_agent_skills'`, add:

```typescript
      // Project Tracker
      case 'project_tracker': {
        if (!action.action) {
          throw new Error('project_tracker requires an "action" parameter.');
        }
        console.log(chalk.cyan(`\n🔍 project_tracker: ${action.action}${action.number ? ` #${action.number}` : ''}...`));
        const result = await projectTracker(action);
        const preview = result.slice(0, 500);
        console.log(chalk.gray(preview + (result.length > 500 ? '\n   ... (truncated)' : '')));
        return result;
      }
```

- [ ] **Step 2: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/core/actionExecutor.ts
git commit -m "feat(executor): wire project_tracker into action executor"
```

---

### Task 6: Build verification

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All existing tests pass, plus the new `project-tracker.test.ts` tests.

- [ ] **Step 2: Run the bundler**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Verify the tool shows up at runtime (manual)**

Run: `node dist/index.js` and ask the LLM "what tools do you have?" or mention "issues" to trigger relevance filtering.
Expected: `project_tracker` appears in the tool list.

- [ ] **Step 4: Smoke test with a real repo (manual)**

In a repo with issues, test:
- "What issues are assigned to me?"
- "Show me PR #1"
- "List open pull requests"

Expected: LLM calls `project_tracker` with correct actions and returns results.

- [ ] **Step 5: Final commit if any fixups needed**

```bash
git add -A
git commit -m "fix: project_tracker integration fixups"
```
