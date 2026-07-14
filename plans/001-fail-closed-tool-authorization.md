# Plan 001: Enforce one fail-closed tool authorization preflight

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. Write the failing tests before production code. If a STOP condition occurs, stop and report; do not improvise. When done, update this plan's row in `plans/README.md` unless a reviewer owns the index.
>
> **Drift check (run first)**: `git diff --stat 292a304..HEAD -- src/core/toolManager.ts src/core/actionExecutor.ts src/core/agent/AgentDependencyComposer.ts src/core/agent/AgentCommandRuntime.ts src/permissions/PermissionManager.ts src/permissions/types.ts src/types.ts tests/toolManager.spec.ts tests/integration/securityIntegration.spec.ts tests/security/securityBlacklist.spec.ts tests/hookManager.spec.ts tests/rpcHooks.spec.ts tests/modes/acp/permissions.test.ts`
>
> If any in-scope file changed, compare the live implementation with the excerpts below. A semantic mismatch is a STOP condition.

## Status

- **Status**: DONE (verified 2026-07-14)
- **Priority**: P0
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `292a304`, 2026-07-11

## Why this matters

Tool availability, prompting, permission policy, immutable blacklist checks, and pre-tool hooks currently run at different layers. That permits real execution paths to bypass the `PermissionManager`, lets `--yes`/unrestricted paths approve before the immutable blacklist is consulted, ignores pre-tool hook decisions, and only protects new `write_file` targets inside `ActionExecutor`. One canonical preflight must decide every tool call before a hook-visible tool start or side effect occurs, and any exception or malformed decision must fail closed.

## Baseline state at planned commit

- `src/permissions/PermissionManager.ts:265-334` owns the policy order. The security blacklist is deliberately first, ahead of patterns, session decisions, modes, and the default prompt decision:

  ```ts
  checkPermission(context: PermissionContext): PermissionDecision {
    if (this.isSecurityBlacklisted(context)) {
      return { allowed: false, reason: 'blacklisted' };
    }
    // ...patterns, caches, modes and scoped lists...
    return { allowed: false, reason: 'default' };
  }
  ```

- `src/core/toolManager.ts:1770-1885` currently checks `ToolFilter`, plan mode, registration, and `requiresApproval`, but never calls `PermissionManager`. It then schedules the action.
- `src/core/agent/AgentCommandRuntime.ts:225-239` returns `allow_once` for YOLO, `--yes`, unrestricted, or auto-confirm before any immutable-blacklist check at that layer.
- `src/core/actionExecutor.ts:546-635` calls `PermissionManager` only for a new `write_file`; existing writes proceed directly. `append_file`, `apply_patch`, and `notebook_edit` also proceed without that check.
- `src/core/agent/AgentDependencyComposer.ts:628-647` executes `pre-tool` hooks but discards all returned `HookExecutionResult` values and immediately emits `tool_start`.
- The existing hook contract in `src/types.ts:682-696` already supports `decision: 'allow' | 'deny' | 'ask' | 'block'`, `continue`, `stopReason`, `updatedInput`, and `additionalContext`. Do not invent replacement vocabulary.
- `src/core/HookManager.ts:761-789` treats exit code 2 as blocking and parses JSON responses on exit 0. `executeHooks` returns those results.
- Existing security tests call `PermissionManager.checkPermission` directly. They do not prove the real path `ToolManager -> AgentDependencyComposer executor -> ActionExecutor` is blocked.

### Required authorization order

For each tool call, the canonical preflight must perform this order:

1. Reject unavailable, unknown, or plan-mode-forbidden tools.
2. Build a `PermissionContext` from the tool and its real command/path/args.
3. Call `PermissionManager.checkPermission`; immutable blacklist and explicit policy denial are terminal and cannot be overridden by hooks, `--yes`, YOLO, unrestricted mode, RPC, or ACP.
4. Execute synchronous `pre-tool` hooks before any `tool_start` event or side effect. Honor exit-code-2 blocking, `deny`, `block`, `continue:false`, `ask`, and `updatedInput`.
5. If a hook updates input, preserve the original tool type, validate the updated object, rebuild the permission context, and run policy checks again so mutation cannot introduce a blacklisted command/path.
6. Prompt only when the policy/hook says prompting is required. Normalize and persist the existing scoped `PermissionPromptResult` via `PermissionManager.applyPromptDecision`.
7. If the user supplies `alternative`, mutate only the supported command/path field, then rebuild and recheck policy before execution.
8. Mark authorization handled in `ToolExecutionContext` so `ActionExecutor` defense-in-depth checks do not double-prompt.
9. Only then emit `tool_start` and execute the action.

For safe tools whose definition does not require approval, a `PermissionManager` result with reason `default` may continue without a prompt; it is not an explicit denial. Exceptions, malformed hook output, unsupported `updatedInput`, and unknown policy reasons fail closed.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tool tests | `bun run test tests/toolManager.spec.ts tests/actionExecutor.spec.ts tests/actionExecutor-validation.spec.ts` | exit 0, all pass |
| Security integration | `bun run test tests/integration/securityIntegration.spec.ts tests/security/securityBlacklist.spec.ts tests/permissionManager.spec.ts` | exit 0, real execution regressions pass |
| Hooks/RPC/ACP | `bun run test tests/hookManager.spec.ts tests/rpcHooks.spec.ts tests/modes/acp/permissions.test.ts tests/modes/rpc/yoloMode.spec.ts` | exit 0, contracts unchanged |
| Typecheck | `bun run typecheck` | exit 0, no errors |
| Lint | `bun run lint` | exit 0 |
| Full proof | `bun run proof` | exit 0 |

## Suggested executor toolkit

- Use `typescript-best-practices` if available for the discriminated authorization result and exhaustive decision handling.
- Read `AGENTS.md` before editing.
- Use the SDK compatibility source only as read-only contract evidence; this plan must not modify `/Users/igorcosta/Documents/autohand/agentsdk/tin-wrapper/typescript`.

## Scope

**In scope** (the only production files to modify):

- `src/core/toolManager.ts` — canonical sequential preflight and stable tool execution context.
- `src/core/actionExecutor.ts` — honor `approvalHandled` and retain defense-in-depth for direct callers.
- `src/core/agent/AgentDependencyComposer.ts` — compose permission manager, EventHooks, confirmation, and execution without discarded decisions.
- `src/permissions/PermissionManager.ts` and `src/permissions/types.ts` — only if a small exported helper is required to distinguish explicit denial from prompt/default; preserve current public decision strings.
- `src/types.ts` — authorization/context types only.
- `src/core/agent/AgentCommandRuntime.ts` — only to ensure auto-confirm is invoked after immutable policy checks.

**In-scope tests**:

- `tests/toolManager.spec.ts`
- `tests/integration/securityIntegration.spec.ts`
- `tests/security/securityBlacklist.spec.ts`
- `tests/actionExecutor.spec.ts`
- `tests/hookManager.spec.ts`
- `tests/rpcHooks.spec.ts`
- `tests/modes/acp/permissions.test.ts`
- A new focused test under `tests/core/agent/` is allowed if composer integration cannot be tested clearly in an existing file.

**Out of scope**:

- Renaming RPC/ACP methods, notifications, hook events, or permission decisions.
- Changing SDK prompt acknowledgement or terminal event order.
- Broad permission-policy redesign, new permission modes, or new dependencies.
- Plan-mode semantics beyond ensuring its denial remains earlier than execution.
- Files in Plans 005-008.

## Git workflow

- Branch: `advisor/001-fail-closed-tool-authorization`
- Keep the failing tests and implementation in one reviewable logical commit after all gates pass.
- Commit title: `Enforce authorization before every tool side effect`
- Commit body must briefly describe the canonical order and compatibility coverage.
- Append `Co-authored-by: Autohand Evolve <code-noreply@autohand.ai>`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add failing real-path authorization tests

Extend `tests/toolManager.spec.ts` and `tests/integration/securityIntegration.spec.ts` so tests instantiate the real `ToolManager` execution path with a `PermissionManager` and a recording executor. Prove all of these fail before implementation:

- A blacklisted `run_command` is not executed under `--yes`, YOLO, unrestricted, RPC confirmation, or ACP full-access behavior.
- Existing `write_file`, `append_file`, `apply_patch`, `notebook_edit`, `delete_path`, `read_file`, `shell`, and meta-tool shell execution consult the canonical preflight.
- An explicit deny-list/pattern denial never calls the confirmation callback.
- A safe non-approval tool with only the `default` decision keeps existing no-prompt behavior.
- A thrown authorization callback produces `success:false` and no executor call.
- No `tool_start` event is emitted for a denied call.

Use harmless temp paths and recording functions; never run a destructive command in a test.

**Verify**: `bun run test tests/toolManager.spec.ts tests/integration/securityIntegration.spec.ts tests/security/securityBlacklist.spec.ts` must fail only on the new expectations.

### Step 2: Add failing EventHooks control-flow tests

Model hook process results after `tests/hookManager.spec.ts`. Add composer/preflight integration cases for:

- exit code 2 / `blockingError`;
- JSON `decision:'deny'` and `decision:'block'`;
- `continue:false` with `stopReason`;
- `decision:'ask'` invoking the existing confirmation callback;
- `updatedInput` changing a benign command to a blacklisted command and being denied on the second policy check;
- valid `updatedInput` reaching the executor while the action `type` cannot be changed;
- `additionalContext` retaining its existing hook meaning (do not silently discard it; route it through the existing conversation/context seam if one exists, otherwise STOP).

Lock the chosen event invariant: authorization denial emits no `tool_start`; any started tool must have exactly one matching `tool_end`.

**Verify**: `bun run test tests/hookManager.spec.ts tests/rpcHooks.spec.ts tests/toolManager.spec.ts` must fail only on the new integration cases.

### Step 3: Implement the canonical preflight

Add a strongly typed authorization option/result to `ToolManagerOptions`. Keep the preflight sequential even when later read-only executions run concurrently. Generate or preserve one stable tool-call ID before authorization and pass it through the hook context and actual executor.

Centralize action-to-`PermissionContext` mapping; cover command, args, `path`, `file_path`, notebook paths, and meta-tool commands. Do not duplicate ad hoc mappings across composer and executor. Explicit-denial reasons must be exhaustively named, including immutable blacklist, restricted mode, deny lists, denied patterns, unavailable/excluded tools, and external denial/error. Unknown/exceptional states return a denied result.

Move pre-tool hook execution out of the unconditional executor body into this preflight. Apply hook decisions in order. Never let a hook override an immutable or explicit policy denial. Recheck policy after any input/alternative mutation.

**Verify**: `bun run test tests/toolManager.spec.ts tests/hookManager.spec.ts tests/integration/securityIntegration.spec.ts` exits 0.

### Step 4: Remove bypasses and double prompts

Update `AgentDependencyComposer` so the canonical preflight receives the real `PermissionManager`, hook manager, and confirmation callback. Ensure `confirmAgentDangerousAction` is reached only after policy checks.

Update `ActionExecutor` branches that perform their own permission handling to respect `context.approvalHandled`. Keep direct-call defense-in-depth: if no canonical preflight marker is present, mutating or command actions must still run the same policy check and prompt path. Do not remove security from direct callers merely to eliminate a double prompt.

**Verify**: `bun run test tests/actionExecutor.spec.ts tests/actionExecutor-validation.spec.ts tests/modes/rpc/yoloMode.spec.ts tests/modes/acp/permissions.test.ts` exits 0.

### Step 5: Prove wire compatibility

Verify permission requests retain `requestId`, `tool`, `description`, `context.command/path/args`, options, and timestamp. Preserve structured decisions and legacy RPC normalization. Preserve hook environment/JSON input and ACP permission modes.

**Verify**: `bun run test tests/modes/rpc/handlers.spec.ts tests/modes/rpc/types.spec.ts tests/rpcHooks.spec.ts tests/modes/acp/adapter.test.ts tests/modes/acp/permissions.test.ts` exits 0.

### Step 6: Run full repository gates

Run tests, lint, and proof in the required order.

**Verify**:

```sh
bun run test
bun run lint
bun run proof
```

All commands must exit 0.

## Test plan

- Real-path tests, not isolated `PermissionManager` tests, are the primary regression proof.
- Cover immutable blacklist under every auto-approval path, explicit denials, default safe tools, hook decisions, hook input mutation, alternative mutation, thrown/malformed callbacks, batched calls, and no-side-effect assertions.
- Cover both existing and new file writes and every file mutation family.
- Preserve existing scoped-decision and RPC/ACP permission suites.
- Do not assert only on error text; assert executor/hook/event call order and absence of side effects.

## Done criteria

- [x] Every registered tool call passes one canonical authorization preflight before side effects.
- [x] Immutable blacklist and explicit deny cannot be bypassed by `--yes`, YOLO, unrestricted, hooks, RPC, or ACP.
- [x] Pre-tool blocking/deny/ask/update semantics use the existing EventHooks contract.
- [x] Mutated inputs are re-authorized and cannot change tool type.
- [x] Denied calls emit no `tool_start`; started calls retain paired lifecycle events.
- [x] Direct `ActionExecutor` callers remain protected and normal calls do not double-prompt.
- [x] Focused security, hook, RPC, ACP, and tool tests pass.
- [x] `bun run test`, `bun run lint`, and `bun run proof` exit 0.
- [x] The Plan 001 slice introduced no dependency/version change; later audited queue work upgraded dependencies separately.
- [x] Plan 001 remained within its implementation scope; the integrated delivery and `plans/README.md` include the other approved plans and queue items.

## STOP conditions

Stop and report if:

- `PermissionManager` semantics changed after `292a304` or the immutable blacklist is no longer first.
- Correct implementation requires changing SDK permission decision strings, RPC method names, or ACP mode semantics.
- A pre-tool hook's `additionalContext` has no safe existing routing seam; do not silently discard or invent a public contract.
- Safe no-approval tools cannot preserve their current behavior without a broader product decision to prompt on every read.
- The solution would emit `tool_start` for denied actions without a matching, contract-tested terminal event.
- Any verification fails twice after a reasonable focused correction.
- An out-of-scope file must change.

## Maintenance notes

- Every future built-in, MCP, meta-tool, or dynamically registered tool must pass through this preflight; registration must not create an alternate execution path.
- Reviewers should scrutinize policy ordering, input mutation, batched-call ordering, and whether failures truly occur before side effects.
- Plan 002 will make the authorization denial result machine-readable end to end. Do not add string-prefix classification here.
