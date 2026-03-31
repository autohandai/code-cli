# cc-src Tool Gap Analysis

This maps the first-class tool surface in `cc-src` against Autohand's current built-in tools in [src/core/toolManager.ts](/Users/igorcosta/Documents/autohand/cli-3/src/core/toolManager.ts).

Source references:
- `cc-src` tools: `/Users/igorcosta/Downloads/cc-src/constants/tools.ts`
- `cc-src` prompt guidance: `/Users/igorcosta/Downloads/cc-src/constants/prompts.ts`
- Autohand tools: [src/core/toolManager.ts](/Users/igorcosta/Documents/autohand/cli-3/src/core/toolManager.ts)

## Summary

Autohand already covers the core local agent surface well:
- file read/write/edit
- code search and globbing
- shell execution
- git and browser operations
- web fetch/search
- todo tracking

The main gaps versus `cc-src` are not basic file/shell tools. They are orchestration tools:
- agent delegation as a first-class tool
- task lifecycle primitives
- explicit tool discovery
- worktree session context entry/exit
- notebook editing
- workflow/sleep/synthetic-output utilities
- cron create/delete parity

## Tool Matrix

| cc-src tool/category | Autohand equivalent | Gap | Priority |
| --- | --- | --- | --- |
| `FILE_READ_TOOL_NAME` | `read_file` | Covered | Low |
| `FILE_EDIT_TOOL_NAME` | `apply_patch`, `multi_file_edit` style edits via executor paths | Covered, but naming differs | Low |
| `FILE_WRITE_TOOL_NAME` | `write_file`, `append_file` | Covered | Low |
| `GLOB_TOOL_NAME` | `glob` | Covered | Low |
| `GREP_TOOL_NAME` | `find`, `search`, `search_with_context` | Covered, and broader | Low |
| `WEB_FETCH_TOOL_NAME` | `fetch_url` | Covered | Low |
| `WEB_SEARCH_TOOL_NAME` | `web_search` | Covered | Low |
| shell tool names / `BASH_TOOL_NAME` | `run_command` | Covered | Low |
| `TODO_WRITE_TOOL_NAME` | `todo_write` | Covered | Low |
| `AGENT_TOOL_NAME` | none | Missing true first-class delegation tool | High |
| `TASK_CREATE/GET/LIST/UPDATE` | none | Missing task lifecycle tools; only `todo_write` exists | High |
| `TASK_OUTPUT_TOOL_NAME` | none | Missing structured task output/reporting channel | Medium |
| `TASK_STOP_TOOL_NAME` | none | Missing explicit stop/cancel tool for delegated tasks | Medium |
| `SEND_MESSAGE_TOOL_NAME` | teammate/runtime messaging exists internally, but not as a tool | Missing externally exposed teammate message primitive | Medium |
| `TOOL_SEARCH_TOOL_NAME` | `tools_registry` only lists tools | Missing searchable tool discovery | Medium |
| `SKILL_TOOL_NAME` | slash skill flows and installer logic exist, but not a tool-call surface | Missing executable skill tool | Medium |
| `NOTEBOOK_EDIT_TOOL_NAME` | none | Missing notebook-aware edit tool | Medium |
| `ENTER_WORKTREE_TOOL_NAME` | worktree features exist internally | Missing first-class session/worktree context tool | Medium |
| `EXIT_WORKTREE_TOOL_NAME` | worktree features exist internally | Missing first-class session/worktree context tool | Medium |
| `CRON_LIST_TOOL_NAME` | schedule listing exists | Partial | Low |
| `CRON_CREATE_TOOL_NAME` | none | Missing create parity | Medium |
| `CRON_DELETE_TOOL_NAME` | cancel/list scheduling exists, but not direct parity | Partial | Medium |
| `WORKFLOW_TOOL_NAME` | none | Missing explicit reusable workflow execution tool | Low |
| `SLEEP_TOOL_NAME` | none | Missing wait/sleep utility tool | Low |
| `SYNTHETIC_OUTPUT_TOOL_NAME` | none | Missing synthetic output/channel tool | Low |
| `ASK_USER_QUESTION_TOOL_NAME` | `ask_followup_question` | Covered | Low |
| `ENTER_PLAN_MODE_TOOL_NAME` / exit plan mode | plan mode exists via commands/runtime | Covered conceptually, not tool-exposed in the same way | Low |

## Prompt Guidance Differences

`cc-src` is stricter and more explicit than Autohand today in a few important ways:

1. Prefer dedicated tools over shell.
   `cc-src` explicitly tells the model to avoid shell when a dedicated tool exists and gives concrete replacements for file read, file edit, file creation, globbing, and grep.

2. Use task tools continuously.
   Their prompt treats task tools as an always-on progress mechanism, not as an optional helper.

3. Maximize parallel tool calls.
   Their prompt is much more direct about parallelizing independent tool calls.

4. Tell users to run interactive commands with `! <command>`.
   This is called out explicitly as the preferred handoff for user-run shell commands.

5. Use agent delegation for broader exploration.
   They differentiate between simple direct searches and broader research delegated to agents.

## Recommended Implementation Order

### 1. First-class delegation and task orchestration

Add:
- `agent`
- `task_create`
- `task_get`
- `task_list`
- `task_update`
- `task_stop`

Reason:
- this is the biggest functional gap
- it unlocks real multi-agent and explicit progress management
- it aligns well with the repo's existing teammate and automode direction

### 2. Tool discovery and worktree context tools

Add:
- `tool_search`
- `enter_worktree`
- `exit_worktree`

Reason:
- these improve discoverability and controlled execution context
- they are useful even before deeper workflow tooling lands

### 3. Notebook and cron parity

Add:
- `notebook_edit`
- `cron_create`
- `cron_delete`

Reason:
- these are meaningful user-facing gaps
- the scheduling gap is partial today, not total

### 4. Lower-priority orchestration helpers

Add if the product direction justifies them:
- `workflow`
- `sleep`
- `synthetic_output`
- `skill`

Reason:
- useful, but less foundational than delegation/task/worktree parity

## Prompt Updates Worth Borrowing

These are prompt changes Autohand can adopt without waiting for new tools:

- Explicitly prefer `read_file`, `find`, `glob`, and `apply_patch` over shell for matching tasks.
- Instruct the model to parallelize independent tool calls by default.
- Tell the model to suggest `! <command>` when the user needs to run an interactive shell command.
- Distinguish between direct code search and delegated exploration once a first-class agent tool exists.
