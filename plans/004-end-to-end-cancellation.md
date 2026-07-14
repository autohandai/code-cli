# Plan 004: Carry cancellation through RPC, the ReAct loop, tools, and child processes

> **Executor instructions**: Follow the plan test-first. Run every verification gate. Stop and report rather than broadening scope when a STOP condition occurs. Update `plans/README.md` on completion unless a reviewer owns it.
>
> **Drift check (run first)**: `git diff --stat 292a304..HEAD -- src/types.ts src/core/agent.ts src/core/agent/InstructionRunner.ts src/core/agent/ReactLoopRunner.ts src/core/toolManager.ts src/core/actionExecutor.ts src/core/agent/AgentDependencyComposer.ts src/actions/command.ts src/ui/shellCommand.ts src/core/HookManager.ts src/modes/rpc/adapter.ts src/modes/acp/adapter.ts src/actions/web.ts src/mcp/McpClientManager.ts tests/toolManager.spec.ts tests/command.spec.ts tests/ui/shellCommand.test.ts tests/hookManager.spec.ts tests/modes/rpc/handlers.spec.ts tests/modes/acp/adapter.test.ts`

## Status

- **Status**: DONE (verified 2026-07-14)
- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: `plans/002-typed-tool-outcomes.md`
- **Category**: bug
- **Planned at**: commit `292a304`, 2026-07-11

## Why this matters

RPC abort currently cancels only an adapter-local controller, marks the session idle immediately, and emits terminal notifications while the agent and its tools may keep running. The stale turn can later emit a second terminal sequence or mutate files after cancellation, while a new prompt is accepted concurrently. Cancellation must have one owner, propagate through every foreground operation, quiesce before idle, and remain compatible with the SDK's `autohand.abort` result and ACP's `cancelled` stop reason.

## Baseline state at planned commit

- `src/core/agent/InstructionRunner.ts:232-285` owns an instruction `AbortController`; cancellation returns false when its signal is aborted.
- `src/core/agent/ReactLoopRunner.ts:408-417` passes the signal to the LLM, but `toolManager.execute` at lines 724-731 receives no signal.
- After an abort breaks the iteration loop, `ReactLoopRunner.ts:932-945` enters the iteration-exhaustion summary path, which can make another model call. Abort must return without that summary.
- `src/types.ts:1385-1390` has no signal in `ToolExecutionContext`.
- `src/actions/command.ts:21-38` and `src/ui/shellCommand.ts` do not accept an `AbortSignal`; foreground children continue.
- `src/modes/rpc/adapter.ts:752-805` clears permissions and aborts only its local controller, sets idle, emits `messageEnd`/`turnEnd`, and clears IDs immediately. It never calls `agent.cancelCurrentInstruction()`.
- `src/core/agent.ts:1388-1394` already exposes `cancelCurrentInstruction()`; ACP calls it and tests lock `stopReason:'cancelled'`.
- The SDK contract is fixed: request `autohand.abort` with `{}`, result `{success:boolean}`, terminal completion through existing message/turn events.

### Required ownership model

- One active prompt record owns its controller, IDs, finalizer, and terminal-event guard.
- RPC/ACP pass an optional external signal into `runInstruction`; `InstructionRunner` links it to its internal controller and always removes listeners.
- `handleAbort` denies pending permissions, calls `agent.cancelCurrentInstruction()`, aborts the prompt signal, and marks a truthful `cancelling`/processing state. It does not clear IDs or emit a duplicate terminal sequence independently of the active prompt finalizer.
- The active prompt finalizer emits exactly one `messageEnd` then `turnEnd`, then changes state to idle.
- A second prompt remains busy until the first run and its foreground work actually settle.
- Detached `background:true` jobs already started remain detached by explicit policy. Abort prevents queued/not-yet-started background tools but does not pretend to terminate detached work.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| RPC/ACP | `bun run test tests/modes/rpc/handlers.spec.ts tests/modes/rpc/protocol.spec.ts tests/modes/acp/adapter.test.ts` | exit 0 |
| Instruction/loop | `bun run test tests/core/agent/InstructionRunner.command-mode.test.ts tests/core/agent/ToolLoopSignature.test.ts` | exit 0 |
| Scheduling | `bun run test tests/toolManager.spec.ts` | exit 0 |
| Children/hooks | `bun run test tests/command.spec.ts tests/ui/shellCommand.test.ts tests/hookManager.spec.ts` | exit 0 |
| Network/MCP | Run the existing focused suites containing `McpClientManager` and web action tests found by `rg -l "McpClientManager|fetch_url" tests` | exit 0 |
| Lint | `bun run lint` | exit 0 |
| Proof | `bun run proof` | exit 0 |

## Suggested executor toolkit

- Use `typescript-best-practices` for signal listener cleanup and typed abort errors.
- Preserve `buildAutohandChildProcessEnv`; do not rebuild child environments manually.
- Use the SDK abort tests as a read-only consumer contract.

## Scope

**In scope**:

- `src/types.ts`
- `src/core/agent.ts`
- `src/core/agent/InstructionRunner.ts`
- `src/core/agent/ReactLoopRunner.ts`
- `src/core/toolManager.ts`
- `src/core/actionExecutor.ts`
- `src/core/agent/AgentDependencyComposer.ts`
- `src/actions/command.ts`
- `src/ui/shellCommand.ts`
- `src/core/HookManager.ts`
- `src/modes/rpc/adapter.ts`
- `src/modes/acp/adapter.ts`
- `src/actions/web.ts` and `src/mcp/McpClientManager.ts` only for foreground signal forwarding where existing request APIs support it.
- Focused tests adjacent to these modules.

**Out of scope**:

- Killing already-detached background jobs or inventing a process registry.
- Renaming `autohand.abort`, changing its params/result, or making prompt acknowledgement wait for the turn.
- Adding terminal reason values unsupported by SDK types.
- Replacing EventHooks, MCP transports, child process libraries, or providers.
- Retrofitting cancellation into unrelated scheduled/daemon jobs.
- New dependencies.

## Git workflow

- Branch: `advisor/004-end-to-end-cancellation`
- Commit title: `Propagate cancellation through active foreground work`
- Body must state detached-background semantics and exactly-once RPC finalization.
- Append `Co-authored-by: Autohand Evolve <code-noreply@autohand.ai>`.
- Do not push unless instructed.

## Steps

### Step 1: Reproduce the RPC race and exactly-once requirement

Add a slow fake `agent.runInstruction` in `tests/modes/rpc/handlers.spec.ts`. Start a prompt, abort while it is in flight, and assert:

- `cancelCurrentInstruction()` is called once;
- pending permissions resolve `deny_once`;
- state does not become idle before the old promise settles;
- a second prompt is rejected/busy until settlement;
- one and only one `messageEnd` and `turnEnd` are emitted in that order;
- the abort result remains `{success:true}` when active and false when nothing is active;
- after settlement state becomes idle and a new prompt can start.

Do not weaken the test by filtering duplicate events after the fact.

**Verify**: `bun run test tests/modes/rpc/handlers.spec.ts` fails only on the new race assertions.

### Step 2: Link external and instruction signals

Add an optional `{signal?: AbortSignal}` argument to `runInstruction`/`InstructionRunner.run` without breaking current one-argument callers. Link an external signal to the internal controller, handle an already-aborted signal synchronously, and remove listeners in `finally`.

Pass the RPC active-prompt signal and ACP session signal. Keep ACP's call to `cancelCurrentInstruction()` and `stopReason:'cancelled'`.

**Verify**: add tests for already-aborted, in-flight abort, and listener cleanup; then run `bun run test tests/core/agent/InstructionRunner.command-mode.test.ts tests/modes/acp/adapter.test.ts`.

### Step 3: Give ToolManager cancellation-aware scheduling

Add `signal?: AbortSignal` to `ToolExecutionContext` and `ToolManager.execute`. Check it:

- before authorization and any prompt;
- after awaited authorization/approval;
- before adding a task to the ready queue;
- before each parallel/sequential execution starts;
- after each awaited executor result.

Not-yet-started calls return Plan 002's typed `aborted` failure and invoke completion once. Stop scheduling new work after abort. Await already-started foreground executors so the turn does not report idle while they run.

Pass the signal from `ReactLoopRunner`. When abort is detected after/between tools, return from the loop; never enter the max-iteration summary call.

**Verify**: `bun run test tests/toolManager.spec.ts tests/core/agent/ToolLoopSignature.test.ts` exits 0 with new pre-abort/mid-batch tests.

### Step 4: Abort foreground commands and PTYs

Add `signal?: AbortSignal` to `RunCommandOptions` and streaming shell options. For non-detached children:

- handle already-aborted signals before spawn;
- on abort send `SIGTERM`, then use the existing bounded forced-kill convention if needed;
- dispose signal listeners and timeouts on close/error;
- resolve/reject exactly once with a typed abort distinguishable by `ActionExecutor`;
- preserve captured stdout/stderr and `buildAutohandChildProcessEnv`.

For PTY, call the supported kill method and dispose data/exit handlers. For `background:true`, document and test that a spawned detached child is not killed, while an already-aborted signal prevents spawning.

**Verify**: `bun run test tests/command.spec.ts tests/ui/shellCommand.test.ts tests/actionExecutor.spec.ts` exits 0; tests prove a slow foreground child is no longer alive after abort.

### Step 5: Propagate through hooks, web, and MCP

Pass the active signal into synchronous foreground pre/post/permission hooks and terminate hook children on abort while retaining timeout and exit-code-2 semantics. Async observational hooks may keep their current detached semantics only if explicitly tested/documented; they must not block prompt quiescence or make authorization decisions.

Combine the active signal with existing timeout controllers in web actions and MCP HTTP requests using a small local helper or `AbortSignal.any` if the supported Node runtime guarantees it. For MCP stdio calls, use the transport's cancellation facility if available. Do not replace timeouts with cancellation; both must work. Clean every listener/timer.

If a specific MCP transport cannot cancel an in-flight call, stop and report that bounded exception rather than claiming full cancellation.

**Verify**: run the focused HookManager, web, and MCP suites with slow-operation abort cases; all exit 0 and no operation continues after the test's abort deadline.

### Step 6: Give RPC one terminal finalizer

Refactor the adapter's active prompt state so `handleAbort` requests cancellation but the active run owns cleanup and terminal emission. Guard finalization by prompt identity/token so a stale promise cannot clear a newer prompt. Preserve `messageEnd` then `turnEnd`; additive `aborted` metadata may remain optional, but do not emit a new `agentEnd` before `turnEnd` because the SDK stops its stream there.

Keep immediate prompt acknowledgement. Keep status truthful until all foreground work settles.

**Verify**: `bun run test tests/modes/rpc/handlers.spec.ts tests/modes/rpc/protocol.spec.ts tests/modes/rpc/types.spec.ts` exits 0.

### Step 7: Run ACP, SDK, and full gates

**Verify**:

```sh
bun run test tests/modes/acp/adapter.test.ts tests/modes/acp/permissions.test.ts
bun run test
bun run lint
bun run proof
cd /Users/igorcosta/Documents/autohand/agentsdk/tin-wrapper/typescript
bun test src/__tests__/rpc-client.test.ts src/__tests__/agent-api.test.ts
bun run typecheck
bun run build
```

All commands exit 0.

## Test plan

- RPC: active/no-active abort, busy until quiescent, exactly-once terminal sequence, stale finalizer isolation.
- ACP: in-flight cancellation keeps `cancelled` and calls the agent.
- Instruction: already aborted, linked abort, cleanup/no leaked listener.
- ToolManager: abort before approval, during approval, between batch tasks, during foreground executor.
- Child processes: normal, interactive, PTY, non-PTY, timeout plus abort, detached policy.
- Hooks/web/MCP: bounded slow operation stops and timers/listeners clean up.
- ReAct: no post-abort exhaustion summary/model request.

## Done criteria

- [x] RPC abort reaches the instruction's active controller.
- [x] State remains non-idle and new prompts remain busy until quiescence.
- [x] Exactly one message/turn terminal sequence is emitted.
- [x] No additional model summary call occurs after abort.
- [x] Not-yet-started tools are typed aborted; foreground commands/hooks/web/MCP stop.
- [x] Detached background semantics are explicit and tested.
- [x] ACP and SDK abort contracts remain unchanged.
- [x] Signal listeners/timers are disposed.
- [x] Tests, lint, proof, and SDK gates pass; index updated.

## STOP conditions

Stop and report if:

- A second prompt is accepted before the prior run settles.
- Duplicate terminal notifications remain possible.
- A foreground child/network/MCP/hook operation continues after abort.
- A transport has no cancellable or bounded termination seam; report it explicitly.
- Signal listeners or timers leak in tests.
- ACP no longer returns `cancelled`, or SDK abort/result/event tests regress.
- Correctness requires a new SDK terminal reason or synchronous prompt response.
- Any gate fails twice after a focused correction.

## Maintenance notes

- Every new foreground tool must accept the instruction signal; detached/background behavior must be explicit.
- Reviewers should inspect race ownership and cleanup more than error wording.
- Shutdown/session-resource ownership was tracked separately and completed in the integrated post-plan delivery; this plan's slice covers active-turn cancellation.
