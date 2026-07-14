# Plan 003: Propagate command-mode failure to lifecycle state and process exit

> **Executor instructions**: Execute test-first and run each gate. Stop on a STOP condition. Update `plans/README.md` when complete unless directed otherwise.
>
> **Drift check (run first)**: `git diff --stat 292a304..HEAD -- src/core/agent/InstructionRunner.ts src/core/agent/AgentLifecycleRunner.ts src/core/agent.ts src/index.ts tests/core/agent/InstructionRunner.command-mode.test.ts tests/core/agent/AgentLifecycleRunner.command-mode.test.ts tests/tuistory/built-cli.tuistory.test.ts`

## Status

- **Status**: DONE (verified 2026-07-14)
- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/002-typed-tool-outcomes.md`
- **Category**: bug
- **Planned at**: commit `292a304`, 2026-07-11

## Why this matters

`InstructionRunner` already reports failure, but command-mode orchestration discards it, announces task completion, may auto-commit, records completed telemetry, and exits zero. Shell scripts, CI jobs, users, and patch mode therefore cannot distinguish a completed turn from an aborted or failed one. The existing boolean should be propagated without changing RPC mode, ACP, or the SDK child process contract.

## Baseline state at planned commit

- `src/core/agent/InstructionRunner.ts` returns `Promise<boolean>` and `false` for abort/unrecovered errors. `tests/core/agent/InstructionRunner.command-mode.test.ts:169-185` already proves a provider failure returns false.
- `src/core/agent/AgentLifecycleRunner.ts:364-420` ignores that value:

  ```ts
  export async function runAgentCommandMode(...): Promise<void> {
    // ...
    await host.runInstruction(instruction);
    // stop hook, bell, task_complete notification, auto-commit
    await host.hookManager.executeHooks('session-end', {
      sessionEndReason: 'exit',
    });
    await host.telemetryManager.endSession('completed');
  }
  ```

- `src/core/agent.ts:489-490` exposes `runCommandMode` as `Promise<void>`.
- `src/index.ts:1451-1455` always calls `process.exit(0)` after `--prompt`.
- Patch mode at `src/index.ts:1969-1981` also ignores the command result and can continue to patch publication logic.
- RPC uses `--mode rpc`, not `--prompt`; a failed RPC turn must not terminate the SDK subprocess. SDK prompt requests are acknowledged immediately and finish through events.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Runner | `bun run test tests/core/agent/InstructionRunner.command-mode.test.ts tests/core/agent/AgentLifecycleRunner.command-mode.test.ts` | exit 0 |
| Entry behavior | `bun run test tests/index.pipeHandoffOrder.spec.ts tests/core/agent.exit-handling.spec.ts` | exit 0 |
| Built CLI | `bun run build && bun run test:tuistory` | exit 0, failure exit regression passes |
| Lint | `bun run lint` | exit 0 |
| Proof | `bun run proof` | exit 0 |

## Scope

**In scope**:

- `src/core/agent/AgentLifecycleRunner.ts`
- `src/core/agent.ts`
- `src/index.ts`
- `tests/core/agent/AgentLifecycleRunner.command-mode.test.ts` (create if absent)
- `tests/core/agent/InstructionRunner.command-mode.test.ts`
- `tests/tuistory/built-cli.tuistory.test.ts`
- A small exported entrypoint helper/test seam in `src/index.ts` only if required to avoid mocking `process.exit` globally.

**Out of scope**:

- Changing `InstructionRunner`'s boolean contract to a public SDK result type.
- Terminating the JSON-RPC or ACP process after one failed turn.
- Renaming session-end hook reasons beyond existing supported values.
- Changing interactive-mode exit behavior except where an explicit fatal `process.exitCode=1` is currently overwritten by unconditional zero; if that is inseparable, add a focused test and preserve successful interactive exit.
- Auto-mode semantics, patch content format, notifications, or telemetry schema.

## Git workflow

- Branch: `advisor/003-truthful-command-exit`
- Commit title: `Propagate failed command turns to process status`
- Append `Co-authored-by: Autohand Evolve <code-noreply@autohand.ai>`.
- Do not push unless instructed.

## Steps

### Step 1: Add failing lifecycle outcome tests

Create a focused host fixture for `runAgentCommandMode`. For a `runInstruction` result of false, assert:

- the function returns false;
- the stop hook still runs with the existing context;
- completion bell/notification do not run;
- auto-commit does not run;
- session-end uses the existing error/crash reason accepted by hook types;
- telemetry ends as failed/crashed using its current vocabulary;
- cleanup restores command-mode and renderer state.

For true, assert current success behavior remains: notification, optional auto-commit, `session-end: exit`, and completed telemetry.

**Verify**: `bun run test tests/core/agent/AgentLifecycleRunner.command-mode.test.ts` fails only on the new false-path expectations.

### Step 2: Propagate the boolean through the public CLI surface

Change `runAgentCommandMode` and `AutohandAgent.runCommandMode` to `Promise<boolean>`. Capture `host.runInstruction` once and drive all success-only side effects from it. Keep stop-hook execution for both outcomes; await session-end/telemetry consistently.

Do not infer command failure from terminal text. Use the existing boolean produced by `InstructionRunner` after Plan 002's truthful outcomes.

**Verify**: `bun run test tests/core/agent/InstructionRunner.command-mode.test.ts tests/core/agent/AgentLifecycleRunner.command-mode.test.ts` exits 0.

### Step 3: Make prompt and patch entrypoints exit truthfully

At the `--prompt` branch, exit 0 only on true and 1 on false. Prefer setting/returning an exit code through a testable helper before the final process exit. Do not allow an unconditional `process.exit(0)` to overwrite a prior non-zero `process.exitCode`.

In patch mode, a false result must not publish a partial patch, print success, or auto-commit. Exit 1 after orderly cleanup.

Do not apply this behavior to `--mode rpc` or ACP.

**Verify**: focused entrypoint tests assert success 0 and failure 1 for prompt and patch paths.

### Step 4: Add a deterministic built-CLI regression

Use the existing Tuistory mock-provider helpers. Configure retry limit zero and a deterministic provider failure. Launch the built CLI with `--prompt`, wait for exit, and assert non-zero status and no completion success signal. Add or retain a successful prompt case that exits zero.

This is a command/startup terminal behavior, so Tuistory proof is mandatory.

**Verify**: `bun run build && bun run test:tuistory` exits 0.

### Step 5: Run compatibility and full gates

Run RPC/ACP tests to prove the child remains alive after turn failures, then full validation.

**Verify**:

```sh
bun run test tests/modes/rpc/handlers.spec.ts tests/modes/acp/adapter.test.ts
bun run test
bun run lint
bun run proof
```

All commands exit 0.

## Test plan

- Unit: true and false lifecycle side effects, hook reason, telemetry status, restoration in `finally`.
- Entry: prompt and patch return/exit codes and no false success publication.
- Tuistory: built prompt failure is non-zero; built success is zero.
- Regression: RPC and ACP do not exit their long-lived process after a failed instruction.

## Done criteria

- [x] `runInstruction(false)` reaches `runCommandMode(false)` and exit 1.
- [x] Failed/aborted command turns do not notify completion or auto-commit.
- [x] Stop/session-end hooks and telemetry describe the real outcome with existing vocabulary.
- [x] Patch mode never publishes partial output after a failed turn.
- [x] RPC/ACP remain long-lived and wire-compatible.
- [x] Built Tuistory proves both exit statuses.
- [x] Tests, lint, and proof pass; index updated.

## STOP conditions

Stop and report if:

- Any prompt caller still exits zero after a false result.
- Auto-commit or task-complete notification runs after failure.
- Hook or telemetry reports completed after failure.
- Patch output is published after a failed turn.
- A proposed change would make RPC prompt handling synchronous or terminate RPC/ACP.
- SDK/ACP compilation breaks due to an unnecessarily widened public type.
- An out-of-scope file or new dependency is required.

## Maintenance notes

- Future command-mode side effects belong behind the same success condition.
- Keep orderly cleanup awaited before process exit; Plan 004 strengthens cancellation and Plan 008 gates this in the built artifact.
