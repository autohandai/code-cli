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

Validation logs are retained locally under `.tmp/peer-communication-validation/`.
The results below distinguish focused checks from the aggregate release gate.

- The first focused run covered 42 files and 524 cases. It exposed two integration
  issues in offline outgoing intent and uncertain process ownership; both were fixed.
- The initial aggregate proof ran 683 files: 9,898 passed, 20 failed, 41 skipped.
  Subsequent fixes corrected the coordinated-worktree mock and callback metadata
  expectations. A targeted rerun passed 209 of 210 cases across the affected 15 files.
  Its remaining failure was the unchanged Blueprint identity reader, which reads loose
  refs but misses this worktree's packed branch ref.
- Real built-CLI Tuistory validation exposed reply restoration timing and an empty
  recipient-directory snapshot on the receiving session. Both paths were repaired;
  all three built-CLI peer scenarios now pass, including send, inbox, correlated reply,
  draft preservation, peer exit, and disabled-startup compatibility.
- The final composer/runtime regression group passes all 76 tests across five files.
  Repository lint and typecheck pass.
- The docs build and discovery audit pass; 284 pages are indexed with no discovery
  errors. JavaScript and declaration builds pass. These results do not substitute for
  the complete CLI proof or live-provider/platform evidence.

## Current limits

Windows peer messaging is disabled until private named-pipe and process-job adapters
are implemented. This workstation supplies macOS evidence; live Linux validation
and the full loaded/reconnect/platform performance matrix remain unverified.

Communication is local to the same OS user and machine. It does not provide a LAN
server, cross-host sockets, a sandbox for arbitrary trusted extension code, or
ownership of processes started outside the participating launch APIs. Native editor
and infrastructure launches are outside the shared workload admission guarantee.
