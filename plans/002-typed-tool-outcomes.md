# Plan 002: Make tool failures typed and truthful across CLI, RPC, and ACP

> **Executor instructions**: Follow this plan step by step, tests first. Run every verification command before continuing. Stop and report on any STOP condition. Update `plans/README.md` when complete unless a reviewer owns the index.
>
> **Drift check (run first)**: `git diff --stat 292a304..HEAD -- src/types.ts src/core/toolManager.ts src/core/actionExecutor.ts src/core/agent/AgentDependencyComposer.ts src/core/agent/ReactLoopRunner.ts src/modes/rpc/adapter.ts src/modes/rpc/types.ts src/modes/acp/adapter.ts tests/toolManager.spec.ts tests/actionExecutor-validation.spec.ts tests/actionExecutor.spec.ts tests/rpcHooks.spec.ts tests/modes/rpc/handlers.spec.ts tests/modes/acp/adapter.test.ts`
>
> Compare changed files with the excerpts below. Semantic drift is a STOP condition.

## Status

- **Status**: DONE (verified 2026-07-14)
- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: `plans/001-fail-closed-tool-authorization.md`
- **Category**: bug
- **Planned at**: commit `292a304`, 2026-07-11

## Why this matters

The runtime currently treats every resolved executor string as success, even when the string says `Error:`, `Blocked:`, `Denied:`, or represents a non-zero command. As a result, telemetry, post-tool hooks, RPC `toolEnd`, ACP tool status, and the model can receive contradictory success state. A discriminated internal outcome must carry failure kind and readable output without parsing English strings or changing the SDK's existing wire fields.

## Baseline state at planned commit

- `src/types.ts:1378-1383` permits contradictory optional fields:

  ```ts
  export interface ToolExecutionResult {
    tool: AgentAction['type'];
    success: boolean;
    output?: string;
    error?: string;
  }
  ```

- `src/core/toolManager.ts:89-91` defines the executor as `Promise<string | undefined>`.
- `src/core/actionExecutor.ts:902-1022` returns error-looking strings for missing commands and spawn failures; `run_command` ignores a non-zero `result.code` in its final outcome. Similar validation/operational strings exist across the switch.
- `src/core/agent/AgentDependencyComposer.ts` records any resolved string as successful in post-tool hooks, telemetry, and output events; thrown exceptions are the only false path.
- RPC and ACP already have compatible boolean fields. RPC SDK `tool_end` is `{toolId, toolName, success, output?, error?, timestamp}`. ACP already maps explicit false to `failed`.
- The external SDK maps `autohand.toolEnd` directly in `src/rpc/client.ts:605-610`; no new wire event or renamed field is needed.

### Required target shape

Introduce a discriminated runtime executor result, for example:

```ts
type ToolActionOutcome =
  | { success: true; output?: string }
  | {
      success: false;
      kind: 'authorization' | 'validation' | 'command' | 'aborted' | 'operational';
      error: string;
      output?: string;
      exitCode?: number | null;
    };
```

Names may follow repo conventions, but `success` must discriminate the union, failure must require `kind` and `error`, and success must not carry an error. Extend `ToolExecutionResult` with the same safe semantics and optional machine-readable failure metadata without removing current wire-compatible fields.

Preserve the broad direct `ActionExecutor.execute(): Promise<string | undefined>` contract. Add a runtime-facing `executeForTool()` (or equivalently named adapter) that produces `ToolActionOutcome`. Do not force every direct test/caller to migrate in this plan, and never classify a returned string by prefix or localized wording.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Tool manager | `bun run test tests/toolManager.spec.ts` | exit 0 |
| Executor | `bun run test tests/actionExecutor-validation.spec.ts tests/actionExecutor.spec.ts tests/actionExecutorLiveOutput.spec.ts tests/command.spec.ts` | exit 0 |
| Agent bridge | `bun run test tests/core/agent/ToolLoopSignature.test.ts tests/rpcHooks.spec.ts` | exit 0 |
| RPC/ACP | `bun run test tests/modes/rpc/handlers.spec.ts tests/modes/rpc/types.spec.ts tests/modes/acp/adapter.test.ts` | exit 0 |
| Typecheck | `bun run typecheck` | exit 0 |
| Lint | `bun run lint` | exit 0 |
| Proof | `bun run proof` | exit 0 |

## Suggested executor toolkit

- Use `typescript-best-practices` for discriminated unions, exhaustive switches, and `unknown` error normalization.
- Read the SDK tool event types in `/Users/igorcosta/Documents/autohand/agentsdk/tin-wrapper/typescript/src/types/index.ts` before changing RPC output; do not edit the SDK.

## Scope

**In scope**:

- `src/types.ts`
- `src/core/toolManager.ts`
- `src/core/actionExecutor.ts`
- `src/core/agent/AgentDependencyComposer.ts`
- `src/core/agent/ReactLoopRunner.ts`
- `src/modes/rpc/adapter.ts` and `src/modes/rpc/types.ts`
- `src/modes/acp/adapter.ts`
- Nested delegate/subagent executor seams only if a failing test proves they return false success.
- Tests named in the command table; a new focused outcome test is allowed under `tests/core/agent/`.

**Out of scope**:

- Changing model-visible successful output text or removing direct `ActionExecutor.execute()`.
- Renaming JSON-RPC/ACP methods, notifications, fields, or SDK event types.
- Adding a second RPC response after prompt acknowledgement.
- Treating a tool failure as necessarily fatal to the entire ReAct turn; the model may recover.
- Cancellation mechanics beyond defining the `aborted` kind; Plan 004 propagates signals.
- New dependencies.

## Git workflow

- Branch: `advisor/002-typed-tool-outcomes`
- Commit title: `Carry typed tool failures across runtime boundaries`
- Explain the direct-call compatibility adapter and wire-contract preservation in the body.
- Append `Co-authored-by: Autohand Evolve <code-noreply@autohand.ai>`.
- Do not push unless instructed.

## Steps

### Step 1: Write failing normalization and bridge tests

Add tests that make a fake executor resolve a typed failure rather than throw. Assert `ToolManager` returns `success:false`, preserves `kind/error/output/exitCode`, and calls `onToolComplete` exactly once.

Add bridge tests proving the same outcome produces:

- post-tool hook `success:false` with readable output;
- telemetry failure, not success;
- `AgentOutputEvent.toolSuccess === false` explicitly;
- RPC `toolEnd.success === false` plus `error` and retained optional `output`;
- ACP tool status `failed`.

Also prove successful empty output remains success.

**Verify**: `bun run test tests/toolManager.spec.ts tests/rpcHooks.spec.ts tests/modes/acp/adapter.test.ts` fails only on the new assertions.

### Step 2: Define the discriminated runtime types

Add the union and exhaustive helper(s) in `src/types.ts` or the narrowest existing shared type module. Make impossible states unrepresentable: a success outcome cannot carry failure metadata, and a failure requires a non-empty error. Update `ToolManagerOptions.executor` and the Plan 001 authorization outcome to use it.

Keep `ToolExecutionResult` compatible with consumers that read `success/output/error`. Additive `kind`/`exitCode` is permitted internally and on CLI types; do not add required SDK wire fields.

**Verify**: `bun run typecheck` reports only expected unmigrated executor errors; after the immediate mechanical caller updates it exits 0.

### Step 3: Add `ActionExecutor`'s runtime adapter test-first

Add `executeForTool(action, context)` while preserving `execute(action, context)` for direct callers. Migrate validation, authorization, command, and operational branches without string-prefix parsing. At minimum cover:

- missing/invalid required arguments;
- Plan 001 permission/hook denial;
- ENOENT/spawn error;
- non-zero foreground `run_command` and interactive command;
- streaming `shell` result with `success:false`;
- failed meta-tool, review, delegation, MCP, and dependency operations when their APIs expose failure;
- thrown unknown exceptions normalized as `operational` failure.

Keep existing human-readable strings as `error` or `output` so the model and terminal remain understandable. Use explicit branch knowledge or a typed lower-layer result, never text classification.

**Verify**: `bun run test tests/actionExecutor-validation.spec.ts tests/actionExecutor.spec.ts tests/actionExecutorLiveOutput.spec.ts tests/command.spec.ts` exits 0 with new outcome cases passing.

### Step 4: Make `ToolManager` preserve outcomes

Update scheduling/concurrency code so both resolved failure outcomes and thrown exceptions become one `ToolExecutionResult`, ordering remains stable, and callbacks fire once. A thrown exception becomes `kind:'operational'`; Plan 004 will distinguish abort exceptions.

Do not change safe parallelism barriers. Authorization denials from Plan 001 must remain pre-execution failures and must not become successful skipped output.

**Verify**: `bun run test tests/toolManager.spec.ts` exits 0, including batch ordering and callback tests.

### Step 5: Make all lifecycle consumers truthful

In `AgentDependencyComposer`, drive post-tool hooks, telemetry, `tool_end`, and file/tool accounting from the typed outcome. Always include explicit `toolSuccess`; include `toolError` or the existing equivalent on failure. Ensure the stable tool ID is reused.

In `ReactLoopRunner`, keep adding one tool message per call in model order. Use output for success and error/output for failure, without losing failure metadata before events are emitted.

Update RPC adapter mapping so it does not default an absent status to true on runtime-generated events. Populate the already-supported optional `error`. Update ACP mapping to `failed` on explicit failure and retain existing content.

**Verify**: `bun run test tests/core/agent/ToolLoopSignature.test.ts tests/rpcHooks.spec.ts tests/modes/rpc/handlers.spec.ts tests/modes/acp/adapter.test.ts` exits 0.

### Step 6: Run compatibility and full gates

Run the CLI gates, then the read-only SDK consumer gate.

**Verify**:

```sh
bun run test
bun run lint
bun run proof
cd /Users/igorcosta/Documents/autohand/agentsdk/tin-wrapper/typescript
bun test src/__tests__/rpc-client.test.ts src/__tests__/agent-api.test.ts
bun run typecheck
bun run build
```

Every command exits 0.

## Test plan

- Cover each failure kind and success with/without output.
- Cover resolved failures, thrown failures, batch ordering, callback count, and no contradictory fields.
- Cover non-zero commands separately from spawn errors.
- Cover authorization denial, including no execution side effect.
- Assert exact RPC/ACP booleans and error fields; keep event names unchanged.
- Assert EventHooks still receive `HOOK_SUCCESS`/`tool_success` and readable output.

## Done criteria

- [x] Runtime executor outcomes form a discriminated union.
- [x] No runtime failure classification uses `startsWith`, regex, or localized error text.
- [x] Non-zero commands, validation errors, denials, abort placeholders, and operational errors are false.
- [x] Post-tool hooks, telemetry, RPC, and ACP all receive the same truthful status.
- [x] Direct `ActionExecutor.execute()` callers retain compatible behavior.
- [x] SDK `tool_end` mapping tests pass unchanged.
- [x] Full CLI test, lint, and proof gates pass.
- [x] The typed-outcome slice remained in scope; the integrated delivery and plan index include the other approved plans and queue items.

## STOP conditions

Stop and report if:

- Any typed failure is still recorded as hook/telemetry/RPC/ACP success.
- A non-zero foreground command remains successful.
- Correctness appears to require parsing English/localized strings.
- The SDK would need a renamed or required new wire field.
- Direct executor consumers break and cannot be preserved with an internal adapter.
- An out-of-scope change or a new dependency is required.
- A verification command fails twice after a focused correction.

## Maintenance notes

- New tools must return an explicit outcome from the runtime adapter; reviewers should reject error-looking success strings.
- Keep the union exhaustive when Plan 004 adds real abort propagation.
- The ReAct loop may continue after ordinary tool failure, but it must not continue after cancellation.
