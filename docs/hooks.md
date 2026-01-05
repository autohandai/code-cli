# Hooks System

Autohand's hooks system allows you to run custom shell commands in response to lifecycle events like tool execution, file modifications, session lifecycle, and LLM interactions. Hooks can be configured via `config.json` or managed interactively with the `/hooks` command.

## Overview

Hooks are useful for:
- Logging tool executions for debugging
- Sending notifications when tasks complete
- Triggering CI/CD pipelines when files change
- Custom metrics and telemetry collection
- Integrating with external tools and services
- Automating permission decisions
- Custom session management

## Two Modes of Hook Integration

### 1. Config-Based Hooks (CLI)
Define shell commands in your `~/.autohand/config.json` that run automatically on lifecycle events. These hooks run in your local shell environment.

### 2. JSON-RPC 2.0 Notifications (IDE Integration)
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
| `session-start` | When a session begins | session type (startup/resume/clear) |
| `session-end` | When a session ends | reason (quit/clear/exit/error), duration |
| `session-error` | When an error occurs | error message, code, context |
| `subagent-stop` | When a subagent finishes execution | subagent id, name, type, success, duration |
| `permission-request` | Before showing permission dialog | tool, path, permission type |
| `notification` | When a notification is sent to user | notification type, message |

> **Note**: `post-response` is an alias for `stop` for backward compatibility.

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
| `subagent-stop` | Subagent type |

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
  "notification_message": null
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
| `HOOK_TOOL` | Tool name | pre-tool, post-tool, permission-request |
| `HOOK_TOOL_CALL_ID` | Unique tool call ID | pre-tool, post-tool |
| `HOOK_ARGS` | JSON-encoded tool arguments | pre-tool, post-tool |
| `HOOK_SUCCESS` | "true" or "false" | post-tool |
| `HOOK_OUTPUT` | Tool output/result | post-tool |
| `HOOK_DURATION` | Execution time in ms | post-tool, stop, session-end |
| `HOOK_PATH` | File path | file-modified, permission-request |
| `HOOK_CHANGE_TYPE` | "create", "modify", or "delete" | file-modified |
| `HOOK_INSTRUCTION` | User instruction | pre-prompt |
| `HOOK_MENTIONED_FILES` | JSON array of mentioned files | pre-prompt |
| `HOOK_TOKENS` | Tokens used | stop |
| `HOOK_TOOL_CALLS_COUNT` | Number of tool calls | stop |
| `HOOK_TURN_TOOL_CALLS` | Tool calls in current turn | stop |
| `HOOK_TURN_DURATION` | Turn duration in ms | stop |
| `HOOK_ERROR` | Error message | session-error |
| `HOOK_ERROR_CODE` | Error code | session-error |
| `HOOK_SESSION_TYPE` | startup, resume, or clear | session-start |
| `HOOK_SESSION_END_REASON` | quit, clear, exit, or error | session-end |
| `HOOK_SUBAGENT_ID` | Subagent task ID | subagent-stop |
| `HOOK_SUBAGENT_NAME` | Subagent name | subagent-stop |
| `HOOK_SUBAGENT_TYPE` | Subagent type | subagent-stop |
| `HOOK_SUBAGENT_SUCCESS` | "true" or "false" | subagent-stop |
| `HOOK_SUBAGENT_ERROR` | Error message if failed | subagent-stop |
| `HOOK_SUBAGENT_DURATION` | Duration in ms | subagent-stop |
| `HOOK_PERMISSION_TYPE` | Permission type being requested | permission-request |
| `HOOK_NOTIFICATION_TYPE` | Type of notification | notification |
| `HOOK_NOTIFICATION_MSG` | Notification message | notification |

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

### Track Subagent Performance

```json
{
  "event": "subagent-stop",
  "command": "echo \"Subagent $HOOK_SUBAGENT_NAME ($HOOK_SUBAGENT_TYPE): $HOOK_SUBAGENT_SUCCESS in ${HOOK_SUBAGENT_DURATION}ms\" >> ~/.autohand/subagents.log",
  "description": "Track subagent performance"
}
```

---

## Managing Hooks with `/hooks`

Use the `/hooks` slash command to interactively:
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

Autohand ships with default hooks that are installed on first run. All hooks are **disabled by default** and can be enabled via `/hooks` or by editing your config.

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

Use `/hooks` and select "Enable/disable hooks" to toggle individual hooks:

```
› /hooks
? Hook action: Enable/disable hooks
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
- Test hooks with the `/hooks` command before relying on them

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
