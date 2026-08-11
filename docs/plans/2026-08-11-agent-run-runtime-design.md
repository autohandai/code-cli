# Agent Run Runtime and Direct Agent Communication — Design

**Date:** 2026-08-11
**Status:** Draft for product and architecture review
**Owner:** CLI
**Implementation flag:** `agent_runtime_v2` (experimental, default off)

## Summary

Autohand already has two useful but separate multi-agent implementations:

- `AgentDelegator` and `SubAgent` run bounded child work in-process and return the
  answer to the caller.
- Agent Teams run real child processes and route task updates and messages through a
  lead-owned `TeamManager`.

Neither implementation provides the complete product contract:

1. an agent can start a real child agent in foreground or background;
2. the caller receives a stable run handle and can wait, inspect, message, or cancel;
3. a running child can start descendants and communicate with its parent, children,
   and siblings without asking the user to relay messages;
4. results, usage, artifacts, failures, and lifecycle events are available
   programmatically; and
5. concurrency, permissions, workspace isolation, crash handling, and output are
   governed consistently.

This design introduces one deep module, `AgentRunRuntime`, as the canonical runtime
for child-agent execution. Model-facing `rlm`, `agent_wait`, `agent_message`, and
`agent_cancel` tools are thin adapters over it. Existing delegation and team surfaces
remain compatible and migrate behind the same runtime in stages.

“Direct agent communication” describes the programming model: an agent addresses
another agent and receives delivery or failure directly. Transport remains brokered by
the root Autohand session. The user is not a message router, but Autohand still has one
place to enforce authorization, ordering, persistence, limits, and shutdown.

## Approval requested

The implementation plan should not be written until these product decisions are
approved. This document recommends all of them.

| Decision | Recommended contract |
|---|---|
| Canonical primitive | `rlm(...)` creates a real child process and returns either its result or a run handle. |
| Background work | First-class in v1, with `agent_wait` and `agent_cancel`; not simulated with shell jobs. |
| Communication topology | Any live participant may message parent, child, or sibling in the same session-owned run tree. |
| Lifecycle authority | A child controls only itself and its descendants. The root controls the entire tree. Siblings communicate but cannot cancel or reassign each other. |
| Structured concurrency | A child run cannot become terminal while descendants are live. It must wait or cancel them. Root-owned background runs may outlive an instruction, not the root session. |
| Transport | Root-brokered, versioned JSON-RPC over stdio for child processes. No peer sockets in v1. |
| Delivery | At-least-once delivery with stable message IDs, receiver deduplication, and per-route ordering. |
| Replies | Replies are ordinary correlated messages; `agent_wait(messageId)` explicitly waits while releasing the caller's execution permit. |
| Idle root | Messages notify an idle root but do not silently start a paid/provider turn. An active or explicitly waiting root resumes automatically. |
| Workspace default | Read-only children share the workspace; write-capable canonical runs use managed worktrees. Shared writes require an explicit policy decision. |
| Approval model | Child authority is the intersection of parent authority, agent definition, session policy, and feature policy. Children cannot elevate. |
| Model selection | Inherit the root model by default; an agent definition may pin a model. Model-supplied overrides are allowed only by explicit root policy and allowlist. |
| Recovery | Persist lifecycle and messages, but mark non-terminal runs `lost` after a root-session crash in v1. No orphan adoption. |
| Terminal proof | Success, cancellation, and timeout are terminal only after the child/tool process tree is confirmed stopped; unknown outcomes are `lost`. |
| Budgets | Hard time, turn, request, context, output, process, and queue bounds; actual-or-unavailable token accounting; no false hard cost promise. |
| Rollout | New experimental flag, default off. Existing `delegate_*` and Teams behavior remains unchanged until its compatibility adapter is deliberately enabled. |
| Cross-session messaging | Deferred, local-machine-only, and opt-in. Cross-machine messaging is out of scope. |
| Full RLM REPL | Out of scope. In this design, RLM means recursively callable child-agent execution, not a general context-as-code interpreter. |

## Why this needs a runtime, not another tool

Adding only an `rlm` tool would make the visible demo work but leave the hard behavior
distributed across tool handlers:

- process ownership and shutdown;
- recursive concurrency without deadlock;
- message delivery and conversation injection;
- permission inheritance and approval routing;
- worktree allocation and artifact collection;
- durable status, usage aggregation, and terminal results;
- terminal, RPC, ACP, and hook event parity; and
- compatibility with delegation and Teams.

Those concerns belong behind one interface. Tools, slash commands, JSON-RPC, the TUI,
and legacy adapters should consume the interface rather than own lifecycle logic.

## Current implementation and exact gaps

### In-process delegation

`src/core/agents/AgentDelegator.ts` and `src/core/agents/SubAgent.ts` already provide:

- one child or up to five parallel children;
- recursive delegation with a default maximum depth of three;
- isolated child conversation context;
- child tool execution; and
- a synchronous `ToolActionOutcome` returned to the parent.

The missing contracts are:

- no run ID or public lifecycle;
- no background start, wait, inspect, message, or cancel;
- no real child process;
- no aggregated child usage in the result;
- no `AbortSignal` propagated through the child loop; and
- no exported public API that another runtime surface can use.

### Agent Teams

`src/core/teams` and `src/modes/teammate.ts` already provide:

- real Node child processes;
- newline-delimited JSON-RPC over stdio;
- lead-owned task and teammate state;
- routing from the lead to a child; and
- process exit and task release handling.

The missing contracts are:

- the child model cannot originate a `team.message` request;
- an incoming message is logged but never enters the child conversation;
- protocol requests do not have a complete response/correlation contract;
- team limits are configured but not consistently enforced;
- child dangerous actions are currently auto-approved in teammate mode;
- team concepts leak into execution and make the primitive unsuitable as a general
  child-run API; and
- tests mock process spawning rather than proving communication through a built CLI.

### Session presence

`ActiveAgentRegistry` and `PeerAwarenessManager` solve same-workspace presence,
heartbeat, collision awareness, and stale process pruning. They are not a mailbox and
must not become the v1 child transport. Their liveness and same-user filesystem safety
patterns can be reused later for opt-in cross-session discovery.

## Goals

1. Provide one stable programmatic lifecycle for foreground, background, parallel, and
   recursive child agents.
2. Let live agents exchange messages without routing content through the user.
3. Make recursive execution bounded, cancellable, observable, and deadlock-free.
4. Preserve permission and workspace safety at least as strongly as the root session.
5. Return structured results, usage, artifacts, and typed failures to the caller.
6. Give terminal, command mode, RPC, ACP, hooks, and tests the same lifecycle events.
7. Preserve current delegation and Teams contracts while their implementations migrate.
8. Keep the first release local to one root Autohand session and one machine.

## Non-goals

- A Python or JavaScript RLM context-as-code REPL.
- Cloud scheduling, remote workers, cross-machine discovery, or network listening.
- An unbounded autonomous swarm.
- Exactly-once execution or message delivery.
- Automatic merging of child work into the caller's branch.
- Allowing a model to grant itself tools, credentials, write access, or larger budgets.
- Arbitrary sibling lifecycle control.
- Continuing a child process after the owning root session exits.
- Removing existing delegation or Teams surfaces in the first release.
- Treating green unit tests as proof of live-provider or built-terminal behavior.

## Terminology

| Term | Meaning |
|---|---|
| Root session | The interactive, command, RPC, or ACP Autohand session that owns all runs in this design. |
| Run | One child-agent execution with a stable ID and lifecycle. |
| Run tree | All runs owned by a root session, connected by `parentRunId`. The root session is the top participant but is not a child process. |
| Budget group | A bounded spend/scheduling scope created by a root instruction and inherited by every run it starts. It may outlive the instruction while background runs remain. |
| Actor | The authenticated root, run, user, or internal system operation issuing a runtime command. |
| Broker | The root-session component that validates, persists, orders, and routes control frames and messages. |
| Execution permit | Permission for a run to perform active model/tool work. Waiting does not consume this permit. |
| Resident permit | Permission for a child process to remain alive. This is separate from execution concurrency. |
| Capability envelope | Immutable upper bounds on a run's tools, effects, messaging, recursion, budgets, and workspace access. |
| Artifact | A durable reference produced by a run, such as changed files, a patch, a worktree, a commit, or verification evidence. |

## Design decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Introduce `AgentRunRuntime` as the only owner of child lifecycle. | Process, state, policy, messaging, and persistence must not diverge by caller. |
| D2 | Keep the runtime interface to `start`, `execute`, and `subscribe`. | A small interface hides scheduler and transport complexity and remains usable by tools, UI, and protocol adapters. |
| D3 | Use a child process for canonical `rlm`. | Process isolation gives truthful cancellation, failure containment, independent context, and future adapter flexibility. |
| D4 | Route all child traffic through the root broker. | Agents communicate directly at the API level while policy and observability stay centralized. |
| D5 | Use stable IDs, persisted acceptance, and deduplication rather than promise exactly-once delivery. | Exactly-once is not achievable across process failure without much heavier coordination. |
| D6 | Inject peer messages only at model-turn safe points. | Mutating a conversation during streaming or tool execution creates nondeterministic context. |
| D7 | Separate execution permits from resident-process permits. | A foreground parent waiting for a child must release execution capacity or recursive trees deadlock. |
| D8 | Make terminal run state immutable. | Callers, UI, hooks, and recovery need a single authoritative outcome. |
| D9 | Persist events and a materialized snapshot under the root session directory. | Runs are session-owned and should share its filesystem permissions and lifecycle. |
| D10 | Mark non-terminal runs `lost` on restart in v1. | The first release does not include a daemon or safe orphan reattachment protocol. |
| D11 | Default write-capable canonical runs to isolated worktrees. | Parallel writes in one working tree are unsafe and make artifacts inseparable. |
| D12 | Never auto-merge child changes. | Applying code is a separate, reviewable authority boundary. |
| D13 | Intersect capabilities at spawn and never expand them later. | A descendant must not be able to exceed its parent or root policy. |
| D14 | Surface background approvals to the root UI and pause the run. | Auto-approval silently expands child authority; immediate failure makes useful background work brittle. |
| D15 | Preserve legacy surfaces through adapters before deprecation. | Existing prompts, automation, output, and tests must not break during migration. |
| D16 | Add one default-off experimental feature flag. | This is a behavioral platform change and needs explicit release gates. |
| D17 | Keep root-session messaging as the v1 boundary. | It covers recursive orchestration without prematurely turning presence files into distributed IPC. |
| D18 | Add real-process and built-CLI acceptance tests. | Mocked process tests cannot prove routing, stdio discipline, cancellation, or shutdown. |
| D19 | Require structured concurrency below the root session. | Descendants must not become ownerless, lose result routing, or continue effects after their parent is terminal. |

## Approaches considered

### Extend `AgentDelegator`

This is attractive because recursive child prompts and tools already work. It is not
the right ownership boundary: the class is synchronous, in-process, tool-shaped, and
has no lifecycle, broker, persistence, or process isolation. Extending it would turn a
small delegation helper into a shallow collection of unrelated responsibilities.

### Generalize Agent Teams

This is attractive because Teams already launches real processes. The team/task/member
domain is a product workflow, not the primitive. Making every child run a team member
would leak team creation, shared task lists, and teammate naming into `rlm`, RPC, tests,
and future adapters.

### Add `AgentRunRuntime` and adapt both systems — chosen

The new module owns the general execution contract. `AgentDelegator` becomes a legacy
foreground adapter. Teams retains its user-facing workflow but uses runs for member
execution and the broker for transport. The process adapter can later be replaced by a
remote executor without changing callers.

## Architecture

```text
Model tools       Slash/CLI       RPC/ACP       Teams workflow       Tests
    |                 |              |                |                |
    +-----------------+--------------+----------------+----------------+
                                      |
                               AgentRunRuntime
                         start / execute / subscribe
                                      |
             +------------------------+------------------------+
             |                        |                        |
      Run state + scheduler      Message broker       Policy + persistence
             |                        |                        |
             +------------------------+------------------------+
                                      |
                           AgentExecutionAdapter
             +------------------------+------------------------+
             |                        |                        |
       Child process             In-process legacy       In-memory tests
          (canonical)               adapter                  adapter
```

The adapter seam is internal and behaviorally meaningful:

- `ChildProcessAgentAdapter` is the production implementation for canonical runs.
- `InProcessAgentAdapter` preserves current `delegate_task` behavior during migration.
- `InMemoryAgentAdapter` deterministically drives state, messages, and failures in unit
  and integration tests.

No caller can write directly to a child process, snapshot, or message queue.

## Deep module interface

```ts
export interface AgentRunRuntime {
  start(request: AgentRunRequest, actor: AgentActor): Promise<AgentRunSnapshot>;
  execute(command: AgentRunCommand, actor: AgentActor): Promise<AgentRunCommandResult>;
  subscribe(
    filter: AgentRunEventFilter,
    actor: AgentActor,
    listener: (event: AgentRunEvent) => void,
  ): () => void;
}
```

```ts
export interface AgentRunRequest {
  task: string;
  agent: string;
  requestedModel?: string;
  context: AgentContextReference[];
  resultSchema?: Record<string, unknown>;
  requestedWorkspace: 'auto' | 'shared' | 'isolated' | 'read-only';
  requestedTimeoutMs?: number;
  requestedMaxModelTurns?: number;
  requestedMaxOutputTokensPerTurn?: number;
}

export type AgentContextReference =
  | { type: 'text'; content: string }
  | { type: 'file'; path: string }
  | { type: 'session_message'; messageId: string }
  | { type: 'run_artifact'; runId: string; artifactIndex: number };
```

Parent identity, depth, session identity, and capabilities are derived from `actor` and
the persisted graph; they are deliberately absent from `AgentRunRequest`.

Validation, authorization, and hard admission failures return a typed error before a
run ID is accepted. After durable acceptance, every operational failure is represented
by the run lifecycle and can be inspected or waited; callers never lose an accepted run
to an untracked thrown exception.

`execute` accepts a discriminated union rather than growing one method per operation:

```ts
export type AgentRunCommand =
  | { type: 'inspect'; runId: string }
  | { type: 'wait_run'; runId: string; timeoutMs?: number }
  | { type: 'wait_message'; messageId: string; timeoutMs?: number }
  | {
      type: 'message';
      to: AgentAddress;
      content: string;
      kind?: 'context' | 'question' | 'response' | 'notification';
      replyTo?: string;
      expectsReply?: boolean;
    }
  | { type: 'cancel'; runId: string; reason?: string }
  | { type: 'shutdown'; reason: string };
```

The runtime derives authorization from `actor`; it never trusts an actor ID or
capability supplied in model tool input.

### Actor model

```ts
export type AgentActor =
  | { kind: 'root'; sessionId: string }
  | { kind: 'run'; sessionId: string; runId: string }
  | { kind: 'user'; sessionId: string }
  | { kind: 'system'; sessionId: string };
```

Every command is checked against the persisted run graph and immutable capability
envelope. A run may:

- inspect or cancel itself;
- start, inspect, wait for, message, or cancel its descendants; and
- message a live parent or sibling within the same root session; and
- wait for a correlated reply to a message it originated.

A run may not cancel, reparent, change the capabilities of, or assign work directly to
a sibling. It sends a message; the sibling or common parent decides what to do. The root
actor can inspect, message, wait for, or cancel any owned run.

## Canonical model tools

### `rlm`

```ts
export interface RlmToolInput {
  task: string;
  agent?: string;
  model?: string;
  mode?: 'foreground' | 'background';
  context?: AgentContextReference[];
  resultSchema?: Record<string, unknown>;
  workspace?: 'auto' | 'shared' | 'isolated' | 'read-only';
  timeoutMs?: number;
  maxModelTurns?: number;
  maxOutputTokensPerTurn?: number;
}
```

Rules:

- `task` is required, sanitized, and bounded.
- `agent` resolves an installed agent definition. Omission uses an internal
  general-purpose child definition that cannot be shadowed by a user agent of the same
  name.
- model resolution uses the agent definition's pinned model, then an authorized
  `model` request, then the root provider/model. An unavailable or disallowed override
  fails explicitly rather than silently falling back.
- a pinned or requested model may use only already configured provider credentials and
  remains subject to the root model allowlist; model choice grants no new tools or
  network authority.
- `mode` defaults to `foreground`.
- `context` contains explicit attachment or context references, not arbitrary absolute
  files silently copied from the parent.
- file references are workspace-relative; session-message and artifact references must
  be visible to the actor under the same-session ancestry policy.
- `resultSchema`, when provided, is validated before the result becomes `completed`.
- workspace and budgets are requests clamped by the capability envelope. They cannot
  grant authority.
- foreground mode starts the run and waits. When the caller is itself a child run, it
  releases its execution permit while waiting and reacquires one before returning the
  tool result.
- background mode returns immediately after durable acceptance. A queued snapshot is a
  truthful success; `starting` or `running` is reported only after capacity is available
  and the child handshake progresses.

Foreground/background is a tool-adapter choice, not an execution-adapter mode. Both
paths call the same `AgentRunRuntime.start`; foreground then issues `wait_run`.

Multiple `rlm` calls in one model tool-call batch are durably accepted in stable tool
order and may execute concurrently under the scheduler. Canonical isolated/read-only
runs are concurrency-safe; shared-write runs are denied in a parallel batch or
serialized only when an explicit root policy permits it. A second canonical parallel
tool is unnecessary. The legacy `delegate_parallel` surface remains for compatibility.

Foreground output:

```ts
export interface AgentRunResultProposal {
  outcome: 'completed' | 'failed';
  output?: string;
  outputTruncated?: boolean;
  structured?: unknown;
  error?: AgentRunError;
  artifacts: AgentRunArtifact[];
  usage: AgentRunUsage;
  proposedAt: string;
}

export interface AgentRunResult {
  runId: string;
  status: 'completed' | 'failed' | 'cancelled' | 'timed_out' | 'lost';
  output?: string;
  outputTruncated?: boolean;
  structured?: unknown;
  error?: AgentRunError;
  artifacts: AgentRunArtifact[];
  usage: AgentRunUsage;
  startedAt?: string;
  finishedAt: string;
}
```

Background output is a snapshot containing at minimum `runId`, `status`, `agent`,
`depth`, `parentRunId`, `workspace`, and `createdAt`.

### `agent_wait`

```ts
export type AgentWaitToolInput =
  | { runId: string; messageId?: never; timeoutMs?: number }
  | { messageId: string; runId?: never; timeoutMs?: number };
```

The generated tool schema uses `oneOf` and requires exactly one of `runId` or
`messageId`.

- Run waits return immediately for a terminal run and return the latest non-terminal
  snapshot when `timeoutMs` expires.
- Message waits resolve when an authorized reply whose `replyTo` equals `messageId` is
  accepted. They return the reply envelope programmatically.
- The broker permits only the original sender to wait and only the original recipient
  to satisfy the reply correlation.
- If the destination becomes terminal before replying, the wait resolves
  `undeliverable` rather than sleeping until its timeout.
- A wait timeout does not cancel the target run, message, or reply expectation.
- An omitted child wait timeout is clamped to the caller's remaining run deadline; root
  CLI/RPC callers may provide a shorter timeout.
- `timeoutMs: 0` on a run wait is the canonical status poll; a separate model-facing
  status tool is intentionally omitted.
- Waiting never occupies an execution permit.

### `agent_message`

```ts
{
  runId: string;
  content: string;
  kind?: 'context' | 'question' | 'response' | 'notification';
  replyTo?: string;
  expectsReply?: boolean;
}
```

- `runId` identifies the destination. A child may use the reserved destination
  `parent`; the adapter resolves it before calling the runtime.
- `kind` defaults to `response` when `replyTo` is present, `question` when
  `expectsReply` is true, and `context` otherwise.
- Acceptance means the broker has authorized and persisted the message, not that the
  recipient model has already read it.
- The result returns `messageId`, `acceptedAt`, and delivery state.
- Replies are ordinary messages with `replyTo` metadata; there is no hidden blocking
  request channel. A sender that requires the reply explicitly calls `agent_wait` with
  the returned `messageId`.

### `agent_cancel`

```ts
{ runId: string; reason?: string }
```

- Cancellation always cascades through non-terminal descendants from leaves upward.
  Keeping descendants of a cancelled owner would create ambiguous authority and result
  delivery.
- The result reports the authoritative state after the cancel request is accepted and
  may be `cancelling`; callers use `agent_wait` when they need proof that effects have
  stopped.

## Run identity and record

Run IDs are opaque, collision-resistant IDs generated by the root runtime and include a
short display form. Names are UI labels only and are never authorization identities.

```ts
export interface AgentRunRecord {
  schemaVersion: 1;
  runId: string;
  sessionId: string;
  budgetGroupId: string;
  parentRunId?: string;
  childRunIds: string[];
  depth: number;
  agent: string;
  provider: string;
  model: string;
  label?: string;
  status: AgentRunStatus;
  terminationCause?: 'cancelled' | 'timed_out' | 'failed';
  capabilityEnvelope: AgentCapabilityEnvelope;
  workspace: AgentRunWorkspace;
  budget: AgentRunBudget;
  usage: AgentRunUsage;
  waits: AgentRunWaitState;
  pendingResult?: AgentRunResultProposal;
  result?: AgentRunResult;
  createdAt: string;
  startedAt?: string;
  updatedAt: string;
  finishedAt?: string;
}
```

```ts
export interface AgentRunWorkspace {
  mode: 'shared' | 'isolated' | 'read-only';
  root: string;
  baseSha?: string;
  worktreePath?: string;
}

export type AgentTokenUsage =
  | {
      kind: 'actual';
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
    }
  | { kind: 'unavailable' };

export interface AgentRunUsage {
  self: AgentTokenUsage;
  descendants: {
    actualPromptTokens: number;
    actualCompletionTokens: number;
    actualTotalTokens: number;
    unavailableRuns: number;
  };
}

export interface AgentRunWaitState {
  childRunIds: string[];
  messageIds: string[];
  approvalIds: string[];
}

export type AgentRunSnapshot = Readonly<
  Pick<
    AgentRunRecord,
    | 'runId'
    | 'budgetGroupId'
    | 'parentRunId'
    | 'depth'
    | 'agent'
    | 'provider'
    | 'model'
    | 'label'
    | 'status'
    | 'terminationCause'
    | 'workspace'
    | 'budget'
    | 'usage'
    | 'waits'
    | 'createdAt'
    | 'startedAt'
    | 'updatedAt'
    | 'finishedAt'
    | 'result'
  >
>;

export type AgentRunCommandResult =
  | { type: 'inspect'; snapshot: AgentRunSnapshot }
  | { type: 'wait_run'; snapshot: AgentRunSnapshot; timedOut: boolean }
  | { type: 'wait_message'; outcome: 'reply'; reply: AgentMessageEnvelope }
  | { type: 'wait_message'; outcome: 'timeout' }
  | { type: 'wait_message'; outcome: 'undeliverable'; error: AgentRunError }
  | { type: 'message'; receipt: AgentMessageReceipt }
  | { type: 'cancel'; snapshot: AgentRunSnapshot }
  | { type: 'shutdown'; affectedRunIds: string[] };
```

Sensitive context, prompts, credentials, and raw provider payloads are not stored in
the snapshot. If transcript persistence is enabled by the root session, it follows the
normal session transcript policy in a run-specific file.

## Lifecycle

Allowed statuses:

```ts
export type AgentRunStatus =
  | 'queued'
  | 'starting'
  | 'running'
  | 'waiting_child'
  | 'waiting_message'
  | 'waiting_approval'
  | 'finishing'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out'
  | 'lost';
```

The transition table is authoritative:

| From | Allowed next states |
|---|---|
| `queued` | `starting`, `cancelling`, `timed_out` |
| `starting` | `running`, `cancelling`, `failed`, `lost` |
| `running` | `waiting_child`, `waiting_message`, `waiting_approval`, `finishing`, `cancelling`, `failed`, `lost` |
| `waiting_child` | `running`, `waiting_message`, `waiting_approval`, `cancelling`, `failed`, `lost` |
| `waiting_message` | `running`, `waiting_child`, `waiting_approval`, `cancelling`, `failed`, `lost` |
| `waiting_approval` | `running`, `waiting_child`, `waiting_message`, `cancelling`, `failed`, `lost` |
| `finishing` | `completed`, `cancelling`, `failed`, `lost` |
| `cancelling` | `cancelled`, `timed_out`, `failed`, `lost` |
| Any terminal state | None |

Rules:

- Every transition is validated by one pure state machine.
- Terminal states are immutable.
- A result is written in the same serialized runtime operation that makes a state
  terminal, so observers cannot see `completed` without a result.
- A validated result with a drained inbox is staged as `pendingResult` and moves the run
  to `finishing` only when no descendant is non-terminal. A clean child exit commits its
  `completed` or `failed` outcome and moves that value to `result`.
- Exit zero without a valid pending result is `failed`; non-zero exit overrides a
  proposed success with `failed`. The staged output remains diagnostic data, not a
  successful result.
- `lost` means ownership or transport disappeared and execution outcome is unknown.
- `failed` means execution ended with a known error.
- A deadline on a live process transitions to `cancelling`; `timed_out` is committed only
  after provider, tools, descendants, and process group have stopped. If stop cannot be
  confirmed, the terminal state is `lost`.
- A child crash, failure, cancellation, or timeout cascades cancellation to all
  descendants. A child that wants parallel background work must wait for or cancel it
  before proposing a result. The root session may retain background children across
  root instructions, but orderly root shutdown cancels them.
- Late frames after terminal state are logged as protocol violations and ignored.

## Scheduler and budgets

The scheduler owns two independent bounded resources:

1. **Execution permits** for active model or tool work.
2. **Resident permits** for live child processes, including children waiting on other
   children, replies, or approval.

Recommended defaults:

| Limit | Default | Scope |
|---|---:|---|
| Maximum recursion depth | 3 | Per ancestry chain |
| Maximum non-terminal direct children | 5 | Per run or root |
| Maximum concurrent executions | 5 | Per root session |
| Maximum resident child processes | 8 | Per root session |
| Maximum non-terminal runs | 16 | Per root session |
| Default run timeout | 15 minutes | Per run |
| Default approval timeout | 5 minutes or remaining run deadline, whichever is shorter | Per request |
| Maximum model turns | 10 | Per run |
| Maximum model requests | 50 | Per budget group |
| Maximum output tokens | 16,000 | Per model request |
| Maximum queued messages | 100 | Per destination |
| Maximum message content | 16 KiB UTF-8 | Per message |
| Maximum task content | 64 KiB UTF-8 | Per run |
| Maximum resolved inline context | 256 KiB UTF-8 | Per run |
| Maximum human result output | 64 KiB UTF-8 | Per run |
| Maximum structured result | 256 KiB encoded JSON | Per run |
| Maximum workspace seed snapshot | 32 MiB | Per isolated run |
| Maximum seeded untracked files | 100 | Per isolated run |
| Maximum retained diagnostic log | 1 MiB | Per run |
| Maximum protocol frame | 1 MiB | Per frame |

All limits must be enforced, not only represented in config. Depth, direct-child,
non-terminal-run, and payload limits reject before acceptance. Execution and resident
capacity place an accepted run in `queued` until a permit or deadline wins.

The root session is depth zero; its child is depth one. Terminal children no longer
consume direct-child or non-terminal-run capacity, but remain inspectable history.

The root lazily creates one budget group for all `rlm` calls made by the same top-level
instruction; a parallel tool batch therefore shares one allowance. Descendants inherit
the group and cannot refresh it. A later root instruction receives a new group, while a
background run from an earlier instruction keeps its original remaining budget.
The group counts provider requests made by child runs, not the root model request that
created the group.

### Deadlock avoidance

When a run starts a foreground child:

1. the child is durably accepted;
2. the parent transitions to `waiting_child`;
3. the parent releases its execution permit;
4. the child may acquire a permit and execute;
5. the child's terminal event wakes the parent; and
6. the parent reacquires a permit before incorporating the result.

Waiting for a correlated reply or approval follows the same rule. Queue admission is
fair within a root session: FIFO by durable acceptance, with a bounded opportunity for
a newly awakened parent to resume so a large fan-out cannot starve completion.

The execution lease belongs to the run, not to an individual wait call. Multiple
parallel child/reply waits release it at most once, and the run reacquires one permit
only when its tool batch is ready for another model request. This prevents duplicate
permit release/reacquisition and fan-in deadlocks.

`waits` is the authoritative detail. When several wait kinds coexist, the coarse status
uses `waiting_approval`, then `waiting_child`, then `waiting_message` precedence. Status
may move directly between waiting states as individual waits resolve.

### Budget inheritance

```ts
export interface AgentRunBudget {
  timeoutMs: number;
  maxModelTurns: number;
  maxOutputTokensPerTurn: number;
  deadlineAt: string;
}

export interface AgentBudgetGroupRecord {
  budgetGroupId: string;
  maxModelRequests: number;
  consumedModelRequests: number;
  createdAt: string;
}
```

- A child request is clamped to its parent's deadline, turn/output caps, and the budget
  group's remaining model-request count.
- The run deadline begins at durable acceptance, so queue time is bounded and visible;
  `startedAt` begins only after the child handshake.
- Every model request consumes one budget-group request unit before provider I/O and
  passes the enforced output-token maximum to the provider.
- A provider adapter that cannot honor the output-token request cap is ineligible for a
  canonical run and fails before run acceptance; a provider that violates the cap ends
  the run with `provider_error` rather than continuing over budget.
- Descendant usage counts toward every ancestor aggregate and the root total, but is
  stored once per run to prevent double counting.
- Providers without actual usage report `unavailable`; the runtime never invents
  precise token counts.
- Exceeding a live run deadline initiates cancellation with timeout as the terminal
  cause. A queued run with no process may transition directly to `timed_out`.
- Total-token and cost ceilings are not claimed as hard v1 guarantees because provider
  usage can be unavailable or arrive only after a response. They may be added only when
  enforcement semantics are truthful across supported providers.

## Direct messaging

### Envelope

```ts
export interface AgentMessageEnvelope {
  schemaVersion: 1;
  messageId: string;
  sessionId: string;
  from: AgentAddress;
  to: AgentAddress;
  sequence: number;
  kind: 'context' | 'question' | 'response' | 'notification';
  content: string;
  replyTo?: string;
  expectsReply: boolean;
  createdAt: string;
}

export interface AgentMessageReceipt {
  messageId: string;
  acceptedAt: string;
  delivery: 'queued' | 'delivered';
}

export type AgentAddress =
  | { kind: 'root' }
  | { kind: 'run'; runId: string };
```

Control frames, task state, approvals, heartbeats, and lifecycle events are never
encoded as agent-authored text messages.

### Delivery contract

1. The sender submits a message to the root broker.
2. The broker authenticates the sender from its process channel, resolves the
   destination, checks same-session topology and capabilities, sanitizes and bounds the
   content, validates any reply correlation, allocates route sequence and message ID,
   and appends `message.accepted`.
3. Only after persistence does the sender receive an acknowledgement.
4. The broker queues or sends the envelope to the destination.
5. The receiver atomically records the message in its inbox/deduplication set, persisted
   through the broker, before acknowledging delivery.
6. Unacknowledged messages may be redelivered while the root session remains alive.

This yields:

- at-least-once delivery;
- no duplicate model injection for a stable `messageId`;
- order preserved for one sender-to-recipient route;
- no total ordering promise across different senders; and
- explicit failure when the recipient is terminal, unknown, unauthorized, or over its
  queue limit.

A `replyTo` reference is valid only when the new sender was the referenced message's
recipient and the new destination was its sender. A spoofed, cross-session, unknown, or
misdirected correlation is rejected. The first accepted response resolves a message
wait; later distinct responses remain visible messages but do not replace its result.

If delivery becomes impossible after acceptance, the broker persists and emits an
`undeliverable` event to the sender. Before accepting a terminal result, the runtime
checks the recipient's accepted inbox watermark. Accepted messages must be injected or
marked undeliverable, so a child cannot race a final result past already accepted work.

### Conversation injection

Incoming messages enter the recipient at a safe point immediately before its next model
request. They never mutate an in-flight stream or tool call.

The child conversation receives a structured, clearly delimited system-owned wrapper
with message ID, sender, kind, and sanitized content. It also receives an instruction
that peer content is untrusted task input, not a policy or permission change. The
original message remains in the broker log; any rendered or prompt copy is clamped
independently.

If a run is idle inside active execution, a newly delivered message schedules another
model turn. A correlated reply wakes `waiting_message`; unrelated messages remain
queued. If the run is waiting on a child or approval, a message is queued until that
wait can be safely interrupted or completed. A terminal run rejects new messages.

The root session follows the same safe-point rule. V1 does not silently start a new
provider turn after the root instruction is fully idle: messages remain in the root
inbox, produce a non-disruptive notification, and enter the next root turn. A root that
is already reasoning or explicitly waiting for a reply resumes without user relay.
Autonomous idle-root wake-up requires a later explicit policy because it spends tokens
and may invoke tools without a new user turn.

### Completion notification

A child terminal event is not merely a text message. It is a control event that:

- resolves all `agent_wait` calls;
- updates root and parent snapshots;
- emits output/hook/UI events; and
- queues a concise model-visible notification for a parent that is still reasoning.

The parent can retrieve the complete structured result using `agent_wait`. Large child
output is never copied repeatedly into peer messages.

### Address discovery

Every run receives its parent address and the IDs/labels of currently authorized
siblings and children. The broker sends a control-plane topology update when that
visible set changes. Topology metadata is injected at the same safe points as messages,
but is never treated as agent-authored content. A run cannot discover other root
sessions or runs outside its session through this interface.

The result of every spawn contains the child run ID. Model tools use `parent` as a
convenience alias; tool adapters resolve all aliases to `AgentAddress` before invoking
the runtime. Ambiguous labels fail rather than selecting an arbitrary run.

## Child process protocol

The canonical transport is versioned newline-delimited JSON-RPC over stdin/stdout.
Stdout is protocol-only. Human logs go to bounded `agent.log` frames or stderr and are
never parsed as control data.

The root spawns the same built Autohand entrypoint in an internal child mode with
`shell: false`, an argument array, the resolved workspace as `cwd`, piped stdio, and a
dedicated process group where the platform permits it. The child mode is not a public
user workflow. A random per-process channel nonce is passed through a private inherited
descriptor or allowlisted environment entry and confirmed during handshake; it is
never accepted from a model frame or command argument.

Required protocol methods and notifications:

| Direction | Method | Purpose |
|---|---|---|
| Child → root notification | `agent.ready` | Version and capability handshake. |
| Root → child request | `agent.start` | Load resolved context and immutable envelope; response acknowledges readiness to execute. |
| Child → root notification | `agent.event` | Thinking, tool, usage, artifact, and progress events. |
| Child → root request | `agent.result` | Propose a terminal result; response accepts it for clean exit or reports live descendants, pending inbox, or validation failure. |
| Child → root request | `agent.command` | Spawn, wait, message, cancel, or approval request; standard JSON-RPC response carries the result. |
| Root → child request | `agent.message` | Deliver an accepted agent message; standard response acknowledges inbox/dedupe storage. |
| Root → child request | `agent.cancel` | Cooperative cancellation with deadline and reason; standard response acknowledges the signal. |
| Root → child notification | `agent.topology` | Update the authorized parent, child, and sibling address directory. |
| Both notifications | `agent.heartbeat` | Detect a wedged or disconnected peer. |
| Child → root notification | `agent.log` | Bounded diagnostic output. |

Protocol requirements:

- a version/capability handshake before task content is sent;
- runtime validation for every inbound frame;
- request IDs and one correlated response for every request;
- bounded response caching by channel/request ID, so an identical duplicate receives
  the original result and a conflicting duplicate is a protocol error;
- after an `agent.result` proposal is accepted, the child starts no new model/tool work,
  closes its channel, and exits within a bounded finishing grace period;
- a maximum frame size before JSON parsing;
- explicit errors for malformed frames, unknown methods, duplicate terminal results,
  and unsupported versions;
- backpressure: pause reads or fail the run when bounded queues fill;
- heartbeat timeouts distinct from run deadlines; and
- no credentials or inherited environment dump in frames or logs.

Diagnostic output beyond the retained cap is drained to prevent pipe deadlock, discarded,
and represented by one truncation event. It must not grow process memory or session
storage without bound.

The root authenticates a child by the private process channel it created. A `runId`
inside a frame cannot impersonate another run.

## Context isolation and result shaping

### Child input

A child starts with:

- the resolved agent definition and system prompt;
- the task;
- its immutable capability and budget summary;
- workspace metadata;
- explicit context references selected by the parent; and
- concise ancestry metadata needed for messaging.

The full parent conversation is not copied by default. The parent may supply a bounded
summary or selected message/context references. Tool outputs are referenced or
summarized rather than blindly duplicated.

### Structured results

If `resultSchema` is present:

1. the child is instructed to produce both a concise human summary and structured data;
2. the runtime validates the data against the schema;
3. one bounded repair turn may run if budget remains; and
4. invalid data after repair produces `failed` with `result_validation_failed` while
   retaining the human output as diagnostic data.

No schema is executed as code. Unsupported or unsafe schema features are rejected at
start. Oversized human output is truncated only at a valid encoding boundary, retained
as a result artifact, and reported with `outputTruncated: true`. Oversized structured
output fails explicitly; it is never truncated into invalid JSON or silently cut.

### Artifacts

```ts
export type AgentRunArtifact =
  | { type: 'changed_files'; paths: string[] }
  | { type: 'patch'; path: string; sha256: string }
  | { type: 'result'; path: string; sha256: string; mediaType: string }
  | { type: 'worktree'; path: string; baseSha: string }
  | { type: 'commit'; sha: string; branch?: string }
  | { type: 'verification'; command: string; exitCode: number; summary: string };
```

Artifact paths must resolve inside the approved workspace, managed worktree, or
session-owned artifact directory. Results do not inline unbounded patches or command
logs.

## Workspace isolation

`workspace: 'auto'` resolves as follows:

| Child capability | Resolution |
|---|---|
| Read-only | Share root workspace with all mutating tools removed. |
| Write-capable | Managed worktree. |

Other modes:

- `read-only` always shares the resolved workspace and removes write effects.
- `isolated` requires a Git repository and creates a managed worktree.
- `shared` requires the root capability to allow shared writes. Interactive mode asks
  for confirmation unless session policy already permits it. Background parallel
  shared writes are denied by default.

If an advanced root policy permits background shared writes, each run must publish its
activity and changed paths through the existing peer-awareness path and participate in
the same collision/claim checks as an independent session. The run broker's knowledge
does not bypass workspace concurrency warnings.

Managed worktrees:

- are created from a captured base SHA and immutable input snapshot;
- use collision-safe Autohand-owned paths and names;
- are never automatically merged or deleted while their result is unacknowledged;
- produce changed-file and patch artifacts at terminal state;
- are retained on failure or cancellation for inspection; and
- are removed only by explicit cleanup or a separately specified retention policy.

The input snapshot prevents a child from silently missing the root's current work. It
contains the tracked diff from the captured base plus a bounded manifest of non-ignored
untracked files. The capture must not modify the root index or working tree. The runtime
records a seed hash and computes child artifacts relative to that seed, so the returned
patch contains the child's delta rather than replaying the parent's pre-existing work.
Ignored files are never copied implicitly; they require an explicit authorized context
reference.

If the workspace changes while the snapshot is being captured, the runtime retries a
bounded number of times and then fails before spawn with `workspace_changed`. A
background worktree is a point-in-time snapshot: later root edits are not synchronized
into it.

The existing session-worktree behavior can supply naming and Git semantics, but run
creation must use an asynchronous, cancellable adapter rather than synchronous Git in a
render or model loop.

Legacy `delegate_task` keeps its current shared-workspace behavior while it is backed by
the in-process adapter. Switching that legacy surface to worktrees is a separate
compatibility decision, not an accidental consequence of enabling `rlm`.

## Capabilities, permissions, and approvals

```ts
export interface AgentCapabilityEnvelope {
  permissionMode: 'restricted' | 'interactive' | 'unrestricted';
  allowWrite: boolean;
  allowNetwork: boolean;
  allowSpawn: boolean;
  allowMessaging: boolean;
  allowModelOverride: boolean;
  allowedTools?: string[];
  deniedTools: string[];
  allowedModels?: string[];
  maxDepth: number;
  maxDirectChildren: number;
  workspaceModes: Array<'shared' | 'isolated' | 'read-only'>;
}
```

The runtime computes the envelope as the intersection of:

1. root session and client policy;
2. parent envelope and remaining budgets;
3. installed agent definition;
4. feature configuration; and
5. workspace restrictions.

The model-facing tool accepts no raw capability object. Descendants can request a
narrower mode but cannot expand any bound.

Child tool registration is capability-derived. `rlm` is absent when spawning is denied
or maximum depth is reached; messaging is absent when disabled; mutating and network
tools are removed rather than merely described as forbidden. Runtime authorization is
still repeated on every command to prevent stale-schema or forged-protocol bypasses.

All child tool calls pass through the same permission evaluator and lifecycle hooks as
the root. The current teammate-mode unconditional approval must not be reused.

For an interactive approval:

- the child transitions to `waiting_approval` and releases its execution permit;
- the root UI shows child name, run ID, requested action, workspace, and reason;
- a background request creates a pending approval notification without stealing focus
  from an active composer; the user resolves it from the approval/run surface;
- approval or denial is recorded and returned over the correlated child channel; and
- root shutdown or approval timeout denies the request and resumes cancellation.

In command, RPC, or ACP mode without an approval responder, an interactive request
fails with `approval_required`. `--yes` may auto-approve only actions already permitted
by the root policy; it never overrides restricted mode, hook denial, or child bounds.

Environment variables passed to a child are allowlisted. Provider authentication is
provided through the existing provider configuration path, not a blanket copy of the
root environment. Messages, protocol logs, events, and snapshots must redact known
secret material.

All context, artifact, and workspace paths are resolved with realpath containment
checks at use time. A symlink that escapes the authorized root is denied unless the
root policy explicitly grants that external path. Child-authored labels, progress,
errors, and messages pass through terminal-control sanitization before rendering.

### Trust boundary

The child process is a failure-isolation boundary, not an operating-system security
sandbox. It runs as the same user, and a permitted shell tool has that user's OS-level
access. Safety comes from exposing only policy-approved tools, applying permissions and
hooks to every effect, constraining workspace paths, and not executing agent content as
runtime code. Managed worktrees isolate Git changes; they do not isolate the host.

Stronger filesystem, memory, CPU, or network isolation requires a separately reviewed
sandbox adapter. The `AgentExecutionAdapter` seam permits that later without weakening
or changing the v1 contract.

## Persistence and recovery

Run data is owned by the root session:

```text
~/.autohand/sessions/<sessionId>/agent-runs/
  snapshot.json
  events/
    000001.jsonl
  transcripts/
    <runId>.jsonl
  artifacts/
    <runId>/
```

- the directory is `0700` and files are `0600`;
- event segments are append-only and contain bounded, versioned lifecycle records;
- `snapshot.json` is an atomically replaced materialized view used for fast startup and
  UI reads;
- snapshot rebuild from events is tested;
- message content follows transcript privacy policy and is excluded from telemetry;
- persisted IDs, timestamps, states, budgets, usage, and artifact references are
  sufficient to explain a run without provider internals.

The broker is the only writer and serializes mutations through one session-owned queue.
Start/message acceptance, state transitions, approvals, and terminal results are
acknowledged only after their event batch is flushed to disk. Snapshot replacement may
lag because recovery replays the event tail. Large logs rotate into immutable numbered
segments after a checkpoint; rotation never rewrites an uncheckpointed event or changes
event sequence numbers.

Recovery may discard one incomplete final JSONL record left by a crash. A malformed
record, duplicate sequence with different content, or sequence gap anywhere else fails
store initialization closed and preserves the files for diagnosis; it must never reset
or fabricate successful run history.

### Root shutdown

Orderly shutdown:

1. stop accepting new starts and messages;
2. cancel non-terminal descendants from leaves upward;
3. wait a bounded cooperative grace period;
4. terminate remaining child process groups;
5. persist authoritative terminal or `lost` state; and
6. close the event writer.

The child treats stdin EOF or loss of root heartbeat as cancellation, stops its tool
process group, and exits. This is best-effort containment, not durable continuation.

### Restart after crash

On session load, the runtime reads the snapshot and event tail. Every persisted
non-terminal v1 run becomes `lost` with reason `root_restarted`. Terminal states remain
unchanged. No process is adopted, no message is replayed to a replacement process, and
no write-capable run is retried automatically.

Forking or cloning a session does not copy its live run graph or make old run IDs
addressable in the new session. A terminal artifact from the source session may be
attached explicitly as read-only context when the normal session-branch policy permits
it. Imported sessions start with no runnable child state.

Read-only automatic retry may be designed later, but retry is not part of v1 because
tool effects cannot generally be proven idempotent.

## Failure model

```ts
export interface AgentRunError {
  code:
    | 'invalid_request'
    | 'not_found'
    | 'unauthorized'
    | 'capability_denied'
    | 'approval_required'
    | 'approval_denied'
    | 'resource_exhausted'
    | 'persistence_error'
    | 'spawn_failed'
    | 'process_exit'
    | 'protocol_error'
    | 'provider_error'
    | 'tool_error'
    | 'result_validation_failed'
    | 'workspace_changed'
    | 'message_undeliverable'
    | 'cancelled'
    | 'timed_out'
    | 'lost';
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}
```

Errors are safe to render and return to a model. Raw provider bodies, stack traces,
environment values, and secret-bearing command text stay in appropriately redacted
diagnostics.

Cancellation propagates through one `AbortSignal` from runtime to provider stream,
React loop, tool manager, shell process group, adapter, and descendants. After a grace
period, the runtime terminates the process group. Cancellation is idempotent.

## Events, hooks, and usage

Canonical output events:

```ts
export interface AgentRunEventBase {
  eventId: string;
  sessionId: string;
  sequence: number;
  timestamp: string;
}

export type AgentRunEvent = AgentRunEventBase & (
  | { type: 'agent_run_started'; run: AgentRunSnapshot }
  | { type: 'agent_run_state'; runId: string; from: AgentRunStatus; to: AgentRunStatus }
  | { type: 'agent_run_message'; message: AgentMessageMetadata }
  | { type: 'agent_run_progress'; runId: string; summary: string }
  | { type: 'agent_run_usage'; runId: string; usage: AgentRunUsage }
  | { type: 'agent_run_artifact'; runId: string; artifact: AgentRunArtifact }
  | { type: 'agent_run_finished'; result: AgentRunResult }
);

export interface AgentMessageMetadata {
  messageId: string;
  from: AgentAddress;
  to: AgentAddress;
  kind: AgentMessageEnvelope['kind'];
  delivery: 'accepted' | 'queued' | 'delivered' | 'undeliverable';
  createdAt: string;
}

export interface AgentRunEventFilter {
  runIds?: string[];
  includeDescendants?: boolean;
  types?: AgentRunEvent['type'][];
  replayAfterSequence?: number;
}
```

Terminal, command mode, JSON output, RPC, and ACP translate from these same events.
Hooks receive new canonical `agent-run-*` events. Existing `subagent-*` and team hooks
remain available through a compatibility translator until a documented removal cycle.

Telemetry records counts, latency, depth, terminal code, adapter, and aggregate usage.
Task text, message content, model output, file content, and patches are excluded by
default. Parent usage includes descendant totals in a clearly named aggregate field;
session aggregation stores each run once to prevent double counting.

## TUI and command surfaces

### Interactive

- Extend the existing task activity area with a compact run tree: label, short ID,
  status, elapsed time, usage availability, and workspace marker.
- Background completion creates a non-disruptive notification and remains available in
  the transcript.
- Child approval is visibly attributed to the child and worktree.
- Ctrl+C first cancels the active root instruction according to existing semantics; a
  second/explicit shutdown cancels owned child runs and exits.

### Commands

`/agents` continues to mean live root sessions. Installed agent definitions keep their
existing management surface. Child executions use a distinct `/runs` surface:

```text
/runs
/runs <run-id>
/runs wait <run-id> [timeout]
/runs message <run-id> <content>
/runs cancel <run-id>
```

Non-interactive equivalents use `autohand runs ...` and support structured JSON output.
The default list shows non-terminal and recent terminal runs; full history is paginated
with stable sequence cursors. Names may be displayed, but commands resolve a short ID
only when it is unique.

Teams keeps `/team`, `/tasks`, and `/message`. After migration, those commands adapt
team members and tasks to runtime runs rather than exposing runtime terminology to team
users.

## Configuration and feature flag

```ts
export interface AgentRuntimeSettings {
  enabled?: boolean;
  maxDepth?: number;
  maxDirectChildren?: number;
  maxConcurrentExecutions?: number;
  maxResidentRuns?: number;
  maxNonTerminalRuns?: number;
  defaultTimeoutMs?: number;
  approvalTimeoutMs?: number;
  maxModelTurnsPerRun?: number;
  maxModelRequestsPerBudgetGroup?: number;
  maxOutputTokensPerTurn?: number;
  allowModelOverride?: boolean;
  allowedModels?: string[];
  workspaceIsolation?: 'auto' | 'shared' | 'isolated' | 'read-only';
  messaging?: 'off' | 'tree';
}
```

Recommended defaults match the scheduler table. The feature registry entry is:

- ID: `agent_runtime_v2`
- stage: `experimental`
- config path: `agentRuntime.enabled`
- default: `false`
- requires restart: `true`

`allowModelOverride` defaults to `false`. This blocks model-authored `model` input but
does not prevent a trusted installed agent definition from pinning a configured model.
When `allowedModels` is present, it constrains both pinned and requested models.

Task, inline-context, message, result, and protocol-frame byte ceilings are fixed safety
caps in v1 rather than user settings. Raising them changes memory and prompt-injection
exposure and requires a reviewed schema/version change.

Config validation rejects negative, zero, non-integer, internally inconsistent, or
unsafe limits. Remote feature flags may disable the feature, but cannot silently enable
it for a user who has not opted in during the experimental stage.

Existing `teams.enabled` remains separate. `teams.maxTeammates` must be enforced while
Teams is still on its current implementation and later mapped to a runtime limit.

## Compatibility contract

### Flag off

- `delegate_task` and `delegate_parallel` use the current in-process implementation.
- Teams uses its current process implementation.
- No `rlm` or `agent_*` tools are exposed.
- Existing output, hooks, configuration, and tests are unchanged.

The current teammate-mode unconditional dangerous-action approval is not a compatibility
contract. Replacing it with the normal permission evaluator is an independent security
prerequisite with its own regression tests, even before TeamManager migrates to runs.

### Flag on, before legacy migration

- Canonical `rlm` and lifecycle tools use `AgentRunRuntime` and child processes.
- Existing delegation and Teams still follow their prior code paths.
- Events are distinct, so dual implementations cannot double-count usage or render the
  same child twice.

### Legacy migration

- `delegate_task` maps to foreground start + wait through the compatibility adapter.
- `delegate_parallel` starts up to five compatible runs, then waits for all in stable
  input order and preserves the existing result shape.
- TeamManager keeps team/member/task identity as a workflow layer. Each assigned task
  becomes a run using the member definition and bounded retained context; messages to
  an active task use the broker, while messages to an idle member remain in the team
  workflow inbox for its next task.
- Tool names and current command output remain until a separate deprecation decision.
- Shared-workspace behavior is preserved for legacy delegation unless explicitly
  changed and tested as a breaking behavior.

The old implementations are removed only after parity tests cover prompts, retained
member context, task reassignment, tmux/in-process presentation, outputs, limits,
cancellation, hooks, and usage. A team member is a long-lived workflow identity; an
`AgentRun` remains a bounded execution of one task.

## Local cross-session messaging — later phase

After the run-tree release is stable, independent root sessions on the same machine may
opt into `messaging: 'workspace'` under a separate feature flag.

That design may extend `ActiveAgentRegistry` records with a versioned local endpoint:

- Unix domain socket on POSIX and named pipe on Windows;
- same-user filesystem permissions;
- authenticated session handshake and protocol negotiation;
- no TCP listener;
- content and queue limits identical to run-tree messaging; and
- root ownership remains local, so another session may message but not cancel a run.

This phase must have its own threat model and acceptance tests. Presence files alone are
not trusted as authorization credentials.

## Implementation phases and release gates

### Phase 0 — contracts

- approve this design;
- write the implementation plan with small test-first increments;
- freeze public types, states, limits, and protocol fixtures; and
- independently close the teammate unconditional-approval gap with a failing regression
  test before reusing any teammate execution path; and
- add the disabled feature definition and configuration validation.

Gate: type-level fixtures and state/protocol contract tests pass with no runtime surface
enabled.

### Phase 1 — deep runtime with in-memory adapter

- state machine, scheduler, immutable capability calculation;
- append-only events and snapshot recovery;
- broker, message ordering, dedupe, and safe-point queue;
- cancellation and usage aggregation; and
- in-memory adapter for deterministic testing.

Gate: exhaustive unit/property-style transition tests, persistence reconstruction, and
deadlock tests pass.

### Phase 2 — real child process and foreground `rlm`

- hardened versioned protocol;
- child process adapter and teammate-mode replacement entrypoint;
- bounded context and structured result validation;
- permission/approval parity; and
- foreground tool surface.

Gate: real process tests prove start, nested tool use, result, provider failure,
protocol corruption, cancel, forced kill, and root shutdown.

### Phase 3 — background lifecycle and direct messaging

- background start, wait, message, cancel;
- safe-point conversation injection;
- run events in terminal, RPC, ACP, hooks, and JSON output; and
- `/runs` and task activity UI.

Gate: built-CLI Tuistory proves a child-originated message changes a recipient's next
turn, background completion is observable, and Ctrl+C/shutdown leaves no child process.

### Phase 4 — recursion, worktrees, and legacy migration

- child-originated spawn/wait/cancel;
- recursive scheduler and inherited budgets;
- managed worktree/artifact lifecycle;
- delegation compatibility adapter; and
- TeamManager workflow migration.

Gate: child → grandchild execution, parallel limit enforcement, no scheduler deadlock,
worktree isolation, artifact review, and complete legacy contract suites pass.

### Phase 5 — opt-in local cross-session messaging

- separate reviewed design and threat model;
- local endpoint discovery and authentication; and
- two-root-session message UX.

Gate: same-user positive path, unauthorized peer rejection, stale endpoint recovery,
restart, and cross-platform tests pass. This phase is not required to ship run-tree
communication.

### Release evidence

Every phase finishes with focused tests, full tests, lint, build/proof, and regression
review. Before enabling the feature by default, release evidence must separately show:

1. automated unit and integration proof;
2. a packaged/built CLI real terminal run;
3. live-provider foreground, background, recursive, and cancellation behavior;
4. workspace/worktree artifact inspection; and
5. clean shutdown with no orphan child or tool processes.

## Test strategy

### Unit

- every valid and invalid state transition;
- terminal immutability and result/state atomicity;
- structured-concurrency rejection of live-descendant completion and ordered teardown;
- actor topology and lifecycle authorization;
- capability and budget intersection;
- inherited, pinned, allowed, denied, and unavailable model resolution;
- queue admission, fairness, execution permit release, and recursion depth;
- message validation, sanitization, ordering, deduplication, and queue limits;
- correlated reply authorization, explicit message waits, and timeout behavior;
- terminal-result serialization against the accepted inbox watermark;
- safe-point injection and no mid-stream injection;
- usage aggregation without double counting;
- structured result validation and bounded repair;
- snapshot rebuild, truncated event tail, and restart-to-`lost` recovery;
- dirty-workspace seed capture, child-only delta, worktree path, and artifact
  containment; and
- legacy result/output translation.

### Integration with real child processes

- handshake and version negotiation;
- correlated concurrent requests and out-of-order responses;
- child-originated spawn, wait, message, cancel, and approval;
- child-to-child correlated replies while the sender releases its execution permit;
- stdout contamination and malformed/oversized frames;
- child crash before ready, during model stream, during tool, and after result;
- cooperative cancellation followed by forced process-group termination;
- root pipe loss and heartbeat loss;
- environment allowlist and secret redaction;
- read-only tool removal and denied capability elevation; and
- retained worktree and patch artifact after failure.

### Ink and Tuistory

TUI automation belongs under the existing `src/testing` drivers and scenarios.
Required built-CLI scenarios:

1. foreground `rlm` returns a child result in the root transcript;
2. background `rlm` returns a run ID, root continues, and `agent_wait` retrieves result;
3. child sends an active parent a question, explicitly waits on the message ID, and the
   parent replies without user relay;
4. two sibling agents exchange a correlated message/reply and the recipient's next
   model request demonstrably includes each message once;
5. child starts a grandchild and receives its structured result;
6. maximum depth, direct-child, resident, execution, and message limits render typed
   failures;
7. cancellation during provider streaming and command execution terminates the tree;
8. an approval request names the child and resumes after allow/deny;
9. a write-capable run edits only its worktree and returns reviewable artifacts;
10. child crash becomes `failed`, root crash recovery becomes `lost`;
11. duplicate delivery acknowledgement does not duplicate conversation content; and
12. Ctrl+C and normal exit leave no child or descendant process alive.

Tests must use deterministic local fake-provider fixtures for exact assertions. A small
live-provider smoke suite is release evidence, not a replacement for deterministic
coverage.

### Compatibility

- existing `delegate_task` and `delegate_parallel` snapshots and result order;
- current recursion depth and parallel count behavior;
- Teams create/add/task/message/shutdown commands;
- existing subagent and team hooks;
- terminal and non-interactive output when the feature is off; and
- Ink >= 7 and React >= 19 remain unchanged.

## Acceptance criteria

The first stable run-tree release is complete only when all statements below are true:

- [ ] `rlm` foreground uses a real child process and returns a typed terminal result.
- [ ] `rlm` background returns a durable run ID with truthful queued/starting/running
  state without waiting for capacity.
- [ ] `agent_wait` returns terminal results and non-destructive timeout snapshots.
- [ ] `agent_wait` resolves a correlated peer reply without consuming an execution
  permit or blocking unrelated delivery.
- [ ] `agent_cancel` reaches provider, tools, process groups, and descendants.
- [ ] A child can start and wait for a grandchild within enforced inherited limits.
- [ ] A child cannot finish with live descendants; failure and cancellation tear them
  down before the parent terminal state is committed.
- [ ] Parent, child, and sibling messages require no user relay.
- [ ] A child-originated message is injected exactly once at a recipient safe point.
- [ ] An idle root receives a non-disruptive inbox notification and is not silently
  awakened into a paid/provider turn.
- [ ] Unauthorized, oversized, terminal-recipient, and queue-exhausted messages fail
  explicitly.
- [ ] Foreground recursive waiting cannot deadlock at maximum execution concurrency.
- [ ] Every configured depth, child, resident, execution, timeout, model-turn,
  model-request, context, output, frame, and message limit is enforced.
- [ ] Child capabilities never exceed parent/root capabilities, including under
  `--yes`.
- [ ] Child tool calls use root-equivalent permission and hook evaluation; there is no
  unconditional dangerous-action approval.
- [ ] Canonical write-capable children use isolated worktrees by default and never
  auto-merge.
- [ ] An isolated child sees the captured root input snapshot, and its patch excludes
  the root's pre-existing seed changes.
- [ ] Results include bounded artifacts and actual-or-unavailable usage metadata.
- [ ] Terminal state and result are immutable and reconstructable from persisted events.
- [ ] `completed`, `cancelled`, and `timed_out` are not committed until the child/tool
  process tree is confirmed stopped; an unknown outcome is `lost`.
- [ ] A root restart marks prior non-terminal runs `lost` and never silently retries
  writes.
- [ ] Terminal, JSON, RPC, ACP, TUI, and hooks observe the same canonical event stream.
- [ ] Existing delegation and Teams flows are unchanged with the feature off.
- [ ] Migration adapters pass the full legacy contract suite before old paths are
  removed.
- [ ] Real child-process tests and built-CLI Tuistory tests pass without mocked spawn.
- [ ] Live-provider release proof covers foreground, background, recursive messaging,
  cancellation, and clean shutdown.
- [ ] `bun test`, `bun lint`, and `bun run proof` pass.

## Expected module boundaries

Names may change during implementation planning, but ownership must remain local:

```text
src/core/agent/runs/
  AgentRunRuntime.ts          # deep public module
  AgentRunStateMachine.ts     # pure transitions
  AgentRunScheduler.ts        # permits, queues, budgets
  AgentRunBroker.ts           # messages and child commands
  AgentRunPolicy.ts           # actor and capability authorization
  AgentRunStore.ts            # events and snapshot
  AgentRunWorkspace.ts        # async isolation and artifacts
  AgentRunProtocol.ts         # schemas and codec
  adapters/
    ChildProcessAgentAdapter.ts
    InProcessAgentAdapter.ts
    InMemoryAgentAdapter.ts
```

Likely adjacent integration points:

- `AgentDependencyComposer` for model tool registration;
- `ReactLoopRunner` and `InstructionRunner` for safe-point delivery and parent state;
- `ToolManager` and process execution for cancellation propagation;
- `AgentLifecycleRunner` for ordered shutdown;
- `AgentUIRuntime`, task activity UI, and output event types;
- session manager/types for session-owned persistence;
- permission and hook runtimes;
- RPC/ACP protocol types;
- `AgentDelegator`, `SubAgent`, and `TeamManager` compatibility adapters; and
- `src/testing` real terminal scenarios.

The implementation plan must keep commits and test slices aligned with these module
boundaries. It must not land a model-facing tool before lifecycle, policy, persistence,
and cancellation behavior behind that tool are testable.

## Review checklist

Before changing this document to **Approved, ready for implementation planning**:

- [ ] Product approves the tool names and foreground/background contract.
- [ ] Product approves brokered same-tree messaging as “direct communication.”
- [ ] Product approves worktree-by-default for canonical write-capable runs.
- [ ] Security approves capability inheritance, approval routing, environment allowlist,
  persistence permissions, and content handling.
- [ ] CLI/TUI owners approve `/runs`, background notifications, and approval UX.
- [ ] Provider/runtime owners approve cancellation, usage, and structured-result
  contracts.
- [ ] Teams owner approves migration behind the runtime without changing team UX.
- [ ] Release owner approves default-off rollout and separate live-provider evidence.
