# Auto-Mode: Autonomous Development Loops

Auto-Mode lets autohand work autonomously on your tasks through iterative improvement cycles—inspired by the [Ralph technique](https://ghuntley.com/ralph/).

## Overview

When you enable auto-mode, autohand enters a self-referential feedback loop:

1. The agent works on your task
2. After each iteration, it reviews its previous work (git history, file changes, test results)
3. It continues improving until the task is complete or limits are reached
4. Changes are optionally isolated in a git worktree for safety

## Quick Start

```bash
# Start an autonomous loop from CLI
autohand --auto-mode "Build a REST API for todos"

# Or from interactive mode
/automode Build a REST API for todos
```

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                      AUTO-MODE LOOP                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. User starts: autohand --auto-mode "Build REST API"      │
│                         │                                   │
│  2. Create worktree ────┼──▶ autohand-automode-<timestamp>  │
│                         │                                   │
│  3. Initialize state ───┼──▶ .autohand/automode.local.md    │
│                         │                                   │
│  ┌──────────────────────▼──────────────────────────┐        │
│  │               ITERATION LOOP                     │        │
│  │  ┌─────────────────────────────────────────┐    │        │
│  │  │  4. Feed prompt to LLM                  │    │        │
│  │  │  5. Execute actions (read/write/run)    │    │        │
│  │  │  6. Agent tries to exit                 │    │        │
│  │  │  7. Stop hook intercepts                │───┐│        │
│  │  │  8. Check completion conditions         │   ││        │
│  │  │     - Completion marker detected?       │   ││        │
│  │  │     - Max iterations reached?           │   ││        │
│  │  │     - Cancel signal received?           │   ││        │
│  │  │  9. If not complete: feed prompt again  │◀──┘│        │
│  │  └─────────────────────────────────────────┘    │        │
│  └─────────────────────────────────────────────────┘        │
│                         │                                   │
│  10. On completion ─────┼──▶ Merge worktree to main         │
│                         │                                   │
│  11. Generate report ───┼──▶ AUTOMODE_CHANGELOG.md          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## CLI Usage

```bash
autohand --auto-mode "<prompt>" [options]
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--max-iterations <n>` | Maximum loop iterations | 50 |
| `--completion-promise <text>` | Text marker signaling completion | "DONE" |
| `--no-worktree` | Disable git worktree isolation | - |
| `--checkpoint-interval <n>` | Git commit every N iterations | 5 |
| `--max-runtime <m>` | Maximum runtime in minutes | 120 |
| `--max-cost <d>` | Maximum API cost in dollars | 10 |
| `--dry-run` | Preview actions without executing | - |

### Examples

```bash
# Basic usage
autohand --auto-mode "Build a CLI tool for file backup"

# With all safety limits
autohand --auto-mode "Refactor auth system" \
  --max-iterations 30 \
  --max-runtime 60 \
  --max-cost 5 \
  --completion-promise "REFACTOR_COMPLETE"

# Without worktree (use current branch)
autohand --auto-mode "Fix all TypeScript errors" --no-worktree

# Frequent checkpoints
autohand --auto-mode "Add unit tests" --checkpoint-interval 2
```

## Slash Command

From interactive mode:

```
/automode <prompt> [--max-iterations <n>] [--completion-promise <s>]
```

### Subcommands

| Command | Description |
|---------|-------------|
| `/automode <prompt>` | Start auto-mode with a task |
| `/automode status` | Show current loop state |
| `/automode pause` | Pause the loop |
| `/automode resume` | Resume paused loop |
| `/automode cancel` | Cancel the loop |
| `/automode help` | Show help |

### Examples

```
/automode Build a REST API with CRUD operations
/automode Fix all linting errors --max-iterations 20
/automode Implement dark mode --completion-promise "DARK_MODE_DONE"
```

## Writing Good Prompts

Include clear completion criteria in your prompts:

### Bad Example
```
Make the app better
```

### Good Example
```
Build a REST API for todos.

Requirements:
- CRUD endpoints (GET, POST, PUT, DELETE)
- Input validation
- Tests with >80% coverage
- README with API documentation

When complete, output: <promise>DONE</promise>
```

The `<promise>DONE</promise>` marker tells auto-mode that the task is complete.

## Cancellation

Multiple ways to stop an auto-mode loop:

| Method | How |
|--------|-----|
| **ESC Key** | Press ESC during the loop |
| **Slash Command** | `/automode cancel` |
| **Hooks** | Trigger `automode:cancel` event |
| **RPC** | Call `automode.cancel` method |
| **Ctrl+C** | Hard stop (exits immediately) |

## Safety Features

### Resource Limits

| Limit | Default | Purpose |
|-------|---------|---------|
| Max Iterations | 50 | Prevents infinite loops |
| Max Runtime | 120 min | Limits total time |
| Max Cost | $10 | Caps API spending |
| Checkpoint Interval | 5 | Creates git checkpoints |

### Git Worktree Isolation

By default, auto-mode creates an isolated git worktree to protect your main branch:

```
┌─────────────────────────────────────────────────────────────────┐
│                   WORKTREE LIFECYCLE                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  START                                                           │
│  ├─ Create branch: autohand-automode-<timestamp>                 │
│  ├─ Create worktree: /tmp/autohand-worktree-<hash>               │
│  └─ ALL file operations now happen in the worktree               │
│                                                                  │
│  DURING LOOP                                                     │
│  ├─ Agent reads/writes files in worktree                         │
│  ├─ Every N iterations: checkpoint commit to automode branch     │
│  └─ Main branch remains untouched                                │
│                                                                  │
│  ON SUCCESS                                                      │
│  ├─ git checkout <original-branch>                               │
│  ├─ git merge autohand-automode-xxx                              │
│  ├─ git worktree remove /tmp/autohand-worktree-xxx               │
│  └─ git branch -d autohand-automode-xxx                          │
│                                                                  │
│  ON CANCEL/ERROR                                                 │
│  └─ Worktree PRESERVED for manual inspection                     │
│     You can: cd /tmp/autohand-worktree-xxx                       │
│              git log, git diff, cherry-pick, etc.                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Key Points:**
- **One worktree per session** (not per iteration)
- **All agent operations** (file reads, writes, commands) happen in the worktree
- **Checkpoints** create commits in the automode branch at regular intervals
- **Merge happens once** at the end on successful completion
- **Preserved on failure** so you can inspect, recover, or cherry-pick changes

**Benefits:**
- Your main branch is protected from experimental changes
- Changes can be reviewed before merging
- Easy to discard if something goes wrong
- Can rollback to checkpoints within the session
- Safe experimentation without affecting other team members

### Circuit Breaker

Auto-mode includes a circuit breaker that stops the loop when:

1. **No Progress** - 3 consecutive iterations with no file changes
2. **Same Errors** - 5 consecutive iterations with identical error output
3. **Test Loop** - 3 consecutive iterations only running tests (no code changes)

This prevents getting stuck in unproductive loops.

## State File

Auto-mode maintains state in `.autohand/automode.local.md`:

```markdown
# Auto-Mode State

## Session
- **Started:** 2026-01-06T14:30:00Z
- **Prompt:** Build a REST API for todos with CRUD operations
- **Branch:** autohand-automode-1736175000
- **Worktree:** /tmp/autohand-worktree-abc123

## Progress
- **Current Iteration:** 12
- **Max Iterations:** 50
- **Status:** running

## Metrics
- **Files Created:** 8
- **Files Modified:** 15
- **Tests Passing:** 24/30
- **Last Action:** Ran tests, 6 failures remaining

## Last Checkpoint
- **Commit:** abc123f
- **Message:** feat: add PUT and DELETE endpoints
```

## Changelog

After each session, auto-mode generates `AUTOMODE_CHANGELOG.md`:

```markdown
# Auto-Mode Session Report

## Summary
- **Task:** Build a REST API for todos
- **Duration:** 45 minutes (12 iterations)
- **Result:** Completed successfully
- **Branch:** autohand-automode-1736175000 → merged to main

## Iterations
### Iteration 1 (14:30:00)
- Created project structure
- Added Express server boilerplate
- **Checkpoint:** `abc1234` - "feat: initialize project"

### Iteration 2 (14:32:15)
- Implemented GET /todos endpoint
- Added in-memory storage
...
```

## Hook Events

Auto-mode emits events that can trigger hooks:

| Event | When |
|-------|------|
| `automode:start` | Loop started |
| `automode:iteration` | Each iteration |
| `automode:checkpoint` | Git commit made |
| `automode:pause` | Loop paused |
| `automode:resume` | Loop resumed |
| `automode:cancel` | Loop cancelled |
| `automode:complete` | Loop completed successfully |
| `automode:error` | Error occurred |

### Example Hook

```bash
#!/bin/bash
# ~/.autohand/hooks/automode-slack.sh
# Notify Slack when auto-mode completes

if [ "$AUTOHAND_EVENT" = "automode:complete" ]; then
  curl -X POST "$SLACK_WEBHOOK" \
    -H "Content-Type: application/json" \
    -d "{\"text\": \"Auto-mode completed: $AUTOHAND_PROMPT\"}"
fi
```

## Configuration

Add defaults to `~/.autohand/config.json`:

```json
{
  "automode": {
    "maxIterations": 50,
    "maxRuntime": 120,
    "maxCost": 10,
    "checkpointInterval": 5,
    "completionPromise": "DONE",
    "useWorktree": true,
    "noProgressThreshold": 3,
    "sameErrorThreshold": 5,
    "testOnlyThreshold": 3
  }
}
```

## Tips

- **Include clear completion criteria** in your prompt
- **Use `<promise>DONE</promise>`** to signal completion
- **Press ESC at any time** to cancel
- **Use `/automode status`** to check progress
- **Review the changelog** after each session
- **Start with smaller tasks** to understand the behavior
- **Enable worktree isolation** (default) for safety
- **Set appropriate limits** to control cost and time

## Troubleshooting

### Loop doesn't complete

- Check if your prompt has clear completion criteria
- Verify the completion marker matches your config
- Look for stuck patterns (circuit breaker should catch these)

### Worktree creation fails

- Ensure you're in a git repository
- Check for uncommitted changes
- Use `--no-worktree` to disable isolation

### High cost

- Lower `--max-iterations`
- Set a stricter `--max-cost`
- Use a more efficient model
- Break task into smaller chunks

### Loop appears stuck

- The circuit breaker should auto-trigger
- Press ESC to cancel manually
- Check `.autohand/automode.local.md` for state

## Related

- [Hooks Documentation](./hooks.md) - Configure lifecycle hooks
- [RPC Protocol](./rpc-protocol.md) - Programmatic control
- [Configuration Reference](./config-reference.md) - All configuration options
