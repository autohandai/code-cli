# Hooks System

Autohand's hooks system allows you to run custom shell commands in response to lifecycle events like tool execution, file modifications, session lifecycle, and LLM interactions. Hooks can be configured via `config.json` or managed interactively with the `/hooks` command.

## Create a hook in plain English

Open `/hooks` to browse every supported lifecycle event, including events with no
hooks installed. The table shows **Installed** and **Active** counts and a short
explanation of each trigger. Counts combine config hooks (including the bundled
examples) and hooks registered by enabled, trusted runtime extensions/plugins.
Disabled config hooks count as installed; the global switch makes every active
count zero. `post-response` is displayed under its canonical event, `stop`.
An active count means enabled; tool/path filters still decide whether a particular
event matches.

1. Navigate with **↑/↓**, then press **Enter** on an event.
2. Read the installed hooks and their sources, then describe the automation in
   plain English. For example, select `post-tool` and type:
   “After a successful write_file, append the edited path and timestamp to changes.log.”
3. Autohand generates a Node.js script using the current provider. It validates the
   returned definition and JavaScript syntax without executing the script.
4. Review the event, workspace, filters, timeout, execution mode, and full script.
   Use **↑/↓**, **PgUp/PgDn**, or **g/G** to scroll. Press **s** to save and enable,
   or **Esc/Ctrl+C** to cancel. Cancellation writes nothing.
5. The table refreshes. The saved hook runs on future matching lifecycle events,
   including in later sessions. Global disable remains in effect until you enable
   it through `/hooks manage`.

Generated scripts are saved as unique `.cjs` files under
`$AUTOHAND_HOME/hooks/generated/` (normally `~/.autohand/hooks/generated/`).
The hook definition is added to the active config file, including a custom
`--config` file. Existing hooks and plugin code are preserved. Generated scripts
require **Node.js on PATH** and use only built-in Node modules by default. They
run only in the workspace where they were created; moving the workspace requires
creating a new hook. The generated wrapper reads JSON stdin once and provides its parsed fields as
`hookContext` (for example, `hookContext.tool_name` or `hookContext.team_task_id`).
Scripts can also read the documented environment variables. They are not run automatically for testing: use `/hooks manage` →
“Test a hook” only when you intend its side effects to occur.

Useful requests include:

- `session-end`: “Append the session ID and timestamp to sessions.log.”
- `pre-tool`: “Block run_command when it tries to run git push --force.”
- `file-modified`: “Format changed TypeScript files with this project's formatter.”
- `rate-limit`: “Write the provider and retry delay to quota-events.log.”
- `task-completed`: “Log the team task ID and result to team-results.log.”

Hook scripts execute with your local permissions. Review generated scripts as you
would review a script you wrote yourself. A syntax check does not prove behavior;
keep secrets in environment variables, and use argument arrays instead of shell
interpolation for values received from hook context.

### Commands and existing hooks

| Command | Behavior |
| --- | --- |
| `/hooks` | Event browser and plain-English creation |
| `/hooks list` | Complete event table, also usable without a TTY |
| `/hooks manage` | Existing toggle, test, remove, manual-add, and global-switch controls |
| `/hooks help` | Command help |
| `/extensions` | Manage the plugins that own extension hooks |

Plugin handlers are identified by extension ID on the selected event. They are
not copied into config or toggled individually by config-hook controls. Disable
the owning extension to stop those handlers. The global hook switch also applies
to extension hooks. Lifecycle hooks are separate from Git's `.git/hooks`.

### Autohand AI tools

When the active provider is **Autohand AI** (`autohandai`), the assistant can use:

| Tool | Arguments | Purpose |
| --- | --- | --- |
| `list_hooks` | none | List all event counts, plugin ownership, and config hooks with indexes |
| `create_hook` | `prompt`, optional `event` | Infer a trigger if omitted, generate a script from plain English, then request approval and save it |
| `set_hook_enabled` | `event`, `index`, `enabled` | Set one config hook's enabled state after normal tool authorization |

For example: “Create a hook that logs the session ID when a session ends.”
Autohand AI can call `create_hook` with that request; you do not need to write a
shell command or edit JSON. These tools are intended for explicit requests for
persistent automation, not one-off tasks. Normal approval modes (`--yes`,
unrestricted mode, and transport approval callbacks) apply to tool-driven
creation. Interactive `/hooks` creation always shows its script review.

Hook tools are absent from other providers' model tool schemas, and execution
checks reject them after a provider switch as well. The event browser and manual
management remain available with every provider, and interactive authoring uses
your currently selected provider. Hook execution itself is provider-independent.

If generation fails, no hook is installed. If config persistence fails, the new
script is removed and the hook is not left active in memory. Existing scripts
are never overwritten by generated drafts.

## Overview

Hooks are useful for:
- Logging tool executions for debugging
- Sending notifications when tasks complete
- Triggering CI/CD pipelines when files change
- Custom metrics and telemetry collection
- Integrating with external tools and services
- Automating permission decisions
- Custom session management

## Hook Integration

### 1. Config-Based Hooks (CLI)
Define shell commands in your `~/.autohand/config.json` that run automatically on lifecycle events. These hooks run in your local shell environment.

Projects can add their own hooks under a `hooks` key in `<project>/.autohand/config.json` (shareable, commit it) or `<project>/.autohand/settings.local.json` (personal, gitignore it). Both the array form and the event-keyed form work in either file:

```json
{
  "hooks": {
    "hooks": [{ "event": "session-start", "command": "echo project session" }],
    "pre-prompt": ["node scripts/check-prompt.cjs"]
  }
}
```

- Project hooks are appended to the global list. A project hook with the same identity (same script file name, or same event plus description/command) replaces the global one, and `settings.local.json` wins over `config.json`.
- A `hooks.enabled` value in a project file overrides the global toggle for that project.
- The project is the workspace the session targets: `--path` when given, otherwise the current directory.
- Project hooks are never written into `~/.autohand/config.json`. Toggling or editing a project hook from `/hooks` lasts for the session only; change the project file to make it permanent.

#### Workspace trust

A cloned repository can ship these files, so project hooks and project MCP servers only run in a workspace you trust.

- The first interactive launch in such a workspace lists every project hook command and how each project MCP server starts, then asks you to choose **Trust this workspace** or **Not now**.
- **Trust this workspace** runs them now and in later sessions. The decision is stored in `~/.autohand/trusted-workspaces.json` with a fingerprint of the declared hooks and servers.
- Any change to a project hook or project MCP server changes the fingerprint, so Autohand asks again. Permission approvals saved to `settings.local.json` do not.
- **Not now**, Escape, or Ctrl+C starts the session without them, and Autohand asks again next launch.
- Runs that cannot show a prompt, such as `-p`, auto mode, patch mode, RPC, and ACP, skip untrusted project hooks and servers and print a warning to stderr.
- While a workspace that declares project hooks or servers is untrusted, the `hooks` and `mcp` sections of its project files are ignored entirely, including their `enabled` switches. Project files that only set those switches need no trust.

### 2. Runtime extension hooks
Enabled, trusted extensions register lifecycle handlers through `api.hooks.on(event, handler)`. The `/hooks` browser includes these handlers and identifies the owning extension.

### 3. JSON-RPC 2.0 Notifications (IDE Integration)
When running in RPC mode (VS Code, Zed, etc.), hook events are also emitted as JSON-RPC 2.0 notifications that IDE extensions can subscribe to.

---

## Hook Events

| Event | When Fired | Context Available |
|-------|-----------|-------------------|
| `pre-tool` | Before a tool begins execution | tool name, args, toolCallId |
| `post-tool` | After a tool completes | tool name, success, duration, output |
| `file-modified` | When a file is created, modified, or deleted | file path, change type |
| `pre-prompt` | Before sending instruction to LLM | instruction, mentioned files |
| `stop` | After agent finishes responding (turn complete) | tokens used, tool calls count, duration |
| `post-response` | Alias for `stop` for backward compatibility | tokens used, tool calls count, duration |
| `session-start` | When a session begins | session type (startup/resume/clear) |
| `session-end` | When a session ends | reason (quit/clear/exit/error), duration |
| `pre-clear` | Before memory extraction on `/clear` or `/new` | session id, cwd |
| `session-error` | When an error occurs | error message, code, context |
| `rate-limit` | When a provider rate limit ends the turn | error message, code, retryAfterMs, httpStatus, model, provider |
| `subagent-start` | Before a worker begins its task | run id, parent id, source, workspace, task, name, type |
| `subagent-progress` | When a worker's actual activity changes | run identity, status, activity, usage |
| `subagent-message` | When a message is queued for a worker | run identity, queued message |
| `subagent-cancel-requested` | When a worker stop is requested | run identity, status |
| `subagent-stop` | When a worker completes, fails, or is cancelled | run identity, status, success, duration, error |
| `permission-request` | Before showing permission dialog | tool, path, permission type |
| `permission-denied` | After the user refuses a permission request | tool, path, command, refusing decision |
| `notification` | When a notification is sent to user | notification type, message |
| `automode:start` | When auto-mode starts | auto-mode session id, prompt, max iterations |
| `automode:iteration` | On each auto-mode iteration | iteration, actions, files created/modified, cost |
| `automode:checkpoint` | When auto-mode creates a checkpoint | iteration, checkpoint commit |
| `automode:pause` | When auto-mode pauses | auto-mode session id, iteration |
| `automode:resume` | When auto-mode resumes | auto-mode session id, iteration |
| `automode:cancel` | When auto-mode is cancelled | cancel reason, iteration, cost |
| `automode:complete` | When auto-mode completes successfully | iterations, actions, files changed, cost |
| `automode:error` | When auto-mode encounters an error | error message, iteration |
| `autoresearch:start` | When an auto-research session starts or resumes | goal, active state, iteration, subcommand, attempt id, decision |
| `autoresearch:pause` | When an auto-research session is paused | goal, active state, iteration, subcommand, attempt id, decision |
| `autoresearch:init` | When init_experiment configures the session | goal, active state, iteration, subcommand, attempt id, decision |
| `autoresearch:before` | Before run_experiment starts an iteration | goal, active state, iteration, subcommand, attempt id, decision |
| `autoresearch:run` | When run_experiment executes the benchmark | goal, active state, iteration, subcommand, attempt id, decision |
| `autoresearch:after` | After run_experiment finishes an iteration | goal, active state, iteration, subcommand, attempt id, decision |
| `autoresearch:log` | When log_experiment records a result | goal, active state, iteration, subcommand, attempt id, decision |
| `autoresearch:decision` | When the deterministic experiment decision is persisted | goal, active state, iteration, subcommand, attempt id, decision |
| `autoresearch:replay` | When an isolated candidate replay completes | goal, active state, iteration, subcommand, attempt id, decision |
| `autoresearch:rescore` | When stored measurements are rescored with the current policy | goal, active state, iteration, subcommand, attempt id, decision |
| `autoresearch:prune` | When artifact retention is previewed or applied | goal, active state, iteration, subcommand, attempt id, decision |
| `autoresearch:complete` | When the auto-research loop completes | goal, active state, iteration, subcommand, attempt id, decision |
| `autoresearch:error` | When auto-research encounters an error | goal, active state, iteration, subcommand, attempt id, decision |
| `pre-learn` | Before a learn operation begins | instruction, cwd |
| `post-learn` | After a learn operation completes | instruction, duration, success |
| `goal-written:completed` | After a goal objective is created | goal id, objective, source |
| `team-created` | When a team is created | team name, member count |
| `teammate-spawned` | When a teammate process starts | team name, teammate name, agent name, pid |
| `teammate-idle` | When a teammate becomes idle | team name, teammate name |
| `task-assigned` | When a task is assigned to a teammate | task id, owner, teammate name |
| `task-completed` | When a task is marked complete | task id, owner, result |
| `team-shutdown` | When team cleanup completes | team name, completed task count, total task count |
| `review:start` | When a code review begins | review path, scope, instructions |
| `review:end` | When a code review session ends | review path, scope, duration |
| `review:paused` | When a code review pauses | review path, scope |
| `review:failed` | When a code review fails | review path, scope, review error |
| `review:completed` | When a code review completes successfully | review path, scope, duration |
| `mode-change` | When permission mode changes | permission mode |
| `context:compact` | When context is compacted | context lifecycle details |
| `context:overflow` | When context overflow is detected | context lifecycle details |
| `context:warning` | When context usage crosses the warning threshold | context lifecycle details |
| `context:critical` | When context usage crosses the critical threshold | context lifecycle details |

> **Note**: `post-response` is an alias for `stop` for backward compatibility.

### Rate limits

Long-window rate limits are **not** retried within the turn. A 5-hour, weekly,
daily, or otherwise unscoped quota cannot clear during a useful turn, so
retrying only spends the session retry budget on attempts that are guaranteed
to fail. When one of these limits is returned, the turn ends immediately and
both `session-error` and `rate-limit` fire once.

Autohand AI request-per-minute throttles are the exception: when the service
explicitly returns `scope: "rpm"`, the provider client may retry within its
configured attempt budget and uses the bounded server `Retry-After` delay. If
those attempts are exhausted, the hooks fire for the final rate-limit error.

Genuine transient failures — network drops, timeouts, 5xx outages — still retry
with backoff, honoring `Retry-After` when the provider sends one.

```json
{
  "hooks": {
    "hooks": [
      {
        "event": "rate-limit",
        "command": "notify-send \"Autohand: $HOOK_ERROR\"",
        "description": "Desktop notification when a quota is hit"
      }
    ]
  }
}
```

`HOOK_RETRY_AFTER_MS` is set only when the provider advertised a `Retry-After`,
so branch on its presence rather than assuming a value:

```bash
#!/bin/bash
if [ -n "$HOOK_RETRY_AFTER_MS" ]; then
  echo "Rate limited on $HOOK_MODEL; retry in $((HOOK_RETRY_AFTER_MS / 1000))s"
else
  echo "Rate limited on $HOOK_MODEL ($HOOK_PROVIDER) — quota exhausted"
fi
```

---

## Configuration

### Basic Structure

```json
{
  "hooks": {
    "enabled": true,
    "hooks": [
      {
        "event": "pre-tool",
        "command": "echo \"Running tool: $HOOK_TOOL\" >> ~/.autohand/hooks.log",
        "description": "Log all tool executions",
        "enabled": true
      }
    ]
  }
}
```

### Hook Definition Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `event` | string | Yes | Event to hook into (see events table) |
| `command` | string | Yes | Shell command to execute |
| `description` | string | No | Description shown in `/hooks` display |
| `enabled` | boolean | No | Whether hook is active (default: true) |
| `timeout` | number | No | Timeout in ms (default: 5000) |
| `async` | boolean | No | Run without blocking (default: false) |
| `matcher` | string | No | Regex pattern to filter events |
| `filter` | object | No | Filter to specific tools or paths |

### Filter Object

Limit when a hook fires using filters:

```json
{
  "filter": {
    "tool": ["run_command", "write_file"],
    "path": ["src/**/*.ts", "lib/**/*.js"]
  }
}
```

- `tool`: Array of tool names. Hook only fires for these tools.
- `path`: Array of glob patterns. Hook only fires for matching file paths.

### Matcher (Regex Filtering)

Use the `matcher` property to filter events using regex patterns:

```json
{
  "event": "pre-tool",
  "command": "./log-dangerous.sh",
  "matcher": "^(run_command|delete_path)$",
  "description": "Log only dangerous tool calls"
}
```

What the matcher matches against depends on the event type:

| Event | Matcher Matches Against |
|-------|------------------------|
| `pre-tool`, `post-tool` | Tool name |
| `permission-request` | Tool name |
| `notification` | Notification type |
| `session-start` | Session type (startup/resume/clear) |
| `session-end` | End reason (quit/clear/exit/error) |
| `subagent-start`, `subagent-progress`, `subagent-message`, `subagent-cancel-requested`, `subagent-stop` | Subagent type |
| `automode:*` | Event-specific auto-mode prompt, iteration, or reason |
| `review:*` | Event-specific review path, scope, instructions, or error |
| `team-created`, `team-shutdown` | Team name |
| `teammate-spawned`, `teammate-idle` | Team name, teammate name, or teammate agent name |
| `task-assigned`, `task-completed` | Task id, task owner, or task result |

---

## Legacy Event Names, Config Shape, and Template Variables

The first hooks documentation described an event-keyed config shape, `on_*` /
`before_*` / `after_*` event names, and `{{variable}}` placeholders. All three
still work and are rewritten onto the lifecycle events above, so an older
configuration keeps firing without changes.

### Legacy config shape

Commands may be listed directly under an event name. Each string (or object
with a `command`) becomes a hook definition for that event; the array form and
the event-keyed form can be mixed. The next time hooks are saved from `/hooks`
the file is written in the array form.

```json
{
  "hooks": {
    "on_file_change": [
      "eslint {{file}} --fix",
      { "command": "prettier --write {{file}}", "async": true }
    ],
    "on_session_end": ["notify-send \"Autohand session finished\""]
  }
}
```

### Legacy event names

| Legacy name | Fires on | Only when |
|-------------|----------|-----------|
| `on_session_start` | `session-start` | — |
| `on_session_end` | `session-end` | — |
| `on_session_resume` | `session-start` | session type is `resume` |
| `before_tool_call` | `pre-tool` | — |
| `after_tool_call` | `post-tool` | — |
| `on_tool_error` | `post-tool` | the tool failed |
| `on_file_change` | `file-modified` | — |
| `on_file_create` | `file-modified` | change type is `create` |
| `on_file_delete` | `file-modified` | change type is `delete` |
| `on_file_read` | `post-tool` | tool is `read_file` |
| `before_command` | `pre-tool` | tool is `run_command`, `shell`, or `custom_command` |
| `after_command` | `post-tool` | tool is `run_command`, `shell`, or `custom_command` |
| `on_user_message` | `pre-prompt` | — |
| `on_agent_response` | `stop` | — |
| `on_error` | `session-error` | — |
| `on_permission_denied` | `permission-denied` | — |
| `on_automode_start` | `automode:start` | — |
| `on_automode_stop` | `automode:complete`, `automode:cancel`, `automode:error` | — |
| `on_automode_iteration` | `automode:iteration` | — |
| `on_subagent_start` | `subagent-start` | — |
| `on_subagent_stop` | `subagent-stop` | — |
| `on_permission_request` | `permission-request` | — |
| `on_notification` | `notification` | — |

Legacy hooks receive the same environment variables and JSON input as the
lifecycle event they map to, and their results are reported under that event.
`/hooks` lists them under the mapped event.

### Template variables

Any hook command may contain `{{variable}}` placeholders. They are replaced
before the command runs, so they work alongside the `$HOOK_*` environment
variables. Values that are not a single plain word are single-quoted for the
shell, so `eslint {{file}}` is safe for paths with spaces. Unknown variables
become empty strings.

| Variable | Value | Source |
|----------|-------|--------|
| `{{file}}`, `{{path}}`, `{{resource}}` | File path | `HOOK_PATH` |
| `{{action}}` | Change type (`create`, `modify`, `delete`) or permission decision | `HOOK_CHANGE_TYPE`, `HOOK_PERMISSION_TYPE` |
| `{{tool}}` | Tool name | `HOOK_TOOL` |
| `{{args}}` | JSON-encoded tool arguments | `HOOK_ARGS` |
| `{{command}}` | Shell command being run or approved | `HOOK_ARGS` (`command`), permission context |
| `{{cwd}}`, `{{project}}` | Workspace root | `HOOK_WORKSPACE` |
| `{{session_id}}` | Session ID | `HOOK_SESSION_ID` |
| `{{timestamp}}` | ISO timestamp at execution | — |
| `{{duration}}` | Duration in ms (tool, turn, or subagent) | `HOOK_DURATION`, `HOOK_TURN_DURATION`, `HOOK_SUBAGENT_DURATION` |
| `{{result}}`, `{{output}}`, `{{response}}` | Tool output | `HOOK_OUTPUT` |
| `{{exit_code}}` | `0` when the tool succeeded, `1` when it failed | `HOOK_SUCCESS` |
| `{{error}}` | Error message | `HOOK_ERROR`, `HOOK_SUBAGENT_ERROR`, `HOOK_REVIEW_ERROR` |
| `{{context}}` | Error code | `HOOK_ERROR_CODE` |
| `{{message}}` | User instruction, notification message, or queued subagent message | `HOOK_INSTRUCTION`, `HOOK_NOTIFICATION_MSG` |
| `{{tokens}}` | Tokens used in the turn | `HOOK_TOKENS` |
| `{{level}}` | Notification type | `HOOK_NOTIFICATION_TYPE` |
| `{{agent}}` | Subagent name or type | `HOOK_SUBAGENT_NAME`, `HOOK_SUBAGENT_TYPE` |
| `{{task}}` | Subagent task or auto-mode prompt | `HOOK_AUTOMODE_PROMPT` |
| `{{iteration}}`, `{{iterations}}` | Current auto-mode or auto-research iteration | `HOOK_AUTOMODE_ITERATION` |
| `{{total}}`, `{{max_iterations}}` | Maximum iterations | `HOOK_AUTOMODE_MAX_ITERATIONS` |
| `{{reason}}` | Cancel reason, context reason, or session end reason | `HOOK_AUTOMODE_CANCEL_REASON`, `HOOK_SESSION_END_REASON` |

---

## JSON Input (stdin)

Hooks receive context as JSON via stdin, in addition to environment variables. This allows for more complex data handling:

```bash
#!/bin/bash
# Hook script that reads JSON input
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name')
TOOL_ARGS=$(echo "$INPUT" | jq -r '.tool_input')

echo "Tool: $TOOL_NAME with args: $TOOL_ARGS"
```

### JSON Input Structure

```json
{
  "session_id": "abc123",
  "cwd": "/path/to/workspace",
  "hook_event_name": "pre-tool",
  "tool_name": "write_file",
  "tool_input": { "path": "src/index.ts", "content": "..." },
  "tool_use_id": "call_123",
  "tool_response": null,
  "tool_success": null,
  "file_path": null,
  "change_type": null,
  "instruction": null,
  "mentioned_files": null,
  "tokens_used": null,
  "tokens_usage_status": null,
  "tool_calls_count": null,
  "turn_tool_calls": null,
  "turn_duration": null,
  "duration": null,
  "error": null,
  "error_code": null,
  "session_type": null,
  "session_end_reason": null,
  "subagent_id": null,
  "subagent_name": null,
  "subagent_type": null,
  "subagent_success": null,
  "subagent_error": null,
  "subagent_duration": null,
  "permission_type": null,
  "notification_type": null,
  "notification_message": null,
  "automode_session_id": null,
  "automode_prompt": null,
  "automode_iteration": null,
  "automode_max_iterations": null,
  "automode_actions": null,
  "automode_files_created": null,
  "automode_files_modified": null,
  "automode_cancel_reason": null,
  "automode_checkpoint_commit": null,
  "automode_total_cost": null,
  "review_path": null,
  "review_scope": null,
  "review_instructions": null,
  "review_error": null,
  "team_name": null,
  "teammate_name": null,
  "teammate_agent_name": null,
  "teammate_pid": null,
  "team_task_id": null,
  "team_task_owner": null,
  "team_task_result": null,
  "team_member_count": null,
  "team_tasks_completed": null,
  "team_tasks_total": null,
  "additional_workspaces": null
}
```

---

## Control Flow Responses

Hooks can return JSON to control agent behavior. This is useful for:
- Automating permission decisions
- Blocking dangerous operations
- Modifying tool inputs

### Response Format

```json
{
  "decision": "allow",
  "reason": "Approved by automation",
  "continue": true,
  "stopReason": null,
  "updatedInput": null,
  "additionalContext": null
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `decision` | string | `allow`, `deny`, `ask`, or `block` |
| `reason` | string | Reason for decision (shown to agent) |
| `continue` | boolean | Whether to continue execution |
| `stopReason` | string | Message shown when continue is false |
| `updatedInput` | object | Modified tool input |
| `additionalContext` | string | Additional context to add to conversation |

### Decision Values

| Decision | Effect |
|----------|--------|
| `allow` | Approve the action without prompting user |
| `deny` | Reject the action without prompting user |
| `ask` | Continue with normal user prompt |
| `block` | Block execution entirely |

### Example: Auto-approve safe commands

```bash
#!/bin/bash
INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name')
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

# Auto-approve git status and git diff
if [[ "$TOOL" == "run_command" && "$COMMAND" =~ ^git\ (status|diff) ]]; then
  echo '{"decision": "allow", "reason": "Safe git command"}'
  exit 0
fi

# Ask for everything else
echo '{"decision": "ask"}'
```

---

## Exit Codes

Hook exit codes have special meaning:

| Exit Code | Meaning |
|-----------|---------|
| 0 | Success - JSON response parsed if present |
| 2 | Blocking error - stops execution with stderr message |
| Other | Non-blocking error - logged but execution continues |

### Example: Block dangerous operations

```bash
#!/bin/bash
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

# Block rm -rf /
if [[ "$COMMAND" =~ rm.*-rf.*/ ]]; then
  echo "Blocked dangerous rm command: $COMMAND" >&2
  exit 2
fi

exit 0
```

---

## Environment Variables

When your hook command executes, these environment variables are available:

| Variable | Description | Available In |
|----------|-------------|--------------|
| `HOOK_EVENT` | Event name (e.g., "pre-tool") | All events |
| `HOOK_WORKSPACE` | Workspace root path | All events |
| `HOOK_SESSION_ID` | Current session ID | All events |
| `HOOK_TOOL` | Tool name | pre-tool, post-tool, permission-request, permission-denied |
| `HOOK_TOOL_CALL_ID` | Unique tool call ID | pre-tool, post-tool |
| `HOOK_ARGS` | JSON-encoded tool arguments | pre-tool, post-tool |
| `HOOK_SUCCESS` | "true" or "false" | post-tool |
| `HOOK_OUTPUT` | Tool output/result | post-tool |
| `HOOK_DURATION` | Execution time in ms | post-tool, stop, session-end |
| `HOOK_PATH` | File path | file-modified, permission-request, permission-denied |
| `HOOK_CHANGE_TYPE` | "create", "modify", or "delete" | file-modified |
| `HOOK_INSTRUCTION` | User instruction | pre-prompt |
| `HOOK_MENTIONED_FILES` | JSON array of mentioned files | pre-prompt |
| `HOOK_TOKENS` | Tokens used | stop |
| `HOOK_TOOL_CALLS_COUNT` | Number of tool calls | stop |
| `HOOK_TURN_TOOL_CALLS` | Tool calls in current turn | stop |
| `HOOK_TURN_DURATION` | Turn duration in ms | stop |
| `HOOK_ERROR` | Error message | session-error, rate-limit |
| `HOOK_ERROR_CODE` | Error code | session-error, rate-limit |
| `HOOK_RETRY_AFTER_MS` | Provider-advertised retry delay in ms (only when sent) | rate-limit |
| `HOOK_HTTP_STATUS` | HTTP status that produced the rate limit | rate-limit |
| `HOOK_MODEL` | Model that was rate limited | rate-limit |
| `HOOK_PROVIDER` | Provider that reported the rate limit | rate-limit |
| `HOOK_SESSION_TYPE` | startup, resume, or clear | session-start |
| `HOOK_SESSION_END_REASON` | quit, clear, exit, or error | session-end |
| `HOOK_SUBAGENT_ID` | Exact worker run ID | subagent events |
| `HOOK_SUBAGENT_NAME` | Subagent name | subagent events |
| `HOOK_SUBAGENT_TYPE` | Subagent type | subagent events |
| `HOOK_SUBAGENT_PARENT_ID` | Parent worker run ID, when nested | subagent events |
| `HOOK_SUBAGENT_SOURCE` | `delegate` or `team` | subagent events |
| `HOOK_SUBAGENT_STATUS` | Current worker status | subagent events |
| `HOOK_SUBAGENT_WORKSPACE` | Selected execution workspace | subagent events |
| `HOOK_SUBAGENT_ACTIVITY` | Actual model/tool activity, when available | subagent-progress |
| `HOOK_SUBAGENT_SUCCESS` | "true" or "false" | subagent-stop |
| `HOOK_SUBAGENT_ERROR` | Error message if failed | subagent-stop |
| `HOOK_SUBAGENT_DURATION` | Duration in ms | subagent-stop |
| `HOOK_PERMISSION_TYPE` | Permission type being requested, or the refusing decision (`deny_once`, `deny_session`, ...) | permission-request, permission-denied |
| `HOOK_NOTIFICATION_TYPE` | Type of notification | notification |
| `HOOK_NOTIFICATION_MSG` | Notification message | notification |
| `HOOK_AUTOMODE_SESSION_ID` | Auto-mode session ID | automode:* |
| `HOOK_AUTOMODE_PROMPT` | Auto-mode prompt/task | automode:start, automode:iteration |
| `HOOK_AUTOMODE_ITERATION` | Current auto-mode iteration | automode:* |
| `HOOK_AUTOMODE_MAX_ITERATIONS` | Maximum auto-mode iterations | automode:start, automode:iteration |
| `HOOK_AUTOMODE_ACTIONS` | JSON array of actions | automode:iteration, automode:complete |
| `HOOK_AUTOMODE_FILES_CREATED` | Number of files created | automode:* |
| `HOOK_AUTOMODE_FILES_MODIFIED` | Number of files modified | automode:* |
| `HOOK_AUTOMODE_CANCEL_REASON` | Cancellation reason | automode:cancel |
| `HOOK_AUTOMODE_CHECKPOINT` | Checkpoint commit hash | automode:checkpoint |
| `HOOK_AUTOMODE_COST` | Total auto-mode cost | automode:* |
| `HOOK_REVIEW_PATH` | Review target path | review:* |
| `HOOK_REVIEW_SCOPE` | Review scope | review:* |
| `HOOK_REVIEW_ERROR` | Review error message | review:failed |
| `HOOK_REVIEW_INSTRUCTIONS` | Review instructions/focus | review:* |
| `HOOK_GOAL_ID` | Goal ID | goal-written:completed |
| `HOOK_GOAL_OBJECTIVE` | Goal objective text | goal-written:completed |
| `HOOK_GOAL_SOURCE` | Source that created the goal | goal-written:completed |
| `HOOK_TEAM_NAME` | Team name | team-created, teammate-spawned, teammate-idle, task-assigned, task-completed, team-shutdown |
| `HOOK_TEAMMATE_NAME` | Teammate name | teammate-spawned, teammate-idle, task-assigned, task-completed |
| `HOOK_TEAMMATE_AGENT` | Teammate agent definition | teammate-spawned |
| `HOOK_TEAMMATE_PID` | Teammate process ID | teammate-spawned |
| `HOOK_TEAM_TASK_ID` | Team task ID | task-assigned, task-completed |
| `HOOK_TEAM_TASK_OWNER` | Team task owner | task-assigned, task-completed |
| `HOOK_TEAM_TASK_RESULT` | Team task result | task-completed |
| `HOOK_TEAM_MEMBER_COUNT` | Number of team members | team-created, teammate-spawned, teammate-idle, team-shutdown |
| `HOOK_TEAM_TASKS_COMPLETED` | Completed task count | teammate-idle, task-assigned, task-completed, team-shutdown |
| `HOOK_TEAM_TASKS_TOTAL` | Total task count | teammate-idle, task-assigned, task-completed, team-shutdown |
| `HOOK_ADDITIONAL_WORKSPACES` | JSON array of additional workspaces | All events when configured |

---

## Examples

### Log All Tool Executions

```json
{
  "event": "pre-tool",
  "command": "echo \"$(date) - Tool: $HOOK_TOOL\" >> ~/.autohand/tool.log",
  "description": "Log tool usage"
}
```

### Notify on File Changes

```json
{
  "event": "file-modified",
  "command": "osascript -e 'display notification \"File changed: '$HOOK_PATH'\" with title \"Autohand\"'",
  "description": "macOS notification on file change",
  "filter": {
    "path": ["src/**/*.ts"]
  }
}
```

### Track Token Usage

```json
{
  "event": "stop",
  "command": "curl -X POST https://api.example.com/metrics -d '{\"tokens\": '$HOOK_TOKENS'}'",
  "description": "Send token metrics",
  "async": true
}
```

### Run Linter on Modified TypeScript Files

```json
{
  "event": "file-modified",
  "command": "eslint \"$HOOK_PATH\" --fix",
  "description": "Auto-lint TypeScript",
  "filter": {
    "path": ["**/*.ts"]
  }
}
```

### Auto-approve Read Operations

```json
{
  "event": "permission-request",
  "command": "./auto-approve-reads.sh",
  "matcher": "^read_file$",
  "description": "Auto-approve file reads"
}
```

With `auto-approve-reads.sh`:
```bash
#!/bin/bash
echo '{"decision": "allow", "reason": "Read operations are safe"}'
```

### Log Session Lifecycle

```json
{
  "event": "session-start",
  "command": "echo \"Session started: $HOOK_SESSION_TYPE at $(date)\" >> ~/.autohand/sessions.log",
  "description": "Log session starts"
}
```

```json
{
  "event": "session-end",
  "command": "echo \"Session ended: $HOOK_SESSION_END_REASON after ${HOOK_DURATION}ms\" >> ~/.autohand/sessions.log",
  "description": "Log session ends"
}
```

### Track and control subagents

Direct, nested, and team workers emit lifecycle events using their unique run IDs. These are the same runs displayed by `/agents view`; external Squad records remain read-only and do not emit local worker-control events. Task and queued message text are available as `subagent_task` and `subagent_message` in the JSON sent to a hook's stdin, rather than embedded in shell commands.

Synchronous `subagent-start` and `subagent-progress` hooks can return the existing response fields on stdout:

```json
{ "additionalContext": "Verify the focused regression test before marking this task complete." }
```

This queues context for that worker's next safe model step. To stop only that worker:

```json
{ "continue": false, "stopReason": "The user has withdrawn this task." }
```

A stop response takes precedence over queued context. Messages are bounded to 8000 characters and the worker inbox is bounded; queued does not mean read. `subagent-message`, `subagent-cancel-requested`, and `subagent-stop` are observational: returned control fields are ignored to prevent recursive control loops. Use `async: true` only for observation, not returned control decisions. Hook failures are isolated, and frequent pending progress events may be coalesced. A cancellation request is not a completed cancellation; track `subagent-stop` with `subagent_status="cancelled"` for the final state.

For example, add this hook definition to the configuration's `hooks.hooks` array to track completion:

```json
{
  "event": "subagent-stop",
  "command": "echo \"Subagent $HOOK_SUBAGENT_NAME ($HOOK_SUBAGENT_TYPE): $HOOK_SUBAGENT_SUCCESS in ${HOOK_SUBAGENT_DURATION}ms\" >> ~/.autohand/subagents.log",
  "description": "Track subagent performance"
}
```

---

## Manual management with `/hooks manage`

Use `/hooks manage` for existing config hooks:
- View all registered hooks grouped by event
- Add new hooks
- Enable/disable individual hooks
- Remove hooks
- Test hooks with sample context
- Toggle hooks globally

### Display Example

```
Hooks
──────────────────────────────────────────────────
Mode: enabled

pre-tool (2/2 enabled)
  1. [enabled] echo "Running tool: $HOOK_TOOL" - Log tool usage
  2. [enabled] ./notify.sh - Notify slack

post-tool (1/1 enabled)
  1. [enabled] ./metrics.sh - Track metrics

stop (1/1 enabled)
  1. [enabled] ./track-tokens.sh - Track token usage

session-start (1/1 enabled)
  1. [enabled] ./log-session.sh - Log sessions

──────────────────────────────────────────────────
Total: 5 hooks (5 enabled, 0 disabled)
```

---

## JSON-RPC 2.0 Hook Notifications

When running in RPC mode (IDE integration), hook events are emitted as JSON-RPC 2.0 notifications that clients can subscribe to.

### Notification Types

| Notification | Method |
|-------------|--------|
| Pre-Tool | `autohand.hook.preTool` |
| Post-Tool | `autohand.hook.postTool` |
| File Modified | `autohand.hook.fileModified` |
| Pre-Prompt | `autohand.hook.prePrompt` |
| Stop | `autohand.hook.stop` |
| Post-Response | `autohand.hook.postResponse` (alias for stop) |
| Session Start | `autohand.hook.sessionStart` |
| Session End | `autohand.hook.sessionEnd` |
| Session Error | `autohand.hook.sessionError` |
| Subagent Stop | `autohand.hook.subagentStop` |
| Permission Request | `autohand.hook.permissionRequest` |
| Notification | `autohand.hook.notification` |

### Example: VS Code Extension

```typescript
// Subscribe to hook notifications
rpcClient.onNotification('autohand.hook.preTool', (params) => {
  outputChannel.appendLine(`[Hook] Pre-tool: ${params.toolName}`);
  vscode.window.setStatusBarMessage(`Running ${params.toolName}...`);
});

rpcClient.onNotification('autohand.hook.postTool', (params) => {
  const status = params.success ? 'success' : 'failed';
  outputChannel.appendLine(`[Hook] Post-tool: ${params.toolName} (${status}, ${params.duration}ms)`);
});

rpcClient.onNotification('autohand.hook.stop', (params) => {
  outputChannel.appendLine(`[Hook] Turn complete: ${params.tokensUsed} tokens, ${params.toolCallsCount} tool calls`);
});

rpcClient.onNotification('autohand.hook.sessionStart', (params) => {
  outputChannel.appendLine(`[Hook] Session started: ${params.sessionType}`);
});

rpcClient.onNotification('autohand.hook.sessionEnd', (params) => {
  outputChannel.appendLine(`[Hook] Session ended: ${params.reason} after ${params.duration}ms`);
});

rpcClient.onNotification('autohand.hook.subagentStop', (params) => {
  const status = params.success ? 'completed' : 'failed';
  outputChannel.appendLine(`[Hook] Subagent ${params.subagentName} ${status} in ${params.duration}ms`);
});
```

### Notification Parameters

#### `autohand.hook.preTool`
```typescript
{
  toolId: string;
  toolName: string;
  args: Record<string, unknown>;
  timestamp: string;
}
```

#### `autohand.hook.postTool`
```typescript
{
  toolId: string;
  toolName: string;
  success: boolean;
  duration: number;
  output?: string;
  timestamp: string;
}
```

#### `autohand.hook.fileModified`
```typescript
{
  filePath: string;
  changeType: 'create' | 'modify' | 'delete';
  toolId: string;
  timestamp: string;
}
```

#### `autohand.hook.prePrompt`
```typescript
{
  instruction: string;
  mentionedFiles: string[];
  timestamp: string;
}
```

#### `autohand.hook.stop`
```typescript
{
  tokensUsed: number;
  tokensUsageStatus?: "actual" | "unavailable";
  toolCallsCount: number;
  duration: number;
  timestamp: string;
}
```

#### `autohand.hook.sessionStart`
```typescript
{
  sessionType: 'startup' | 'resume' | 'clear';
  timestamp: string;
}
```

#### `autohand.hook.sessionEnd`
```typescript
{
  reason: 'quit' | 'clear' | 'exit' | 'error';
  duration: number;
  timestamp: string;
}
```

#### `autohand.hook.sessionError`
```typescript
{
  error: string;
  code?: string;
  context?: Record<string, unknown>;
  timestamp: string;
}
```

#### `autohand.hook.subagentStop`
```typescript
{
  subagentId: string;
  subagentName: string;
  subagentType: string;
  success: boolean;
  duration: number;
  error?: string;
  timestamp: string;
}
```

#### `autohand.hook.permissionRequest`
```typescript
{
  tool: string;
  path?: string;
  command?: string;
  args?: Record<string, unknown>;
  timestamp: string;
}
```

#### `autohand.hook.notification`
```typescript
{
  notificationType: string;
  message: string;
  timestamp: string;
}
```

---

## Built-in Hooks

Autohand ships with default hooks that are installed on first run. All hooks are **disabled by default** and can be enabled via `/hooks manage` or by editing your config.

### Logging Hooks

Simple hooks for logging events:

| Event | Description |
|-------|-------------|
| `session-start` | Log when session starts |
| `session-end` | Log when session ends with duration |
| `stop` | Log turn completion with token/tool stats |
| `file-modified` | Log file changes (filtered to `src/**/*` and `lib/**/*`) |

### Sound Alert Hook

Plays a system sound when a task completes. Cross-platform support for macOS, Linux, and Windows.

```json
{
  "event": "stop",
  "command": "~/.autohand/hooks/sound-alert.sh",
  "description": "Play sound when task completes",
  "enabled": true,
  "async": true
}
```

**Platform support:**
- **macOS**: Uses `afplay` with system sounds (Glass.aiff for success)
- **Linux**: Uses `paplay`, `aplay`, or `speaker-test`
- **Windows**: Uses PowerShell `[console]::beep()`

### Auto-Format Hook

Automatically formats changed files using prettier, eslint, or biome.

```json
{
  "event": "file-modified",
  "command": "~/.autohand/hooks/auto-format.sh",
  "description": "Auto-format changed files",
  "enabled": true,
  "filter": {
    "path": ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.json", "**/*.css", "**/*.md"]
  }
}
```

**Formatter priority:**
1. Prettier (if available in project)
2. ESLint --fix (for JS/TS files)
3. Biome format

### Slack Notification Hook

Sends a Slack notification when tasks complete. Requires `SLACK_WEBHOOK_URL` environment variable.

```json
{
  "event": "stop",
  "command": "~/.autohand/hooks/slack-notify.sh",
  "description": "Send Slack notification when task completes",
  "enabled": true,
  "async": true
}
```

**Setup:**
1. Create a Slack Incoming Webhook at https://api.slack.com/messaging/webhooks
2. Set the environment variable:
   ```bash
   export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/XXX/YYY/ZZZ"
   ```

**Message includes:**
- Project name
- Duration (human readable)
- Tokens used
- Tool calls count

### Git Auto-Stage Hook

Automatically stages modified files to git.

```json
{
  "event": "file-modified",
  "command": "~/.autohand/hooks/git-auto-stage.sh",
  "description": "Auto-stage modified files to git",
  "enabled": true,
  "filter": {
    "path": ["src/**/*", "lib/**/*", "tests/**/*"]
  }
}
```

**Automatically skips:**
- `.env*` files
- `*.log`, `*.tmp`, `*.swp`, `*.bak` files
- `node_modules/`, `.git/`, `dist/`, `build/`, `coverage/` directories

### Security Guard Hook

Blocks dangerous commands and operations before they execute. Uses exit code 2 to block.

```json
{
  "event": "pre-tool",
  "command": "~/.autohand/hooks/security-guard.sh",
  "description": "Block dangerous commands and operations",
  "enabled": true,
  "matcher": "^(run_command|delete_path|write_file)$"
}
```

**Blocked commands:**
- `rm -rf /`, `rm -rf ~`, `rm -rf .`
- `sudo rm`
- `chmod 777`, `chmod -R 777`
- `mkfs`, `dd if=`
- Fork bombs
- `curl | bash`, `wget | sh` (piped to shell)

**Protected files:**
- `.env`, `.env.local`, `.env.production`
- SSH keys (`id_rsa`, `id_ed25519`, `*.pem`, `*.key`)
- Credentials (`credentials.json`, `secrets.json`, `.npmrc`, `.pypirc`)

### Smart Commit Hook

Automatically runs lint, test, and creates a commit with an LLM-generated message.

```json
{
  "event": "stop",
  "command": "~/.autohand/hooks/smart-commit.sh",
  "description": "Auto lint, test, and commit with LLM message",
  "enabled": false,
  "async": true
}
```

> **Note**: This hook is disabled by default. Enable it only if you want automatic commits after each agent turn.

### Enabling Built-in Hooks

Use `/hooks manage` and select "Toggle hooks on/off" to toggle individual hooks:

```
› /hooks manage
? Action: Toggle hooks on/off
? Select hook to toggle:
  ❯ [disabled] session-start - Log session start
    [disabled] sound-alert - Play sound when task completes
    [disabled] auto-format - Auto-format changed files
    [disabled] slack-notify - Send Slack notification
    [disabled] git-auto-stage - Auto-stage modified files
    [disabled] security-guard - Block dangerous operations
```

Or manually edit your `~/.autohand/config.json` to enable specific hooks.

---

## Best Practices

### Timeout Guidelines
- Default timeout is 5000ms (5 seconds)
- For quick logging operations, 1000-2000ms is sufficient
- For network operations, consider 10000-30000ms
- For long-running operations, set `async: true`

### Sync vs Async
- **Sync (default)**: Blocks agent until hook completes. Use for critical operations that must complete before continuing.
- **Async**: Runs in background without blocking. Use for logging, metrics, or non-critical notifications.

### Error Handling
- Hook failures do not crash the agent
- Errors are logged but execution continues
- Exit code 2 blocks execution with the stderr message
- Test hooks with `/hooks manage` before relying on them

### Security Considerations
- Hook commands run in your shell with your permissions
- Be careful with hooks that receive user input (potential for injection)
- Avoid running hooks from untrusted config files
- Consider sanitizing environment variables in your hook scripts

### Control Flow Best Practices
- Use `decision: "allow"` sparingly - only for operations you're certain are safe
- Use `decision: "ask"` as the default fallback
- Use `decision: "block"` with exit code 2 for truly dangerous operations
- Always provide a `reason` for allow/deny decisions for auditability

## Import hooks from another coding agent

Use the `hooks` category to import command hooks into the configuration Autohand actually uses:

```sh
autohand import claude --categories hooks
autohand import codex --categories hooks
autohand import cursor --categories hooks
autohand import grok --categories hooks
```

Inside a session, use `/import claude --categories hooks`. `--dry-run` scans without writing. `--all --categories hooks` restricts an all-source import to hooks. The CLI respects the selected `--path`, `--config`, and `AUTOHAND_CONFIG`; the slash command updates the current session's hook manager. Legacy Codex `notify` commands are discovered and reported for manual porting because they receive their JSON payload as a command argument.

Imported commands are **saved disabled**. Review the original scripts, then enable the desired entries through `/hooks manage`. Importing does not execute commands, copy scripts, install dependencies, or carry over another agent's trust approvals. Commands continue to reference their original scripts. Repeating the same import skips existing definitions and preserves their enabled state. Existing hooks and unrelated configuration remain intact; malformed destination configuration is reported without overwriting it.

| Source | User files | Current project files |
| --- | --- | --- |
| Claude Code | `~/.claude/settings.json` (or `CLAUDE_CONFIG_DIR`) | `.claude/settings.json`, `.claude/settings.local.json` |
| Codex | `~/.codex/hooks.json`, `config.toml` (or `CODEX_HOME`) | `.codex/hooks.json`, `.codex/config.toml` |
| Cursor | `~/.cursor/hooks.json` | `.cursor/hooks.json` |
| Grok | `~/.grok/hooks/*.json` | `.grok/hooks/*.json` |

Codex JSON and inline TOML definitions are both read, including nested array tables and multiline commands. Grok import currently imports hooks only. Plugin bundles, managed policies, ancestor-project layers, and additional Grok `hooks-paths` roots are outside this importer. Import Claude/Cursor configurations under their own source names even when Grok also loads those files.

| Source event | Autohand event |
| --- | --- |
| `PreToolUse` / Cursor `preToolUse` | `pre-tool` |
| `PostToolUse` / Cursor `postToolUse` | `post-tool` on success (Codex observes both outcomes) |
| Claude/Grok `PostToolUseFailure` / Cursor `postToolUseFailure` | `post-tool` on failure |
| `UserPromptSubmit` / Cursor `beforeSubmitPrompt` | `pre-prompt` |
| Claude/Codex `PermissionRequest` | `permission-request` |
| `SessionStart` / Cursor `sessionStart` | `session-start` |
| `SessionEnd` / Cursor `sessionEnd` | `session-end` |
| Claude/Grok `Notification` | `notification` |
| `PostCompact` | `context:compact` |
| Cursor `beforeShellExecution` / `afterShellExecution` | Shell-only `pre-tool` / successful `post-tool` |
| Grok `Stop` | `stop` |

The adapter translates common tool names, file paths/content, shell arguments, event names, JSON stdin, and supported permission responses. Cursor shell matchers inspect the command string. Success/failure filters and project scope are enforced before spawning a command. Cursor user hooks retain their user-directory working directory; project hooks run in the project. Claude-compatible commands receive `CLAUDE_PROJECT_DIR`; Grok commands receive the Grok hook environment fields.

Timeout values are converted from seconds to milliseconds. When omitted, Claude command hooks use 600 seconds, prompt hooks 30 seconds, and session-end hooks 1.5 seconds; Codex uses 600 seconds except session-end at 1 second. Grok uses 5 seconds. Cursor documents a platform-dependent default, so imports use Autohand's 5-second default; set an explicit source timeout to retain a particular budget. Source-wide/shared shutdown budgets are not reproduced.

This is a command-hook adapter, not an emulation of the source agent. Review any script that depends on its complete payload or tool schema. Transcript paths, source-specific IDs, permission-mode/sandbox metadata, file attachments, tool-response object shapes, and source-specific file-edit formats are not reconstructed. Codex shell calls use `Bash`; native file tools retain their names (`apply_patch` also matches `Edit` and `Write`). Claude/Cursor file operations expose common file fields, while patch/edit input rewrites are denied with an explanation. Permission persistence updates also require manual porting.

HTTP, prompt/agent/MCP-tool handlers, asynchronous hooks, `failClosed`, unsupported matcher shapes, and unmapped events are reported as skipped. In particular, Claude/Codex/Cursor stop or subagent-stop hooks that continue a turn, pre-compaction hooks, Cursor file-read content gates and Tab/workspace hooks, and new source-specific events need manual porting. Post-compaction is never substituted for pre-compaction. Hooks that add context can deliver it to the conversation; lifecycle observers cannot restart turns or replace MCP responses.

Grok's only blocking event is `PreToolUse`. An explicit deny or exit code 2 blocks there; its other events stay passive. An `allow` response from Grok does not override Autohand permissions.

Formats were checked against the official [Claude Code hook reference](https://code.claude.com/docs/en/hooks), [Codex hook manual](https://learn.chatgpt.com/docs/hooks.md), [Cursor hook reference](https://cursor.com/docs/hooks), and [Grok hook reference](https://docs.x.ai/build/features/hooks).

### Runtime wiring checked with hook imports

`pre-prompt` runs in the common instruction runner, including interactive CLI, command, ACP, and JSON-RPC turns. Denial happens before prompt preparation or model calls, and running prompt hooks can be cancelled. RPC adapters forward original Review prompts and mentioned files instead of executing a duplicate hook. ACP also executes configured `stop` hooks after a turn.

Permission changes emit `mode-change` with `previous_mode`/`mode` JSON fields and `HOOK_PREVIOUS_MODE`/`HOOK_MODE` environment fields. `/learn` emits `pre-learn` before analysis and `post-learn` afterwards. The hook summary uses the same event catalogue as the browser, and autoresearch `decision`, `replay`, `rescore`, and `prune` events honor their matchers.
