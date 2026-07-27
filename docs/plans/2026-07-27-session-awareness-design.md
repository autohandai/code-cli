# Concurrent Session Awareness — Design

**Date:** 2026-07-27
**Status:** Approved, ready for implementation planning
**Owner:** CLI

## Summary

When two or more autohand sessions run against the same project directory, neither
knows the other exists. Each can commit, rewrite the working tree, and edit the same
files while the other is mid-turn.

This design makes sessions aware of one another: each publishes what it is doing, and
each warns at the moments where concurrent work actually causes damage.

## Motivating incident

This design comes from a real failure observed on 2026-07-27, not a hypothetical.

During a single working session on `cli-3`, a second session committed twice to `main`
(`d828290`, `748d8ab`) and left 26 modified files in the shared working tree, including
edits to `src/core/agent.ts` and a test belonging to the first session's own feature.

The consequences were all near-misses that a human had to catch by hand:

- `git status` output became a mix of two sessions' work, so any broad `git add` would
  have silently committed someone else's in-flight changes.
- A conflicted merge into `main` would have left the shared repository in a `MERGING`
  state while another agent was actively committing.
- A full test run was invalidated partway through because the tree changed underneath it.

Every one of these is detectable. None of them was surfaced.

## What already exists

Most of the transport is built and in production use.

`src/session/ActiveAgentRegistry.ts` (233 lines):

- One JSON record per session under `AUTOHAND_PATHS.activeAgents`
  (`~/.autohand/active-agents/`, `src/constants.ts:29`)
- `ActiveAgentRecord` already carries `pid`, `sessionId`, **`workspaceRoot`**,
  `projectName`, `provider`, `model`, `mode`, **`status: 'idle' | 'working'`**,
  `startedAt`, `updatedAt`, `messageCount`, `contextPercent`, `tokensUsed`
- `ActiveAgentHeartbeat` refreshes every `ACTIVE_AGENT_HEARTBEAT_INTERVAL_MS` (5s)
- `listActive()` prunes records whose PID is dead or whose `updatedAt` is older than
  `ACTIVE_AGENT_STALE_MS` (15s)

Detecting a peer is therefore already a one-line filter on `listActive()`.

**The gap is entirely on the surfacing side.** The only consumer is the `/agents`
command (`src/commands/agents.ts:45`) — the user has to ask. Nothing is proactive,
records do not say *what* a session is doing, and nothing watches git.

Other infrastructure this design reuses rather than rebuilds:

| Need | Existing mechanism |
|---|---|
| Write choke point | `ActionExecutor.notifyFileModified` (`actionExecutor.ts:756`) |
| Notification delivery | `InkRenderer.addNotification` (`InkRenderer.tsx:609`) |
| Status line segment | `lineExtension` / `mergeLineExtensions` (`StatusLine.tsx:85`) |
| Config + settings UI | `SETTINGS_REGISTRY` (`settings.ts`), `type: 'enum'` |
| Untrusted text hardening | `sanitizeAnnouncementText` (`AnnouncementContent.ts`) |

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Three tiers, user-configurable, defaulting to `warn` | Passive is too quiet to have prevented the incident; mandatory locking would deadlock legitimate parallel workflows. |
| D2 | Publish full activity, including current instruction text | Chosen deliberately for human context ("the other session is refactoring auth"). Privacy cost accepted; see Security. |
| D3 | Warnings are advisory, never blocking, in the `warn` tier | A blocking prompt on every commit in a multi-session workflow becomes noise users learn to dismiss, which is worse than no warning. |
| D4 | Repo drift is read from `.git` files, never a git subprocess | Same session that removed synchronous git from the render path; this must not reintroduce it. |
| D5 | Claims reuse record liveness instead of a lock lifecycle | The heartbeat already solves crash recovery. A separate lock protocol would need its own staleness, release, and reaping logic. |
| D6 | Extend `ActiveAgentRegistry` rather than add a new transport | Heartbeat, liveness, staleness, and dead-PID pruning are already solved there. |

### Approaches considered

- **Extend `ActiveAgentRegistry` (chosen).** Reuses a working liveness model.
- **Dedicated per-workspace IPC/lock file.** Would duplicate heartbeat and staleness
  logic, and create a second source of truth about which sessions are alive.
- **OS advisory locks (`flock`).** Cannot carry activity metadata, and behaves poorly
  on network filesystems and across platforms.

## Architecture

New directory `src/session/peers/`, deliberately split so the decision logic is pure
and testable without touching the filesystem:

| Module | Responsibility |
|---|---|
| `PeerAwarenessManager.ts` | The only surface the agent consumes. Reads the registry, diffs peers between polls, emits join/leave/drift events. Polls on the existing 5s heartbeat tick rather than adding a timer, and owns the in-process read cache (path → mtime at last read) used for collision detection. |
| `PeerActivityPublisher.ts` | Builds the `activity` block for this session's own record, including the `phase` mapping below. |
| `PeerWarnings.ts` | Pure functions: given peers + an intended action, return the warnings. No I/O, no React. |
| `RepoStateReader.ts` | Reads `.git/HEAD` and the ref file with async `fs`. No subprocess. |
| `index.ts` | Barrel. |

### Record extension

`ActiveAgentRecord` gains one optional block, so old records stay readable:

```ts
export interface ActiveAgentActivity {
  phase: 'idle' | 'thinking' | 'editing' | 'running_command' | 'waiting_input';
  /** Current instruction, sanitized and clamped to 200 characters. */
  instruction?: string;
  /** Current shell command, sanitized and clamped to 200 characters. */
  command?: string;
  /** Workspace-relative paths written this session, newest first, max 20. */
  pathsWritten: string[];
  /** Paths this session has claimed. Only populated in the `coordinate` tier. */
  claims?: string[];
  /** Branch and commit as read from .git, for drift detection. */
  headRef?: { branch: string | null; sha: string };
}
```

`activity` is optional and additive. A session running an older build simply omits it,
and peers degrade to the presence information they already had.

**`phase` is derived, not tracked separately.** It is computed at publish time from state
the agent already holds, so there is no new state machine to keep in sync:

| Condition | `phase` |
|---|---|
| `isInstructionActive === false` | `idle` |
| An `ask_followup_question` / confirmation prompt is open | `waiting_input` |
| The in-flight tool is `run_command` or `shell` | `running_command` |
| The in-flight tool writes files (`apply_patch`, `write_file`, `replace_in_file`, …) | `editing` |
| Otherwise, while a turn is running | `thinking` |

### Tiers

`config.sessions.awareness`: `'passive' | 'warn' | 'coordinate'`, default `'warn'`.

Registered in `SETTINGS_REGISTRY` (`settings.ts`) as
`type: 'enum', enumValues: ['passive', 'warn', 'coordinate'], defaultValue: 'warn'`,
which makes it appear in `/settings` with no extra UI work.

| Tier | Publishes | Reacts |
|---|---|---|
| `passive` | activity | peer indicator + launch line only |
| `warn` (default) | activity | + git guard, file collision, repo drift — all advisory |
| `coordinate` | activity + claims | + confirmation prompt before writing a peer-claimed path |

## Warn tier: the three signals

**1. Git mutation guard.** At the `run_command` / `shell` choke point in
`ActionExecutor`, if the command matches a git mutation
(`commit|merge|rebase|reset|checkout|switch|push|cherry-pick`) and at least one live peer
shares this `workspaceRoot`, emit a notification naming the peers and their phase.

**2. File collision.** In `notifyFileModified`, warn when either:
- a live peer's `pathsWritten` contains the same workspace-relative path, or
- the file's mtime is newer than when this session last read it (tracked in-process).

**3. Repo drift.** Each heartbeat, `RepoStateReader` reads `.git/HEAD`; if it is a
symbolic ref, it reads the ref file, falling back to `.git/packed-refs`. When the
resulting sha differs from the previously observed one, emit a drift notification.
**No `git` subprocess is spawned** — this is two small async file reads.

Attribution is explicit rather than inferred: whenever this session runs a git mutation
through the command choke point, it re-reads `.git` immediately afterwards and adopts
the new sha as its baseline. A drift notification therefore fires only for changes this
session did not make. A concurrent commit landing during our own git command is reported
on the following tick, which is acceptable — the notification is advisory.

All three route through `InkRenderer.addNotification`. None blocks.

## Coordinate tier

A session publishes `claims: string[]` for paths it intends to modify. Before writing a
path claimed by a *live* peer, the user is asked to confirm; under `--yes` / autoConfirm
the write proceeds and the warning is recorded.

Claims carry no independent lifecycle. They live inside the record, so a crashed session
drops its claims automatically via the existing dead-PID and 15-second staleness pruning.

## Surfaces

- **Launch** — a line in `printWelcome` when peers exist, inheriting its `isTTY` guard,
  so command mode, pipes, and CI print nothing.
- **Status line** — a `⚉ N peers` segment through the existing `lineExtension` mechanism.
- **Warnings** — `addNotification`, rendered by the existing `NotificationStack`.
- **`/agents`** — gains phase, instruction, and recent paths per record.

## Security

D2 puts prompt text into `~/.autohand/active-agents/`, so two mitigations are part of
the feature rather than follow-ups:

1. **Permissions.** The directory is created `0700` and records written `0600`. Today
   `ActiveAgentRegistry.write` uses default permissions, which is acceptable for token
   counts and model names but not for instruction text.
2. **Sanitization.** Peer-authored `instruction` and `command` strings are rendered into
   *this* session's terminal. They pass through `sanitizeAnnouncementText` (ANSI escapes,
   C0/C1 controls, bidi overrides, zero-width characters) before display, exactly as
   server-supplied announcement text does.

## Test plan

**Unit — `PeerWarnings`** (pure, no I/O)
- git mutation detected across command spellings, and non-mutations ignored
  (`git status`, `git log`, `git diff`)
- collision only when the peer is live and the path matches after normalization
- no warnings when the only record is this session's own
- tier gating: `passive` produces none, `coordinate` adds claim conflicts

**Unit — `RepoStateReader`**
- symbolic-ref `HEAD`, detached `HEAD`, packed-refs fallback, missing `.git`
- asserts no subprocess is spawned

**Unit — `ActiveAgentRegistry`**
- round-trips `activity`; records without `activity` still parse
- directory is `0700` and records `0600`
- `pathsWritten` clamped to 20, newest first
- peer instruction text with ANSI, bidi, and zero-width payloads is sanitized

**Unit — `PeerAwarenessManager`**
- join/leave diffing across polls; stale peers dropped; own record excluded
- drift baseline adopted after this session's own git mutation, so no self-drift warning
- `phase` derivation across all five conditions in the table above

**ink-testing-library**
- peer count segment renders, and is absent at zero peers

**Tuistory**
- two built CLIs launched against one workspace: the second reports the first at launch
  and in the status line; on exit of the first, the peer indicator clears

## Files touched

**New**
- `src/session/peers/{PeerAwarenessManager,PeerActivityPublisher,PeerWarnings,RepoStateReader,index}.ts`
- tests mirroring the plan above

**Modified**
- `src/session/ActiveAgentRegistry.ts` — `activity` block, `0700`/`0600` permissions
- `src/core/agent.ts` — construct the manager, feed the publisher from turn state
- `src/core/actionExecutor.ts` — git guard at the command choke point, collision check in
  `notifyFileModified`
- `src/commands/settings.ts` — `sessions.awareness` registry entry
- `src/types.ts` — `SessionsSettings` on `LoadedConfig`
- `src/index.ts` — launch line in `printWelcome`
- `src/core/agent/AgentUIRuntime.ts` — peer status segment
- `src/commands/agents.ts` — richer per-record detail
- `src/i18n/locales/en.json` — user-facing strings

## Out of scope

- Cross-machine awareness. Records are local to `~/.autohand`; sessions on different
  machines sharing a network filesystem are not addressed.
- Merging or reconciling concurrent edits. This design reports, it does not resolve.
- Awareness between autohand and other tools (Claude Code, Codex) working in the same
  directory. The registry is autohand-only.
- Any change to `/agents` beyond richer output.
