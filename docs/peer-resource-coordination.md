# Coordinate build resources across sessions

Resource coordination gives an authorized controller a shared, capacity-one build
resource. Workers request access, the controller selects a ticket, and the runtime
checks the reservation before starting a participating command. A priority message
alone never grants access, frees capacity, or kills a running build.

## Configure the controller and participants

Enable communication in each session. Use `machine` scope for different projects and
set `allowResourceControl` only in sessions that you authorize to install policies and
grant requests:

```json
{
  "sessions": {
    "communication": {
      "enabled": true,
      "alias": "build-controller",
      "scope": "machine",
      "idleBehavior": "notify",
      "allowResourceControl": true,
      "resourceWaitTimeoutMs": 300000
    }
  }
}
```

Worker sessions can leave `allowResourceControl` false. `auto` is optional and separately
authorizes idle model turns; controller authority alone does not enable automatic work.
Only grant this authority to a principal that should make coordination decisions.

Use `list_peers` to obtain the exact controller and worker IDs. Install the policy from
an authorized session through the model's `coordinate_resource` tool:

```json
{
  "operation": "set_controller",
  "resource": "machine/xcodebuild",
  "controller": "<controller-peer-id>",
  "participants": ["<worker-a-peer-id>", "<worker-b-peer-id>"],
  "profile": "build"
}
```

Replace placeholders with IDs returned by discovery. Tool examples show JSON arguments,
not composer commands. You can ask the model to perform the operation with those values.
The designated controller must also possess `resource.control` to issue grants.

Resource keys are `machine/<name>` or `repository/<common-directory-id>/<name>`. Names
contain letters, digits, underscores, dots and dashes. A repository identifier is an
opaque, consistently chosen token shared by the participating controller and workers;
use a hash of the canonical common Git directory when provisioning repository policies.
The coordination directory supplies the namespace. Different directories have independent
resource state even when the resource name matches.

## Request, grant, execute

The worker requests one resource ticket:

```json
{"operation":"request","resource":"machine/xcodebuild","reason":"Build the reviewed app revision"}
```

The result contains `requestId`, `epoch`, the controller, holder and queue. A queued
ticket does not authorize a process. The controller grants the selected ticket:

```json
{"operation":"grant","requestId":"<request-id>","epoch":1}
```

Use the epoch returned by the current policy. The worker can receive the grant through
`peer_messages` with an event cursor and a bounded wait, then invoke its normal command
tool. The executor also requests and waits when the model omitted an explicit ticket.
It displays `waiting_resource` while parked. Waiting keeps the live worker counted in
its existing thread budget and does not use reasoning-loop iterations.

Normal command permissions still apply. `--yes`, auto-confirmation and YOLO do not grant
resource access. The gate revalidates after approval and binds an unused reservation to
the exact command/cwd. Multiple eligible tickets require explicit selection instead of
guessing. The default hard resource wait is five minutes; cancellation or timeout returns
a typed outcome and prevents spawn.

## Choose an enforcement profile

| Profile | Participating commands |
| --- | --- |
| `build` | Known build/test executables and package scripts, including `xcodebuild`, Make/CMake/Ninja, Gradle/Maven, Swift/Go/Cargo, and npm/pnpm/yarn/Bun build, test, check, proof, lint, typecheck and compile scripts. Recognized shell/env wrappers are inspected. |
| `strict` | Every process launch through the managed command gate in an enrolled session. Runtime-owned discovery, authentication and read-only observation probes are outside the workload gate. |

Use `strict` when an arbitrary wrapper can hide a build. The `build` profile does not
prove that a custom script is harmless. Managed paths include shell tools, immediate
commands, foreground/background/PTY execution, hooks, formatters, linters, quality
scripts, environment bootstrap, worktree operations, goal template commands, Git
mutations, automode checkpoints, the built-in browser launcher and `/tester` scripts.
Published workers and teammates inherit their root's enrollment.

Trusted extensions that call the standard command executor participate. Arbitrary native
code inside a trusted extension, external MCP servers, independent third-party agents,
external terminals and older unenrolled clients are outside this guarantee. Their
processes cannot be inferred or controlled from peer presence alone. Autohand's own
authentication, update and team-host processes are control infrastructure; worker workload
commands are gated inside their runtime.

## Let the current build finish

Requesting a different priority changes which queued ticket the controller grants next.
It does not cancel a running command. Policy changes increment the epoch and invalidate
unused reservations while retaining started work.

A private managed-launch ledger records admission before spawn, including commands
started before a resource policy existed. Installing or widening a policy adopts the
relevant admitted commands as visible blockers. New grants wait until all their owned
process trees finish. A policy installed between the initial check and final admission
causes `STALE_POLICY`; retry under the current policy. A policy installed after admission
preserves that admitted command and blocks later grants.

Backgrounding preserves ownership. Exiting the initial shell does not release capacity
when its process group still has children. Cancellation signals the owned group, and
capacity is released only after exit is established. A crash between admission, spawn
and identity publication leaves a conservative blocker for recovery.

## Inspect and cancel safely

```json
{"operation":"status","resource":"machine/xcodebuild"}
```

Status includes policy epoch, controller, queue ages, current reservation and any managed
launch blockers. Resource events carry resource identity, request identity, epoch and a
durable sequence. Consume them through `peer_messages`; recording an event never creates
a model turn by itself.

```json
{"operation":"cancel_request","requestId":"<queued-request-id>"}
```

This cancels the caller's unused ticket. `release` frees the caller's unused reservation.
Neither operation can free a `starting` or `running` command. Ending an agent run cancels
its queued tickets and unused reservations while preserving active process ownership.

Unused reservations expire after 30 seconds. Started commands have no time-based lease
expiry. `RECOVERY_REQUIRED` means ownership is uncertain, not that the resource is free.
Investigate the persisted process incarnation and process tree before operator recovery;
do not delete a ledger or resource file while a process may still be running.

## Implementation ownership

`ResourceCoordinator` owns private, atomic state and short metadata transactions.
`CommandCoordinationGate` owns command admission, process publication and tree draining.
Policy installation and final command admission serialize through the namespace lock;
resource grants serialize through each resource's own lock. Locks are released before
commands run or grants are awaited. The launch ledger remains independent of a root or
controller's lifetime, so an absent heartbeat never frees a running build.

See the [protocol reference](peer-communication-protocol.md) for storage paths, limits,
security assumptions and the worker adapter boundary.
