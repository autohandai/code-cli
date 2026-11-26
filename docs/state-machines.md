# Explicit state machines

This document records the implicit state machines found in `src`, the hazards each one had, and the explicit model that replaced it. Each table below was generated from the exported definition, so it matches the code. The shared primitive is `src/utils/stateMachine.ts`. `send` throws `InvalidTransitionError` on a rejected event, `trySend` returns `false`, and `defineStateMachine` rejects a table that targets an undeclared state when the module loads.

## How the inventory was built

There were two read-only survey passes over `src`. They looked for lifecycle state spread across booleans, unguarded status strings, nullable-field combinations that encode a phase, and if/else ladders over those. The passes produced 26 candidates. Three more scans followed:

- **Lifecycle-named boolean fields** (`closed`, `disposed`, `started`, `stopped`, `running`, `paused`, `cancelled`, and similar).
- **Direct string assignments** to `status`, `state`, `phase` or `mode`.
- **Exported union types** named `*Status`, `*State`, `*Phase` or `*Lifecycle`.

Every candidate the passes and scans found is now an explicit model: 33 transition tables, plus the three derived models described below. [Reviewed and not converted](#reviewed-and-not-converted) lists the hits that are not state machines, with the reason for each.

## Hazards found, per machine

"Contradictory" means a combination of the old flags that the code could reach but that has no meaning. "Dead end" means a state the workflow could not leave although it should. "Race" means interleaved async callers that corrupted the state.

| Machine | Contradictory combinations (before) | Dead ends (before) | Races (before) |
|---|---|---|---|
| `PEER_TURN_LIFECYCLE` | `wakeRequested && closed`; `busy && wakeRequested` after the host had declined | A declined wake left `wakeRequested = true`, so peer auto-replies stopped for the rest of the session | A wake request in flight raced `beginTurn` from a user turn |
| `AgentPeerRuntime` close | `closed` and `closing` disagreed while the cleanup promise was pending | — | `bindRun` during close leaked a child run; it now throws `TARGET_ENDED` |
| `StartupInitPhase` | — | — | Concurrent first-turn callers (submit, `/mcp`, mobile) each finalized init and fired `session-start` more than once. A resumed session reported `sessionType: 'startup'` |
| `TURN_PHASE` | `isInstructionActive` flipped false and back to true mid-turn | A throw during bootstrap, UI setup, permissions or the echo left `isInstructionActive = true` forever. That blocked extension reload, readiness, repeat and peer turns | — |
| `ModalDepth` | `modalActive = false` while an outer modal was still open | A throw in `onAfterModal` left the modal open | Nested modals closed each other early |
| `PERSISTENT_INPUT_LIFECYCLE` | Paused and inactive at once; paste state alive after stop | — | Unbalanced resume attached duplicate keypress listeners; an inner resume took stdin back from a modal |
| `TERMINAL_REGIONS_LIFECYCLE` | Inactive while still holding a multi-line height | — | — |
| `AUTOMODE_LIFECYCLE` / `AUTOMODE_STATUS_TRANSITIONS` | `cancelled` overwritten by `completed` or `failed`; paused after cancel | A setup failure left the manager active forever | Two concurrent `start()` calls both ran; cancel was emitted twice |
| `TEAMMATE_LIFECYCLE` / `TEAMMATE_TRANSPORT` | Working while the transport had failed; idle after shutdown was acknowledged | Respawn was impossible after a failed spawn | A late idle or work message revived a teammate that was stopping |
| `TEAM_LIFECYCLE` | Active and closing at once after an unexpected error | A stalled shutdown never recovered; a rejected peer binding blocked shutdown | — |
| `CLOUD_SESSION_LIFECYCLE` | Two observe loops; ended with a live refresh timer | A 401, 403 or 404 ended the session, and `/refresh` did not reconnect | A concurrent start opened a second loop |
| `TELEMETRY_SESSION_LIFECYCLE` | Ended while the heartbeat ran; `session_end` for session `'unknown'` | — | `session_end` was sent twice |
| `PING_SERVICE_LIFECYCLE` | Four redundant flags had to stay in agreement by hand | — | — |
| `CLI_RUNTIME_LIFECYCLE` | Five redundant flags had to stay in agreement by hand | — | — |
| `RPC_ADAPTER_LIFECYCLE` + derived status | Status `processing` with no prompt active; `idle` while a reset arrived mid-prompt | Status stuck at `processing` after a permission or directory request made outside a prompt, so every later prompt was rejected | A second pending permission was hidden by the first one's completion |
| `LINE_READER_LIFECYCLE` | Closed but not ended | — | A final unterminated line was dropped on `close` |
| `SYNC_SERVICE_LIFECYCLE` | `syncing` disagreed with `activeOperation` | The `authFailed` timer check was unreachable | — |
| `GOAL_STATUS_LIFECYCLE` | A complete or budget-limited goal pushed back to paused, blocked or waiting | After that, `createGoal` refused to replace the goal | — |
| `EXTENSION_RELOAD_LIFECYCLE` | Stopped with watchers still open | — | Overlapping `updateWatchers` passes closed the newer pass's watchers |
| `AUTO_APPROVAL_LIFECYCLE` + review holds | Read-only review off while a review was still active; this was more permissive than intended | — | Out-of-order release of overlapping reviews |
| `MCP_STDIO_CONNECTION_LIFECYCLE` | `this.process` overwritten while an earlier child was still alive | `start()` after `stop()` or after exit spawned a child the cached stop never killed | Concurrent `start()` spawned extra children |
| `MCP_CONNECT_ATTEMPT_LIFECYCLE` | A server marked `connected` after `disconnect` | A cancelled connect recorded as `error` after `disconnectAll` | `disconnect(name)` during a connect threw `not found`, then the connect registered a live server |
| `ACP_SESSION_LIFECYCLE` | Cancelled state held both in `cancelledSessions` and `abortController.aborted`; session data split across seven maps | A cancel outside a prompt aborted the session controller, so every later out-of-turn question failed | A second prompt replaced the first prompt's abort controller; a cancelled prompt reported an internal error when the next prompt arrived first |
| `MOBILE_RELAY_LIFECYCLE` | `disposed && mobileConnected` | — | Artifact upload, delivery status, merge results and controller events published through a stopped or replaced relay; concurrent `unpair()` revoked twice and hung the first caller |
| `INK_RENDERER_LIFECYCLE` | Never started, paused and stopped all encoded as `instance === null` | Resume after stop remounted a UI that nothing would clean up | Concurrent `resume()` mounted twice; `stop()` or `pause()` during resume's yield still mounted; `start()` while paused patched stdout twice |
| `FILE_PREVIEW_MODE` | Preview flag false while a batch id was set | Exit during an apply restored `preview = true` with no batch, so later writes were batched silently | Overlapping applies restored a stale flag, applied a change twice, and removed a newer batch's change by reused id |
| `AGENT_PROGRAM_STATUS_LIFECYCLE` | `failed` set while the base state read `working` | Status stuck on "working" after `fail()` followed by a nested run | A nested run's message outlived the run |
| `PEER_ENDPOINT_LIFECYCLE` | `started && stopped` | A failed first publish left the endpoint "running" with no heartbeat | `stop()` during an early `start()` still bound the socket |
| `RESOURCE_TICKET_LIFECYCLE` | Holder and ticket states disagreeing | A holder whose ticket was pruned made every operation throw `UNKNOWN_TARGET` | Cancel rewrote an expired or stale ticket and journalled a second terminal notice; expiry rewrote a cancelled ticket |
| `PEER_RECEIPT_LIFECYCLE` | Local transitions and the receipt merge followed different rules | A late reply turned an `expired` receipt into `replied` locally, which the sender's merge refused, so the two processes disagreed | A reply that landed during `consume()` was overwritten back to `consumed` |
| `LANE_LIFECYCLE` | — | — | A second settle overwrote the terminal status and called `onSettled` twice |
| `TASK_LIFECYCLE` | `in_progress` with no owner; a stale `cancelRequested` on a new claim | A pending task set to `in_progress` through `task_update` was never run or offered again | Two teammates could claim the same task; a finished outcome could be overwritten |
| `PLAN_MODE_PHASE` | Enabled + `completed` showed `[PLAN]` without restricting tools; executing with plan mode off | A previous plan was reused after re-enabling, defeating the "No plan has been created yet" guard | A second acceptance re-emitted `plan:accepted` and reset the start time; `exit_plan_mode` now refuses it before opening the review |
| `DEEP_RESEARCH_RUN_LIFECYCLE` | — | — | A resubmitted run marker re-finalized a completed run, rewriting it to `incomplete` and clearing `completedAt` |

A regression test covers every row: it failed on the old code and passes now. These tests sit next to the table, property and random-walk tests in the matching `*.stateMachine.test.ts` file.

## Machines without a transition table

Three models are not tables, because a table would add nothing.

- **`StartupInitPhase`** (`src/core/agent/AgentLifecycleRunner.ts`) is derived in a single place, `startupInitPhase(host)`, from `initReady`, `initDone` and a per-host memoized finalization. States: `notStarted`, `initializing`, `awaitingFirstTurn`, `finalizing`, `complete`. Events: background init settles, the first turn calls `ensureAgentInitComplete`, finalization resolves. Every caller during `finalizing` awaits the same promise, so `session-start` fires once.
- **`ModalDepth`** (`src/core/agent/TurnActivity.ts`) is a counter with idempotent release tokens. Visibility is `depth > 0`. Releasing the same token twice does nothing, and no release can close another modal.
- **`AgentPeerRuntime` close** (`src/core/agent/AgentPeerRuntime.ts`) has states `open` and `closing`, held as one memoized promise. Every `bindRun` after close throws `TARGET_ENDED`.

## Reviewed and not converted

These hits came up in the scans but are not state machines. Each has a single variable or a single write, so there is nothing to guard.

| Site | Why it is not converted |
|---|---|
| `executeReviewWithLifecycle` (`src/review/reviewLifecycle.ts`) | One local `status` variable inside one function with straight-line control flow. It is already a single source of truth. |
| `BootstrapStepStatus`, `QualityCheckStatus` | Per-step result fields, written once when the step finishes. |
| `AgentRunStore` run status | `finish()` already refuses runs that are not active, so a run moves from active to terminal exactly once. |
| `mentionPreview` mode | Selects which menu is shown. Any mode may follow any other. |
| Single open/closed latches (`TeammatePeerBridge`, `ProcessTerminal`, `StreamingResponsePreview`, and others) | Two states with one irreversible edge; the boolean is the whole model. |

Decisions left for a product call, each recorded in the matching test file:

- A team task that was never claimed can still be marked completed through `task_update`, which unblocks dependents.
- A `starting` resource holder whose owner died before `recordSpawn` still needs manual recovery. The existing test "holds starting occupancy indefinitely" requires this.
- `InkRenderer` `start()` after `stop()` is a no-op. No production path restarts a stopped renderer: `InkUIManager` creates a new one each time.

## Transition tables

Each table lists, for every state, the events it accepts and the events it rejects. A rejected event throws through `send` or returns `false` through `trySend`. "Terminal" means no outgoing transition, by design. None of the 33 machines has a state that is unreachable from its initial state.

### FILE_PREVIEW_MODE — `src/actions/filesystem.ts`

Machine name: "FilePreviewMode". Initial: `direct`. States: `direct`, `preview`. Events: `enterPreview`, `exitPreview`.

| From | Allowed (event → to) | Rejected events |
|---|---|---|
| `direct` | `enterPreview` → `preview` | `exitPreview` |
| `preview` | `enterPreview` → `preview`, `exitPreview` → `direct` | — |

Terminal (dead-end by design): none. Unreachable from initial: none.

### CLOUD_SESSION_LIFECYCLE — `src/cloud/CloudSession.ts`

Machine name: "CloudSession". Initial: `idle`. States: `idle`, `connecting`, `observing`, `ended`, `disposed`. Events: `start`, `dispose`, `connected`, `failed`, `end`.

| From | Allowed (event → to) | Rejected events |
|---|---|---|
| `idle` | `start` → `connecting`, `dispose` → `disposed` | `connected`, `failed`, `end` |
| `connecting` | `connected` → `observing`, `failed` → `ended`, `dispose` → `disposed` | `start`, `end` |
| `observing` | `end` → `ended`, `dispose` → `disposed` | `start`, `connected`, `failed` |
| `ended` | `start` → `connecting`, `dispose` → `disposed` | `connected`, `failed`, `end` |
| `disposed` | — (terminal) | `start`, `dispose`, `connected`, `failed`, `end` |

Terminal (dead-end by design): `disposed`. Unreachable from initial: none.

### AGENT_PROGRAM_STATUS_LIFECYCLE — `src/core/agent/AgentProgramStatus.ts`

Machine name: "AgentProgramStatus". Initial: `settled`. States: `settled`, `running`, `failing`, `cancelling`, `disposed`. Events: `begin`, `fail`, `cancel`, `dispose`, `settle`.

| From | Allowed (event → to) | Rejected events |
|---|---|---|
| `settled` | `begin` → `running`, `fail` → `settled`, `cancel` → `settled`, `dispose` → `disposed` | `settle` |
| `running` | `fail` → `failing`, `cancel` → `cancelling`, `settle` → `settled`, `dispose` → `disposed` | `begin` |
| `failing` | `fail` → `failing`, `cancel` → `cancelling`, `settle` → `settled`, `dispose` → `disposed` | `begin` |
| `cancelling` | `fail` → `cancelling`, `cancel` → `cancelling`, `settle` → `settled`, `dispose` → `disposed` | `begin` |
| `disposed` | — (terminal) | `begin`, `fail`, `cancel`, `dispose`, `settle` |

Terminal (dead-end by design): `disposed`. Unreachable from initial: none.

### PEER_TURN_LIFECYCLE — `src/core/agent/PeerCommunicationRuntime.ts`

Machine name: "peer-turn". Initial: `idle`. States: `idle`, `requesting`, `awaitingTurn`, `inTurn`, `closed`. Events: `requestWake`, `beginTurn`, `close`, `wakeAccepted`, `wakeDeclined`, `wakeFailed`, `endTurn`.

| From | Allowed (event → to) | Rejected events |
|---|---|---|
| `idle` | `requestWake` → `requesting`, `beginTurn` → `inTurn`, `close` → `closed` | `wakeAccepted`, `wakeDeclined`, `wakeFailed`, `endTurn` |
| `requesting` | `wakeAccepted` → `awaitingTurn`, `wakeDeclined` → `idle`, `wakeFailed` → `idle`, `beginTurn` → `inTurn`, `close` → `closed` | `requestWake`, `endTurn` |
| `awaitingTurn` | `beginTurn` → `inTurn`, `wakeFailed` → `idle`, `close` → `closed` | `requestWake`, `wakeAccepted`, `wakeDeclined`, `endTurn` |
| `inTurn` | `beginTurn` → `inTurn`, `endTurn` → `idle`, `close` → `closed` | `requestWake`, `wakeAccepted`, `wakeDeclined`, `wakeFailed` |
| `closed` | — (terminal) | `requestWake`, `beginTurn`, `close`, `wakeAccepted`, `wakeDeclined`, `wakeFailed`, `endTurn` |

Terminal (dead-end by design): `closed`. Unreachable from initial: none.

### TURN_PHASE — `src/core/agent/TurnActivity.ts`

Machine name: "TurnPhase". Initial: `idle`. States: `idle`, `admitted`, `preparing`, `running`, `finishing`. Events: `admit`, `prepare`, `settle`, `start`, `finish`.

| From | Allowed (event → to) | Rejected events |
|---|---|---|
| `idle` | `admit` → `admitted` | `prepare`, `settle`, `start`, `finish` |
| `admitted` | `prepare` → `preparing`, `settle` → `idle` | `admit`, `start`, `finish` |
| `preparing` | `start` → `running`, `settle` → `idle` | `admit`, `prepare`, `finish` |
| `running` | `finish` → `finishing`, `settle` → `idle` | `admit`, `prepare`, `start` |
| `finishing` | `settle` → `idle` | `admit`, `prepare`, `start`, `finish` |

Terminal (dead-end by design): none. Unreachable from initial: none.

### AUTOMODE_LIFECYCLE — `src/core/AutomodeManager.ts`

Machine name: "automode-lifecycle". Initial: `idle`. States: `idle`, `starting`, `running`, `paused`, `cancelled`, `completed`, `failed`. Events: `start`, `abandon`, `begin`, `cancel`, `fail`, `pause`, `complete`, `resume`, `settle`.

| From | Allowed (event → to) | Rejected events |
|---|---|---|
| `idle` | `start` → `starting` | `abandon`, `begin`, `cancel`, `fail`, `pause`, `complete`, `resume`, `settle` |
| `starting` | `abandon` → `idle`, `begin` → `running`, `cancel` → `cancelled`, `fail` → `failed` | `start`, `pause`, `complete`, `resume`, `settle` |
| `running` | `pause` → `paused`, `cancel` → `cancelled`, `complete` → `completed`, `fail` → `failed` | `start`, `abandon`, `begin`, `resume`, `settle` |
| `paused` | `resume` → `running`, `cancel` → `cancelled`, `complete` → `completed`, `fail` → `failed` | `start`, `abandon`, `begin`, `pause`, `settle` |
| `cancelled` | `settle` → `idle` | `start`, `abandon`, `begin`, `cancel`, `fail`, `pause`, `complete`, `resume` |
| `completed` | `settle` → `idle` | `start`, `abandon`, `begin`, `cancel`, `fail`, `pause`, `complete`, `resume` |
| `failed` | `settle` → `idle` | `start`, `abandon`, `begin`, `cancel`, `fail`, `pause`, `complete`, `resume` |

Terminal (dead-end by design): none. Unreachable from initial: none.

### AUTOMODE_STATUS_TRANSITIONS — `src/core/AutomodeState.ts`

Machine name: "automode-status". Initial: `running`. States: `running`, `paused`, `cancelled`, `completed`, `failed`. Events: `paused`, `cancelled`, `completed`, `failed`, `running`.

| From | Allowed (event → to) | Rejected events |
|---|---|---|
| `running` | `paused` → `paused`, `cancelled` → `cancelled`, `completed` → `completed`, `failed` → `failed` | `running` |
| `paused` | `running` → `running`, `cancelled` → `cancelled`, `completed` → `completed`, `failed` → `failed` | `paused` |
| `cancelled` | — (terminal) | `paused`, `cancelled`, `completed`, `failed`, `running` |
| `completed` | — (terminal) | `paused`, `cancelled`, `completed`, `failed`, `running` |
| `failed` | — (terminal) | `paused`, `cancelled`, `completed`, `failed`, `running` |

Terminal (dead-end by design): `cancelled`, `completed`, `failed`. Unreachable from initial: none.

### LANE_LIFECYCLE — `src/core/lanes/LaneManager.ts`

Machine name: "Lane". Initial: `running`. States: `running`, `completed`, `partial`, `failed`, `cancelled`. Events: `completed`, `partial`, `failed`, `cancelled`.

| From | Allowed (event → to) | Rejected events |
|---|---|---|
| `running` | `completed` → `completed`, `partial` → `partial`, `failed` → `failed`, `cancelled` → `cancelled` | — |
| `completed` | — (terminal) | `completed`, `partial`, `failed`, `cancelled` |
| `partial` | — (terminal) | `completed`, `partial`, `failed`, `cancelled` |
| `failed` | — (terminal) | `completed`, `partial`, `failed`, `cancelled` |
| `cancelled` | — (terminal) | `completed`, `partial`, `failed`, `cancelled` |

Terminal (dead-end by design): `completed`, `partial`, `failed`, `cancelled`. Unreachable from initial: none.

### TASK_LIFECYCLE — `src/core/teams/TaskManager.ts`

Machine name: "TeamTask". Initial: `pending`. States: `pending`, `in_progress`, `completed`, `failed`, `cancelled`. Events: `claim`, `complete`, `fail`, `cancel`, `release`.

| From | Allowed (event → to) | Rejected events |
|---|---|---|
| `pending` | `claim` → `in_progress`, `complete` → `completed`, `fail` → `failed`, `cancel` → `cancelled` | `release` |
| `in_progress` | `complete` → `completed`, `fail` → `failed`, `cancel` → `cancelled`, `release` → `pending` | `claim` |
| `completed` | `release` → `pending` | `claim`, `complete`, `fail`, `cancel` |
| `failed` | `release` → `pending` | `claim`, `complete`, `fail`, `cancel` |
| `cancelled` | `release` → `pending` | `claim`, `complete`, `fail`, `cancel` |

Terminal (dead-end by design): none. Unreachable from initial: none.

### TEAM_LIFECYCLE — `src/core/teams/TeamManager.ts`

Machine name: "team-lifecycle". Initial: `none`. States: `none`, `active`, `closing`, `stalled`, `finalizing`, `completed`. Events: `create`, `shutdown`, `stopped`, `stall`, `settled`.

| From | Allowed (event → to) | Rejected events |
|---|---|---|
| `none` | `create` → `active` | `shutdown`, `stopped`, `stall`, `settled` |
| `active` | `shutdown` → `closing` | `create`, `stopped`, `stall`, `settled` |
| `closing` | `stopped` → `finalizing`, `stall` → `stalled` | `create`, `shutdown`, `settled` |
| `stalled` | `shutdown` → `closing` | `create`, `stopped`, `stall`, `settled` |
| `finalizing` | `settled` → `completed` | `create`, `shutdown`, `stopped`, `stall` |
| `completed` | `create` → `active` | `shutdown`, `stopped`, `stall`, `settled` |

Terminal (dead-end by design): none. Unreachable from initial: none.

### TEAMMATE_LIFECYCLE — `src/core/teams/TeammateProcess.ts`

Machine name: "teammate-lifecycle". Initial: `created`. States: `created`, `spawning`, `idle`, `working`, `stopping`, `exited`. Events: `spawn`, `idle`, `work`, `shutdownAck`, `transportFailed`, `exit`.

| From | Allowed (event → to) | Rejected events |
|---|---|---|
| `created` | `spawn` → `spawning`, `idle` → `idle`, `work` → `working`, `shutdownAck` → `stopping` | `transportFailed`, `exit` |
| `spawning` | `idle` → `idle`, `work` → `working`, `shutdownAck` → `stopping`, `transportFailed` → `stopping`, `exit` → `exited` | `spawn` |
| `idle` | `work` → `working`, `shutdownAck` → `stopping`, `transportFailed` → `stopping`, `exit` → `exited` | `spawn`, `idle` |
| `working` | `idle` → `idle`, `shutdownAck` → `stopping`, `transportFailed` → `stopping`, `exit` → `exited` | `spawn`, `work` |
| `stopping` | `exit` → `exited` | `spawn`, `idle`, `work`, `shutdownAck`, `transportFailed` |
| `exited` | — (terminal) | `spawn`, `idle`, `work`, `shutdownAck`, `transportFailed`, `exit` |

Terminal (dead-end by design): `exited`. Unreachable from initial: none.

### TEAMMATE_TRANSPORT — `src/core/teams/TeammateProcess.ts`

Machine name: "teammate-transport". Initial: `open`. States: `open`, `failed`, `closed`. Events: `fail`, `close`.

| From | Allowed (event → to) | Rejected events |
|---|---|---|
| `open` | `fail` → `failed`, `close` → `closed` | — |
| `failed` | `close` → `closed` | `fail` |
| `closed` | — (terminal) | `fail`, `close` |

Terminal (dead-end by design): `closed`. Unreachable from initial: none.

### DEEP_RESEARCH_RUN_LIFECYCLE — `src/deepResearch/session.ts`

Machine name: "deep research run". Initial: `queued`. States: `queued`, `running`, `incomplete`, `completed`. Events: `start`, `complete`, `block`.

| From | Allowed (event → to) | Rejected events |
|---|---|---|
| `queued` | `start` → `running`, `complete` → `completed`, `block` → `incomplete` | — |
| `running` | `start` → `running`, `complete` → `completed`, `block` → `incomplete` | — |
| `incomplete` | `start` → `running`, `complete` → `completed`, `block` → `incomplete` | — |
| `completed` | — (terminal) | `start`, `complete`, `block` |

Terminal (dead-end by design): `completed`. Unreachable from initial: none.

### EXTENSION_RELOAD_LIFECYCLE — `src/extensions/ExtensionReloadController.ts`

Machine name: "extension reload". Initial: `idle`. States: `idle`, `starting`, `watching`, `stopped`. Events: `start`, `stop`, `ready`.

| From | Allowed (event → to) | Rejected events |
|---|---|---|
| `idle` | `start` → `starting`, `stop` → `stopped` | `ready` |
| `starting` | `ready` → `watching`, `stop` → `stopped` | `start` |
| `watching` | `stop` → `stopped` | `start`, `ready` |
| `stopped` | — (terminal) | `start`, `stop`, `ready` |

Terminal (dead-end by design): `stopped`. Unreachable from initial: none.

### GOAL_STATUS_LIFECYCLE — `src/goals/types.ts`

Machine name: "goal status". Initial: `active`. States: `active`, `paused`, `blocked`, `waiting`, `budgetLimited`, `complete`. Events: `activate`, `pause`, `block`, `wait`, `complete`, `exhaustBudget`.

| From | Allowed (event → to) | Rejected events |
|---|---|---|
| `active` | `activate` → `active`, `pause` → `paused`, `block` → `blocked`, `wait` → `waiting`, `complete` → `complete`, `exhaustBudget` → `budgetLimited` | — |
| `paused` | `activate` → `active`, `pause` → `paused`, `block` → `blocked`, `wait` → `waiting`, `complete` → `complete` | `exhaustBudget` |
| `blocked` | `activate` → `active`, `pause` → `paused`, `block` → `blocked`, `wait` → `waiting`, `complete` → `complete` | `exhaustBudget` |
| `waiting` | `activate` → `active`, `pause` → `paused`, `block` → `blocked`, `wait` → `waiting`, `complete` → `complete` | `exhaustBudget` |
| `budgetLimited` | `activate` → `active`, `complete` → `complete` | `pause`, `block`, `wait`, `exhaustBudget` |
| `complete` | `activate` → `active` | `pause`, `block`, `wait`, `complete`, `exhaustBudget` |

Terminal (dead-end by design): none. Unreachable from initial: none.

### MCP_CONNECT_ATTEMPT_LIFECYCLE — `src/mcp/McpClientManager.ts`

Machine name: "McpConnectAttempt". Initial: `connecting`. States: `connecting`, `connected`, `failed`, `cancelled`. Events: `connected`, `fail`, `cancel`.

| From | Allowed (event → to) | Rejected events |
|---|---|---|
| `connecting` | `connected` → `connected`, `fail` → `failed`, `cancel` → `cancelled` | — |
| `connected` | — (terminal) | `connected`, `fail`, `cancel` |
| `failed` | — (terminal) | `connected`, `fail`, `cancel` |
| `cancelled` | — (terminal) | `connected`, `fail`, `cancel` |

Terminal (dead-end by design): `connected`, `failed`, `cancelled`. Unreachable from initial: none.

### MCP_STDIO_CONNECTION_LIFECYCLE — `src/mcp/McpClientManager.ts`

Machine name: "McpStdioConnection". Initial: `idle`. States: `idle`, `starting`, `running`, `closed`, `stopping`, `stopped`. Events: `start`, `stop`, `spawned`, `exit`, `stopped`.

| From | Allowed (event → to) | Rejected events |
|---|---|---|
| `idle` | `start` → `starting`, `stop` → `stopping` | `spawned`, `exit`, `stopped` |
| `starting` | `spawned` → `running`, `exit` → `closed`, `stop` → `stopping` | `start`, `stopped` |
| `running` | `exit` → `closed`, `stop` → `stopping` | `start`, `spawned`, `stopped` |
| `closed` | `stop` → `stopping` | `start`, `spawned`, `exit`, `stopped` |
| `stopping` | `stopped` → `stopped` | `start`, `stop`, `spawned`, `exit` |
| `stopped` | — (terminal) | `start`, `stop`, `spawned`, `exit`, `stopped` |

Terminal (dead-end by design): `stopped`. Unreachable from initial: none.

### MOBILE_RELAY_LIFECYCLE — `src/mobile/MobileRelay.ts`

Machine name: "MobileRelay". Initial: `awaitingClaim`. States: `awaitingClaim`, `connected`, `disposed`. Events: `claim`, `dispose`.

| From | Allowed (event → to) | Rejected events |
|---|---|---|
| `awaitingClaim` | `claim` → `connected`, `dispose` → `disposed` | — |
| `connected` | `dispose` → `disposed` | `claim` |
| `disposed` | — (terminal) | `claim`, `dispose` |

Terminal (dead-end by design): `disposed`. Unreachable from initial: none.

### ACP_SESSION_LIFECYCLE — `src/modes/acp/adapter.ts`

Machine name: "AcpSession". Initial: `idle`. States: `idle`, `prompting`, `cancelling`, `closed`. Events: `prompt`, `cancel`, `close`, `drain`, `settle`.

| From | Allowed (event → to) | Rejected events |
|---|---|---|
| `idle` | `prompt` → `prompting`, `cancel` → `idle`, `close` → `closed` | `drain`, `settle` |
| `prompting` | `prompt` → `prompting`, `cancel` → `cancelling`, `drain` → `cancelling`, `settle` → `idle`, `close` → `closed` | — |
| `cancelling` | `prompt` → `prompting`, `cancel` → `cancelling`, `settle` → `idle`, `close` → `closed` | `drain` |
| `closed` | — (terminal) | `prompt`, `cancel`, `close`, `drain`, `settle` |

Terminal (dead-end by design): `closed`. Unreachable from initial: none.

### PLAN_MODE_PHASE — `src/modes/planMode/PlanModeManager.ts`

Machine name: "PlanModePhase". Initial: `planning`. States: `planning`, `executing`, `completed`. Events: `accept`, `complete`, `replan`.

| From | Allowed (event → to) | Rejected events |
|---|---|---|
| `planning` | `accept` → `executing` | `complete`, `replan` |
| `executing` | `complete` → `completed`, `replan` → `planning` | `accept` |
| `completed` | `replan` → `planning` | `accept`, `complete` |

Terminal (dead-end by design): none. Unreachable from initial: none.

### RPC_ADAPTER_LIFECYCLE — `src/modes/rpc/adapter.ts`

Machine name: "RPCAdapter". Initial: `open`. States: `open`, `shuttingDown`, `sealed`. Events: `shutdown`, `seal`.

| From | Allowed (event → to) | Rejected events |
|---|---|---|
| `open` | `shutdown` → `shuttingDown` | `seal` |
| `shuttingDown` | `seal` → `sealed` | `shutdown` |
| `sealed` | — (terminal) | `shutdown`, `seal` |

Terminal (dead-end by design): `sealed`. Unreachable from initial: none.

### LINE_READER_LIFECYCLE — `src/modes/rpc/protocol.ts`

Machine name: "LineReader". Initial: `open`. States: `open`, `closed`, `disposed`. Events: `finish`, `dispose`.

| From | Allowed (event → to) | Rejected events |
|---|---|---|
| `open` | `finish` → `closed`, `dispose` → `disposed` | — |
| `closed` | `dispose` → `disposed` | `finish` |
| `disposed` | — (terminal) | `finish`, `dispose` |

Terminal (dead-end by design): `disposed`. Unreachable from initial: none.

### AUTO_APPROVAL_LIFECYCLE — `src/permissions/PermissionManager.ts`

Machine name: "auto-approval window". Initial: `off`. States: `off`, `armed`, `expired`. Events: `arm`, `expire`.

| From | Allowed (event → to) | Rejected events |
|---|---|---|
| `off` | `arm` → `armed` | `expire` |
| `armed` | `arm` → `armed`, `expire` → `expired` | — |
| `expired` | `arm` → `armed` | `expire` |

Terminal (dead-end by design): none. Unreachable from initial: none.

### CLI_RUNTIME_LIFECYCLE — `src/runtime/CliRuntimeResourceOwner.ts`

Machine name: "CliRuntimeResourceOwner". Initial: `open`. States: `open`, `signalled`, `closed`. Events: `signal`, `shutdown`.

| From | Allowed (event → to) | Rejected events |
|---|---|---|
| `open` | `signal` → `signalled`, `shutdown` → `closed` | — |
| `signalled` | `shutdown` → `closed` | `signal` |
| `closed` | — (terminal) | `signal`, `shutdown` |

Terminal (dead-end by design): `closed`. Unreachable from initial: none.

### PEER_RECEIPT_LIFECYCLE — `src/session/peers/PeerMessageStore.ts`

Machine name: "PeerReceipt". Initial: `pending`. States: `pending`, `unknown`, `accepted`, `consumed`, `replied`, `rejected`, `expired`. Events: `unknown`, `accepted`, `consumed`, `replied`, `rejected`, `expired`, `pending`.

| From | Allowed (event → to) | Rejected events |
|---|---|---|
| `pending` | `unknown` → `unknown`, `accepted` → `accepted`, `consumed` → `consumed`, `replied` → `replied`, `rejected` → `rejected`, `expired` → `expired` | `pending` |
| `unknown` | `pending` → `pending`, `accepted` → `accepted`, `consumed` → `consumed`, `replied` → `replied`, `rejected` → `rejected`, `expired` → `expired` | `unknown` |
| `accepted` | `consumed` → `consumed`, `replied` → `replied`, `expired` → `expired` | `unknown`, `accepted`, `rejected`, `pending` |
| `consumed` | `replied` → `replied` | `unknown`, `accepted`, `consumed`, `rejected`, `expired`, `pending` |
| `replied` | — (terminal) | `unknown`, `accepted`, `consumed`, `replied`, `rejected`, `expired`, `pending` |
| `rejected` | — (terminal) | `unknown`, `accepted`, `consumed`, `replied`, `rejected`, `expired`, `pending` |
| `expired` | — (terminal) | `unknown`, `accepted`, `consumed`, `replied`, `rejected`, `expired`, `pending` |

Terminal (dead-end by design): `replied`, `rejected`, `expired`. Unreachable from initial: none.

### PEER_ENDPOINT_LIFECYCLE — `src/session/peers/PeerMessaging.ts`

Machine name: "PeerEndpoint". Initial: `idle`. States: `idle`, `starting`, `running`, `failed`, `stopped`. Events: `start`, `stop`, `started`, `failed`.

| From | Allowed (event → to) | Rejected events |
|---|---|---|
| `idle` | `start` → `starting`, `stop` → `stopped` | `started`, `failed` |
| `starting` | `started` → `running`, `failed` → `failed`, `stop` → `stopped` | `start` |
| `running` | `stop` → `stopped` | `start`, `started`, `failed` |
| `failed` | `stop` → `stopped` | `start`, `started`, `failed` |
| `stopped` | — (terminal) | `start`, `stop`, `started`, `failed` |

Terminal (dead-end by design): `stopped`. Unreachable from initial: none.

### RESOURCE_TICKET_LIFECYCLE — `src/session/peers/ResourceCoordinator.ts`

Machine name: "ResourceTicket". Initial: `queued`. States: `queued`, `reserved`, `starting`, `running`, `released`, `cancelled`, `expired`, `stale`, `ended`, `completed`. Events: `grant`, `revoke`, `cancel`, `end`, `start`, `release`, `expire`, `spawn`, `spawn_failed`, `complete`.

| From | Allowed (event → to) | Rejected events |
|---|---|---|
| `queued` | `grant` → `reserved`, `revoke` → `stale`, `cancel` → `cancelled`, `end` → `ended` | `start`, `release`, `expire`, `spawn`, `spawn_failed`, `complete` |
| `reserved` | `start` → `starting`, `release` → `released`, `expire` → `expired`, `revoke` → `stale`, `cancel` → `cancelled`, `end` → `ended` | `grant`, `spawn`, `spawn_failed`, `complete` |
| `starting` | `spawn` → `running`, `spawn_failed` → `released` | `grant`, `revoke`, `cancel`, `end`, `start`, `release`, `expire`, `complete` |
| `running` | `complete` → `completed` | `grant`, `revoke`, `cancel`, `end`, `start`, `release`, `expire`, `spawn`, `spawn_failed` |
| `released` | — (terminal) | `grant`, `revoke`, `cancel`, `end`, `start`, `release`, `expire`, `spawn`, `spawn_failed`, `complete` |
| `cancelled` | — (terminal) | `grant`, `revoke`, `cancel`, `end`, `start`, `release`, `expire`, `spawn`, `spawn_failed`, `complete` |
| `expired` | — (terminal) | `grant`, `revoke`, `cancel`, `end`, `start`, `release`, `expire`, `spawn`, `spawn_failed`, `complete` |
| `stale` | — (terminal) | `grant`, `revoke`, `cancel`, `end`, `start`, `release`, `expire`, `spawn`, `spawn_failed`, `complete` |
| `ended` | — (terminal) | `grant`, `revoke`, `cancel`, `end`, `start`, `release`, `expire`, `spawn`, `spawn_failed`, `complete` |
| `completed` | — (terminal) | `grant`, `revoke`, `cancel`, `end`, `start`, `release`, `expire`, `spawn`, `spawn_failed`, `complete` |

Terminal (dead-end by design): `released`, `cancelled`, `expired`, `stale`, `ended`, `completed`. Unreachable from initial: none.

### SYNC_SERVICE_LIFECYCLE — `src/sync/SyncService.ts`

Machine name: "SyncService". Initial: `idle`. States: `idle`, `running`, `stopped`, `authFailed`. Events: `start`, `stop`, `authFail`, `pause`.

| From | Allowed (event → to) | Rejected events |
|---|---|---|
| `idle` | `start` → `running`, `stop` → `stopped`, `authFail` → `authFailed` | `pause` |
| `running` | `pause` → `idle`, `stop` → `stopped`, `authFail` → `authFailed` | `start` |
| `stopped` | — (terminal) | `start`, `stop`, `authFail`, `pause` |
| `authFailed` | — (terminal) | `start`, `stop`, `authFail`, `pause` |

Terminal (dead-end by design): `stopped`, `authFailed`. Unreachable from initial: none.

### PING_SERVICE_LIFECYCLE — `src/telemetry/PingService.ts`

Machine name: "PingService". Initial: `idle`. States: `idle`, `running`, `stopped`. Events: `start`, `stop`.

| From | Allowed (event → to) | Rejected events |
|---|---|---|
| `idle` | `start` → `running`, `stop` → `stopped` | — |
| `running` | `stop` → `stopped` | `start` |
| `stopped` | — (terminal) | `start`, `stop` |

Terminal (dead-end by design): `stopped`. Unreachable from initial: none.

### TELEMETRY_SESSION_LIFECYCLE — `src/telemetry/TelemetryManager.ts`

Machine name: "TelemetrySession". Initial: `idle`. States: `idle`, `active`, `ended`, `shutdown`. Events: `start`, `shutdown`, `end`.

| From | Allowed (event → to) | Rejected events |
|---|---|---|
| `idle` | `start` → `active`, `shutdown` → `shutdown` | `end` |
| `active` | `start` → `active`, `end` → `ended`, `shutdown` → `shutdown` | — |
| `ended` | `start` → `active`, `shutdown` → `shutdown` | `end` |
| `shutdown` | — (terminal) | `start`, `shutdown`, `end` |

Terminal (dead-end by design): `shutdown`. Unreachable from initial: none.

### INK_RENDERER_LIFECYCLE — `src/ui/ink/InkRenderer.tsx`

Machine name: "InkRenderer". Initial: `idle`. States: `idle`, `mounted`, `paused`, `resuming`, `stopped`. Events: `start`, `stop`, `pause`, `resume`, `mounted`.

| From | Allowed (event → to) | Rejected events |
|---|---|---|
| `idle` | `start` → `mounted`, `stop` → `stopped` | `pause`, `resume`, `mounted` |
| `mounted` | `pause` → `paused`, `stop` → `stopped` | `start`, `resume`, `mounted` |
| `paused` | `resume` → `resuming`, `stop` → `stopped` | `start`, `pause`, `mounted` |
| `resuming` | `mounted` → `mounted`, `pause` → `paused`, `stop` → `stopped` | `start`, `resume` |
| `stopped` | — (terminal) | `start`, `stop`, `pause`, `resume`, `mounted` |

Terminal (dead-end by design): `stopped`. Unreachable from initial: none.

### PERSISTENT_INPUT_LIFECYCLE — `src/ui/persistentInput.ts`

Machine name: "PersistentInput". Initial: `inactive`. States: `inactive`, `active`, `paused`. Events: `start`, `pause`, `stop`, `resume`.

| From | Allowed (event → to) | Rejected events |
|---|---|---|
| `inactive` | `start` → `active` | `pause`, `stop`, `resume` |
| `active` | `pause` → `paused`, `stop` → `inactive` | `start`, `resume` |
| `paused` | `resume` → `active`, `stop` → `inactive` | `start`, `pause` |

Terminal (dead-end by design): none. Unreachable from initial: none.

### TERMINAL_REGIONS_LIFECYCLE — `src/ui/terminalRegions.ts`

Machine name: "TerminalRegions". Initial: `inactive`. States: `inactive`, `active`. Events: `enable`, `disable`, `deactivate`.

| From | Allowed (event → to) | Rejected events |
|---|---|---|
| `inactive` | `enable` → `active` | `disable`, `deactivate` |
| `active` | `disable` → `inactive`, `deactivate` → `inactive` | `enable` |

Terminal (dead-end by design): none. Unreachable from initial: none.

