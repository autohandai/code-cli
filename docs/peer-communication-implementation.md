# Peer communication implementation and evidence

Design: [Local peer communication and build coordination](peer-communication-design.md).
Implementation baseline: `bebd0857` on `peer-communication`.

The Unix peer runtime, worker adapters, terminal composer, durable messages, and
managed resource coordination are implemented. Communication is opt-in and defaults
off. The guides and configuration reference are available in this repository and
in the docs-site source. This is a source implementation, not a published release.

## Delivered behavior

- Each root owns an authenticated local Unix socket and a process incarnation.
  Workspace, repository, and machine scope apply in both directions. Exact root and
  worker IDs prevent alias reuse from silently redirecting a message.
- Inbox/outbox persistence records acceptance, consumption, replies, expiry, and
  unresolved delivery. Retained messages remain addressable for correlated replies.
  Peer context carries provenance and is consumed at recorded context boundaries.
- Root agents, in-process subagents, and parent-owned teammate stdio adapters expose
  scoped peer tools. RPC and ACP surfaces publish peer events. Notify is the default
  idle policy; automatic turns require explicit configuration and existing budgets.
- The colon composer supports exact selection, direct sends, inline references,
  scoped discovery, draft/history/queue restoration, and an inbox with reply drafting.
  A reply refreshes the sender directory and installs its identity, correlation, and
  scope before the composer resumes.
- Resource controllers authorize participating commands before spawn. Namespace
  admission records include commands already starting/running when a policy is
  installed. Process ownership lasts until the enrolled process tree has ended;
  uncertain ownership stays blocked for recovery.
- Shell/PTY, Git mutations, worktree changes, hooks, build/quality runners, formatter
  and linter launches, bootstrap/goal commands, browser search, project tracking, and
  `/tester run` use the shared gate when enrolled in the root coordination context.

## User and operator documentation

- [Peer communication guide](peer-communication.md)
- [Resource coordination guide](peer-resource-coordination.md)
- [Protocol, runtime, persistence and limits](peer-communication-protocol.md)
- [Two-session terminal lab](peer-communication-lab.md)
- [Configuration and required ports](config-reference.md#required-ports-and-agent-transports)

The docs site contains corresponding guide/tutorial pages, sidebar/index links, and
peer settings plus the full port/transport table on its configuration page. Existing
unrelated site edits were preserved. Nothing has been deployed by this task.

## Validation record

Logs are retained locally under `.tmp/peer-communication-validation/`.

| Check | Result |
| --- | --- |
| Full unit suite, including real peer IPC, processes and resource coordination | 9,918 passed, 41 skipped across 683 files. |
| Repository lint and typecheck | Passed. |
| JavaScript and declaration builds | Passed. |
| Built CLI peer scenarios | All three passed: direct send, inbox/reply, draft preservation, peer exit, and disabled startup. |
| Final composer/runtime regression group | All 76 tests passed across five files. |
| Aggregate terminal suite | 158 passed, one skipped; a sync/connector transition timed out. |
| Sync close repair plus peer terminal regressions | All four passed together after preventing late sync redraws and accepting autocomplete explicitly in the scenario. |
| Docs build and discovery | Passed; 284 pages indexed, no discovery errors, configuration port table included in HTML and Markdown. |
| Full 2/10/50-peer benchmark attempt | No valid result produced. No latency or throughput claim is made; no benchmark fixture processes remained after the attempt. |

The aggregate proof rerun after the sync repair passed lint/typecheck, then reported
CLI subprocess, coordinated-command/PTY, and project-test-run failures. It was stopped
with SIGINT (exit 130) after repeated failures; see `completion-proof.log`. The
previous full unit pass and repaired terminal scenarios are useful evidence, but the
latest aggregate proof is incomplete. This branch is not certified release-ready.

## Current limits

Windows peer messaging is disabled until private named-pipe and process-job adapters
are implemented. This workstation supplies macOS evidence; live Linux validation
and the full loaded/reconnect/platform performance matrix remain unverified.

Communication is local to the same OS user and machine. It does not provide a LAN
server, cross-host sockets, a sandbox for arbitrary trusted extension code, or
ownership of processes started outside the participating launch APIs. Native editor
and infrastructure launches are outside the shared workload admission guarantee.
