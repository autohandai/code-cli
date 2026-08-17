# Agent Teams

Agent Teams lets a lead Autohand process spawn and coordinate multiple teammate processes that work on tasks in parallel. The lead manages a shared task list, routes messages between teammates, and displays progress in real time. Teammates are headless child processes that receive tasks via JSON-RPC over stdio.

---

## Architecture

Agent Teams uses a lead-managed model. A single lead process orchestrates everything: spawning teammates, assigning tasks, routing messages, and tracking progress.

- **Lead process** -- The interactive Autohand session you launch normally. It creates and manages the team.
- **Teammate processes** -- Headless child processes spawned via `autohand --mode teammate`. Each runs its own LLM loop to work on assigned tasks.
- **Communication** -- All inter-process communication uses JSON-RPC 2.0 over stdio, encoded as newline-delimited JSON. The `MessageRouter` class handles encoding and decoding.
- **Task management** -- The lead maintains a shared `TaskManager` with dependency resolution. Tasks have `blockedBy` arrays; a task only becomes available when all its dependencies are completed.
- **Auto-assignment** -- When a teammate first reports `team.ready` or later sends `team.idle`, the lead assigns the next pending, unblocked task automatically.

There is no direct teammate-to-teammate communication channel. All messages pass through the lead.

---

## Getting Started

### Configuration

Enable and configure teams in `~/.autohand/config.json`:

```json
{
  "teams": {
    "enabled": true,
    "maxTeammates": 5
  }
}
```

### Config Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable or disable team features |
| `maxTeammates` | number | `5` | Maximum number of simultaneous teammates |

`teams.teammateMode` and `--teammate-mode` remain accepted for compatibility.
The supported live view is rendered in the lead terminal for both normal launches
and `autohand --tmux`; teammate worker processes remain headless so their JSON-RPC
transport cannot be confused with terminal output.

---

## Slash Commands

### `/team` -- Team Management

| Command | Description |
|---------|-------------|
| `/team` or `/team help` | Show available team subcommands |
| `/team create [name]` | Create a team or reuse the active team with the same name |
| `/team status` | Show team name, active/completed status, member count, task progress, member list with status indicators, and the full task list |
| `/team view` | Open the live team view without asking the agent for a status report |
| `/team shutdown` | Gracefully shut down all teammates |

Example `/team status` output:

```
Team: refactor-auth
Status: active
Members: 3
Tasks: 2/5 completed

  ● hunter (code-reviewer) - working
  ○ scout (test-writer) - idle
  × tracer (docs-writer) - shutdown

Tasks:
  ✓ Extract auth middleware
  ● Write integration tests → hunter
  ○ Update API documentation
  ○ Add error handling (blocked by: task-2)
  ○ Final review
```

### `/tasks` -- View Task List

Shows all tasks with status icons, task ID, subject, owner, and blocked-by information.

Status icons:
- Check mark -- completed
- Filled circle -- in progress
- Open circle -- pending

```
Tasks [2/5 done]

  ✓ task-1 Extract auth middleware → hunter
  ● task-2 Write integration tests → scout
  ○ task-3 Update API documentation
  ○ task-4 Add error handling (blocked by: task-2)
  ○ task-5 Final review
```

### `/message <name> <text>` -- Direct Message

Send a message to a named teammate from the lead process.

```
/message hunter also check src/legacy/
```

The lead forwards the message to the target teammate via `team.message`. If the teammate name is not found, an error is displayed.

---

## Task Lifecycle

Tasks move through the following states:

```
pending --> in_progress --> completed
   ^
   |
   +---- (crash recovery) ----+
```

1. **Created** -- Tasks are created with status `pending`. Each task has a `subject`, `description`, and optional `blockedBy` array of task IDs.
2. **Available** -- A task becomes available when its status is `pending` and all tasks in its `blockedBy` list have status `completed`. The `getAvailableTasks()` method returns these.
3. **Assigned** -- When a teammate goes idle, the lead picks the first available task, sets its status to `in_progress`, assigns the `owner`, and sends a `team.assignTask` message to the teammate.
4. **In progress** -- The teammate works on the task and sends `team.log` messages to report progress.
5. **Completed** -- The teammate sends a `team.taskUpdate` with `status: "completed"`. The lead records a `completedAt` timestamp and sets the teammate status to `idle`.
6. **Released (crash recovery)** -- If a teammate exits unexpectedly, all of its `in_progress` tasks are released back to `pending` with the `owner` cleared. These tasks become available for reassignment.

### Task Dependencies

Tasks can depend on other tasks via the `blockedBy` array:

```typescript
taskManager.createTask({
  subject: 'Add error handling',
  description: 'Add proper error handling to the auth endpoints',
  blockedBy: ['task-2'],  // Must wait for task-2 to complete
});
```

A task with unresolved dependencies will not appear in `getAvailableTasks()` and will not be assigned to any teammate.

---

## Display Modes

### Live Lead View

While a team has open work, the status line displays an animated activity dot,
team name, completed task count, and active teammate count even when the lead is
idle. Updates are pushed from the team runtime; no status prompt or polling loop
is required.

Open or close the expanded view with:

- **Cmd+T** when the terminal forwards Meta+T.
- **Ctrl+T** as the portable terminal shortcut.
- **`/team view`** to open it explicitly.

The expanded `TeamPanel` renders inline in the lead terminal and shows:

- **Header** -- Team name with an active/inactive indicator.
- **Task list** -- Progress count (N/M done) and each task with its status icon, subject, and assigned owner.
- **Teammate list** -- Each teammate with a status icon, name, and agent type.

Creating a team from the default interactive editing mode also changes the
session to **AUTO** so teammates can proceed without approval prompts. An
explicit PLAN or YOLO choice is preserved. ACP/RPC sessions keep their client-
selected permission mode.

### `--tmux`

`autohand --tmux` launches the lead CLI in a dedicated tmux session. The same
status-line activity and expanded team view render there; teammate processes
stay headless and communicate with the lead over piped JSON-RPC.

---

## Hook Events

Teams emit lifecycle events that integrate with the Autohand hooks system. Configure hooks in `~/.autohand/config.json` to respond to team events.

| Event | When | Available Context |
|---|---|---|
| `team-created` | Team is created | `teamName` |
| `teammate-spawned` | Teammate process starts | `teamName`, `teammateName`, `teammateAgentName`, `teammatePid` |
| `teammate-idle` | Teammate finishes a task and goes idle | `teamName`, `teammateName`, task totals |
| `task-assigned` | Task assigned to a teammate | `teamName`, `teamTaskId`, `teamTaskOwner`, member/task totals |
| `task-completed` | Task marked done | `teamName`, `teamTaskId`, `teamTaskResult`, member/task totals |
| `team-shutdown` | Team cleanup completes | `teamName`, `teamMemberCount`, `teamTasksCompleted`, `teamTasksTotal` |

Context values are available as uppercase environment variables such as
`HOOK_TEAM_TASK_ID`, `HOOK_TEAM_TASKS_COMPLETED`, and `HOOK_TEAM_TASKS_TOTAL`.

### Example Hook Configuration

```json
{
  "hooks": {
    "enabled": true,
    "hooks": [
      {
        "event": "task-completed",
        "command": "echo \"Task $HOOK_TEAM_TASK_ID done by $HOOK_TEAM_TASK_OWNER\" >> ~/.autohand/team.log",
        "description": "Log task completions"
      },
      {
        "event": "team-shutdown",
        "command": "echo \"Team $HOOK_TEAM_NAME finished: $HOOK_TEAM_TASKS_COMPLETED/$HOOK_TEAM_TASKS_TOTAL tasks\"",
        "description": "Report team summary on shutdown",
        "async": true
      }
    ]
  }
}
```

See the [Hooks documentation](./hooks.md) for full details on hook configuration, filtering, and control flow responses.

---

## Message Routing

All communication between teammates goes through the lead process. There are no direct teammate-to-teammate channels.

### How It Works

1. A teammate sends a `team.message` JSON-RPC notification with a `to` field specifying the recipient name and a `content` field with the message text.
2. The lead receives the message via the teammate's stdout stream.
3. The lead looks up the target teammate by name and forwards the message as a `team.message` with a `from` field identifying the sender.
4. The target teammate receives the message on its stdin.

### Sending Messages from the Lead

Use the `/message` slash command to send messages directly from the lead to a teammate:

```
/message scout check the auth middleware tests in src/middleware/__tests__/
```

The lead sends the message with `from: "lead"`.

### JSON-RPC Message Format

Outgoing from teammate:
```json
{"jsonrpc": "2.0", "method": "team.message", "params": {"to": "scout", "content": "Check the test coverage"}}
```

Forwarded by lead to target:
```json
{"jsonrpc": "2.0", "method": "team.message", "params": {"from": "hunter", "content": "Check the test coverage"}}
```

---

## Crash Recovery

If a teammate process exits unexpectedly (non-zero exit code, killed by signal, or otherwise terminated):

1. The lead detects the exit via the child process `exit` event handler.
2. The teammate's status is set to `shutdown`.
3. All tasks owned by that teammate with status `in_progress` are released: their status is reset to `pending` and their `owner` is cleared.
4. Released tasks re-enter the available pool and can be assigned to other idle teammates on the next assignment cycle.

This prevents work from being silently lost when a teammate crashes. The task will be retried by another teammate.

---

## Teammate Process Lifecycle

A teammate child process follows this lifecycle:

1. **Spawn** -- The lead spawns a new Node.js process with `--mode teammate` and passes team metadata as CLI flags:
   ```
   autohand --mode teammate --team <teamName> --name <name> --agent <agentName> --lead-session <sessionId> [--model <model>] [--path <workspacePath>] [--config <configPath>]
   ```
   The child process inherits the current environment plus
   `AUTOHAND_TEAMMATE`, `AUTOHAND_TEAM_NAME`, `AUTOHAND_TEAMMATE_NAME`,
   `AUTOHAND_TEAMMATE_AGENT`, and `AUTOHAND_TEAM_LEAD_SESSION_ID`. Resolved
   teammates also receive `AUTOHAND_TEAM_REQUESTED_ROLE` and
   `AUTOHAND_TEAM_AGENT_SOURCE` when available. During a task,
   `AUTOHAND_TEAM_TASK_ID`, `AUTOHAND_TEAM_TASK_SUBJECT`, and
   `AUTOHAND_TEAM_TASK_OWNER` are scoped to that execution.

2. **Ready** -- The teammate sends `team.ready` to the lead via stdout, signaling it is initialized and ready for work.

3. **Idle/Working loop** -- The teammate alternates between idle (waiting for tasks) and working (executing assigned tasks). On each task:
   - Receives `team.assignTask` on stdin.
   - Sends `team.taskUpdate` with `status: "in_progress"`.
   - Executes the task using its LLM loop.
   - Sends `team.taskUpdate` with `status: "completed"` and an optional result.
   - Sends `team.idle` to signal availability.

4. **Shutdown** -- The lead sends `team.shutdown`. The teammate replies with `team.shutdownAck` and exits. If the teammate does not acknowledge within 3 seconds, the lead force-terminates the process with SIGTERM.

---

## JSON-RPC Protocol Reference

All messages use JSON-RPC 2.0 format, newline-delimited. Messages are encoded by `MessageRouter.encode()` and parsed line-by-line from stdout/stdin streams.

### Messages from Teammate to Lead

| Method | Params | Description |
|--------|--------|-------------|
| `team.ready` | `{ name }` | Teammate is initialized and ready |
| `team.taskUpdate` | `{ taskId, status, result? }` | Task status change |
| `team.message` | `{ to, content }` | Message to forward to another teammate |
| `team.idle` | `{ lastTask? }` | Teammate is idle and available for work |
| `team.shutdownAck` | `{}` | Acknowledges shutdown request |
| `team.log` | `{ level, text }` | Log entry for display in the lead UI |

### Messages from Lead to Teammate

| Method | Params | Description |
|--------|--------|-------------|
| `team.assignTask` | `{ task }` | Assign a task object to the teammate |
| `team.message` | `{ from, content }` | Forwarded message from another team member |
| `team.updateContext` | `{ tasks }` | Updated task list for context |
| `team.shutdown` | `{ reason }` | Request graceful shutdown |

---

## Project Profiling

The `ProjectProfiler` scans your repository to understand its structure before team formation. This analysis can drive automatic agent generation, helping the lead decide what kinds of teammates to spawn.

### What It Detects

**Languages** -- Identified by checking for manifest files:

| File | Language |
|------|----------|
| `package.json`, `tsconfig.json` | TypeScript |
| `Cargo.toml` | Rust |
| `go.mod` | Go |
| `pyproject.toml`, `requirements.txt` | Python |
| `Gemfile` | Ruby |
| `pom.xml`, `build.gradle` | Java |

**Frameworks** -- Detected from `package.json` dependencies and devDependencies:

React, Vue, Angular, Express, Fastify, Next, Ink, Commander, Vitest, Jest.

**Structure** -- Checks for the presence of:

- `docs/` directory
- Test directories (`tests/`, `test/`, `__tests__/`)
- CI configuration (`.github/workflows/`, `.circleci/`, `.gitlab-ci.yml`)

**Signals** -- Scans source files (`.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rs`, `.go`) for quality markers:

| Signal | Description | Severity |
|--------|-------------|----------|
| `todo` | `TODO`, `FIXME`, `HACK`, `XXX` markers | Low (<= 5), Medium (6-20), High (> 20) |
| `missing-docs` | No `docs/` directory found | Medium |
| `missing-tests` | No test directory found | Medium |

The profiler scans up to 200 tracked source files (via `git ls-files`) and records up to 10 file locations per signal.

---

## Graceful Shutdown

When `/team shutdown` is invoked or the lead session ends:

1. The lead sends `team.shutdown` with a reason string to every teammate.
2. A 3-second grace period allows teammates to acknowledge via `team.shutdownAck`.
3. After the grace period, any remaining teammate processes are force-terminated with `SIGTERM`.
4. The team status is set to `completed` and internal teammate references are cleared.
5. The live view marks the team completed and clears its teammate processes.

### ACP

ACP clients receive each complete team snapshot as an ACP `plan` update. Team
tasks map to plan entries with `pending`, `in_progress`, or `completed` status,
so editors can render the same background progress without parsing terminal text.
