# Lanes

A lane is a named background agent that works on one task in parallel while you
keep talking to Autohand in the main conversation. Ask for one in plain
language:

```text
❯ open a new lane and fix the invisible selection highlight
```

Autohand starts the lane, tells you it is open, and gives the prompt straight
back. The lane does the work on its own and reports when it is finished.

Lanes are experimental and off by default. The feature flag is `cli_lanes`.

## Turning it on and off

```bash
autohand experiments enable cli_lanes
autohand experiments disable cli_lanes
```

Inside a session, `/experiments enable cli_lanes` and
`/experiments disable cli_lanes` do the same, and `/experiments` on its own
opens the checkbox list where `cli_lanes` can be toggled with space. In
`~/.autohand/config.json`:

```json
{ "features": { "cliLanes": true } }
```

`features.cliLanes` must be `true` or `false`; any other value is rejected when
the config loads. `autohand experiments status cli_lanes` shows the current
state.

No restart is needed. Toggling the flag in a running session takes effect on
the next request:

- **On**: the agent learns what "open a new lane" means and can start lanes.
- **Off**: nothing about lanes is in the system prompt or the tool schemas, and
  the lanes list is not drawn. Lanes that were already running keep running,
  stay visible in `/agents`, and still report back when they finish.

## What you see

While at least one lane exists, a list sits underneath the composer and its
status line:

```text
❯ Plan, search, build anything
Autohand (…) · 82% context left · ? shortcuts
● main
○ agents-navigation  Fix /agents arrow navigation          2m 6s · 93.1k tokens
✓ selection-highlight  Fix invisible selection highlight  3m 11s · 105.2k tokens
✗ usage-screen  Rebuild the usage screen                                    11s
```

- `● main` is the conversation you are typing in.
- Each lane row shows its name, a one-line description, how long it has run and
  the total tokens it has used so far. Tokens appear once the lane's first model
  request has completed.
- The marker is the lane's state: `○` running, `✓` done, `◐` stopped at its
  iteration limit with partial work, `✗` failed, `⊘` cancelled. The elapsed time
  of a finished lane stops at the moment it finished.

On a narrow terminal the description is shortened first, then the token count is
dropped, then the elapsed time; the lane name is kept longest. The list takes at
most six rows (fewer on short terminals). When there are more lanes than rows,
running lanes are shown first and the rest are summarized as `+N more`.

When a lane finishes, a short notice appears (`Lane selection-highlight
completed.`) and the lane's result is handed to the main conversation as its
next turn, so Autohand summarizes what the lane did. If the main conversation is
busy, the report waits its turn in the queue behind anything you have already
queued.

## How a lane works

A lane is an ordinary delegated sub-agent run with a name. Opening one calls the
existing `delegate_task` tool with two extra arguments, `lane_name` and
`lane_description`, which exist only while `cli_lanes` is on. Instead of waiting
for the sub-agent, the tool returns immediately and the run continues in the
background.

Because a lane is a normal agent run:

- It uses one of the installed agents (`implementer`, `researcher`, `tester`,
  one of your own, …). The main agent picks the one that fits the task.
- It follows the same permission rules, approval prompts and lifecycle hooks
  (`subagent-start`, `subagent-progress`, `subagent-stop`) as any delegated
  agent. Wherever delegation is blocked, lanes are blocked too.
- It appears in `/agents`, where you can inspect its output, send it a message,
  or cancel it.
- It does not see the main conversation. The main agent writes it a
  self-contained brief.

## Limits

- **Four lanes at once.** A fifth is refused until one finishes. Each running
  lane also takes one of the session's agent threads
  (`features.multi_agent_v2.max_concurrent_threads_per_session`); if none is
  free the lane fails straight away and says so.
- **Names** are normalized to lowercase kebab-case, at most 32 characters. Two
  running lanes cannot share a name. Reusing the name of a finished lane
  replaces its row.
- **Descriptions** are one line, at most 80 characters. If the agent gives
  none, the first line of the task is used.
- **The list keeps eight lanes.** Beyond that the oldest finished lane is
  dropped from the list (it remains in `/agents`).
- **Lanes share your working tree.** They are not isolated in a git worktree, so
  two lanes editing the same file can collide. Ask for lanes on separate parts
  of the code.
- **Lanes end with the session.** Quitting Autohand cancels running lanes; they
  are not resumed by `/resume`, and the list starts empty in a new session.
- **Pressing Esc does not stop a lane.** Esc cancels the main turn only. Cancel
  a lane from `/agents`.
- **Interactive sessions only.** In `--prompt` command mode and in RPC/ACP
  sessions the flag has no effect, because there is no open conversation for a
  lane to report into.

## Not in this version

- A keyboard shortcut or slash command to open, switch to, or focus a lane. The
  list is read-only; use `/agents` to interact with a lane.
- Per-lane git worktrees or branches.
- Lanes that survive a restart.
- Lanes opened by sub-agents or teammates. Only the main conversation can open
  one.
- Separate input and output token counts per lane.
