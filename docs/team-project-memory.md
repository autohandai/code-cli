# Team project memory

Status: implemented locally; API deployment and CLI distribution pending

## Behavior

1. Members connected to the same selected team account and Git repository share project memories. Personal user memories stay in the existing user-owned library. Merely logging in or belonging to a team does not publish personal memories.
2. Sharing requires an auth token, explicit `api.accountId` (or `AUTOHAND_ACCOUNT_ID`), enabled sync, and an HTTPS/SSH Git origin. The repository key is SHA-256 of a credential-free canonical host/repository identity. HTTPS and SSH origins for the same repository produce the same key, independent of local paths, branches and worktrees. Local-only repositories remain local.
3. The API validates active team membership for every read/write. Owners, admins and contributors can share project memories; read-only accounts can read but not publish. The API requires the explicit account header and never defaults a request into a team.
4. Shared project state uses a separate R2 event log at account/project scope. It reuses existing memory event validation, merge and replay semantics. User-level events are rejected. Concurrent writers merge through conditional writes; deletion tombstones survive stale uploads.
5. The CLI retains account/project cache directories outside ordinary personal file sync. Changing account, auth, workspace or repository immediately changes the active cache. Team A's library must never be uploaded to Team B or included when logged out. Local project memories are preserved and seeded into a newly connected shared project without importing personal user entries.
6. Project mutations append locally through the existing MemoryManager, then sync. Each turn refreshes shared project memories before building its context, so changes from another member appear in the running agent. Background reflections, session extraction and context summarization capture their original account/project scope and check it again inside the storage lock; a later account or workspace change prevents those project notes from saving into the new scope. Cached data can be used offline for the same authenticated account/project; failed sync keeps pending writes and reports an actionable error. Permission failures revoke the cached binding.
7. Shared context is explicitly marked as team/project knowledge and treated as repository guidance, subordinate to the user's current instructions. Later turn context supersedes earlier memory snapshots. Personal creation limits continue to apply to the user library; the project pool is separate and has a bounded log size.
8. No production deployment, release, commit or push is included. Verification must demonstrate two members sharing one project, distinct accounts/projects remaining isolated, personal memory privacy, account removal/switches, concurrent merge, deletion, read-only permissions and runtime context refresh.

## API contract

`GET /v1/project-memories/:projectId` and `PUT /v1/project-memories/:projectId`, with bearer auth and `X-Autohand-Account-Id`. Project IDs are 64 lowercase hex characters. PUT body: `{ "log": "JSONL" }`. Successful response: `{ "success": true, "accountId": "...", "projectId": "...", "canWrite": true, "log": "JSONL" }`. GET returns an empty log for a new project. Maximum log size: 10 MiB. Responses are private/no-store. Invalid log/scope returns 400, denied access 403, conflicting event IDs 409, oversized log 413; exhausted CAS retries return 409. Clients must verify both returned scope IDs before accepting data.

## Configuration

After logging in, select the team with `api.accountId` in the active CLI profile or the existing `AUTOHAND_ACCOUNT_ID` environment variable. The environment variable takes precedence. Existing `sync.enabled: false` or an exclusion matching `memory/events/LOG.jsonl` disables project sharing. The Git `origin` identifies the project; branches and local clone locations do not create separate pools.

The first successful connection seeds existing local project memories into that team's project. Personal memory and normalized personal Claude/Codex imports are not seeded. Shared changes are cached under `~/.autohand/.project-memories/`, outside ordinary personal file sync.

On account changes or logout, earlier shared-memory blocks are removed from system/bootstrap notes before the next turn. Historical user, assistant and tool messages remain part of the conversation; this feature does not erase transcripts.

Architecture decision: [share project memory within a selected team account](adr/2026-10-10-team-project-memory.md).

## Local verification (2026-10-10)

- Final CLI source: 150 focused tests passed across 10 files, covering two-member sharing through the real MemoryManager, private personal entries, deletion, offline recovery, read-only permissions, account/repository/backend isolation, per-turn context replacement and delayed reflection/extraction/summarization writes.
- CLI lint, typecheck and final ESM/CJS/declaration build passed. API typecheck and the full API suite passed: 117 files, 1,710 tests.
- The aggregate CLI unit run during implementation passed 11,848 tests, failed five ReactLoopRunnerStatus tool-selection tests and skipped 71. Those five failures were reproduced against unchanged HEAD; `bun run proof` therefore stopped at its unit stage.
- A separate aggregate build/terminal run passed 271 tests, failed nine and skipped two across 63 files. Failures concern workflow-help matching, research/status/provider fixtures, QR/process output, reasoning settings and diff rendering, with some teardown errors. This aggregate used the earlier implementation build, before the final deferred-writer guards.
- The workflow-help failure also reproduced against the final rebuilt CLI in isolation: `/deslop help` wraps `Preserves behavior and unrelated work` across terminal lines, while the scenario waits for the uninterrupted string. Its fixture has no selected team account and disables sync.

These results prove local API/storage-fixture and CLI memory/runtime behavior. They do not prove live Cloudflare storage, production sharing or a released CLI. API deployment and CLI distribution remain pending.
